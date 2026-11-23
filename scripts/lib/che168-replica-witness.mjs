import fs from 'node:fs/promises';
import {constants, openSync, readSync, closeSync, fstatSync, readdirSync, lstatSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {execFileSync, fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {snapshotBinding} from './che168-snapshot.mjs';
import {restoreChe168Replica} from './che168-replica.mjs';
import {assertRawHandoff, assertRawPin, rawDigest, rawReferences} from './catalog-raw-provenance.mjs';
import {createResourceNodeInvocation, reportResourceNodeStartup} from './node-resource-memory.mjs';

export const CHE168_REPLICA_WITNESS_KIND = 'independent_che168_replica_v1';
export const CHE168_REPLICA_WITNESS_SOURCE = 'autohome_used_china_open';
export const CHE168_REPLICA_WORKER_CLOSURE = Object.freeze([
  'scripts/catalog-auto-api-che168-bulk-intake.mjs', 'scripts/lib/che168-replica-witness.mjs',
  'scripts/lib/che168-replica.mjs', 'scripts/lib/che168-replay-journal.mjs', 'scripts/lib/che168-snapshot.mjs',
  'scripts/lib/che168-csv-stream.mjs', 'scripts/lib/auto-api-che168-client.mjs', 'scripts/lib/che168-missing-details.mjs',
  'scripts/lib/catalog-intake-checkpoint.mjs', 'scripts/lib/catalog-raw-provenance.mjs',
  'scripts/lib/node-resource-memory.mjs', 'scripts/lib/node-resource-memory-startup.mjs',
  'apps/web/lib/catalog/auto-api-che168.ts', 'apps/web/lib/catalog/storage.ts', 'apps/web/lib/data.ts',
  'apps/web/lib/catalog/china-year-policy.ts', 'apps/web/lib/catalog/collection-controls.ts',
]);
export const CHE168_REPLICA_WITNESS_LIMITS = Object.freeze({payloadBytes: 1024 ** 2, workMs: 300000});
const CHUNK = 16 * 1024 ** 2, SHA = /^[a-f0-9]{64}$/, COMMIT = /^[a-f0-9]{40}$/;
const INSPECTION_CHILD = '--che168-replica-inspection-child';
const UUID = '[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}';
const ROOT = new RegExp('^catalog/provider-replicas/che168/' + UUID + '$');
const bytesDigest = bytes => createHash('sha256').update(bytes).digest('hex');
const integer = (n, max = Number.MAX_SAFE_INTEGER, min = 0) => Number.isSafeInteger(n) && n >= min && n <= max;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ascii = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = code => {throw Error('che168_replica_witness_' + code);};
const check = (condition, code) => {if (!condition) fail(code);};
const same = (a, b) => rawDigest(a) === rawDigest(b);
const signed = body => ({...body, checksum: rawDigest(body)});
const sourceId = CHE168_REPLICA_WITNESS_SOURCE;
const stableId = id => bytesDigest(sourceId + ':' + id).slice(0, 24);
const safeError = error => /^che168_replica_witness_[a-z0-9_]+$/.test(error?.message || '') ? error.message : 'che168_replica_witness_failed';
export function addChe168WitnessCount(total, increment) {
  check(integer(total) && integer(increment), 'census');
  const next = total + increment; check(integer(next), 'census'); return next;
}

/** Workflow SHA cannot substitute for a different or dirty collector checkout.
 * The mandatory closure must be tracked; all tracked differences and any
 * untracked code under scripts, app libraries or packages invalidate proof. */
export function che168ReplicaWorkerSource(root = fileURLToPath(new URL('../../', import.meta.url))) {
  const options = {cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe']};
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', ...CHE168_REPLICA_WORKER_CLOSURE], options);
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--'], options);
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'scripts', 'apps/web/lib', 'packages'], options).trim();
    if (untracked) return null;
    const source = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], options).trim();
    return COMMIT.test(source) ? source : null;
  } catch {return null;}
}

/** Future main producers only. A failed optional retirement proof neither
 * changes feed completeness nor discards rows or ancestral protection. */
