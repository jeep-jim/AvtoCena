import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ObjectJsonStorage, StorageConflictError } from '../apps/web/lib/data.ts';

// Synthetic objects only. No production credentials, listing, deletion or copying.
let stage = 'configuration';
try {
  assert.equal(process.env.YC_OBJECT_STORAGE_ENDPOINT, 'https://s3.regru.cloud');
  assert.equal(process.env.YC_OBJECT_STORAGE_BUCKET, 'avtocena-staging-8120751');
  assert.equal(process.env.YC_OBJECT_STORAGE_PREFIX, 'migration-staging/compatibility/');
  for (const name of ['YC_OBJECT_STORAGE_REGION', 'YC_OBJECT_STORAGE_ACCESS_KEY_ID', 'YC_OBJECT_STORAGE_SECRET_ACCESS_KEY']) {
    assert.ok(process.env[name]?.trim(), `Missing ${name}`);
  }
  const storage = new ObjectJsonStorage();
  const prefix = `probe-${randomUUID()}`;
  const json = `${prefix}/state.json`;
  const binary = `${prefix}/document.bin`;
  const original = { version: 1, text: 'Проверка нового хранилища' };
  stage = 'create and read JSON';
  await storage.writeJson(json, original, { ifNoneMatch: '*' });
  const first = await storage.readJsonWithMeta(json, null);
  assert.equal(first.found, true);
  assert.ok(first.etag);
  assert.deepEqual(first.value, original);
  stage = 'reject duplicate create';
  await assert.rejects(storage.writeJson(json, { version: 999 }, { ifNoneMatch: '*' }), StorageConflictError);
  stage = 'conditional update';
  await storage.writeJson(json, { version: 2 }, { ifMatch: first.etag });
  await assert.rejects(storage.writeJson(json, { version: 999 }, { ifMatch: first.etag }), StorageConflictError);
  const second = await storage.readJsonWithMeta(json, null);
  assert.deepEqual(second.value, { version: 2 });
  assert.ok(second.etag);
  stage = 'concurrent update';
  const race = await Promise.allSettled([3, 4].map(version => storage.writeJson(json, { version }, { ifMatch: second.etag })));
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(race.filter(r => r.status === 'rejected' && r.reason instanceof StorageConflictError).length, 1);
  const final = await storage.readJson(json, null);
  assert.ok([3, 4].includes(final?.version));
  stage = 'binary document and HEAD';
  const payload = Buffer.from('Synthetic AvtoCena document — no customer data.\n');
  await storage.putBinary(binary, payload, 'application/octet-stream', { ifNoneMatch: '*' });
  assert.equal(await storage.binaryExists(binary), true);
  assert.deepEqual((await storage.getBinary(binary)).data, payload);
  stage = 'list synthetic prefix';
  const listed = await storage.listObjects(prefix);
  assert.deepEqual(listed.map(item => item.key).sort(), [binary, json].sort());
  stage = 'private access and signed download';
  const signed = await storage.createBinaryDownloadUrl(binary, 60);
  const unsigned = new URL(signed); unsigned.search = '';
  const response = await fetch(unsigned, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  await response.body?.cancel();
  assert.ok([403, 404].includes(response.status), 'Anonymous access must be denied');
  const download = await fetch(signed, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), payload);
  console.log('PASS: JSON, ETag conflicts, concurrent update, binary, HEAD, LIST, private access and signed download.');
  console.log('Two tiny synthetic objects retained for inspection. No production data copied or deleted.');
} catch (error) {
  // Never print signed URLs, credential values, HTTP response bodies or full errors.
  const code = /^object_storage_[a-z_]+_\d{3}$/.test(error?.message || '') ? error.message : error?.name || 'Error';
  console.error(`FAIL at ${stage}: ${code}`);
  process.exitCode = 1;
}
