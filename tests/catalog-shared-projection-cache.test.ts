import assert from 'node:assert/strict';
import test from 'node:test';
import { getJsonStorage } from '../apps/web/lib/data';
import { getOfferFromCurrentProjection, resetCatalogReadCachesForTests } from '../apps/web/lib/catalog/storage';

test('a market detail fallback reuses the full projection and still checks cutover generation', async () => {
  const storage = getJsonStorage(), original = storage.readJsonWithMeta;
  const id = 'jpauc_japan_past_open:cache-test';
  const row = {id, market: 'japan', make: 'Toyota', model: 'Camry', year: 2026};
  const reads: string[] = [];
  let manifestGeneration = 'one';
  storage.readJsonWithMeta = async <T>(key: string, fallback: T) => {
    reads.push(key);
    let value: unknown;
    if (key === 'catalog/manifest.json') value = {generationId: manifestGeneration, markets: {}};
    else if (key === 'catalog/public/projection/all.json') value = {generationId: 'one', items: [row]};
    else if (key === 'catalog/public/projection/japan.json') value = {generationId: manifestGeneration, items: [row]};
    else assert.fail(`unexpected storage read: ${key}`);
    return {found: true, value: value as T};
  };
  try {
    resetCatalogReadCachesForTests();
    await getOfferFromCurrentProjection('unknown'); // warm all-market snapshot
    assert.equal((await getOfferFromCurrentProjection(id))?.id, id);
    assert.equal(reads.filter(key => key.endsWith('/japan.json')).length, 0);
    assert.equal(reads.filter(key => key.endsWith('/all.json')).length, 1);
    manifestGeneration = 'two'; resetCatalogReadCachesForTests(); reads.length = 0;
    assert.equal(await getOfferFromCurrentProjection('unknown'), null);
    assert.equal((await getOfferFromCurrentProjection(id))?.id, id, 'stale shared snapshot falls back to the new market file');
    assert.equal(reads.filter(key => key.endsWith('/japan.json')).length, 1);
  } finally {
    storage.readJsonWithMeta = original;
    resetCatalogReadCachesForTests();
  }
});
