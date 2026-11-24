import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {savePrivateChinaSource, chinaSourceOutputRoot, PRIVATE_SOURCE_FILES} from '../scripts/catalog-next/private-source-output.mjs';
import {restorePrivateChinaSource} from '../scripts/catalog-next/restore-private-source.mjs';

const PART_BYTES = 8 * 1024 * 1024;
const owner = {runId: '123456', attempt: '2', revision: 'a'.repeat(40)};
const sourceId = 'autohome_used_china_open';
const hash = value => createHash('sha256').update(value).digest('hex');
const observedAt = '2026-11-23T06:00:00.000Z';
const verifiedAt = '2026-11-24T07:00:00.000Z';
const preparedAt = '2026-11-24T09:00:00.000Z';
const binding = hash('snapshot-binding');
const collect = async iterator => { const rows = []; for await (const row of iterator) rows.push(row); return rows; };

async function fixture(t, {large = false} = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-source-restore-test-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const input = path.join(directory, 'source'); await fs.mkdir(input, {mode: 0o700});
  const offers = [
    {sourceOfferId: '1', year: 2013, sourcePrice: 100, powerHp: 80},
    {sourceOfferId: '2', year: 2014, sourcePrice: 200, powerHp: null},
    {sourceOfferId: '3', powerHp: 120},
    {sourceOfferId: '4', year: 2028, sourcePrice: 350, powerHp: 160},
  ].map((data, index) => ({...data, id: hash(sourceId + ':' + data.sourceOfferId).slice(0, 24), sourceId, market: 'china', status: 'active',
    originalEvidence: {value: 'preserve private source fields ' + index},
    ...(large && index === 0 ? {largePrivateSourceField: 'x'.repeat(9 * 1024 * 1024)} : {}),
    operational: {provider: 'auto-api.com', detailIdentityVerified: true,
      che168ActiveVerification: {method: 'snapshot_and_complete_change_stream', snapshotBinding: binding, cursor: 35, verifiedAt}}}));
  const db = new DatabaseSync(path.join(input, 'source.sqlite'));
  db.exec(`PRAGMA journal_mode=DELETE;
    CREATE TABLE offers(id TEXT PRIMARY KEY, source_offer_id TEXT NOT NULL UNIQUE, year INTEGER,
      eligible INTEGER NOT NULL, disposition TEXT NOT NULL, payload TEXT NOT NULL, payload_sha256 TEXT NOT NULL);`);
  const insert = db.prepare('INSERT INTO offers VALUES(?,?,?,?,?,?,?)');
  const ledger = [], hashes = [];
  for (const offer of offers) {
    const year = Number.isSafeInteger(offer.year) && offer.year >= 1886 && offer.year <= 2027 ? offer.year : null;
    const disposition = year === null ? 'year_unknown' : year < 2014 ? 'year_before_minimum' : 'eligible';
    const payload = JSON.stringify(offer), payloadSha256 = hash(payload);
    insert.run(offer.id, offer.sourceOfferId, year, disposition === 'eligible' ? 1 : 0, disposition, payload, payloadSha256);
    ledger.push(JSON.stringify({id: offer.id, sourceOfferId: offer.sourceOfferId, year, disposition, payloadSha256}));
    hashes.push([offer.id, payloadSha256]);
  }
  db.exec('CREATE INDEX offers_eligible_year ON offers(eligible,year,id)'); db.close();
  hashes.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const reconciliation = {version: 1, market: 'china', inputCoverage: 'saved_normalized_complete_replica', sourceObservedAt: observedAt,
    supplierLatestVerified: false, minimumYear: 2014, sourceRows: 4, eligible: 1, yearBeforeMinimum: 1, yearUnknown: 2,
    missingPrice: 1, missingPower: 1, sourceReportedQuarantined: 3, allInputRowsAccountedFor: true,
    idsSha256: hash(JSON.stringify(hashes.map(row => row[0]))), rowsSha256: hash(JSON.stringify(hashes)),
    missingValuesInvented: false, pricesRecalculated: false, publicationReady: false};
  await fs.writeFile(path.join(input, 'dispositions.ndjson'), ledger.join('\n') + '\n');
  await fs.writeFile(path.join(input, 'reconciliation.json'), JSON.stringify(reconciliation));
  const files = [];
  for (const name of ['source.sqlite', 'dispositions.ndjson', 'reconciliation.json']) {
    const bytes = await fs.readFile(path.join(input, name)); files.push({name, bytes: bytes.length, sha256: hash(bytes)});
  }
  const sourceManifest = {version: 1, kind: 'china-saved-source-v1', classification: 'private_source', market: 'china',
    provider: 'auto_api_che168', sourceId, preparedAt, sourceObservedAt: observedAt, supplierLatestVerified: false,
    source: {runId: '654321', cursor: 35, snapshotBinding: binding, archiveRoot: 'catalog/nonjp-intake/v1/china/777777/1',
      archiveSha256: hash('archive'), reportSha256: hash('report'), replicaSha256: hash('replica'), witnessSha256: hash('witness'),
      downloadCutSha256: hash('download-cut')}, policy: {minimumYear: 2014}, reconciliation, files, publicationReady: false};
  await fs.writeFile(path.join(input, 'source-manifest.json'), JSON.stringify(sourceManifest));
  const objects = new Map(), writes = [];
  const storage = {driver: 'object',
    async putBinary(key, data, _mime, condition) {
      assert.deepEqual(condition, {ifNoneMatch: '*'}); assert(!objects.has(key));
      writes.push(key); objects.set(key, Buffer.from(data));
    },
    async getBinary(key) {
      assert(objects.has(key), 'missing private object'); const data = Buffer.from(objects.get(key));
      return {data, size: data.length, checksum: hash(data)};
    }};
  const saved = await savePrivateChinaSource({storage, owner, directory: input, sourceManifest});
  const completeKey = chinaSourceOutputRoot(owner) + '/complete.json', calls = [];
  const readPort = {async getBinary(key) { calls.push({get: key}); return storage.getBinary(key); },
    async assertPrivateBucket() { calls.push({privacy: true}); return {verified: true}; }};
  return {directory, input, offers, sourceManifest, saved, objects, writes, completeKey, calls, readPort,
    outputDirectory: path.join(directory, 'restored')};
}

