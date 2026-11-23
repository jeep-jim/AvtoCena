import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {captureCheckpoint, createCheckpointStorage, checkpointCliInput, CHECKPOINT_BOUNDARIES}
  from '../.github/operations/catalog-rebuild-20261123/checkpoint.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const at = Date.parse('2026-11-23T16:00:00Z');
const base = {runId: '45190000001', attempt: '1', sourceSha: 'a'.repeat(40),
  serving: {ok: true, releaseSha: 'b'.repeat(40), calculationVersion: 'c'.repeat(64),
    checkedAt: new Date(at - 1000).toISOString()}, now: () => at};
const prefix = `catalog-rebuild/checkpoints/${base.runId}/${base.attempt}`;
const manifestKey = 'catalog/manifest.json';
const previousKey = 'catalog/previous-manifest.json';
const controlsKey = 'catalog/operations/collection-controls-v1.json';
const configKey = 'markets/markets.json';
const secretKey = 'integrations/ajes/config.json';
const manifestBytes = Buffer.from('{ "generationId": "gen_1790000000000_test", "markets": {"korea":{"count":2}}, "note":"Корея" }\n');

function fixture() {
  const objects = new Map(), calls = [], headCounts = new Map();
  let revision = 0;
  const hooks = {};
  const set = (key, value) => {
    const bytes = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(JSON.stringify(value));
    objects.set(key, {bytes, etag: `opaque-${++revision}`});
  };
  set(manifestKey, manifestBytes);
  set(controlsKey, {version: 1, revision: 7,
    markets: {korea: {enabled: true, changedBy: 'PRIVATE_ACTOR'}, china: {enabled: false}},
    sources: {encar_feed: {enabled: false, changedBy: 'PRIVATE_ACTOR'}, che168_feed: {enabled: true},
      hidden_supplier: {enabled: true, password: 'PRIVATE_PASSWORD'}},
    history: [{actor: 'PRIVATE_ACTOR', reason: 'PRIVATE_HISTORY'}], extra: 'PRIVATE_CONTROLS'});
  set(configKey, [{id: 'korea', versions: [{id: 'v1', createdByUserId: 'PRIVATE_STAFF', logisticsRub: 123}]}]);
  set(secretKey, {encryptedPassword: 'PRIVATE_CIPHERTEXT', updatedAt: '2026-11-23T00:00:00Z'});
  set('catalog/raw-feed-config/v1/che168-snapshot.json', {sourceUrl: 'https://private.invalid/signed?token=PRIVATE_FEED_URL', bytes: 100});
  const storage = {
    driver: 'object',
    async readObjectMetadata(key) {
      const count = (headCounts.get(key) || 0) + 1;
      headCounts.set(key, count); calls.push({method: 'HEAD', key});
      await hooks.head?.(key, count);
      const object = objects.get(key);
      return object ? {found: true, etag: object.etag} : {found: false};
    },
    async getBinary(key) {
      calls.push({method: 'GET', key});
      const object = objects.get(key);
      if (!object) throw Error('NOT_FOUND_WITH_PRIVATE_DETAILS');
      const data = await hooks.get?.(key, Buffer.from(object.bytes)) ?? Buffer.from(object.bytes);
      return {data, size: data.length, checksum: hash(data), mimeType: 'application/json'};
    },
    async putBinary(key, bytes, contentType, condition) {
      calls.push({method: 'PUT', key, contentType, condition});
      assert.deepEqual(condition, {ifNoneMatch: '*'});
      if (objects.has(key)) { const error = Error('conflict'); error.name = 'StorageConflictError'; throw error; }
      set(key, bytes);
      await hooks.put?.(key, bytes);
      return {size: bytes.length, checksum: hash(bytes)};
    },
    readJson() { throw Error('seed or JSON reader must never be used'); },
    readJsonWithMeta() { throw Error('projection-expanding JSON reader must never be used'); },
    writeJson() { throw Error('source JSON writer must never be used'); },
    deleteJson() { throw Error('delete must never be used'); },
    deleteBinary() { throw Error('delete must never be used'); },
    listObjects() { throw Error('whole-prefix inventory must never be used'); },
  };
  return {objects, calls, headCounts, hooks, set, storage};
}
const capture = (f, options = {}) => captureCheckpoint({...base, storage: f.storage, ...options});
const receiptOf = (f, result) => JSON.parse(f.objects.get(result.receiptKey).bytes);
const hasReceipt = f => f.objects.has(prefix + '/receipt.json');