export async function prepareChe168ReplicaInputWitness({storage, directory, config, owner, environment = process.env,
  deadline, signal, temporaryParent}) {
  const unavailable = reason => ({sourceInputWitnessUnavailable: reason});
  if (environment.GITHUB_REPOSITORY !== 'jeep-jim/AvtoCena' || environment.GITHUB_REF !== 'refs/heads/main') {
    return unavailable('che168_replica_witness_future_main_only');
  }
  const sourceSha = che168ReplicaWorkerSource();
  if (!sourceSha) return unavailable('che168_replica_witness_worker_source_unverified');
  if (sourceSha !== owner?.revision || environment.GITHUB_SHA !== sourceSha
    || environment.GITHUB_RUN_ID !== owner?.runId || environment.GITHUB_RUN_ATTEMPT !== owner?.attempt) {
    return unavailable('che168_replica_witness_worker_source_mismatch');
  }
  try {
    const sourceInputWitness = await verifyChe168ReplicaInput({storage, directory, config,
      producer: {runId: owner.runId, attempt: owner.attempt, sourceSha}, deadline, signal, temporaryParent});
    return {sourceInputWitness};
  } catch (error) {return unavailable(safeError(error));}
}

function boundedLimits(options) {
  check(object(options), 'limits');
  const value = {...CHE168_REPLICA_WITNESS_LIMITS};
  for (const [key, amount] of Object.entries(options)) {
    check(Object.hasOwn(value, key) && integer(amount, value[key], 1), 'limits'); value[key] = amount;
  }
  return value;
}

function readReport(directory) {
  const pieces = [], scan = fileDigest(path.join(directory, 'report.json'), chunk => pieces.push(Buffer.from(chunk)));
  const bytes = Buffer.concat(pieces, scan.bytes);
  const report = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  check(object(report), 'report');
  const {sourceInputWitness, ...body} = report;
  return {report, body, bytesSha256: scan.sha256};
}

function validateReport(report, config, producer, limits) {
  check(report.version === 1 && report.market === 'china' && report.provider === 'auto_api_che168'
    && report.completed === true && !report.failure && !report.partial
    && !['saved_snapshot_technical_repair', 'technical_repair'].includes(report.mode)
    && !(report.rawArchiveDependencies?.length) && Array.isArray(report.sources)
    && report.sources.length > 0 && report.sources.length <= 100
    && Number.isFinite(Date.parse(report.completedAt)), 'completed_report');
  const sources = report.sources.filter(row => row?.sourceId === sourceId), source = sources[0], binding = snapshotBinding(config);
  check(sources.length === 1 && source.provider === 'auto_api_che168'
    && source.completeInventory === true && source.stopReason === 'source_finished' && source.rejectedIdentity === 0
    && !source.partial && !source.failure && source.snapshotBinding === binding
    && source.snapshotStartedAt === config.modifiedAt && integer(source.initialCursor) && source.initialCursor >= config.initialCursor
    && integer(source.cursor) && source.cursor >= source.initialCursor && integer(source.changes)
    && integer(source.uniqueOffers, Number.MAX_SAFE_INTEGER, 1) && source.observations === source.uniqueOffers, 'source_report');
  const descriptor = source.replica;
  check(ROOT.test(descriptor?.key || '') && SHA.test(descriptor.sha256 || '') && descriptor.binding === binding
    && descriptor.cursor === source.cursor, 'replica_identity');
  check(object(producer) && /^\d{1,20}$/.test(producer.runId || '') && /^[1-9]\d{0,5}$/.test(producer.attempt || '')
    && COMMIT.test(producer.sourceSha || ''), 'producer');
  const base = source.baseReplica ? {key: source.baseReplica.key, sha256: source.baseReplica.sha256, binding, cursor: source.initialCursor} : null;
  check(!base || ROOT.test(base.key || '') && SHA.test(base.sha256 || '') && base.key !== descriptor.key, 'base_replica');
  check(base || source.initialCursor === config.initialCursor, 'initial_cursor');
  const cutId=source.ownedFeedRun;
  check(cutId===undefined || typeof cutId==='string' && /^[1-9]\d*$/.test(cutId),'owned_feed_run');
  const journalBinding = rawDigest({binding, initialCursor: source.initialCursor, base, ...(cutId?{cutId}:{}), replayVersion: 2});
  const journalKey = 'catalog/intake-working/che168-v1/' + BigInt('0x' + journalBinding.slice(0, 14)).toString();
  check(source.workingJournal?.key === journalKey && source.workingJournal.binding === journalBinding, 'journal_binding');
  check(Array.isArray(report.rawStoragePins) && report.rawStoragePins.length <= 64, 'producer_pin');
  const pins = report.rawStoragePins.filter(pin => pin?.references?.some(row => row.kind === 'che168-replica' && row.root === descriptor.key));
  check(pins.length === 1, 'producer_pin');
  const handoff = assertRawHandoff(pins[0]);
  check(same(handoff.owner, {runId: producer.runId, attempt: producer.attempt, revision: producer.sourceSha})
    && handoff.references.some(row => row.kind === 'che168-journal' && row.root === journalKey)
    && handoff.references.every(row => row.root !== descriptor.key || !row.sha256 || row.sha256 === descriptor.sha256), 'producer_binding');
  return {source, binding, descriptor, journalKey, journalBinding, handoff};
}