const restore = (f, overrides = {}) => restorePrivateChinaSource({storage: f.readPort, owner,
  expectedReceiptSha256: f.saved.receiptSha256, outputDirectory: f.outputDirectory, ...overrides});
const receipt = f => JSON.parse(f.objects.get(f.completeKey));
function sealReceipt(f, value) {
  const bytes = Buffer.from(JSON.stringify(value)); f.objects.set(f.completeKey, bytes); return hash(bytes);
}
function replaceStoredFile(f, envelope, name, bytes) {
  const descriptor = envelope.files.find(file => file.name === name), parts = [];
  for (let offset = 0; offset < bytes.length; offset += PART_BYTES) {
    const chunk = bytes.subarray(offset, offset + PART_BYTES), sha256 = hash(chunk);
    const key = `${envelope.root}/files/${name}/${parts.length}-${sha256}`;
    f.objects.set(key, Buffer.from(chunk)); parts.push({key, bytes: chunk.length, sha256});
  }
  Object.assign(descriptor, {bytes: bytes.length, sha256: hash(bytes), parts});
  if (name === 'source-manifest.json') envelope.sourceManifestSha256 = descriptor.sha256;
  envelope.totalBytes = envelope.files.reduce((sum, file) => sum + file.bytes, 0);
}
async function assertIncomplete(f) {
  await assert.rejects(fs.lstat(path.join(f.outputDirectory, 'source-manifest.json')), {code: 'ENOENT'});
}

