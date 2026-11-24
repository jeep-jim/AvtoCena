import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {savePrivateChinaGeneration, restorePrivateChinaGeneration} from '../scripts/catalog-next/private-generation.mjs';
import {chinaGenerationRoot, createPrivateChinaGenerationStorage} from '../scripts/catalog-next/generation-storage.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const owner = {runId: '1234567', attempt: '1', revision: 'a'.repeat(40)};
const names = ['DISPOSITIONS.ndjson', 'FILTER_SEMANTICS.json', 'FX_RECEIPT.json', 'GENERATION.json',
  'RECONCILIATION.json', 'RUNTIME_CONTEXT.json', 'SOURCE.json', 'details.sqlite', 'query.sqlite', 'source.sqlite'];
async function fixture(t, large = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-generation-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const files = {};
  for (const name of names) { files[name] = path.join(directory, name);
    await fs.writeFile(files[name], large && name === 'source.sqlite' ? Buffer.alloc(17 * 1024 * 1024, 42) : Buffer.from(name + '\n'));
  }
  const objects = new Map(), calls = [];
  const storage = {
    async assertPrivateBucket() { calls.push('privacy'); return {verified: true}; },
    async putBinary(key, bytes, _contentType, condition) {
      assert.deepEqual(condition, {ifNoneMatch: '*'}); assert(!objects.has(key));
      calls.push('PUT ' + key); objects.set(key, Buffer.from(bytes));
    },
    async getBinary(key) { calls.push('GET ' + key); assert(objects.has(key));
      const data = Buffer.from(objects.get(key)); return {data, checksum: hash(data), size: data.length}; },
  };
  const binding = {market: 'china', generationId: 'gen_test_1', runtimeSha: 'b'.repeat(40),
    sourceDescriptorSha256: hash(await fs.readFile(files['SOURCE.json'])),
    generationManifestSha256: hash(await fs.readFile(files['GENERATION.json']))};
  return {directory, files, storage, objects, calls, binding};
}
const save = f => savePrivateChinaGeneration({storage: f.storage, owner, files: f.files, binding: f.binding});
const restore = (f, saved, options = {}) => restorePrivateChinaGeneration({storage: f.storage, owner,
  expectedReceiptSha256: saved.receiptSha256, outputDirectory: path.join(f.directory, 'restored'), names, ...options});

test('a complete private generation roundtrips compressed multipart bytes and seals completion last', async t => {
  const f = await fixture(t, true), saved = await save(f);
  assert.equal(saved.receipt.published, false);
  assert(saved.receipt.storedBytes < saved.receipt.totalBytes / 10);
  const source = saved.receipt.files.find(file => file.name === 'source.sqlite');
  assert.equal(source.parts.length, 3); assert(source.parts.every(part => part.encoding === 'gzip'));
  const writes = f.calls.filter(x => x.startsWith('PUT '));
  assert.equal(writes.at(-1), 'PUT ' + chinaGenerationRoot(owner) + '/complete.json');
  const result = await restore(f, saved);
  assert.equal(result.receiptSha256, saved.receiptSha256);
  for (const name of names) {
    assert.deepEqual(await fs.readFile(result.paths[name]), await fs.readFile(f.files[name]));
    assert.equal((await fs.stat(result.paths[name])).mode & 0o777, 0o400);
  }
  assert.deepEqual(f.calls.filter(x => x.startsWith('PUT ')), writes);
});

test('a failed readback does not create completion or touch any live key', async t => {
  const f = await fixture(t), read = f.storage.getBinary;
  f.storage.getBinary = async key => { const value = await read(key); return {...value, data: Buffer.from('corrupt')}; };
  await assert.rejects(save(f), /part_readback/);
  assert(!f.objects.has(chinaGenerationRoot(owner) + '/complete.json'));
  assert([...f.objects.keys()].every(key => key.startsWith(chinaGenerationRoot(owner) + '/files/')));
});

