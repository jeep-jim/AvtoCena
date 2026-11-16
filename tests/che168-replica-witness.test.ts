import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {normalizeAutoApiChe168} from '../apps/web/lib/catalog/auto-api-che168';
import {collectAutoApiChe168} from '../scripts/lib/auto-api-che168-client.mjs';
import {snapshotBinding} from '../scripts/lib/che168-snapshot.mjs';
import {saveChe168Replica} from '../scripts/lib/che168-replica.mjs';
import {openChe168ReplayJournal} from '../scripts/lib/che168-replay-journal.mjs';
import {openRawFeedPin, rawDigest} from '../scripts/lib/catalog-raw-provenance.mjs';
import {observationShardWriter} from '../scripts/lib/catalog-intake-checkpoint.mjs';
import {archiveIntakeDirectory, verifyIntakeArchive} from '../scripts/lib/nonjp-intake-archive.mjs';
import {verifyChe168ReplicaInput, assertChe168ReplicaInputWitness, CHE168_REPLICA_WITNESS_SOURCE as SOURCE,
  CHE168_REPLICA_WITNESS_KIND, CHE168_REPLICA_WORKER_CLOSURE, che168ReplicaWorkerSource,
  prepareChe168ReplicaInputWitness} from '../scripts/lib/che168-replica-witness.mjs';

const hash = (value: any) => rawDigest(value), sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const at = '2026-11-16T12:00:00.000Z', oldAt = '2026-10-09T08:09:40.000Z';
const owner = {runId: '43870000001', attempt: '1', revision: 'a'.repeat(40)};
const producer = {runId: owner.runId, attempt: owner.attempt, sourceSha: owner.revision};
const sourceConfig = {version: 1, date: '2026-10-09', filename: 'active_offer.csv', host: 'https://autobase-barrett.auto-api.com',
  initialCursor: 20, bytes: 100, etag: '"test-csv"', modifiedAt: oldAt, delimiter: '|'};
const schema = 'CREATE TABLE inventory(id TEXT PRIMARY KEY,payload TEXT NOT NULL,event INTEGER NOT NULL)';

class Store {
  driver = 'object'; data = new Map<string, any>(); binary = new Map<string, Buffer>(); reads: string[] = []; writes: string[] = [];
  onRead: ((key: string) => Promise<void>) | undefined; onBinary: ((key: string) => Promise<void>) | undefined;
  async readJson(key: string, fallback: any) {this.reads.push(key); await this.onRead?.(key); return structuredClone(this.data.get(key) ?? fallback);}
  async readJsonWithMeta(key: string, fallback: any) {
    const value = await this.readJson(key, fallback), found = this.data.has(key);
    return {found, value, ...(found ? {etag: '"' + hash(value) + '"'} : {})};
  }
  async writeJson(key: string, value: any, condition: any = {}) {
    const old = this.data.get(key);
    if (condition.ifNoneMatch && old !== undefined || condition.ifMatch && condition.ifMatch !== '"' + hash(old) + '"') {
      const error = Error('storage_conflict'); error.name = 'StorageConflictError'; throw error;
    }
    this.writes.push(key); this.data.set(key, structuredClone(value));
  }
  async putBinary(key: string, bytes: Buffer) {this.writes.push(key); this.binary.set(key, Buffer.from(bytes));}
  async getBinary(key: string) {
    this.reads.push(key); await this.onBinary?.(key);
    if (!this.binary.has(key)) throw Error('missing'); return {data: Buffer.from(this.binary.get(key)!)};
  }
  async listBucketObjects() {
    return [...this.data].map(([key, value]) => ({key, size: Buffer.byteLength(JSON.stringify(value))}))
      .concat([...this.binary].map(([key, value]) => ({key, size: value.length})));
  }
}