function validateManifest(manifest, context, limits) {
  const {descriptor, binding, source} = context;
  check(object(manifest) && rawDigest(manifest) === descriptor.sha256 && manifest.version === 1
    && manifest.binding === binding && manifest.cursor === source.cursor && integer(manifest.bytes, Number.MAX_SAFE_INTEGER, 1)
    && Array.isArray(manifest.parts) && manifest.parts.length > 0
    && manifest.parts.length === Math.ceil(manifest.bytes / CHUNK)
    && manifest.parts.every((part, index) => object(part) && part.bytes === Math.min(CHUNK, manifest.bytes - index * CHUNK)
      && SHA.test(part.sha256 || '')), 'manifest');
}

function validateJournal(head, context) {
  const {source, journalBinding} = context;
  // The existing journal does not persist an empty head until its first
  // commit. Absence is usable only for the exactly unchanged cursor; the
  // resulting witness explicitly records that no saved head was present.
  if (head === null) {check(source.cursor === source.initialCursor && source.changes === 0, 'journal_missing'); return;}
  check(object(head) && head.version === 2 && head.binding === journalBinding && head.initialCursor === source.initialCursor
    && head.cursor === source.cursor && head.changes === source.changes
    && integer(head.bytes) && integer(head.rawBytes)
    && Array.isArray(head.chunks)
    && head.chunks.every(row => new RegExp('^' + UUID + '$').test(row?.id || '') && SHA.test(row.sha || ''))
    && new Set(head.chunks.map(row => row.id)).size === head.chunks.length
    && (head.cursor === head.initialCursor ? head.changes === 0 && head.chunks.length === 0 && head.bytes === 0 && head.rawBytes === 0
      : head.changes > 0 && head.chunks.length > 0 && head.bytes > 0 && head.rawBytes > 0), 'journal');
}

function validateProducerPin(pin, handoff) {
  assertRawPin(pin);
  check(['ready', 'published'].includes(pin.state) && pin.operationId === handoff.operationId
    && pin.readyAt === handoff.readyAt && same(pin.owner, handoff.owner)
    && rawDigest(rawReferences(pin.references)) === handoff.referencesSha256, 'producer_pin_changed');
}

