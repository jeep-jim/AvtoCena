import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {readCatalogModelNames, resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
import {loadModelSuggestions} from '../apps/web/lib/catalog/model-suggestion-loader';

test('model names use compact publication data even when moderation or prices need work', async () => {
  const storage = getJsonStorage(), originalRead = storage.readJson, originalMeta = storage.readJsonWithMeta;
  const generationId = 'model-directory-test', reads: string[] = [];
  const models = ['3 Series', ...Array.from({length: 90}, (_, n) => `MODEL ${n}`)]
    .map(model => ({model, count: 1, marketCounts: {china: 1}}));
  const summary = {generationId, brands: {bmw: {make: 'BMW', count: models.length, marketCounts: {china: models.length}, models}}};
  const values = new Map<string, unknown>([
    ['catalog/manifest.json', {generationId, markets: {china: {count: models.length}}}],
    ['catalog/public/brand-summary.json', summary],
    ['catalog/public/facets.json', {generationId, models: [{make: 'BMW', model: 'New model'}]}],
  ]);
  const read = async <T>(path: string, fallback: T): Promise<T> => {
    reads.push(path);
    assert.ok(values.has(path), `unexpected expensive read: ${path}`);
    return values.get(path) as T ?? fallback;
  };
  storage.readJson = read;
  storage.readJsonWithMeta = async <T>(path: string, fallback: T) => ({value: await read(path, fallback), found: true});
  try {
    resetCatalogReadCachesForTests();
    const names = await readCatalogModelNames('BMW', 'china');
    assert.equal(names.length, 91);
    assert.equal(names[0].model, '3 Series');
    assert.equal((await readCatalogModelNames('BMW', 'china|europe')).length, 91);
    assert.deepEqual(await readCatalogModelNames('BMW', 'europe'), []);
    assert.deepEqual(await readCatalogModelNames('Audi', 'china'), []);
    summary.generationId = 'previous'; resetCatalogReadCachesForTests();
    // A summary publication race can use current compact facets, not all vehicles.
    values.set(`catalog/generations/${generationId}/indexes/brand-summary.json`, summary);
    assert.deepEqual(await readCatalogModelNames('BMW', 'china'), [{make: 'BMW', model: 'New model'}]);
    (values.get('catalog/public/facets.json') as any).generationId = 'previous';
    resetCatalogReadCachesForTests();
    await assert.rejects(readCatalogModelNames('BMW'), /catalog_model_directory_unavailable/);
    assert.ok(reads.every(path => !/projection|budget|current-offers|editorial/.test(path)));
  } finally {
    storage.readJson = originalRead; storage.readJsonWithMeta = originalMeta; resetCatalogReadCachesForTests();
  }
});

test('inventory requests are scoped and separate from the independently loaded stock directory', async () => {
  const original = globalThis.fetch, urls: string[] = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return Response.json({version: 1, brands: [], models: [['BMW', '3 Series', [], 1]]});
  };
  try {
    const [a, b] = await Promise.all([loadModelSuggestions(true, undefined, 'BMW', 'china'), loadModelSuggestions(true, undefined, 'BMW', 'china')]);
    assert.equal(urls.length, 1); assert.equal(a, b);
    assert.match(urls[0], /scope=inventory&make=BMW&market=china/);
    assert.equal(a('3', 'BMW')[0].model, '3 Series');
    await loadModelSuggestions(true, undefined, 'BMW', 'green');
    assert.equal(urls.length, 2); assert.match(urls[1], /market=green/);
  } finally { globalThis.fetch = original; }
});