async function fixture(t: any, options: {resume?: boolean; mutate?: (db: DatabaseSync) => void; rows?: number} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'che168-witness-test-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const directory = path.join(root, 'output'), scratch = path.join(root, 'isolated'); await fs.mkdir(directory); await fs.mkdir(scratch);
  const filename = path.join(root, 'source.sqlite'), db = new DatabaseSync(filename); db.exec(schema);
  const storage = new Store(), config = {...sourceConfig}, binding = snapshotBinding(config), initialCursor = options.resume ? 24 : 20;
  const base = options.resume ? {key: 'catalog/provider-replicas/che168/11111111-1111-1111-1111-111111111111', sha256: 'b'.repeat(64), binding, cursor: initialCursor} : null;
  const journalBinding = hash({binding, initialCursor, base, replayVersion: 2});
  const artifactRunId = BigInt('0x' + journalBinding.slice(0, 14)).toString(), journalKey = 'catalog/intake-working/che168-v1/' + artifactRunId;
  const snapshotRoot = 'catalog/provider-snapshots/che168/' + binding;
  const rawPin = await openRawFeedPin({storage, owner, operationId: 'che168-input-witness-fixture', references: [
    {kind: 'che168-snapshot', root: snapshotRoot}, {kind: 'che168-journal', root: journalKey},
    ...(base ? [{kind: 'che168-replica', root: base.key, sha256: base.sha256}] : [])]});
  const put = db.prepare('INSERT INTO inventory VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,event=excluded.event');
  const raw = (id: string) => ({inner_id: id, url: 'https://www.che168.com/dealer/1/' + id + '.html', mark: 'Toyota', model: 'Corolla',
    year: 2022, price: 90000, images: ['https://2sc2.autoimg.cn/escimg/fixture.jpg']});
  const add = (id: string, event: number, time = oldAt) => {
    const offer = normalizeAutoApiChe168({inner_id: id, data: raw(id)}, time); assert.ok(offer);
    put.run(id, JSON.stringify(offer), event); return offer;
  };
  for (const id of ['42', '44', '99']) add(id, 19);
  for (let i = 0; i < (options.rows || 3) - 3; i++) add(String(1000 + i), 19);
  const journal = await openChe168ReplayJournal({storage, artifactRunId, binding: journalBinding, initialCursor, apply: async () => {}});
  let pending: any[] = []; const requests: string[] = [];
  const completion = await collectAutoApiChe168({yearFrom: 2014, resume: {cursor: journal.cursor, snapshotStartedAt: oldAt}, useChangeData: true,
    now: () => at, request: async (endpoint: string, params: any) => {
      requests.push(endpoint); assert.equal(endpoint, 'changes');
      const event = (id: number, inner_id: string, change_type: string, data?: any) => ({id, inner_id, change_type, created_at: at, data});
      return {result: !options.resume && params.change_id === 20 ? [event(20, '43', 'added', raw('43')),
        event(21, '42', 'changed', {new_price: 123}), event(22, '99', 'removed'), event(23, '98', 'removed')] : [],
        meta: {cur_change_id: params.change_id, next_change_id: 24}};
    },
    onOffer: async (row: any, time: string, change: any) => {const offer = add(String(row.inner_id), change.id, time); pending.push({kind: 'offer', offer, event: change.id});},
    onPriceChange: async (change: any) => {
      const row = db.prepare('SELECT payload FROM inventory WHERE id=?').get(String(change.inner_id))!;
      const offer = JSON.parse(row.payload as string); offer.sourcePrice = change.data.new_price; offer.totalRub = null; offer.calculationStatus = 'needs_data'; offer.updatedAt = change.created_at;
      offer.operational = {...offer.operational, lastSeenAt: change.created_at, che168PriceChangeId: change.id};
      put.run(String(change.inner_id), JSON.stringify(offer), change.id); pending.push({kind: 'price', innerId: String(change.inner_id), price: change.data.new_price, at: change.created_at, event: change.id}); return true;
    },
    onRemoval: async (change: any) => {db.prepare('DELETE FROM inventory WHERE id=?').run(String(change.inner_id)); pending.push({kind: 'removed', innerId: String(change.inner_id), at: change.created_at, event: change.id});},
    onProgress: async (progress: any) => {await journal.commit({cursor: progress.cursor, changes: progress.changes, events: pending}); pending = [];},
  });
  options.mutate?.(db);
  const rows: any[] = [], write = observationShardWriter(directory, SOURCE);
  for (const row of db.prepare('SELECT payload FROM inventory ORDER BY id DESC').iterate()) {
    const offer = JSON.parse(row.payload as string);
    offer.operational = {...offer.operational, lastSeenAt: completion.completedAt,
      che168ActiveVerification: {method: 'snapshot_and_complete_change_stream', snapshotBinding: binding, initialCursor: config.initialCursor,
        cursor: completion.cursor, verifiedAt: completion.completedAt}};
    rows.push(offer); await write({stage: 'detail', observedAt: completion.completedAt, offer});
  }
  db.close();
  const replica = await saveChe168Replica({storage, filename, binding, cursor: completion.cursor, beforeWrite: (root: string) => rawPin.add([{kind: 'che168-replica', root}])});
  const source: any = {sourceId: SOURCE, provider: 'auto_api_che168', snapshotBinding: binding, snapshotStartedAt: oldAt, yearFrom: 2014,
    syncMode: 'snapshot', mode: 'snapshot', pages: options.resume ? 0 : 1, observations: rows.length, uniqueOffers: rows.length,
    rejectedIdentity: 0, completeInventory: true, stopReason: 'source_finished', initialCursor, cursor: completion.cursor, changes: completion.changes,
    workingJournal: {key: journalKey, binding: journalBinding}, replica, ...(base ? {baseReplica: {key: base.key, sha256: base.sha256}} : {})};
  const report: any = {version: 1, provider: 'auto_api_che168', market: 'china', completed: true, startedAt: at, completedAt: completion.completedAt,
    sources: [source], confirmedWithdrawals: [], rawStoragePins: [await rawPin.handoff()]};
  const writeReport = () => fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report)); await writeReport();
  const optionsOf = () => ({storage, directory, config, producer, temporaryParent: scratch});
  storage.reads = []; storage.writes = [];
  return {root, directory, scratch, filename, storage, config, binding, source, report, rows, replica, snapshotRoot, journalKey, requests, writeReport, optionsOf};
}