function fileDigest(filename, onChunk = () => {}) {
  const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW), hash = createHash('sha256');
  try {
    const before = fstatSync(fd); check(before.isFile() && integer(before.size, Number.MAX_SAFE_INTEGER, 1), 'database_size');
    const buffer = Buffer.alloc(65536); let total = 0, header;
    for (;;) {const bytes = readSync(fd, buffer, 0, buffer.length, null); if (!bytes) break;
      total = addChe168WitnessCount(total, bytes); check(total <= before.size, 'database_size');
      if (!header) header = Buffer.from(buffer.subarray(0, Math.min(100, bytes)));
      hash.update(buffer.subarray(0, bytes)); onChunk(buffer.subarray(0, bytes));}
    const after = fstatSync(fd); check(total === before.size && total === after.size
      && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'database_changed');
    return {bytes: total, sha256: hash.digest('hex'), header};
  } finally {closeSync(fd);}
}

function readObservationShard(filename, rowBytes, onRow) {
  let pending = [], pendingBytes = 0, rows = 0;
  const scan = fileDigest(filename, chunk => {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start), end = newline < 0 ? chunk.length : newline;
      if (end > start) {
        pendingBytes = addChe168WitnessCount(pendingBytes, end - start); check(pendingBytes <= rowBytes, 'observation_size');
        pending.push(Buffer.from(chunk.subarray(start, end)));
      }
      if (newline < 0) break;
      check(pendingBytes > 0, 'observation_size');
      const row = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(pending, pendingBytes)));
      pending = []; pendingBytes = 0; rows = addChe168WitnessCount(rows, 1);
      check(rows <= 500, 'observation_count'); onRow(row); start = newline + 1;
    }
  });
  check(pendingBytes === 0, 'shard_bytes');
  return {bytes: scan.bytes, sha256: scan.sha256, rows};
}