test('actual private upload restores exact generation and all source rows by default, with no source or write capability', async t => {
  const f = await fixture(t), writesBefore = f.writes.length, result = await restore(f);
  assert.equal(result.complete, true); assert.equal(result.receiptSha256, f.saved.receiptSha256);
  assert.equal(result.manifest.sourceObservedAt, observedAt); assert.equal(result.manifest.supplierLatestVerified, false);
  assert.equal(result.manifest.publicationReady, false); assert(Object.isFrozen(result.manifest));
  assert.notEqual(result.manifest.source.runId, result.receipt.owner.runId);
  assert.deepEqual((await fs.readdir(f.outputDirectory)).sort(), [...PRIVATE_SOURCE_FILES].sort());
  assert.equal((await fs.lstat(f.outputDirectory)).mode & 0o777, 0o700);
  for (const name of PRIVATE_SOURCE_FILES) {
    assert.deepEqual(await fs.readFile(path.join(f.outputDirectory, name)), await fs.readFile(path.join(f.input, name)));
    assert.equal((await fs.lstat(path.join(f.outputDirectory, name))).mode & 0o777, 0o400);
  }
  const networkBeforeIteration = f.calls.length;
  assert.deepEqual(await collect(result.offers()), [...f.offers].sort((a, b) => a.id < b.id ? -1 : 1));
  const eligible = await collect(result.offers({eligibleOnly: true}));
  assert.equal(eligible.length, 1); assert.equal(eligible[0].year, 2014); assert.equal(eligible[0].powerHp, null);
  assert.equal(f.calls.length, networkBeforeIteration); assert.equal(f.writes.length, writesBefore);
  assert.equal(f.calls.filter(call => call.privacy).length, 2);
  assert.equal(f.calls.filter(call => call.get === f.completeKey).length, 2);
  assert(f.calls.filter(call => call.get).every(call => call.get.startsWith(chinaSourceOutputRoot(owner) + '/')));
  await assert.rejects(collect(result.offers({eligibleOnly: 'yes'})), /eligible_only/);
});

test('multipart SQLite restores in exact receipt order without loading old raw archives', async t => {
  const f = await fixture(t, {large: true}), database = receipt(f).files.find(file => file.name === 'source.sqlite');
  assert.equal(database.parts.length, 2); assert.equal(database.parts[0].bytes, PART_BYTES);
  const result = await restore(f);
  assert.equal((await collect(result.offers())).find(row => row.sourceOfferId === '1').largePrivateSourceField.length, 9 * 1024 * 1024);
  const readKeys = f.calls.filter(call => call.get?.includes('/files/source.sqlite/')).map(call => call.get);
  assert.deepEqual(readKeys, database.parts.map(part => part.key));
});

test('completion must exist and match the externally selected SHA before any source parts are read', async t => {
  const f = await fixture(t);
  await assert.rejects(restore(f, {expectedReceiptSha256: hash('different receipt')}), /read_checksum/);
  assert.equal(f.calls.filter(call => call.get).length, 1); await assertIncomplete(f);
  f.objects.delete(f.completeKey); f.calls.length = 0;
  await assert.rejects(restore(f), /missing private object/);
  assert.equal(f.calls.filter(call => call.get).length, 1); await assertIncomplete(f);
  await assert.rejects(restore(f, {expectedReceiptSha256: undefined}), /receipt_sha256/);
});

test('wrong owner, mixed generation, traversal, reordered files, incomplete receipt and invalid sizes fail before part reads', async t => {
  const f = await fixture(t), original = Buffer.from(f.objects.get(f.completeKey));
  const changes = [
    value => { value.owner.revision = 'b'.repeat(40); },
    value => { value.owner.runId = '123457'; },
    value => { value.root = value.root.replace('/123456/', '/123457/'); },
    value => { value.files[0].parts[0].key = value.files[0].parts[0].key.replace('/123456/', '/123457/'); },
    value => { value.files[0].name = '../private.json'; },
    value => { [value.files[0], value.files[1]] = [value.files[1], value.files[0]]; },
    value => { value.files.pop(); },
    value => { value.files[0].parts[0].bytes--; },
    value => { value.files[0].bytes = Number.MAX_SAFE_INTEGER + 1; },
    value => { value.totalBytes++; },
    value => { value.published = true; },
    value => { value.sourceApiCalls = 1; },
    value => { delete value.sourceManifestSha256; },
  ];
  for (const change of changes) {
    const value = JSON.parse(original); change(value); f.calls.length = 0;
    await assert.rejects(restore(f, {expectedReceiptSha256: sealReceipt(f, value)}), /china_source_restore_/);
    assert.equal(f.calls.filter(call => call.get).length, 1); await assertIncomplete(f);
  }
});

