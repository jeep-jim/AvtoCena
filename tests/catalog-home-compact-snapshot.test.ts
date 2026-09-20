import assert from 'node:assert/strict';
import test from 'node:test';
import { getJsonStorage } from '../apps/web/lib/data';
import { catalogOverviewMarketComplete } from '../apps/web/lib/catalog/overview';
import { readHomeCatalogSnapshot, resetCatalogReadCachesForTests } from '../apps/web/lib/catalog/storage';

test('homepage uses a complete compact snapshot when policy hides a few records', async () => {
  const storage = getJsonStorage(), original = storage.readJsonWithMeta;
  const markets = ['korea', 'china', 'japan', 'uae', 'europe', 'georgia'];
  const manifest = {generationId: 'home-filtered', markets: Object.fromEntries(markets.map(m => [m, {count: 10}]))};
  const overview = {version: 1, publicPolicyVersion: 2, generationId: manifest.generationId,
    facets: {generationId: manifest.generationId},
    markets: Object.fromEntries(markets.map(m => [m, {sourceTotal: 10, total: 8,
      items: Array.from({length: 6}, (_, i) => ({id: `${m}-${i}`, market: m}))}]))};
  storage.readJsonWithMeta = async <T>(key: string, fallback: T) => {
    assert.ok(['catalog/manifest.json', 'catalog/public/overview.json', `catalog/generations/${manifest.generationId}/indexes/overview.json`].includes(key), `must not load large files: ${key}`);
    return {found: true, value: (key.endsWith('manifest.json') ? manifest : overview) as T};
  };
  try {
    resetCatalogReadCachesForTests();
    const result = await readHomeCatalogSnapshot(6);
    assert.equal(result.total, 48);
    assert.equal(result.items.length, 36);
    assert.equal(result.marketCounts.korea, 8);
  } finally {
    storage.readJsonWithMeta = original;
    resetCatalogReadCachesForTests();
  }
});

test('compact completeness gate rejects missing source counts, short samples and false zeroes', () => {
  const items = Array.from({length: 6}, (_, i) => ({id: String(i)})) as any;
  assert.equal(catalogOverviewMarketComplete({total: 8, items}, 10, 6), false);
  assert.equal(catalogOverviewMarketComplete({total: 8, sourceTotal: 9, items}, 10, 6), false);
  assert.equal(catalogOverviewMarketComplete({total: 8, sourceTotal: 10, items: []}, 10, 6), false);
  assert.equal(catalogOverviewMarketComplete({total: 0, sourceTotal: 10, items: []}, 10, 6), false);
  assert.equal(catalogOverviewMarketComplete({total: 10, items}, 10, 6), true);
  assert.equal(catalogOverviewMarketComplete({total: 0, items: []}, 0, 6), true);
});