function inspectDatabase({filename, directory, source, config, completedAt, limits, deadline}) {
  const within = () => check(Date.now() < deadline, 'deadline'); within();
  const before = fileDigest(filename), header = before.header;
  check(header?.length === 100 && header.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))
    && header[18] === 1 && header[19] === 1, 'closed_database');
  const db = new DatabaseSync(filename, {readOnly: true, allowExtension: false});
  let normalized, inventory, schemaSha256, observationFiles;
  try {
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA cache_size=-16384;');
    const schema = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name COLLATE BINARY').all();
    const table = schema.find(row => row.type === 'table' && row.name === 'inventory');
    check(schema.length === 2 && table?.tbl_name === 'inventory'
      && table.sql.replace(/\s/g, '').toLowerCase() === 'createtableinventory(idtextprimarykey,payloadtextnotnull,eventintegernotnull)'
      && schema.some(row => row.type === 'index' && row.name === 'sqlite_autoindex_inventory_1'
        && row.tbl_name === 'inventory' && row.sql === null), 'schema');
    const columns = db.prepare('PRAGMA table_xinfo(inventory)').all();
    check(same(columns.map(row => [row.name, row.type, row.notnull, row.dflt_value, row.pk, row.hidden]),
      [['id', 'TEXT', 0, null, 1, 0], ['payload', 'TEXT', 1, null, 0, 0], ['event', 'INTEGER', 1, null, 0, 0]]), 'schema');
    schemaSha256 = rawDigest({schema, columns});
    const integrity = db.prepare('PRAGMA integrity_check').all(); within();
    check(integrity.length === 1 && integrity[0].integrity_check === 'ok', 'integrity');
    const count = Number(db.prepare('SELECT count(*) AS n FROM inventory').get().n);
    check(integer(count, Number.MAX_SAFE_INTEGER, 1) && count === source.uniqueOffers, 'count');
    const pageSize = Number(db.prepare('PRAGMA page_size').get().page_size), pages = Number(db.prepare('PRAGMA page_count').get().page_count);
    check(integer(pageSize, 65536, 512) && integer(pages, Number.MAX_SAFE_INTEGER, 1)
      && integer(pageSize * pages) && pageSize * pages === before.bytes, 'database_pages');
    const pairs = new Map(), idsHash = createHash('sha256').update('['), payloadHash = createHash('sha256').update('[');
    let previous = '', rows = 0, minEvent = Infinity, maxEvent = -Infinity;
    for (const row of db.prepare('SELECT id,payload,event FROM inventory ORDER BY id COLLATE BINARY').iterate()) {
      within(); check(typeof row.id === 'string' && /^\d{1,32}$/.test(row.id) && row.id > previous
        && typeof row.payload === 'string' && Buffer.byteLength(row.payload) <= limits.payloadBytes
        && integer(row.event, source.cursor, config.initialCursor - 1), 'inventory_row');
      const offer = JSON.parse(row.payload);
      check(object(offer) && JSON.stringify(offer) === row.payload && offer.id === stableId(row.id)
        && offer.sourceOfferId === row.id && offer.sourceId === sourceId && offer.market === 'china'
        && offer.operational?.provider === 'auto-api.com' && offer.operational.detailIdentityVerified === true, 'row_identity');
      if (rows) {idsHash.update(','); payloadHash.update(',');}
      idsHash.update(JSON.stringify(row.id)); payloadHash.update(JSON.stringify([row.id, bytesDigest(row.payload), row.event]));
      previous = row.id; rows = addChe168WitnessCount(rows, 1); minEvent = Math.min(minEvent, row.event); maxEvent = Math.max(maxEvent, row.event);
      offer.operational = {...offer.operational, lastSeenAt: completedAt,
        che168ActiveVerification: {method: 'snapshot_and_complete_change_stream', snapshotBinding: source.snapshotBinding,
          initialCursor: config.initialCursor, cursor: source.cursor, verifiedAt: completedAt}};
      check(!pairs.has(offer.id), 'duplicate_id'); pairs.set(offer.id, rawDigest(offer));
    }
    check(rows === count, 'count');
    inventory = {rows, idsSha256: idsHash.update(']').digest('hex'), rowsSha256: payloadHash.update(']').digest('hex'), minEvent, maxEvent};
    const seen = new Set(), files = [], names = readdirSync(directory).filter(name => name.startsWith(sourceId + '-')).sort(ascii);
    check(names.length > 0, 'shard_count'); let totalBytes = 0;
    for (const [index, name] of names.entries()) {
      within(); check(name === sourceId + '-' + String(index + 1).padStart(6, '0') + '.jsonl', 'shard_name');
      const target = path.join(directory, name); check(lstatSync(target).isFile(), 'shard_type');
      const actual = readObservationShard(target, limits.payloadBytes + 4096, row => {
        within();
        check(row?.stage === 'detail' && row.observedAt === completedAt && object(row.offer)
          && !seen.has(row.offer.id) && pairs.get(row.offer.id) === rawDigest(row.offer), 'observation_changed');
        seen.add(row.offer.id); check(seen.size <= count, 'observation_count');
      });
      totalBytes = addChe168WitnessCount(totalBytes, actual.bytes);
      files.push({name, ...actual});
    }
    check(seen.size === count && seen.size === source.observations, 'observation_missing');
    const sorted = [...pairs].sort(([a], [b]) => ascii(a, b));
    normalized = {rows: sorted.length, idsSha256: rawDigest(sorted.map(([id]) => id)), rowsSha256: rawDigest(sorted)};
    inventory.observationFilesSha256 = rawDigest(files); inventory.observationBytes = totalBytes;
    observationFiles = files;
  } finally {db.close();}
  within(); const after = fileDigest(filename);
  check(after.sha256 === before.sha256 && after.bytes === before.bytes && readdirSync(path.dirname(filename)).length === 1, 'database_changed');
  return {normalized, inventory, observationFiles, schemaSha256, databaseSha256: before.sha256, databaseBytes: before.bytes};
}

async function runWorkerInspection(options, signal) {
  check(!signal?.aborted && options.deadline > Date.now(), 'deadline');
  const worker = new Worker(new URL(import.meta.url), {workerData: {kind: 'che168_replica_readback', options}, execArgv: []});
  let timer, abort;
  try {
    return await new Promise((resolve, reject) => {
      const rejectDeadline = () => reject(Error('che168_replica_witness_deadline'));
      timer = setTimeout(rejectDeadline, Math.max(1, options.deadline - Date.now())); abort = rejectDeadline;
      signal?.addEventListener('abort', abort, {once: true});
      worker.once('message', value => value?.ok ? resolve(value.value) : reject(Error(value?.error || 'che168_replica_witness_failed')));
      worker.once('error', () => reject(Error('che168_replica_witness_worker')));
      worker.once('exit', code => {if (code !== 0) reject(Error('che168_replica_witness_worker'));});
    });
  } finally {clearTimeout(timer); signal?.removeEventListener('abort', abort); await worker.terminate();}
}