test('wrong external receipt and corrupted stored data cannot expose a completed local generation', async t => {
  const f = await fixture(t), saved = await save(f);
  await assert.rejects(restore(f, saved, {expectedReceiptSha256: 'f'.repeat(64)}), /receipt_checksum/);
  const part = saved.receipt.files.find(file => file.name === 'details.sqlite').parts[0];
  f.objects.set(part.key, Buffer.from('corrupt'));
  await assert.rejects(restore(f, saved), /part_checksum/);
  await assert.rejects(fs.stat(path.join(f.directory, 'restored', 'GENERATION.json')), {code: 'ENOENT'});
});

test('identity, exact manifest hashes, complete files and existing directories are enforced', async t => {
  const f = await fixture(t);
  await assert.rejects(savePrivateChinaGeneration({storage: f.storage, owner, files: {...f.files, 'other-market.json': f.files['SOURCE.json']}, binding: f.binding}), /file_set/);
  const g = await fixture(t); g.binding.sourceDescriptorSha256 = 'c'.repeat(64);
  await assert.rejects(save(g), /manifest_binding/);
  assert(!g.objects.has(chinaGenerationRoot(owner) + '/complete.json'));
  const saved = await save(f), existing = path.join(f.directory, 'existing');
  await fs.mkdir(existing); await fs.writeFile(path.join(existing, 'keep'), 'preserved');
  await assert.rejects(restore(f, saved, {outputDirectory: existing}), {code: 'EEXIST'});
  assert.equal(await fs.readFile(path.join(existing, 'keep'), 'utf8'), 'preserved');
});

test('production transport allows only its private China generation keys and create-only objects', async () => {
  const ownerId = 'verified-owner';
  const acl = `<AccessControlPolicy><Owner><ID>${ownerId}</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>${ownerId}</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>`;
  const calls = [], objects = new Map();
  const environment = {YC_OBJECT_STORAGE_ENDPOINT: 'https://s3.regru.cloud', YC_OBJECT_STORAGE_REGION: 'us-east-1',
    YC_OBJECT_STORAGE_BUCKET: 'avtocena-staging-8120751', YC_OBJECT_STORAGE_PREFIX: 'migration-staging/full-20261011/',
    YC_OBJECT_STORAGE_ACCESS_KEY_ID: 'test-key', YC_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret'};
  const storage = createPrivateChinaGenerationStorage({owner, environment, fetcher: async (url, options) => {
    const u = new URL(url); calls.push({path: u.pathname, query: u.search, method: options.method});
    assert.equal(options.redirect, 'error');
    if (u.searchParams.has('acl')) return new Response(acl);
    if (u.searchParams.has('policy')) return new Response('<Error><Code>NoSuchBucketPolicy</Code></Error>', {status: 404});
    if (options.method === 'PUT') {
      assert.equal(options.headers['if-none-match'], '*'); assert.equal(options.headers['x-amz-acl'], 'private');
      objects.set(u.pathname, Buffer.from(options.body)); return new Response('', {status: 200});
    }
    return new Response(objects.get(u.pathname));
  }});
  await storage.assertPrivateBucket(); const before = calls.length;
  await assert.rejects(storage.putBinary('catalog/manifest.json', Buffer.from('x'), 'application/json', {ifNoneMatch: '*'}), /write/);
  await assert.rejects(storage.getBinary('catalog/market-rebuild/v1/korea/runs/1234567/1/generation/complete.json'), /key/);
  await assert.rejects(storage.getBinary(storage.root + '/files/../secret/0-' + 'a'.repeat(64)), /key/);
  assert.equal(calls.length, before);
  const data = Buffer.from('generation'), key = storage.root + '/files/GENERATION.json/0-' + hash(data);
  await assert.rejects(storage.putBinary(key, data, 'application/json', {ifMatch: 'old'}), /create_only/);
  await storage.putBinary(key, data, 'application/json', {ifNoneMatch: '*'});
  assert.deepEqual((await storage.getBinary(key)).data, data);
  assert(calls.every(call => ['GET', 'PUT'].includes(call.method)));
});