test('checkpoint retains exact original bytes, protects source objects and never claims full backup', async () => {
  const f = fixture();
  const original = new Map([...f.objects].map(([key, value]) => [key, Buffer.from(value.bytes)]));
  const result = await capture(f), receipt = receiptOf(f, result);
  const root = receipt.roots.find(row => row.key === manifestKey);
  assert.equal(root.copyKey, `${prefix}/objects/${hash(manifestBytes)}.json`);
  assert.deepEqual(f.objects.get(root.copyKey).bytes, manifestBytes);
  assert.equal(hash(f.objects.get(result.receiptKey).bytes), result.receiptSha256);
  assert.equal(receipt.complete, true);
  assert.equal(receipt.fullBackup, false);
  assert.equal(receipt.deletionAllowed, false);
  assert.equal(result.report.fullBackup, false);
  assert.equal(result.report.deletionAllowed, false);
  assert.equal(result.report.kind, 'fixed_roots');
  assert.equal(result.report.operationAccepted, false);
  assert.equal(result.report.servingStabilityVerified, false);
  assert.deepEqual(receipt.serving.releaseSha, base.serving.releaseSha);
  assert.equal(receipt.serving.calculationVersion, base.serving.calculationVersion);
  assert.equal(receipt.sourceSha, base.sourceSha);
  for (const [key, bytes] of original) assert.deepEqual(f.objects.get(key).bytes, bytes, key);
  const writes = f.calls.filter(call => call.method === 'PUT');
  assert.ok(writes.length > 0);
  assert.ok(writes.every(call => call.key.startsWith(prefix + '/') && call.condition.ifNoneMatch === '*'));
  assert.equal(f.headCounts.get(manifestKey), 3);
});

test('protected settings are fingerprints only, and public output excludes private values/history/unknown switches', async () => {
  const f = fixture(), result = await capture(f), receipt = receiptOf(f, result);
  for (const key of [configKey, secretKey, controlsKey]) {
    const row = receipt.roots.find(row => row.key === key);
    assert.equal(row.mode, 'fingerprint');
    assert.equal(Object.hasOwn(row, 'copyKey'), false);
    assert.equal(row.sha256, hash(f.objects.get(key).bytes));
    assert.equal(f.objects.has(`${prefix}/objects/${row.sha256}.json`), false);
  }
  assert.deepEqual(result.report.controls, {revision: 7,
    markets: {china: false, korea: true}, sources: {encar_feed: false, che168_feed: true}});
  const publicText = JSON.stringify(result.report);
  for (const forbidden of ['PRIVATE_', 'hidden_supplier', 'sourceUrl', 'encryptedPassword', '"history":', 'changedBy', 'createdByUserId']) {
    assert.equal(publicText.includes(forbidden), false, forbidden);
  }
  for (const root of result.report.roots) {
    assert.deepEqual(Object.keys(root).sort(), ['bytes', 'found', 'key', 'sha256']);
  }
  assert.equal(JSON.stringify(receipt).includes('PRIVATE_'), false);
});

test('optional absence is recorded without seed lookup or copying a synthetic default', async () => {
  const f = fixture(), result = await capture(f);
  assert.deepEqual(result.report.roots.find(row => row.key === previousKey),
    {key: previousKey, found: false, bytes: null, sha256: null});
  assert.equal(f.calls.some(call => call.method === 'GET' && call.key === previousKey), false);
  assert.equal(f.headCounts.get(previousKey), 2);
  assert.equal(CHECKPOINT_BOUNDARIES.roots.some(row => row.key === 'knowledge/encyclopedia/calculation-v1.json'), false);
});

test('missing required public manifest stops before a receipt or checkpoint writes', async () => {
  const f = fixture(); f.objects.delete(manifestKey);
  await assert.rejects(capture(f), /checkpoint_required_root_missing/);
  assert.equal(hasReceipt(f), false);
  assert.equal(f.calls.some(call => call.method === 'PUT'), false);
});