async function replaceReplica(f: any, bytes: Buffer) {
  assert.ok(bytes.length <= 16 * 1024 ** 2);
  const manifest = {version: 1, binding: f.binding, cursor: f.source.cursor, bytes: bytes.length, parts: [{bytes: bytes.length, sha256: sha(bytes)}]};
  f.storage.data.set(f.replica.key + '/manifest.json', manifest); f.storage.binary.set(f.replica.key + '/0.gz', gzipSync(bytes));
  f.replica.sha256 = hash(manifest); await f.writeReport();
}

test('real SQLite is reconstructed from only the new replica and matches all emitted payloads after the exact active overlay', async t => {
  const f = await fixture(t); const before = hash([...f.storage.data]), binary = hash([...f.storage.binary].map(([k, v]) => [k, sha(v)]));
  const witness = await verifyChe168ReplicaInput(f.optionsOf());
  assert.equal(witness.kind, CHE168_REPLICA_WITNESS_KIND); assert.equal(witness.snapshot.root, f.replica.key);
  assert.deepEqual(witness.producer, producer); assert.equal(witness.snapshot.rows, 3); assert.equal(witness.replicaReadback.inventory.minEvent, 19);
  assert.equal(witness.replicaReadback.inventory.maxEvent, 21); assert.equal(witness.replicaReadback.cursor, 24);
  assert.equal(witness.replicaReadback.completion.changes, 4); assert.equal(witness.replicaReadback.completion.terminalResponseArchived, false);
  const pairs = f.rows.map(row => [row.id, hash(row)]).sort(([a], [b]) => a < b ? -1 : 1);
  assert.deepEqual(witness.normalized, {rows: 3, idsSha256: hash(pairs.map(([id]) => id)), rowsSha256: hash(pairs)});
  assert.equal(f.rows.find(row => row.sourceOfferId === '42').sourcePrice, 123); assert.ok(!f.rows.some(row => row.sourceOfferId === '99'));
  assert.deepEqual(f.requests, ['changes', 'changes']); // Only the existing collector's mocked calls, none from the verifier.
  assert.ok(f.storage.reads.every(key => key.startsWith(f.replica.key + '/') || key === f.journalKey + '/head.json' || key === f.report.rawStoragePins[0].key));
  assert.ok(!f.storage.reads.some(key => key.startsWith(f.snapshotRoot + '/'))); assert.equal(f.storage.writes.length, 0);
  assert.equal(hash([...f.storage.data]), before); assert.equal(hash([...f.storage.binary].map(([k, v]) => [k, sha(v)])), binary);
  assert.deepEqual(await fs.readdir(f.scratch), []);
  assert.deepEqual(await verifyChe168ReplicaInput(f.optionsOf()), witness);
});

