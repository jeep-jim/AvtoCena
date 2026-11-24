import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {chinaSourceOutputRoot, PRIVATE_SOURCE_FILES} from './private-source-output.mjs';

const PART_BYTES = 8 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const SOURCE_ID = 'autohome_used_china_open';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const need = (value, code) => assert(value, 'china_source_restore_' + code);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  same(Object.keys(value).sort(), [...names].sort());
const normalizedSql = value => String(value ?? '').replace(/\s+/g, '').toLowerCase();
const TABLE_SQL = `CREATE TABLE offers(id TEXT PRIMARY KEY, source_offer_id TEXT NOT NULL UNIQUE, year INTEGER,
  eligible INTEGER NOT NULL, disposition TEXT NOT NULL, payload TEXT NOT NULL, payload_sha256 TEXT NOT NULL)`;
const INDEX_SQL = 'CREATE INDEX offers_eligible_year ON offers(eligible,year,id)';

function parseJson(bytes, code) {
  try {
    const text = typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    return JSON.parse(text);
  } catch { throw Error('china_source_restore_' + code); }
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

function validateReceipt(receipt, owner, root) {
  need(keys(receipt, ['version', 'kind', 'market', 'owner', 'root', 'sourceManifestSha256', 'files',
    'totalBytes', 'published', 'sourceApiCalls', 'liveCatalogWrites', 'deletions']) && receipt.version === 1 &&
    receipt.kind === 'china-rebuild-saved-source' && receipt.market === 'china' && receipt.root === root &&
    keys(receipt.owner, ['runId', 'attempt', 'revision']) && Object.keys(owner).every(key => receipt.owner[key] === owner[key]) &&
    receipt.published === false && receipt.sourceApiCalls === 0 && receipt.liveCatalogWrites === 0 && receipt.deletions === 0 &&
    SHA.test(receipt.sourceManifestSha256 ?? ''), 'receipt_identity');
  need(Array.isArray(receipt.files) && same(receipt.files.map(file => file?.name), PRIVATE_SOURCE_FILES), 'receipt_files');
  let totalBytes = 0;
  for (const file of receipt.files) {
    need(keys(file, ['name', 'bytes', 'sha256', 'parts']) && integer(file.bytes) && file.bytes > 0 &&
      SHA.test(file.sha256 ?? '') && Array.isArray(file.parts) && file.parts.length === Math.ceil(file.bytes / PART_BYTES), 'file_descriptor');
    for (const [index, part] of file.parts.entries()) {
      need(keys(part, ['key', 'bytes', 'sha256']) && SHA.test(part.sha256 ?? '') &&
        part.bytes === Math.min(PART_BYTES, file.bytes - index * PART_BYTES) &&
        part.key === `${root}/files/${file.name}/${index}-${part.sha256}`, 'part_descriptor');
    }
    totalBytes += file.bytes;
  }
  need(integer(totalBytes) && totalBytes === receipt.totalBytes &&
    receipt.files.find(file => file.name === 'source-manifest.json').sha256 === receipt.sourceManifestSha256, 'receipt_totals');
}

function validateManifest(manifest, reconciliation, receipt) {
  const source = manifest?.source;
  need(manifest?.version === 1 && manifest.kind === 'china-saved-source-v1' && manifest.classification === 'private_source' &&
    manifest.market === 'china' && manifest.provider === 'auto_api_che168' && manifest.sourceId === SOURCE_ID &&
    instant(manifest.preparedAt) && instant(manifest.sourceObservedAt) && Date.parse(manifest.sourceObservedAt) <= Date.parse(manifest.preparedAt) &&
    manifest.supplierLatestVerified === false && manifest.publicationReady === false && manifest.policy?.minimumYear === 2014 &&
    typeof source?.runId === 'string' && /^[1-9]\d{0,19}$/.test(source.runId) && integer(source.cursor) &&
    /^catalog\/nonjp-intake\/v1\/china\/[1-9]\d{0,19}\/[1-9]\d{0,5}$/.test(source.archiveRoot ?? '') &&
    ['snapshotBinding', 'archiveSha256', 'reportSha256', 'replicaSha256', 'witnessSha256', 'downloadCutSha256']
      .every(key => SHA.test(source[key] ?? '')), 'manifest_identity');
  const names = ['source.sqlite', 'dispositions.ndjson', 'reconciliation.json'];
  need(Array.isArray(manifest.files) && same(manifest.files.map(file => file?.name), names), 'manifest_files');
  for (const file of manifest.files) {
    const expected = receipt.files.find(item => item.name === file.name);
    need(keys(file, ['name', 'bytes', 'sha256']) && file.bytes === expected.bytes && file.sha256 === expected.sha256, 'manifest_file_binding');
  }
  const counts = ['sourceRows', 'eligible', 'yearBeforeMinimum', 'yearUnknown', 'missingPrice', 'missingPower'];
  need(reconciliation?.version === 1 && reconciliation.market === 'china' &&
    reconciliation.inputCoverage === 'saved_normalized_complete_replica' && reconciliation.sourceObservedAt === manifest.sourceObservedAt &&
    reconciliation.supplierLatestVerified === false && reconciliation.minimumYear === 2014 &&
    counts.every(key => integer(reconciliation[key])) && reconciliation.sourceRows > 0 &&
    reconciliation.sourceRows === reconciliation.eligible + reconciliation.yearBeforeMinimum + reconciliation.yearUnknown &&
    reconciliation.missingPrice <= reconciliation.sourceRows && reconciliation.missingPower <= reconciliation.sourceRows &&
    (reconciliation.sourceReportedQuarantined === null || integer(reconciliation.sourceReportedQuarantined)) &&
    reconciliation.allInputRowsAccountedFor === true && reconciliation.missingValuesInvented === false &&
    reconciliation.pricesRecalculated === false && reconciliation.publicationReady === false &&
    SHA.test(reconciliation.idsSha256 ?? '') && SHA.test(reconciliation.rowsSha256 ?? '') &&
    same(reconciliation, manifest.reconciliation), 'reconciliation');
}

const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

async function hashFile(filename) {
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.nlink === 1, 'local_file');
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of handle.createReadStream({autoClose: false})) { hash.update(chunk); bytes += chunk.length; }
    const after = await handle.stat(), named = await fs.lstat(filename);
    need(sameFile(before, after) && sameFile(before, named) && !named.isSymbolicLink() && bytes === before.size, 'local_file_changed');
    return {bytes, sha256: hash.digest('hex'), stat: after};
  } finally { await handle.close(); }
}

