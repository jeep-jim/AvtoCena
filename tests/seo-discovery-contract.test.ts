import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { discoveryPrice, discoveryDescription } from '../apps/web/lib/catalog/discovery-policy';
import { buildAiProductFeed } from '../apps/web/lib/ai-discovery';
import { commercialCatalogMeta, marketLanding, budgetLandingQuery } from '../apps/web/lib/seo/commercial-catalog';

const ready = { id: 'valid', make: 'Kia', model: 'K5', market: 'korea', year: 2023,
  cardImageUrl: '/car.webp', cardProjectionVersion: 3, publicSpecificationVerified: true,
  calculationStatus: 'ready', publicVisibleRub: 2_000_000, totalRub: 2_000_000 };

test('discovery excludes historical, inactive, preliminary, seller and conflicting prices from commercial feed', () => {
  const rows = [ready,
    { ...ready, id: 'japan', market: 'japan', catalogKind: 'auction_result' },
    { ...ready, id: 'sold', status: 'sold' },
    { ...ready, id: 'stale', status: 'stale' },
    { ...ready, id: 'seller', catalogPricingMode: 'seller', sellerPriceRub: 900_000 },
    { ...ready, id: 'preliminary', calculationSnapshot: { pricingConfidence: 'preliminary' } },
    { ...ready, id: 'conflict', fuel: 'petrol', powertrainKind: 'combustion', powerHp: 103, powerKw: 146.36 },
    { ...ready, id: 'missing', publicVisibleRub: 0, totalRub: 0, calculationStatus: 'needs_data' },
  ];
  const feed = buildAiProductFeed({ generationId: 'test', items: rows as any });
  assert.equal(feed.productCount, 1);
  const csv = gunzipSync(feed.data).toString('utf8');
  assert.match(csv, /"valid"/);
  assert.match(csv, /preorder/);
  assert.doesNotMatch(csv, /in_stock|"conflict"|"japan"|"seller"/);
  assert.equal(discoveryPrice(rows[1]).kind, 'auction_result');
  assert.match(discoveryDescription(rows[1], 'Kia', 'Япония'), /не является предложением к покупке/);
  assert.match(discoveryDescription(rows[4], 'Kia', 'Корея'), /900.*000.*без доставки/);
});

test('canonical commercial intents accept campaign tags, reject filter duplicates and unknown route keys', () => {
  const market = commercialCatalogMeta({ market: 'china', utm_source: 'yandex', yclid: 'test' });
  assert.equal(market.alternates.canonical, '/cars/china');
  assert.equal(market.robots.index, true);
  assert.equal(commercialCatalogMeta({ market: 'china', fuel: 'electric' }).robots.index, false);
  assert.equal(commercialCatalogMeta({ budgetTo: '2000000', hasPrice: 'yes' }).alternates.canonical, '/cars/budget/2000000');
  assert.equal(commercialCatalogMeta({ budgetTo: '123456' }).robots.index, false);
  assert.equal(marketLanding('toString'), undefined);
  assert.equal(marketLanding('__proto__'), undefined);
});

test('commercial core has unique intent groups and explicitly unmeasured demand, advertising remains gated', () => {
  const core = JSON.parse(readFileSync('data/seo/commercial-core-v1.json', 'utf8'));
  assert.equal(core.searchVolume, null);
  assert.equal(core.advertising.enabled, false);
  assert.equal(core.clusters.length, 20);
  assert.equal(new Set(core.clusters.map((c: any) => c.id)).size, core.clusters.length);
  assert.equal(core.clusters.reduce((n: number, c: any) => n + c.keywords.length, 0), 120);
  assert.equal(core.clusters.find((c: any) => c.id === 'market-japan').adStatus, 'hold-sold-lots-not-stock');
});

test('budget landing route controls both filtering and canonical despite conflicting query aliases', () => {
  for (const budget of ['5000000', ['5000000', '1000000'], 'invalid', '-1']) {
    const query = budgetLandingQuery('2000000', {budget, budgetTo: '3000000', hasPrice: 'no', utm_source: 'test'});
    assert.equal(Object.hasOwn(query, 'budget'), false);
    assert.equal(query.budgetTo, '2000000');
    assert.equal(query.hasPrice, 'yes');
    assert.equal(commercialCatalogMeta(query).alternates.canonical, '/cars/budget/2000000');
    assert.equal(commercialCatalogMeta(query).robots.index, true);
  }
  const filtered = budgetLandingQuery('2000000', {fuel: 'petrol', make: 'Toyota'});
  assert.equal(filtered.fuel, 'petrol');
  assert.equal(filtered.make, 'Toyota');
  assert.equal(commercialCatalogMeta(filtered).robots.index, false);
  const wrapper = readFileSync('apps/web/app/(public)/cars/budget/[amount]/page.tsx', 'utf8');
  assert.match(wrapper, /return budgetLandingQuery\(amount, await props\.searchParams\)/);
});

test('page and metadata share canonical presentation and scenario metadata is exported at page level', () => {
  const page = readFileSync('apps/web/app/(public)/cars/offer/[id]/page.tsx', 'utf8');
  const layout = readFileSync('apps/web/app/(public)/cars/offer/[id]/layout.tsx', 'utf8');
  assert.match(page, /getOfferPresentationForPage/);
  assert.match(layout, /getOfferPresentationForPage/);
  assert.match(page, /const metadata = await baseOfferMetadata\(\{ params \}\)/);
  assert.match(page, /query\.powerHp \|\| query\.modificationId[\s\S]*index: false/);
  assert.match(layout, /index: !state\.inactive/);
  assert.doesNotMatch(layout, /schema\.org\/InStock/);
});