test('zero-change resume uses a full current replica without reading its missing base or creating a fictional journal head', async t => {
  const f = await fixture(t, {resume: true}); assert.ok(!f.storage.data.has(f.journalKey + '/head.json'));
  const witness = await verifyChe168ReplicaInput(f.optionsOf());
  assert.equal(witness.replicaReadback.replayInitialCursor, 24); assert.equal(witness.replicaReadback.cursor, 24);
  assert.equal(witness.replicaReadback.completion.journalHeadFound, false);
  assert.equal(witness.replicaReadback.completion.journalHeadSha256, hash(null));
  assert.ok(!f.storage.reads.some(key => key.startsWith(f.source.baseReplica.key + '/'))); assert.equal(witness.snapshot.rows, 3);
});

test('over 500 actual output rows cross ordinary shard boundaries without changing sorted payload coverage', async t => {
  const f = await fixture(t, {rows: 503}); const witness = await verifyChe168ReplicaInput(f.optionsOf());
  assert.equal(witness.normalized.rows, 503); assert.equal((await fs.readdir(f.directory)).filter(name => name.endsWith('.jsonl')).length, 2);
  assert.equal(witness.normalized.idsSha256, hash(f.rows.map(row => row.id).sort()));
});

test('a real multi-part SQLite file is restored in full and every saved part is read once', async t => {
  const f = await fixture(t, {rows: 260, mutate(db) {
    const rows = db.prepare('SELECT id,payload FROM inventory').all(), update = db.prepare('UPDATE inventory SET payload=? WHERE id=?');
    for (const row of rows) {const offer = JSON.parse(row.payload as string); offer.operational.fixtureDetail = 'x'.repeat(65536);
      update.run(JSON.stringify(offer), row.id as string);}
  }});
  const manifest = f.storage.data.get(f.replica.key + '/manifest.json'); assert.equal(manifest.parts.length, 2);
  const witness = await verifyChe168ReplicaInput(f.optionsOf()); assert.equal(witness.snapshot.pages, 2); assert.equal(witness.normalized.rows, 260);
  assert.equal(witness.replicaReadback.databaseSha256, sha(await fs.readFile(f.filename)));
  assert.deepEqual(f.storage.reads.filter(key => key.endsWith('.gz')), [f.replica.key + '/0.gz', f.replica.key + '/1.gz']);
  assert.equal(f.storage.writes.length, 0);
});