async function readLocalJson(filename, expected) {
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.nlink === 1 && before.size === expected.bytes, 'local_json_file');
    const bytes = await handle.readFile(), after = await handle.stat(), named = await fs.lstat(filename);
    need(sameFile(before, after) && sameFile(before, named) && !named.isSymbolicLink() &&
      bytes.length === expected.bytes && digest(bytes) === expected.sha256, 'local_json_checksum');
    return parseJson(bytes, 'local_json');
  } finally { await handle.close(); }
}

async function checkDirectory(directory, identity) {
  const stat = await fs.lstat(directory);
  need(stat.isDirectory() && !stat.isSymbolicLink() && stat.dev === identity.dev && stat.ino === identity.ino &&
    (stat.mode & 0o077) === 0 && await fs.realpath(directory) === directory, 'local_directory_changed');
}

async function newPrivateDirectory(directory) {
  need(typeof directory === 'string' && path.isAbsolute(directory) && path.resolve(directory) === directory &&
    directory !== path.parse(directory).root, 'output_directory');
  const parent = path.dirname(directory), stat = await fs.lstat(parent);
  need(stat.isDirectory() && !stat.isSymbolicLink() && await fs.realpath(parent) === parent, 'output_parent');
  await fs.mkdir(directory, {mode: 0o700});
  const identity = await fs.lstat(directory);
  await checkDirectory(directory, identity);
  return identity;
}

function validateRow(row, manifest) {
  need(typeof row.payload === 'string' && SHA.test(row.payload_sha256 ?? '') && digest(row.payload) === row.payload_sha256,
    'row_payload');
  const offer = parseJson(row.payload, 'row_json'), active = offer?.operational?.che168ActiveVerification;
  need(typeof row.source_offer_id === 'string' && /^\d{1,32}$/.test(row.source_offer_id) &&
    row.id === digest(SOURCE_ID + ':' + row.source_offer_id).slice(0, 24) && offer?.id === row.id &&
    offer.sourceOfferId === row.source_offer_id && offer.sourceId === SOURCE_ID && offer.market === 'china' && offer.status === 'active' &&
    offer.operational?.provider === 'auto-api.com' && offer.operational.detailIdentityVerified === true &&
    active?.method === 'snapshot_and_complete_change_stream' && active.snapshotBinding === manifest.source.snapshotBinding &&
    active.cursor === manifest.source.cursor && instant(active.verifiedAt) &&
    Date.parse(active.verifiedAt) >= Date.parse(manifest.sourceObservedAt) && Date.parse(active.verifiedAt) <= Date.parse(manifest.preparedAt),
  'row_identity');
  const year = Number.isSafeInteger(offer.year) && offer.year >= 1886 &&
    offer.year <= new Date(manifest.sourceObservedAt).getUTCFullYear() + 1 ? offer.year : null;
  const disposition = year === null ? 'year_unknown' : year < 2014 ? 'year_before_minimum' : 'eligible';
  need(row.year === year && row.disposition === disposition && row.eligible === (disposition === 'eligible' ? 1 : 0), 'row_disposition');
  return offer;
}