test('corrupted or truncated parts and missing last parts cannot create a local completed source', async t => {
  const f = await fixture(t), descriptor = receipt(f).files.find(file => file.name === 'source.sqlite'), key = descriptor.parts[0].key;
  const original = Buffer.from(f.objects.get(key));
  const corrupted = Buffer.from(original); corrupted[corrupted.length - 1] ^= 1; f.objects.set(key, corrupted);
  await assert.rejects(restore(f), /read_checksum/); await assertIncomplete(f);
  f.objects.set(key, original.subarray(0, original.length - 1));
  await assert.rejects(restore(f), /read_checksum/); await assertIncomplete(f);
  f.objects.delete(key);
  await assert.rejects(restore(f), /missing private object/); await assertIncomplete(f);
});

test('multipart order, duplicate parts and foreign part keys are rejected before download', async t => {
  const f = await fixture(t, {large: true}), original = Buffer.from(f.objects.get(f.completeKey));
  for (const change of [parts => parts.reverse(), parts => { parts[1] = {...parts[0]}; }, parts => { parts[1].key += '/../foreign'; }]) {
    const value = JSON.parse(original); change(value.files.find(file => file.name === 'source.sqlite').parts); f.calls.length = 0;
    await assert.rejects(restore(f, {expectedReceiptSha256: sealReceipt(f, value)}), /part_descriptor/);
    assert.equal(f.calls.filter(call => call.get).length, 1); await assertIncomplete(f);
  }
});

test('manifest descriptors and row census must match even when an outer receipt has matching hashes', async t => {
  const f = await fixture(t), value = receipt(f), manifest = structuredClone(f.sourceManifest);
  manifest.files[0].sha256 = hash('other sqlite');
  replaceStoredFile(f, value, 'source-manifest.json', Buffer.from(JSON.stringify(manifest)));
  await assert.rejects(restore(f, {expectedReceiptSha256: sealReceipt(f, value)}), /manifest_file_binding/); await assertIncomplete(f);

  const g = await fixture(t), other = receipt(g), modified = structuredClone(g.sourceManifest);
  modified.reconciliation.missingPower = 0;
  const reconciliationBytes = Buffer.from(JSON.stringify(modified.reconciliation));
  replaceStoredFile(g, other, 'reconciliation.json', reconciliationBytes);
  Object.assign(modified.files.find(file => file.name === 'reconciliation.json'), {bytes: reconciliationBytes.length, sha256: hash(reconciliationBytes)});
  replaceStoredFile(g, other, 'source-manifest.json', Buffer.from(JSON.stringify(modified)));
  await assert.rejects(restore(g, {expectedReceiptSha256: sealReceipt(g, other)}), /sqlite_census/); await assertIncomplete(g);
});

test('SQLite must be closed and contain only the expected plain source schema', async t => {
  const f = await fixture(t), envelope = receipt(f), databasePath = path.join(f.input, 'source.sqlite');
  const db = new DatabaseSync(databasePath); db.exec('CREATE VIEW injected AS SELECT payload FROM offers'); db.close();
  const databaseBytes = await fs.readFile(databasePath), manifest = structuredClone(f.sourceManifest);
  replaceStoredFile(f, envelope, 'source.sqlite', databaseBytes);
  Object.assign(manifest.files[0], {bytes: databaseBytes.length, sha256: hash(databaseBytes)});
  replaceStoredFile(f, envelope, 'source-manifest.json', Buffer.from(JSON.stringify(manifest)));
  await assert.rejects(restore(f, {expectedReceiptSha256: sealReceipt(f, envelope)}), /sqlite_schema/); await assertIncomplete(f);
  const walHeader = Buffer.from(databaseBytes); walHeader[18] = 2;
  replaceStoredFile(f, envelope, 'source.sqlite', walHeader); Object.assign(manifest.files[0], {sha256: hash(walHeader)});
  replaceStoredFile(f, envelope, 'source-manifest.json', Buffer.from(JSON.stringify(manifest)));
  await assert.rejects(restore(f, {expectedReceiptSha256: sealReceipt(f, envelope)}), /sqlite_closed/); await assertIncomplete(f);
});