test('a root changed between HEAD and body readback cannot produce a checkpoint', async () => {
  const f = fixture();
  f.hooks.head = (key, count) => { if (key === manifestKey && count === 2) f.set(key, {generationId: 'changed'}); };
  await assert.rejects(capture(f), /checkpoint_root_changed/);
  assert.equal(hasReceipt(f), false);
});

test('a later root change is detected by the final all-root HEAD pass', async () => {
  const f = fixture();
  f.hooks.head = (key, count) => { if (key === manifestKey && count === 3) f.set(key, {generationId: 'changed-later'}); };
  await assert.rejects(capture(f), /checkpoint_root_changed/);
  assert.equal(hasReceipt(f), false);
  assert.ok(f.calls.some(call => call.method === 'PUT' && call.key.includes('/objects/')));
});

test('appearance of a previously absent root invalidates the capture', async () => {
  const f = fixture();
  f.hooks.head = (key, count) => { if (key === previousKey && count === 2) f.set(key, {generationId: 'appeared'}); };
  await assert.rejects(capture(f), /checkpoint_root_changed/);
  assert.equal(hasReceipt(f), false);
});

test('protected fingerprint changes are fenced by the final pass too', async () => {
  const f = fixture();
  f.hooks.head = (key, count) => { if (key === configKey && count === 3) f.set(key, [{id: 'new-admin-version'}]); };
  await assert.rejects(capture(f), /checkpoint_root_changed/);
  assert.equal(hasReceipt(f), false);
});

test('partial copied-body readback fails even when the readback reports its own internally consistent checksum', async () => {
  const f = fixture();
  f.hooks.get = (key, bytes) => key.includes('/objects/') ? bytes.subarray(0, bytes.length - 1) : bytes;
  await assert.rejects(capture(f), /checkpoint_copy_readback_mismatch/);
  assert.equal(hasReceipt(f), false);
});

test('receipt readback is verified before returning a successful public report', async () => {
  const f = fixture();
  f.hooks.get = (key, bytes) => key.endsWith('/receipt.json') ? bytes.subarray(0, 10) : bytes;
  await assert.rejects(capture(f), /checkpoint_copy_readback_mismatch/);
});

test('matching content from an interrupted create-only copy can be reused, never overwritten', async () => {
  const f = fixture(), key = `${prefix}/objects/${hash(manifestBytes)}.json`;
  f.set(key, manifestBytes); const previousEtag = f.objects.get(key).etag;
  await capture(f);
  assert.equal(f.objects.get(key).etag, previousEtag);
  assert.deepEqual(f.objects.get(key).bytes, manifestBytes);
});

test('a conflicting existing content-addressed object is not overwritten or accepted', async () => {
  const f = fixture(), key = `${prefix}/objects/${hash(manifestBytes)}.json`;
  f.set(key, Buffer.from('wrong content')); const previousEtag = f.objects.get(key).etag;
  await assert.rejects(capture(f), /checkpoint_copy_readback_mismatch/);
  assert.equal(f.objects.get(key).etag, previousEtag);
  assert.equal(f.objects.get(key).bytes.toString(), 'wrong content');
  assert.equal(hasReceipt(f), false);
});

test('an existing different receipt cannot be replaced by the same run/attempt', async () => {
  const f = fixture(), key = prefix + '/receipt.json';
  f.set(key, {priorReceipt: true}); const previousEtag = f.objects.get(key).etag;
  await assert.rejects(capture(f), /checkpoint_copy_readback_mismatch/);
  assert.equal(f.objects.get(key).etag, previousEtag);
  assert.deepEqual(JSON.parse(f.objects.get(key).bytes), {priorReceipt: true});
});