function readDatabase(filename) {
  const db = new DatabaseSync(filename, {readOnly: true, allowExtension: false});
  try { db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;'); return db; }
  catch (error) { db.close(); throw error; }
}

async function validateDatabase(filename, manifest, expected) {
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const bytes = Buffer.alloc(100), result = await handle.read(bytes, 0, bytes.length, 0);
    need(result.bytesRead === 100 && bytes.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')) && bytes[18] === 1 && bytes[19] === 1,
      'sqlite_closed');
  } finally { await handle.close(); }
  const db = readDatabase(filename);
  try {
    const schema = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name').all();
    need(same(schema.map(row => [row.type, row.name, row.tbl_name]), [
      ['table', 'offers', 'offers'], ['index', 'offers_eligible_year', 'offers'],
      ['index', 'sqlite_autoindex_offers_1', 'offers'], ['index', 'sqlite_autoindex_offers_2', 'offers']]) &&
      normalizedSql(schema[0].sql) === normalizedSql(TABLE_SQL) && normalizedSql(schema[1].sql) === normalizedSql(INDEX_SQL) &&
      schema[2].sql === null && schema[3].sql === null, 'sqlite_schema');
    const integrity = db.prepare('PRAGMA integrity_check').all();
    need(integrity.length === 1 && integrity[0].integrity_check === 'ok', 'sqlite_integrity');
    const counts = {sourceRows: 0, eligible: 0, yearBeforeMinimum: 0, yearUnknown: 0, missingPrice: 0, missingPower: 0};
    const ids = createHash('sha256').update('['), rows = createHash('sha256').update('[');
    for (const row of db.prepare('SELECT * FROM offers ORDER BY id COLLATE BINARY').iterate()) {
      const offer = validateRow(row, manifest);
      if (counts.sourceRows++) { ids.update(','); rows.update(','); }
      ids.update(JSON.stringify(row.id)); rows.update(JSON.stringify([row.id, row.payload_sha256]));
      if (row.eligible) counts.eligible++; else if (row.year === null) counts.yearUnknown++; else counts.yearBeforeMinimum++;
      if (!(typeof offer.sourcePrice === 'number' && Number.isFinite(offer.sourcePrice) && offer.sourcePrice > 0)) counts.missingPrice++;
      if (!(typeof offer.powerHp === 'number' && Number.isFinite(offer.powerHp) && offer.powerHp > 0)) counts.missingPower++;
    }
    need(Object.keys(counts).every(key => counts[key] === expected[key]) &&
      ids.update(']').digest('hex') === expected.idsSha256 && rows.update(']').digest('hex') === expected.rowsSha256, 'sqlite_census');
  } finally { db.close(); }
}

/** Restore only a completed, explicitly selected private generation. The port
 * has no write/list/delete/source method; no previous raw archive is consulted.
 * No final manifest is exposed until every local file and census is verified. */