test('witness survives the existing immutable intake archive and independent byte-for-byte report restore', async t => {
  const f = await fixture(t); const witness = await verifyChe168ReplicaInput(f.optionsOf());
  f.report.sourceInputWitness = witness; await f.writeReport();
  const receipt = await archiveIntakeDirectory({storage: f.storage, directory: f.directory, market: 'china', owner});
  const restored = path.join(f.root, 'restored-report'); await verifyIntakeArchive({storage: f.storage, receipt, directory: restored});
  const saved = JSON.parse(await fs.readFile(path.join(restored, 'report.json'), 'utf8'));
  assert.deepEqual(saved.sourceInputWitness, witness); assert.equal(receipt.reportDigest, hash(saved));
  assertChe168ReplicaInputWitness(saved.sourceInputWitness);
  const archived = f.storage.data.get(receipt.root + '/complete.json'); assert.ok(archived.collection.complete);
  const part = archived.files.find((file: any) => file.name === 'report.json').parts[0]; f.storage.data.get(part.key).sha256 = '0'.repeat(64);
  await assert.rejects(() => verifyIntakeArchive({storage: f.storage, receipt}), /intake_archive_part/);
});

test('a checksummed non-SQLite string is not independence evidence', async t => {
  const f = await fixture(t); await replaceReplica(f, Buffer.from('sqlite fixture'));
  await assert.rejects(() => verifyChe168ReplicaInput(f.optionsOf()), /closed_database/); assert.deepEqual(await fs.readdir(f.scratch), []);
});

test('valid SQLite with an unexpected table, schema or trigger cannot use a single file checksum as proof', async t => {
  for (const sql of ['CREATE TABLE extra(secret TEXT)', 'CREATE TRIGGER unexpected AFTER INSERT ON inventory BEGIN SELECT 1; END']) {
    const f = await fixture(t); const db = new DatabaseSync(f.filename); db.exec(sql); db.close(); await replaceReplica(f, await fs.readFile(f.filename));
    await assert.rejects(() => verifyChe168ReplicaInput(f.optionsOf()), /schema/);
  }
  const f = await fixture(t), other = path.join(f.root, 'other.sqlite'), db = new DatabaseSync(other);
  db.exec('CREATE TABLE inventory(id TEXT PRIMARY KEY,payload TEXT NOT NULL,event TEXT NOT NULL)'); db.close(); await replaceReplica(f, await fs.readFile(other));
  await assert.rejects(() => verifyChe168ReplicaInput(f.optionsOf()), /schema/);
});

test('a WAL main file without its sidecars is ineligible even if its parts were saved correctly', async t => {
  const f = await fixture(t), db = new DatabaseSync(f.filename);
  try {db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE inventory SET event=23');
    assert.ok((await fs.stat(f.filename + '-wal')).size > 0); await replaceReplica(f, await fs.readFile(f.filename));
  } finally {db.close();}
  await assert.rejects(() => verifyChe168ReplicaInput(f.optionsOf()), /closed_database/);
});

