import assert from 'node:assert/strict';
import test from 'node:test';
import { getJsonStorage } from '../apps/web/lib/data';
import { readAiSitemapProjection } from '../apps/web/lib/ai-discovery';
import { getOfferFromCurrentProjection, resetCatalogReadCachesForTests } from '../apps/web/lib/catalog/storage';

test('shared projection is reused but stale generation cannot serve a detail', async () => {
  const storage = getJsonStorage(), original = storage.readJsonWithMeta;
  const id = 'mobile_de_open:cache-test';
  const row = {id, market: 'europe', make: 'Toyota', model: 'Camry', year: 2026};
  const reads: string[] = [];
  let manifestGeneration = 'one', projectionGeneration = 'one';
  storage.readJsonWithMeta = async <T>(key: string, fallback: T) => {
    reads.push(key);
    let value: unknown;
    if (key === 'catalog/manifest.json') value = {generationId: manifestGeneration, markets: {}};
    else if (key === 'catalog/public/facets.json') value = {generationId: ''};
    else if (key === 'catalog/public/sitemap-projection.json') value = null;
    else if (key === 'catalog/public/projection/all.json') value = {generationId: projectionGeneration, items: [row]};
    else if (key === 'catalog/public/projection/europe.json') value = {generationId: manifestGeneration, items: [row]};
    else if(key==='catalog-editorial/current.json')return {found:false,value:fallback};
    else assert.fail(`unexpected storage read: ${key}`);
    return {found: true, value: value as T};
  };
  try {
    resetCatalogReadCachesForTests();
    await getOfferFromCurrentProjection('unknown'); // warm all-market snapshot
    assert.equal((await getOfferFromCurrentProjection(id))?.id, id);
    assert.equal((await readAiSitemapProjection())?.items[0].id, id);
    assert.equal(reads.filter(key => key.endsWith('/europe.json')).length, 0);
    assert.equal(reads.filter(key => key.endsWith('/all.json')).length, 1);
    manifestGeneration = 'two'; resetCatalogReadCachesForTests(); reads.length = 0;
    assert.equal(await getOfferFromCurrentProjection('unknown'), null);
    assert.equal(await getOfferFromCurrentProjection(id),null,'unpublished new generation does not reuse stale rows');
    assert.equal(reads.filter(key=>key.endsWith('/europe.json')).length,0);
    projectionGeneration='two';resetCatalogReadCachesForTests();
    assert.equal((await getOfferFromCurrentProjection(id))?.id,id,'detail becomes available once the matching projection is published');

  } finally {
    storage.readJsonWithMeta = original;
    resetCatalogReadCachesForTests();
  }
});