export async function restorePrivateChinaSource({storage, owner, expectedReceiptSha256, outputDirectory, onProgress = () => {}}) {
  need(keys(storage, ['getBinary', 'assertPrivateBucket']) && typeof storage.getBinary === 'function' &&
    typeof storage.assertPrivateBucket === 'function', 'read_capability');
  need(keys(owner, ['runId', 'attempt', 'revision']) && Object.values(owner).every(value => typeof value === 'string'), 'owner');
  owner = {...owner};
  const root = chinaSourceOutputRoot(owner);
  need(SHA.test(expectedReceiptSha256 ?? '') && typeof onProgress === 'function', 'receipt_sha256');
  const read = async (key, expected) => {
    const result = await storage.getBinary(key);
    need(Buffer.isBuffer(result?.data) && result.data.length > 0 && result.data.length <= PART_BYTES &&
      (result.size === undefined || result.size === result.data.length), 'read_response');
    const sha256 = digest(result.data);
    need((result.checksum === undefined || result.checksum === sha256) && sha256 === expected.sha256 &&
      (expected.bytes === undefined || result.data.length === expected.bytes), 'read_checksum');
    return result.data;
  };
  need((await storage.assertPrivateBucket())?.verified === true, 'private_bucket');
  const completeKey = root + '/complete.json';
  const receiptBytes = await read(completeKey, {sha256: expectedReceiptSha256});
  const receipt = parseJson(receiptBytes, 'receipt_json');
  validateReceipt(receipt, owner, root);
  const identity = await newPrivateDirectory(outputDirectory), created = new Set();
  const partial = name => path.join(outputDirectory, name + '.partial');
  try {
    for (const file of receipt.files) {
      await checkDirectory(outputDirectory, identity);
      const filename = partial(file.name), handle = await fs.open(filename,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      created.add(file.name + '.partial');
      const hash = createHash('sha256'); let bytes = 0;
      try {
        for (const part of file.parts) {
          const chunk = await read(part.key, part);
          hash.update(chunk); bytes += chunk.length; await handle.writeFile(chunk);
        }
        need(bytes === file.bytes && hash.digest('hex') === file.sha256, 'file_checksum');
        await handle.sync();
      } finally { await handle.close(); }
      await onProgress({phase: 'private_source_file_restored', file: file.name, bytes, parts: file.parts.length});
    }
    const manifest = await readLocalJson(partial('source-manifest.json'), receipt.files.find(file => file.name === 'source-manifest.json'));
    const reconciliation = await readLocalJson(partial('reconciliation.json'), receipt.files.find(file => file.name === 'reconciliation.json'));
    validateManifest(manifest, reconciliation, receipt);
    await validateDatabase(partial('source.sqlite'), manifest, reconciliation);
    // A single generation is pinned throughout; a changed completion marker or
    // changed privacy policy cannot be accepted after the lengthy download.
    await read(completeKey, {sha256: expectedReceiptSha256, bytes: receiptBytes.length});
    need((await storage.assertPrivateBucket())?.verified === true, 'private_bucket');
    await checkDirectory(outputDirectory, identity);
    for (const file of receipt.files) {
      const current = await hashFile(partial(file.name));
      need(current.bytes === file.bytes && current.sha256 === file.sha256, 'local_checksum');
      await fs.chmod(partial(file.name), 0o400);
    }
    const finalOrder = [...PRIVATE_SOURCE_FILES.filter(name => name !== 'source-manifest.json'), 'source-manifest.json'];
    for (const name of finalOrder) {
      // link is exclusive: unlike rename it never replaces another local file.
      await fs.link(partial(name), path.join(outputDirectory, name)); created.add(name);
      await fs.unlink(partial(name)); created.delete(name + '.partial');
    }
    const paths = {database: path.join(outputDirectory, 'source.sqlite'), dispositions: path.join(outputDirectory, 'dispositions.ndjson'),
      reconciliation: path.join(outputDirectory, 'reconciliation.json'), manifest: path.join(outputDirectory, 'source-manifest.json')};
    const databaseSeal = receipt.files.find(file => file.name === 'source.sqlite');
    const sealedStat = await fs.lstat(paths.database);
    const checkDatabase = async () => {
      await checkDirectory(outputDirectory, identity);
      const actual = await hashFile(paths.database);
      need(sameFile(actual.stat, sealedStat) && actual.bytes === databaseSeal.bytes && actual.sha256 === databaseSeal.sha256 &&
        (actual.stat.mode & 0o777) === 0o400, 'immutable_database_changed');
    };
    freeze(receipt); freeze(manifest); freeze(reconciliation); freeze(paths);
    return Object.freeze({complete: true, directory: outputDirectory, receipt, receiptSha256: expectedReceiptSha256, manifest, reconciliation, paths,
      async *offers({eligibleOnly = false} = {}) {
        need(typeof eligibleOnly === 'boolean', 'eligible_only');
        await checkDatabase();
        const db = readDatabase(paths.database); let count = 0;
        try {
          for (const row of db.prepare('SELECT * FROM offers' + (eligibleOnly ? ' WHERE eligible=1' : '') + ' ORDER BY id COLLATE BINARY').iterate()) {
            count++; yield validateRow(row, manifest);
          }
          need(count === (eligibleOnly ? reconciliation.eligible : reconciliation.sourceRows), 'iteration_census');
        } finally {
          db.close();
          // Also runs on early return/break and when the consumer throws.
          await checkDatabase();
        }
      }});
  } catch (error) {
    // Remove only names created by this call, never an existing directory or
    // an unknown file. No recursive removal and no remote deletion exist here.
    try {
      await checkDirectory(outputDirectory, identity);
      for (const name of created) await fs.unlink(path.join(outputDirectory, name)).catch(() => {});
      await fs.rmdir(outputDirectory).catch(() => {});
    } catch { /* a replaced directory is not ours to clean */ }
    throw error;
  }
}