test('write fence rejects source mutations, deletes, broad reads and unconditioned/out-of-scope writes', async () => {
  const f = fixture(), scoped = createCheckpointStorage(f.storage, base);
  const bytes = Buffer.from('{}'), safeKey = `${prefix}/objects/${hash(bytes)}.json`;
  for (const key of [manifestKey, controlsKey, secretKey, 'clients/clients.json',
    `catalog-rebuild/checkpoints/999/1/objects/${hash(bytes)}.json`, prefix + '/objects/../escape.json']) {
    assert.throws(() => scoped.putBinary(key, bytes, 'application/json', {ifNoneMatch: '*'}), /checkpoint_write_forbidden/);
  }
  assert.throws(() => scoped.putBinary(safeKey, bytes, 'application/json', {}), /checkpoint_write_forbidden/);
  assert.throws(() => scoped.putBinary(safeKey, bytes, 'application/json', {ifNoneMatch: '*', ifMatch: 'etag'}), /checkpoint_write_forbidden/);
  assert.throws(() => scoped.putBinary(safeKey, Buffer.from('{"different":true}'), 'application/json', {ifNoneMatch: '*'}), /checkpoint_write_forbidden/);
  for (const method of ['writeJson', 'deleteJson', 'deleteBinary', 'deleteObjects', 'deletePrefix', 'listObjects', 'listBucketObjects',
    'listObjectVersions', 'listMultipartUploads', 'abortMultipartUpload', 'createBinaryDownloadUrl', 'readJson', 'readJsonWithMeta']) {
    assert.throws(() => scoped[method](manifestKey, {}), /checkpoint_operation_forbidden/, method);
  }
  assert.throws(() => scoped.getBinary('clients/clients.json'), /checkpoint_read_forbidden/);
  assert.throws(() => scoped.readObjectMetadata('accounts/users/private.json'), /checkpoint_read_forbidden/);
  assert.deepEqual(f.calls, []);
});

test('opaque ETag is mandatory and source body checksum/size failures are fatal', async () => {
  const missing = fixture(); missing.objects.get(manifestKey).etag = undefined;
  await assert.rejects(capture(missing), /checkpoint_etag_required/);
  const broken = fixture(), original = broken.storage.getBinary;
  broken.storage.getBinary = async key => ({...await original(key), size: -1});
  await assert.rejects(capture(broken), /checkpoint_source_body_invalid/);
  assert.equal(hasReceipt(broken), false);
});

test('malformed controls cannot fabricate public enabled booleans', async () => {
  const f = fixture();
  f.set(controlsKey, {version: 1, revision: 1, markets: {}, sources: {encar_feed: {enabled: 'true'}}});
  await assert.rejects(capture(f), /checkpoint_controls_invalid/);
  assert.equal(hasReceipt(f), false);
});

test('unverified/stale identity, invalid scope and local storage fail before any I/O', async () => {
  for (const options of [{serving: undefined}, {serving: {...base.serving, ok: false}},
    {serving: {...base.serving, checkedAt: new Date(at - 11 * 60_000).toISOString()}},
    {serving: {...base.serving, releaseSha: 'main'}}, {sourceSha: ''}, {runId: '../escape'},
    {attempt: '1/../../escape'}, {storage: {...fixture().storage, driver: 'local'}}]) {
    const f = fixture();
    await assert.rejects(capture(f, options), /checkpoint_/);
    assert.deepEqual(f.calls, []);
  }
});

test('CLI requires an explicit successful health observation and cannot infer an installed release', () => {
  const env = {JSON_STORAGE_DRIVER: 'object', GITHUB_RUN_ID: base.runId, GITHUB_RUN_ATTEMPT: base.attempt,
    GITHUB_SHA: base.sourceSha, CHECKPOINT_SERVING_HEALTH_OK: 'true',
    CHECKPOINT_SERVING_RELEASE_SHA: base.serving.releaseSha,
    CHECKPOINT_SERVING_CALCULATION_VERSION: base.serving.calculationVersion,
    CHECKPOINT_SERVING_CHECKED_AT: new Date().toISOString()};
  assert.equal(checkpointCliInput(env).serving.releaseSha, base.serving.releaseSha);
  assert.throws(() => checkpointCliInput({...env, CHECKPOINT_SERVING_HEALTH_OK: undefined}), /checkpoint_serving_identity_required/);
  assert.throws(() => checkpointCliInput({...env, CHECKPOINT_SERVING_RELEASE_SHA: undefined}), /checkpoint_serving_identity_required/);
  assert.throws(() => checkpointCliInput({...env, JSON_STORAGE_DRIVER: 'local'}), /checkpoint_object_storage_required/);
});