async function runInspection(options, signal) {
  check(!signal?.aborted && options.deadline > Date.now(), 'deadline');
  // Node's Worker heap inherits process-wide V8 flags; resourceLimits cannot
  // replace the publisher's old memory sample. A small, fresh-resource child
  // hosts the same inspector thread and stays responsive to IPC disconnect.
  const invocation = await createResourceNodeInvocation({args: [], role: 'che168-replica-witness'});
  check(!signal?.aborted && options.deadline > Date.now(), 'deadline');
  const nonce = randomUUID(), child = fork(new URL(import.meta.url), [INSPECTION_CHILD], {
    execArgv: invocation.args, env: invocation.env, stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  let timer, abort;
  try {
    return await new Promise((resolve, reject) => {
      const rejectDeadline = () => reject(Error('che168_replica_witness_deadline'));
      timer = setTimeout(rejectDeadline, Math.max(1, options.deadline - Date.now())); abort = rejectDeadline;
      signal?.addEventListener('abort', abort, {once: true});
      child.once('message', value => value?.nonce === nonce && value.ok === true ? resolve(value.value)
        : reject(Error(value?.nonce === nonce ? safeError({message: value.error}) : 'che168_replica_witness_worker')));
      child.once('error', () => reject(Error('che168_replica_witness_worker')));
      child.once('exit', () => reject(Error('che168_replica_witness_worker')));
      if (signal?.aborted || options.deadline <= Date.now()) {rejectDeadline(); return;}
      child.send({kind: 'che168_replica_readback', nonce, options}, error => {
        if (error) reject(Error('che168_replica_witness_worker'));
      });
    });
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const closed = new Promise(resolve => child.once('close', resolve)); child.kill('SIGKILL'); await closed;
    }
  }
}

/** Source-only proof emitter. It reads only the new replica, the current
 * journal head and its ready producer pin. Historical CSV/base replica/journal
 * chunks never participate in restoring or comparing this materialization.
 * The saved producer report is the completion authority; it does not contain
 * the supplier's terminal response, and this helper never creates one. */
export async function verifyChe168ReplicaInput({storage, directory, config, producer, limits: overrides = {},
  deadline = Date.now() + CHE168_REPLICA_WITNESS_LIMITS.workMs, signal, temporaryParent = os.tmpdir()}) {
  const limits = boundedLimits(overrides); let temp;
  const within = () => check(!signal?.aborted && Date.now() < deadline, 'deadline');
  check(object(config) && object(producer), 'arguments');
  config = JSON.parse(JSON.stringify(config)); producer = JSON.parse(JSON.stringify(producer));
  check(typeof directory === 'string' && path.isAbsolute(directory) && path.isAbsolute(temporaryParent)
    && storage?.driver === 'object' && typeof storage.readJson === 'function' && typeof storage.getBinary === 'function'
    && Number.isFinite(deadline) && deadline > Date.now() && deadline <= Date.now() + limits.workMs, 'arguments');
  try {
    within(); const initial = readReport(directory), context = validateReport(initial.body, config, producer, limits);
    const {source, descriptor, binding, journalKey, handoff} = context, manifestKey = descriptor.key + '/manifest.json';
    const keys = new Set([manifestKey, journalKey + '/head.json', handoff.key]);
    const bounded = async call => {
      within(); let timer, abort;
      try {return await Promise.race([Promise.resolve().then(() => {within(); return call();}), new Promise((_, reject) => {
        const stop = () => reject(Error('che168_replica_witness_deadline')); abort = stop;
        timer = setTimeout(stop, Math.max(1, deadline - Date.now())); signal?.addEventListener('abort', abort, {once: true});
      })]);} finally {clearTimeout(timer); signal?.removeEventListener('abort', abort);}
    };
    const read = async key => {
      within(); check(keys.has(key), 'read_scope'); const value = await bounded(() => storage.readJson(key, null)); within();
      check(object(value) || value === null && key === journalKey + '/head.json', 'read_size'); return value;
    };
    const manifest = await read(manifestKey); validateManifest(manifest, context, limits);
    const journal = await read(journalKey + '/head.json'); validateJournal(journal, context);
    const pin = await read(handoff.key); validateProducerPin(pin, handoff);
    temp = await fs.mkdtemp(path.join(temporaryParent, 'che168-independent-'));
    const filename = path.join(temp, 'inventory.sqlite'), partReads = []; let next = 0;
    await restoreChe168Replica({filename, descriptor, binding, cursor: source.cursor, storage: {
      async readJson(key) {check(key === manifestKey, 'restore_scope'); const value = await read(key); check(same(value, manifest), 'manifest_changed'); return value;},
      async getBinary(key) {
        within(); const index = next++; check(index < manifest.parts.length && key === descriptor.key + '/' + index + '.gz', 'restore_scope');
        const result = await bounded(() => storage.getBinary(key)); within();
        check(Buffer.isBuffer(result?.data) && result.data.length > 0 && result.data.length <= CHUNK + 65536, 'compressed_part_bound');
        partReads.push({index, bytes: result.data.length, sha256: bytesDigest(result.data)}); return result;
      },
    }});
    check(next === manifest.parts.length, 'restore_parts'); within();
    const actual = await runInspection({filename, directory, source, config, completedAt: initial.body.completedAt, limits, deadline}, signal);
    check(actual.databaseBytes === manifest.bytes, 'database_size');
    check(same(await read(manifestKey), manifest), 'manifest_changed');
    check(same(await read(journalKey + '/head.json'), journal), 'journal_changed');
    check(same(await read(handoff.key), pin), 'producer_pin_changed');
    check(same(readdirSync(directory).filter(name => name.startsWith(sourceId + '-')).sort(ascii),
      actual.observationFiles.map(row => row.name)), 'observations_changed');
    for (const file of actual.observationFiles) {
      within(); const actual = fileDigest(path.join(directory, file.name));
      check(actual.bytes === file.bytes && actual.sha256 === file.sha256, 'observations_changed');
    }
    const final = readReport(directory); check(final.bytesSha256 === initial.bytesSha256, 'report_changed'); within();
    const witness = signed({version: 1, kind: CHE168_REPLICA_WITNESS_KIND, sourceId, producer: {...producer},
      snapshot: {root: descriptor.key, completeSha256: descriptor.sha256, pages: manifest.parts.length,
        pagesSha256: rawDigest(manifest.parts.map((part, index) => [index, part.sha256, part.bytes])),
        rows: actual.inventory.rows, completedAt: initial.body.completedAt}, normalized: actual.normalized,
      replicaReadback: {version: 1, method: 'closed_sqlite_restore_and_full_output_comparison',
        binding, initialCursor: config.initialCursor, replayInitialCursor: source.initialCursor, cursor: source.cursor,
        databaseBytes: actual.databaseBytes, databaseSha256: actual.databaseSha256, schemaSha256: actual.schemaSha256,
        integrity: 'ok', inventory: actual.inventory, compressedPartsSha256: rawDigest(partReads),
        completion: {authority: 'saved_completed_producer_report', reportSha256: rawDigest(initial.body),
          terminalResponseArchived: false, journalHeadFound: journal !== null, journalHeadSha256: rawDigest(journal), journalBinding: context.journalBinding,
          cursor: source.cursor, changes: source.changes, producerPinSha256: rawDigest(pin)}}});
    return assertChe168ReplicaInputWitness(witness);
  } catch (error) {throw Error(safeError(error));}
  finally {if (temp) await fs.rm(temp, {recursive: true, force: true});}
}

export function assertChe168ReplicaInputWitness(value) {
  check(object(value) && SHA.test(value.checksum || ''), 'checksum'); const {checksum, ...body} = value;
  check(rawDigest(body) === checksum && value.version === 1 && value.kind === CHE168_REPLICA_WITNESS_KIND
    && value.sourceId === sourceId && ROOT.test(value.snapshot?.root || '')
    && SHA.test(value.snapshot.completeSha256 || '') && integer(value.snapshot.pages, Number.MAX_SAFE_INTEGER, 1)
    && SHA.test(value.snapshot.pagesSha256 || '') && integer(value.snapshot.rows, Number.MAX_SAFE_INTEGER, 1)
    && Number.isFinite(Date.parse(value.snapshot.completedAt)), 'witness');
  check(/^\d{1,20}$/.test(value.producer?.runId || '') && /^[1-9]\d{0,5}$/.test(value.producer?.attempt || '')
    && COMMIT.test(value.producer?.sourceSha || ''), 'producer');
  const normalized = value.normalized, proof = value.replicaReadback;
  check(normalized?.rows === value.snapshot.rows && SHA.test(normalized.idsSha256 || '') && SHA.test(normalized.rowsSha256 || '')
    && proof?.version === 1 && proof.method === 'closed_sqlite_restore_and_full_output_comparison'
    && proof.integrity === 'ok' && SHA.test(proof.binding || '') && integer(proof.initialCursor)
    && integer(proof.replayInitialCursor) && proof.replayInitialCursor >= proof.initialCursor
    && integer(proof.cursor) && proof.cursor >= proof.replayInitialCursor
    && integer(proof.databaseBytes, Number.MAX_SAFE_INTEGER, 1)
    && value.snapshot.pages === Math.ceil(proof.databaseBytes / CHUNK)
    && ['databaseSha256', 'schemaSha256', 'compressedPartsSha256'].every(key => SHA.test(proof[key] || ''))
    && proof.inventory?.rows === normalized.rows && ['idsSha256', 'rowsSha256', 'observationFilesSha256'].every(key => SHA.test(proof.inventory[key] || ''))
    && integer(proof.inventory.minEvent, proof.cursor, proof.initialCursor - 1)
    && integer(proof.inventory.maxEvent, proof.cursor, proof.inventory.minEvent)
    && integer(proof.inventory.observationBytes, Number.MAX_SAFE_INTEGER, 1)
    && proof.completion?.authority === 'saved_completed_producer_report' && proof.completion.terminalResponseArchived === false
    && proof.completion.cursor === proof.cursor && integer(proof.completion.changes)
    && typeof proof.completion.journalHeadFound === 'boolean'
    && (proof.completion.journalHeadFound || proof.completion.changes === 0 && proof.cursor === proof.replayInitialCursor
      && proof.completion.journalHeadSha256 === rawDigest(null))
    && ['reportSha256', 'journalHeadSha256', 'journalBinding', 'producerPinSha256'].every(key => SHA.test(proof.completion[key] || '')), 'witness');
  return value;
}

if (!isMainThread && workerData?.kind === 'che168_replica_readback') {
  try {reportResourceNodeStartup(); parentPort.postMessage({ok: true, value: inspectDatabase(workerData.options)});}
  catch (error) {parentPort.postMessage({ok: false, error: safeError(error)});}
}

if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === INSPECTION_CHILD) {
  check(process.argv.length === 3 && typeof process.send === 'function' && process.connected, 'worker');
  process.once('disconnect', () => process.exit(0)); // Also terminates a busy inspector thread.
  process.once('message', async message => {
    let response;
    try {
      check(message?.kind === 'che168_replica_readback' && new RegExp('^' + UUID + '$').test(message.nonce || ''), 'worker');
      response = {ok: true, value: await runWorkerInspection(message.options)};
    } catch (error) {response = {ok: false, error: safeError(error)};}
    if (!process.connected) {process.exit(0); return;}
    process.send({nonce: message?.nonce, ...response}, () => {if (process.connected) process.disconnect();});
  });
}