test('full integrity_check detects an index payload mismatch that quick_check accepts', async t => {
  const f = await fixture(t), db = new DatabaseSync(f.filename);
  const pageSize = Number(db.prepare('PRAGMA page_size').get()!.page_size);
  const indexPage = Number(db.prepare("SELECT rootpage FROM sqlite_schema WHERE name='sqlite_autoindex_inventory_1'").get()!.rootpage); db.close();
  const bytes = await fs.readFile(f.filename), start = (indexPage - 1) * pageSize;
  const offset = bytes.subarray(start, start + pageSize).indexOf(Buffer.from('42')); assert.ok(offset >= 0);
  bytes[start + offset + 1] = '1'.charCodeAt(0); await fs.writeFile(f.filename, bytes);
  const broken = new DatabaseSync(f.filename, {readOnly: true});
  try {assert.equal(broken.prepare('PRAGMA quick_check').get()!.quick_check, 'ok');
    assert.ok(broken.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok'));
  } finally {broken.close();}
  await replaceReplica(f, bytes); await assert.rejects(() => verifyChe168ReplicaInput(f.optionsOf()), /integrity/);
});

test('corrupt or missing compressed parts fail readback without storage writes', async t => {
  for (const missing of [false, true]) {
    const f = await fixture(t); if (missing) f.storage.binary.delete(f.replica.key + '/0.gz'); else f.storage.binary.set(f.replica.key + '/0.gz', gzipSync(Buffer.from('corrupt')));
    await assert.rejects(() => verifyChe168ReplicaInput(f.optionsOf()), /che168_replica_witness/);
    assert.equal(f.storage.writes.length, 0); assert.deepEqual(await fs.readdir(f.scratch), []);
  }
});

test('same-count changed seller payload is rejected against the actual output rows', async t => {
  const f = await fixture(t), db = new DatabaseSync(f.filename);
  const row = db.prepare('SELECT payload FROM inventory WHERE id=?').get('42')!; const offer = JSON.parse(row.payload as string); offer.sourcePrice = 999;
  db.prepare('UPDATE inventory SET payload=? WHERE id=?').run(JSON.stringify(offer), '42'); db.close(); await replaceReplica(f, await fs.readFile(f.filename));
  await assert.rejects(() => verifyChe168ReplicaInput(f.optionsOf()), /observation_changed/);
});

test('wrong source identity and out-of-cursor events fail on actual SQLite rows', async t => {
  for (const kind of ['source', 'id', 'future_event', 'past_event']) {
    const f = await fixture(t), db = new DatabaseSync(f.filename);
    if (kind.endsWith('event')) db.prepare('UPDATE inventory SET event=? WHERE id=?').run(kind === 'future_event' ? 25 : 18, '42');
    else {const row = db.prepare('SELECT payload FROM inventory WHERE id=?').get('42')!; const offer = JSON.parse(row.payload as string);
      if (kind === 'source') offer.sourceId = 'other'; else offer.sourceOfferId = '43'; db.prepare('UPDATE inventory SET payload=? WHERE id=?').run(JSON.stringify(offer), '42');}
    db.close(); await replaceReplica(f, await fs.readFile(f.filename));
    await assert.rejects(() => verifyChe168ReplicaInput(f.optionsOf()), /row_identity|inventory_row/);
  }
});

test('the existing inclusive event boundary is preserved rather than inventing a stricter change-stream policy', async t => {
  const f = await fixture(t, {mutate(db) {db.prepare('UPDATE inventory SET event=? WHERE id=?').run(24, '42');}});
  const witness = await verifyChe168ReplicaInput(f.optionsOf()); assert.equal(witness.replicaReadback.inventory.maxEvent, 24);
  assert.equal(witness.replicaReadback.cursor, 24);
});

test('incomplete reports, wrong producer, cursor and manifest binding cannot manufacture a witness', async t => {
  for (const change of [(f: any) => {f.report.completed = false;}, (f: any) => {f.source.stopReason = 'collecting';},
    (f: any) => {f.source.cursor++;}, (f: any) => {f.source.replica.binding = '0'.repeat(64);},
    (f: any) => {f.report.failure = 'auto_api_transport_failed';}]) {
    const f = await fixture(t); change(f); await f.writeReport(); await assert.rejects(() => verifyChe168ReplicaInput(f.optionsOf()), /che168_replica_witness/);
    assert.equal(f.storage.writes.length, 0);
  }
  const f = await fixture(t); await assert.rejects(() => verifyChe168ReplicaInput({...f.optionsOf(), producer: {...producer, sourceSha: 'b'.repeat(40)}}), /producer_binding/);
});

test('nonempty replay needs its saved exact journal head and matching cursor/count', async t => {
  for (const kind of ['missing', 'cursor', 'changes', 'binding']) {
    const f = await fixture(t), key = f.journalKey + '/head.json', head = f.storage.data.get(key);
    if (kind === 'missing') f.storage.data.delete(key); else head[kind] = kind === 'binding' ? '0'.repeat(64) : head[kind] + 1;
    await assert.rejects(() => verifyChe168ReplicaInput(f.optionsOf()), /journal/); assert.equal(f.storage.writes.length, 0);
  }
});

test('missing, duplicated and modified active-observation overlay rows are rejected', async t => {
  for (const kind of ['missing', 'duplicate', 'lastSeenAt', 'cursor']) {
    const f = await fixture(t), file = path.join(f.directory, SOURCE + '-000001.jsonl');
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
    if (kind === 'missing') lines.pop(); else if (kind === 'duplicate') lines[1] = lines[0];
    else if (kind === 'lastSeenAt') lines[0].offer.operational.lastSeenAt = oldAt;
    else lines[0].offer.operational.che168ActiveVerification.cursor++;
    await fs.writeFile(file, lines.map((row: any) => JSON.stringify(row)).join('\n') + '\n');
    await assert.rejects(() => verifyChe168ReplicaInput(f.optionsOf()), /observation_/);
  }
});

test('count discrepancies, symlink output and incomplete shard sequence fail closed', async t => {
  const f = await fixture(t); f.source.uniqueOffers++; f.source.observations++; await f.writeReport();
  await assert.rejects(() => verifyChe168ReplicaInput(f.optionsOf()), /count/);
  const g = await fixture(t), original = path.join(g.directory, SOURCE + '-000001.jsonl');
  await fs.rename(original, path.join(g.root, 'saved.jsonl')); await fs.symlink(path.join(g.root, 'saved.jsonl'), original);
  await assert.rejects(() => verifyChe168ReplicaInput(g.optionsOf()), /shard_type/);
  const h = await fixture(t); await fs.rename(path.join(h.directory, SOURCE + '-000001.jsonl'), path.join(h.directory, SOURCE + '-000002.jsonl'));
  await assert.rejects(() => verifyChe168ReplicaInput(h.optionsOf()), /shard_name/);
});

test('manifest, journal and producer-pin mutation during readback invalidates the proof', async t => {
  for (const kind of ['manifest', 'journal', 'pin']) {
    const f = await fixture(t); f.storage.onBinary = async () => {
      if (kind === 'manifest') f.storage.data.get(f.replica.key + '/manifest.json').extra = true;
      else if (kind === 'journal') f.storage.data.get(f.journalKey + '/head.json').extra = true;
      else f.storage.data.get(f.report.rawStoragePins[0].key).updatedAt = '2026-11-16T13:00:00.000Z';
    };
    await assert.rejects(() => verifyChe168ReplicaInput(f.optionsOf()), /changed/); assert.deepEqual(await fs.readdir(f.scratch), []);
  }
});

test('output files changed after the SQL comparison cannot receive a fresh signed witness', async t => {
  const f = await fixture(t); let manifests = 0;
  f.storage.onRead = async key => {if (key === f.replica.key + '/manifest.json' && ++manifests === 3)
    await fs.appendFile(path.join(f.directory, SOURCE + '-000001.jsonl'), '\n');};
  await assert.rejects(() => verifyChe168ReplicaInput(f.optionsOf()), /observations_changed/);
});

test('the completed report and producer ready state are actual fenced inputs rather than caller flags', async t => {
  const f = await fixture(t); f.storage.onBinary = async () => {f.report.extra = 'changed'; await f.writeReport();};
  await assert.rejects(() => verifyChe168ReplicaInput(f.optionsOf()), /report_changed/);
  const g = await fixture(t); g.storage.data.get(g.report.rawStoragePins[0].key).state = 'loading';
  await assert.rejects(() => verifyChe168ReplicaInput(g.optionsOf()), /producer_pin_changed/);
  assert.equal(g.storage.writes.length, 0);
});

test('declared bounds and abort/deadline reject without partial storage mutations', async t => {
  const f = await fixture(t);
  await assert.rejects(() => verifyChe168ReplicaInput({...f.optionsOf(), limits: {rows: 2}}), /source_report/);
  await assert.rejects(() => verifyChe168ReplicaInput({...f.optionsOf(), limits: {replicaBytes: 100}}), /manifest/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => verifyChe168ReplicaInput({...f.optionsOf(), signal: controller.signal}), /deadline/);
  const g = await fixture(t); g.storage.readJson = async () => new Promise(() => {});
  const started = Date.now(); await assert.rejects(() => verifyChe168ReplicaInput({...g.optionsOf(), deadline: Date.now() + 30}), /deadline/);
  assert.ok(Date.now() - started < 1000); assert.equal(g.storage.writes.length, 0); assert.deepEqual(await fs.readdir(g.scratch), []);
});

test('the signed witness binds readback evidence and explicitly cannot claim an archived terminal response', async t => {
  const f = await fixture(t), witness = await verifyChe168ReplicaInput(f.optionsOf());
  const changed = structuredClone(witness); changed.replicaReadback.databaseSha256 = '0'.repeat(64);
  assert.throws(() => assertChe168ReplicaInputWitness(changed), /witness/);
  const forged = structuredClone(witness); forged.replicaReadback.completion.terminalResponseArchived = true;
  const {checksum, ...body} = forged; forged.checksum = hash(body);
  assert.throws(() => assertChe168ReplicaInputWitness(forged), /witness/);
});

test('worker source guard requires tracked clean code and never substitutes the workflow SHA', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'che168-worker-source-')); t.after(() => fs.rm(root, {recursive: true, force: true}));
  const git = (...args: string[]) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  git('init', '-q');
  for (const filename of CHE168_REPLICA_WORKER_CLOSURE) {await fs.mkdir(path.dirname(path.join(root, filename)), {recursive: true}); await fs.writeFile(path.join(root, filename), 'fixture\n');}
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'Fixture code closure');
  const source = git('rev-parse', 'HEAD').trim(); assert.equal(che168ReplicaWorkerSource(root), source);
  await fs.appendFile(path.join(root, CHE168_REPLICA_WORKER_CLOSURE[0]), 'dirty\n'); assert.equal(che168ReplicaWorkerSource(root), null);
  git('checkout', '--', CHE168_REPLICA_WORKER_CLOSURE[0]);
  await fs.writeFile(path.join(root, 'scripts/untracked.mjs'), 'fixture'); assert.equal(che168ReplicaWorkerSource(root), null);
  await fs.unlink(path.join(root, 'scripts/untracked.mjs')); assert.equal(che168ReplicaWorkerSource(root), source);
  git('rm', '--cached', CHE168_REPLICA_WORKER_CLOSURE[1]); assert.equal(che168ReplicaWorkerSource(root), null);
});

test('future-main-only and mismatched-source paths keep completed data and all ancestral refs unchanged', async t => {
  const f = await fixture(t), environment = {GITHUB_REPOSITORY: 'jeep-jim/AvtoCena', GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: owner.revision, GITHUB_RUN_ID: owner.runId, GITHUB_RUN_ATTEMPT: owner.attempt};
  const before = await fs.readFile(path.join(f.directory, 'report.json'), 'utf8'), args = {...f.optionsOf(), owner, environment};
  const branch = await prepareChe168ReplicaInputWitness({...args, environment: {...environment, GITHUB_REF: 'refs/heads/feature'}});
  assert.deepEqual(branch, {sourceInputWitnessUnavailable: 'che168_replica_witness_future_main_only'});
  const mismatch = await prepareChe168ReplicaInputWitness(args);
  assert.deepEqual(mismatch, {sourceInputWitnessUnavailable: 'che168_replica_witness_worker_source_mismatch'});
  assert.equal(await fs.readFile(path.join(f.directory, 'report.json'), 'utf8'), before);
  assert.equal(f.storage.reads.length, 0); assert.equal(f.storage.writes.length, 0);
});
