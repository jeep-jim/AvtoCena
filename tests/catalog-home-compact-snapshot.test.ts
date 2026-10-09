import assert from 'node:assert/strict';
import test from 'node:test';
import { getJsonStorage } from '../apps/web/lib/data';
import { buildCatalogOverviewPayload, catalogOverviewMarketComplete } from '../apps/web/lib/catalog/overview';
import { readHomeCatalogSnapshot, resetCatalogReadCachesForTests } from '../apps/web/lib/catalog/storage';

test('homepage uses a complete compact snapshot when policy hides a few records', async () => {
  const storage = getJsonStorage(), original = storage.readJsonWithMeta;
  const oldSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'homepage-runtime-secret';
  const rawPhoto = 'https://2sc2.autoimg.cn/escimg/auto/car.jpg.webp';
  const markets = ['korea', 'china', 'japan', 'uae', 'europe', 'georgia'];
  const manifest = {generationId: 'home-filtered', markets: Object.fromEntries(markets.map(m => [m, {count: 10}]))};
  const overview = buildCatalogOverviewPayload(manifest.generationId,
    {generationId: manifest.generationId} as any,
    Object.fromEntries(markets.map(m => [m, {sourceTotal: 10, total: 8,
      items: Array.from({length: 6}, (_, i) => ({id: `${m}-${i}`, market: m, cardImageUrl: rawPhoto, images: [{url:rawPhoto}]}))}])) as any);
  storage.readJsonWithMeta = async <T>(key: string, fallback: T) => {
    if(key==='catalog-editorial/current.json')return {found:false,value:fallback};
  assert.ok(['catalog/manifest.json', 'catalog/public/overview.json', `catalog/generations/${manifest.generationId}/indexes/overview.json`].includes(key), `must not load large files: ${key}`);
    return {found: true, value: (key.endsWith('manifest.json') ? manifest : overview) as T};
  };
  try {
    resetCatalogReadCachesForTests();
    const result = await readHomeCatalogSnapshot(6);
    assert.equal(result.total, 48);
    assert.equal(result.items.length, 36);
    assert.equal(result.marketCounts.korea, 8);
    const china = result.items.find(item => item.market === 'china')!;
    assert.match((china as any).cardImageUrl, /^\/api\/catalog\/photo\//);
    assert.equal(china.images[0].url, (china as any).cardImageUrl);
    assert.equal(overview.markets.china.items[0].images[0].url, rawPhoto);
  } finally {
    storage.readJsonWithMeta = original;
    if (oldSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = oldSecret;
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
