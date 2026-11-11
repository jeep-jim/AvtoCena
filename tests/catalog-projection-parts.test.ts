import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LocalJsonStorage, ObjectJsonStorage, StorageConflictError} from '../apps/web/lib/data';
import {readCatalogProjectionParts} from '../apps/web/lib/catalog-projection-parts';

const root = 'catalog/public/projection/all.json';
test('large all-market projection keeps atomic roots, exact rows and fail-closed reads', async t => {
  const cwd = process.cwd(), previous = process.env.CATALOG_CHUNKED_ALL_PROJECTION_WRITE;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'projection-parts-'));
  await fs.mkdir(path.join(dir, 'data')); process.chdir(dir);
  const storage = new LocalJsonStorage();
  const old = {generationId: 'old', items: [{id: 'old'}]};
  const value = {generationId: 'new', items: Array.from({length: 2501}, (_, i) => ({id: String(i), market: i % 2 ? 'china' : 'uae', name: 'Комплектация 北京', unknown: null, nested: {history: [i, true], amount: 3177645}, absent: undefined}))};
  try {
    delete process.env.CATALOG_CHUNKED_ALL_PROJECTION_WRITE;
    await storage.writeJson(root, old);
    assert.deepEqual(await storage.readJson(root, null), old);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join('data', root), 'utf8')), old);
    process.env.CATALOG_CHUNKED_ALL_PROJECTION_WRITE = '1';

    await t.test('never serializes the full items array; exact legacy-shaped readback', async () => {
      const stringify = JSON.stringify;
      const guard = t.mock.method(JSON, 'stringify', ((v: any, ...args: any[]) => {
        if (Array.isArray(v?.items) && v.items.length > 1000) throw RangeError('simulated V8 single-string limit');
        return (stringify as any)(v, ...args);
      }) as any);
      try { await storage.writeJson(root, value); } finally { guard.mock.restore(); }
      const directory = JSON.parse(await fs.readFile(path.join('data', root), 'utf8'));
      assert.equal(directory.parts.length, 3);
      assert.equal(directory.count, value.items.length);
      assert.equal(directory.items, undefined);
      assert.deepEqual(await storage.readJson(root, null), JSON.parse(JSON.stringify(value)));
      await storage.writeJson(root, value); // Content-addressed parts can be reused.
      assert.deepEqual(await storage.readJson(root, null), JSON.parse(JSON.stringify(value)));
    });
    await t.test('a failed child write never replaces the previous root', async () => {
      const before = await fs.readFile(path.join('data', root), 'utf8');
      const original = storage.writeJson.bind(storage);
      const fail = t.mock.method(storage, 'writeJson', async (key, v, condition) => {
        if (key.includes('/broken/') && key.includes('/1-')) throw Error('network_failed');
        return original(key, v, condition);
      });
      try { await assert.rejects(storage.writeJson(root, {...value, generationId: 'broken'}), /network_failed/); }
      finally { fail.mock.restore(); }
      assert.equal(await fs.readFile(path.join('data', root), 'utf8'), before);
    });
    await t.test('root CAS conflict retains the active generation', async () => {
      await assert.rejects(storage.writeJson(root, {...value, generationId: 'conflict'}, {ifMatch: 'wrong-etag'}), StorageConflictError);
      assert.equal((await storage.readJson<any>(root, null)).generationId, 'new');
    });
    await t.test('missing, altered, count-mismatched and foreign children are rejected', async () => {
      const directory = JSON.parse(await fs.readFile(path.join('data', root), 'utf8'));
      await assert.rejects(readCatalogProjectionParts(storage, root, {...directory, count: directory.count + 1}), /count_mismatch/);
      await assert.rejects(readCatalogProjectionParts(storage, root, {...directory, parts: [{...directory.parts[0], path: 'settings/private.json'}]}), /descriptor_invalid/);
      const first = path.join('data', directory.parts[0].path), saved = await fs.readFile(first);
      await fs.writeFile(first, JSON.stringify({items: [{id: 'changed'}]}));
      await assert.rejects(storage.readJson(root, null), /integrity_failed/);
      await fs.rm(first);
      await assert.rejects(storage.readJson(root, null), /integrity_failed/);
      await fs.writeFile(first, saved);
    });
    await t.test('unknown root fields are never silently dropped', async () => {
      await assert.rejects(storage.writeJson(root, {...value, extra: true}), /unexpected_fields/);
    });
  } finally {
    process.chdir(cwd);
    if (previous === undefined) delete process.env.CATALOG_CHUNKED_ALL_PROJECTION_WRITE;
    else process.env.CATALOG_CHUNKED_ALL_PROJECTION_WRITE = previous;
    await fs.rm(dir, {recursive: true, force: true});
  }
});

test('object storage keeps root ETags and reuses expanded rows on 304', async () => {
  const config = {YC_OBJECT_STORAGE_ENDPOINT: 'https://s3.regru.cloud', YC_OBJECT_STORAGE_REGION: 'us-east-1', YC_OBJECT_STORAGE_BUCKET: 'synthetic', YC_OBJECT_STORAGE_PREFIX: '', YC_OBJECT_STORAGE_ACCESS_KEY_ID: 'synthetic', YC_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'synthetic', CATALOG_CHUNKED_ALL_PROJECTION_WRITE: '1'};
  const before = Object.fromEntries(Object.keys(config).map(k => [k, process.env[k]]));
  const originalFetch = globalThis.fetch;
  const objects = new Map<string, {text: string; etag: string}>();
  let reads = 0, version = 0;
  try {
    Object.assign(process.env, config);
    globalThis.fetch = async (url, options) => {
      const key = new URL(String(url)).pathname, headers = new Headers(options?.headers), saved = objects.get(key);
      if (options?.method === 'PUT') {
        if (headers.get('if-none-match') === '*' && saved) return new Response(null, {status: 412});
        if (headers.has('if-match') && headers.get('if-match') !== saved?.etag) return new Response(null, {status: 412});
        objects.set(key, {text: String(options.body), etag: `v${++version}`});
        return new Response(null, {status: 200});
      }
      reads++;
      if (!saved) return new Response(null, {status: 404});
      if (headers.get('if-none-match') === `"${saved.etag}"`) return new Response(null, {status: 304});
      return new Response(saved.text, {headers: {etag: `"${saved.etag}"`}});
    };
    const storage = new ObjectJsonStorage(), value = {generationId: 'object', items: Array.from({length: 1001}, (_, id) => ({id, name: 'Авто'}))};
    await storage.writeJson(root, value, {ifNoneMatch: '*'});
    const first = await storage.readJsonWithMeta(root, null);
    assert.deepEqual(first.value, value);
    const previousReads = reads;
    assert.equal(await storage.readJsonWithMeta(root, null, first), first);
    assert.equal(reads, previousReads + 1, '304 must not re-read immutable parts');
    await assert.rejects(storage.writeJson(root, value, {ifMatch: 'wrong'}), StorageConflictError);
    await storage.writeJson(root, {generationId: 'empty', items: []}, {ifMatch: first.etag});
    assert.deepEqual((await storage.readJsonWithMeta(root, null, first)).value, {generationId: 'empty', items: []});
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