test('privacy and completion are checked again after restore, and a broader storage capability is rejected', async t => {
  const f = await fixture(t); let checks = 0;
  const privacy = {...f.readPort, async assertPrivateBucket() { return {verified: ++checks < 2}; }};
  await assert.rejects(restore(f, {storage: privacy}), /private_bucket/); await assertIncomplete(f);
  f.calls.length = 0;
  await assert.rejects(restore(f, {storage: {...f.readPort, async putBinary() { throw Error('never'); }}}), /read_capability/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(restore(f, {storage: {...f.readPort, async assertPrivateBucket() { return {verified: false}; }}}), /private_bucket/);
  assert.equal(f.calls.length, 0);
  let reads = 0;
  const changed = {...f.readPort, async getBinary(key) {
    if (key === f.completeKey && ++reads === 2) { const data = Buffer.from('{}'); return {data}; }
    return f.readPort.getBinary(key);
  }};
  await assert.rejects(restore(f, {storage: changed}), /read_checksum/); await assertIncomplete(f);
});

test('existing directories, symlink parents and traversal paths are never overwritten', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.outputDirectory); await fs.writeFile(path.join(f.outputDirectory, 'sentinel'), 'keep');
  await assert.rejects(restore(f), {code: 'EEXIST'});
  assert.equal(await fs.readFile(path.join(f.outputDirectory, 'sentinel'), 'utf8'), 'keep');
  const alias = path.join(f.directory, 'alias'); await fs.symlink(f.directory, alias);
  await assert.rejects(restore(f, {outputDirectory: path.join(alias, 'restore')}), /output_parent/);
  await assert.rejects(restore(f, {outputDirectory: f.directory + '/unused/../restore'}), /output_directory/);
  await assert.rejects(restore(f, {outputDirectory: 'relative-restore'}), /output_directory/);
  const link = path.join(f.directory, 'output-link'); await fs.symlink(f.input, link);
  await assert.rejects(restore(f, {outputDirectory: link}), {code: 'EEXIST'});
  assert.deepEqual((await fs.readdir(f.input)).sort(), [...PRIVATE_SOURCE_FILES].sort());
});

test('local mutation during download is caught and the final manifest is exposed only after verification', async t => {
  const f = await fixture(t);
  await assert.rejects(restore(f, {async onProgress(event) {
    await assertIncomplete(f);
    if (event.file === 'dispositions.ndjson') {
      await fs.writeFile(path.join(f.outputDirectory, 'dispositions.ndjson.partial'), 'changed locally');
    }
  }}), /local_checksum/); await assertIncomplete(f);
});

test('a symlink substituted for a staged JSON file is not followed and its target is preserved', async t => {
  const f = await fixture(t), target = path.join(f.directory, 'unrelated-private.json');
  await fs.writeFile(target, '{"preserve":true}');
  await assert.rejects(restore(f, {async onProgress(event) {
    if (event.file === 'source-manifest.json') {
      const staged = path.join(f.outputDirectory, 'source-manifest.json.partial');
      await fs.unlink(staged); await fs.symlink(target, staged);
    }
  }}), {code: 'ELOOP'});
  assert.equal(await fs.readFile(target, 'utf8'), '{"preserve":true}'); await assertIncomplete(f);
});

test('all-row and eligible iterators detect immutable database changes before use and on early return', async t => {
  const f = await fixture(t), result = await restore(f), networkReads = f.calls.length;
  const iterator = result.offers(); assert.equal((await iterator.next()).done, false);
  await fs.chmod(result.paths.database, 0o600);
  await assert.rejects(iterator.return(), /immutable_database_changed/);
  await assert.rejects(collect(result.offers({eligibleOnly: true})), /immutable_database_changed/);
  assert.equal(f.calls.length, networkReads);

  const g = await fixture(t), other = await restore(g);
  await fs.chmod(other.paths.database, 0o600);
  const handle = await fs.open(other.paths.database, 'r+');
  await handle.write(Buffer.from([0]), 0, 1, 0); await handle.close(); await fs.chmod(other.paths.database, 0o400);
  await assert.rejects(collect(other.offers()), /immutable_database_changed/);
});
