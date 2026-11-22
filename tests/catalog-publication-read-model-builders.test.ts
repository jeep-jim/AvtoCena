import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getJsonStorage, resetJsonStorageForTests} from '../apps/web/lib/data';
import {catalogInventoryAgeDecision} from '../apps/web/lib/catalog/inventory-admission';
import {compactPublicStorageOffer, persistCatalogOffers, prepareCatalogProjectionRows, resetCatalogReadCachesForTests,
  type CatalogSearchProjection, type PublicationReadModelBuilders} from '../apps/web/lib/catalog/storage';

const markets = ['china', 'japan', 'korea', 'uae', 'europe', 'georgia'];
const now = new Date('2026-11-22T12:00:00.000Z');
const day = (date = now) => new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);
const ids = (rows: {id: string}[]) => rows.map(row => row.id).sort();

function offer(id: string, market: 'europe' | 'korea', year: number): any {
  return {
    id, sourceId: market === 'europe' ? 'autoscout_europe_open' : 'encar_direct', sourceOfferId: id,
    market, offerType: 'fixed', status: 'active', make: 'Hyundai', model: 'Avante', year,
    sourcePrice: 18_000_000, sourceCurrency: market === 'europe' ? 'EUR' : 'KRW', priceMode: 'fixed',
    totalRub: 2_021_912, mileageKm: 61_114, engineCc: 1598, powerHp: 123,
    powerDataConfidence: 'source_exact', powerDataSource: 'synthetic_exact_fixture',
    fuel: 'petrol', powertrainKind: 'combustion', transmission: 'automatic', drive: 'fwd', bodyType: 'sedan',
    images: Array.from({length: 5}, (_, i) => ({id: `${id}-image-${i}`, url: `https://example.test/${id}/${i}.jpg`,
      objectKey: `catalog/images/${market}/${id}-${i}.jpg`, width: 1280, height: 960, size: 120000,
      checksum: `${id}-${i}`, mimeType: 'image/jpeg'})),
    calculationStatus: 'ready', calculationSnapshot: {
      customs: {status: 'ready'}, breakdown: ['car', 'topavto-commission', 'broker', 'svh', 'laboratory', 'sbkts', 'epts', 'rf-delivery', 'customs']
        .map(id => ({id, amountRub: 1})),
    },
    firstSeenAt: now.toISOString(), updatedAt: now.toISOString(), operational: {
      sourceUrl: market === 'europe' ? `https://www.autoscout24.com/offers/${id}` : `https://fem.encar.com/cars/detail/${id}`,
      photoIdentityVerified: true,
      semanticEvidence: {fuel: {status: 'exact', value: 'petrol'}, powertrainKind: {status: 'exact', value: 'combustion'},
        engineCc: {status: 'exact', value: 1598}, powerHp: {status: 'exact', value: 123}},
    },
  };
}

// The verified runtime loader supplies these functions in production. This
// fixture supplies a separate, fixed serving-membership contract, deliberately
// different from the publisher's newer minimum-model-year admission policy.
function servingBuilders(accepted: ReadonlySet<string>) {
  const calls: {kind: string; market?: string; date?: string; ids: string[]}[] = [];
  const select = (rows: CatalogSearchProjection[]) => rows.filter(row => accepted.has(row.id));
  const facets = (generationId: string): any => ({generationId, makes: [], models: [], markets: [], bodyTypes: [], fuels: [], transmissions: [], drives: []});
  const builders: PublicationReadModelBuilders = {
    async prepareBudgetRows(rows) {
      await Promise.resolve();
      calls.push({kind: 'budget', ids: ids(rows)});
      return select(rows);
    },
    async buildLanding(generationId, market, rows, options = {}) {
      calls.push({kind: 'landing', market, date: options.now ? day(options.now) : 'initial', ids: ids(rows)});
      const selected = select(rows);
      return {version: 1, generationId, market, policyDate: day(options.now), sourceTotal: rows.length,
        total: selected.length, items: selected.slice(0, 192), facets: facets(generationId)};
    },
    async buildOverview(generationId, rows, options = {}) {
      calls.push({kind: 'overview', date: day(options.now), ids: ids(rows)});
      return {version: 1, publicPolicyVersion: 2, generationId, policyDate: day(options.now), facets: facets(generationId),
        markets: Object.fromEntries(markets.map(market => {
          const source = rows.filter(row => row.market === market), selected = select(source);
          return [market, {sourceTotal: source.length, total: selected.length, items: selected.slice(0, 24)}];
        }))};
    },
  };
  return {builders, calls};
}

async function fixture(t: any, run: (storage: ReturnType<typeof getJsonStorage>) => Promise<void>) {
  const cwd = process.cwd(), root = await fs.mkdtemp(path.join(os.tmpdir(), 'publication-builders-'));
  const names = ['JSON_STORAGE_DRIVER', 'CATALOG_GROW_ONLY_MARKETS', 'CATALOG_LIVE_RATE_DISABLED'];
  const previous = Object.fromEntries(names.map(key => [key, process.env[key]]));
  t.mock.timers.enable({apis: ['Date'], now});
  try {
    await fs.mkdir(path.join(root, 'data')); process.chdir(root);
    process.env.JSON_STORAGE_DRIVER = 'local'; process.env.CATALOG_GROW_ONLY_MARKETS = ''; process.env.CATALOG_LIVE_RATE_DISABLED = 'true';
    resetJsonStorageForTests(); resetCatalogReadCachesForTests();
    const storage = getJsonStorage();
    await storage.writeJson('catalog/manifest.json', {version: 2, generationId: 'gen_initial', markets: {}});
    await run(storage);
  } finally {
    process.chdir(cwd);
    for (const key of names) {if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];}
    t.mock.timers.reset(); resetJsonStorageForTests(); resetCatalogReadCachesForTests();
    await fs.rm(root, {recursive: true, force: true});
  }
}

test('real publication uses serving membership for budget, initial landings and all three dated page windows', async t => fixture(t, async storage => {
  const preserved = [offer('eu-2020', 'europe', 2020), offer('eu-2021', 'europe', 2021)];
  const incoming = [offer('kr-2021', 'korea', 2021), offer('kr-2022', 'korea', 2022)];
  const frozen = JSON.stringify(preserved), accepted = new Set(['eu-2020', 'eu-2021', 'kr-2022']);
  const {builders, calls} = servingBuilders(accepted);
  assert.equal(catalogInventoryAgeDecision(incoming[0], now).eligible, false, 'fresh Korea still requires model year 2022');
  let admissionChecked = false;
  const writes = new Map<string, any>(), write = storage.writeJson.bind(storage);
  storage.writeJson = async (key, value, condition) => {
    writes.set(key, structuredClone(value));
    return write(key, value, condition);
  };
  const manifest = await persistCatalogOffers([...preserved, ...incoming], {
    expectedBaseGenerationId: 'gen_initial', preservePublicOffersByMarket: {europe: preserved},
    publicationReadModelBuilders: builders,
    beforePublishValidate(rows) {
      assert.deepEqual(ids(rows), [...accepted].sort());
      assert.equal(JSON.stringify(rows.filter(row => row.market === 'europe')), frozen);
      admissionChecked = true;
    },
  });
  assert.equal(admissionChecked, true);
  assert.equal(JSON.stringify(preserved), frozen, 'retained source records were not mutated');
  assert.equal(manifest.markets.europe.count, 2); assert.equal(manifest.markets.korea.count, 1);
  const prefix = `catalog/generations/${manifest.generationId}/indexes/`;
  const raw: any = await storage.readJson(prefix + 'projection/europe.json', null);
  assert.deepEqual(ids(raw.items), ['eu-2020', 'eu-2021']);
  assert.equal(prepareCatalogProjectionRows(raw.items).length, 0, 'the publisher default policy remains unchanged');
  const budget: any = await storage.readJson(prefix + 'budget-count-v3.json', null);
  assert.deepEqual([...budget.rows, ...budget.otherRows].map(row => row[5].id).sort(), [...accepted].sort());
  assert.deepEqual(calls.filter(call => call.kind === 'budget').map(call => call.ids), [[...accepted].sort()]);
  for (const market of ['europe', 'korea']) assert.equal(calls.filter(call => call.kind === 'landing' && call.market === market && call.date === 'initial').length, 1);
  for (const [suffix, date] of [['', '2026-11-22'], ['.2026-11-23', '2026-11-23'], ['.2026-11-24', '2026-11-24']]) {
    const landing: any = await storage.readJson(prefix + `market-landing-v1/europe${suffix}.json`, null);
    const overview: any = await storage.readJson(prefix + `overview${suffix}.json`, null);
    assert.equal(landing.policyDate, date); assert.equal(landing.sourceTotal, 2); assert.equal(landing.total, 2);
    assert.deepEqual(ids(landing.items), ['eu-2020', 'eu-2021']);
    assert.equal(overview.policyDate, date); assert.equal(overview.dailyLandingsVersion, 1);
    assert.deepEqual(ids(overview.markets.europe.items), ['eu-2020', 'eu-2021']);
    assert.deepEqual(ids(overview.markets.korea.items), ['kr-2022']);
  }
  const retainedChunks = [...writes.entries()].filter(([key]) => key.startsWith(`catalog/generations/${manifest.generationId}/`) && !key.includes('/indexes/') && Array.isArray(writes.get(key)))
    .flatMap(([, rows]) => rows).filter(row => row?.market === 'europe');
  assert.deepEqual(retainedChunks, preserved.map(compactPublicStorageOffer), 'immutable retained vehicle chunks remain unchanged');
  assert.equal((await storage.readJson<any>('catalog/manifest.json', null)).generationId, manifest.generationId);
}));

for (const mode of ['duplicate', 'foreign-id', 'changed-market', 'not-an-array'] as const) {
  test(`publication rejects ${mode} from an async budget builder before budget writes or cutover`, async t => fixture(t, async storage => {
    const row = offer('retained', 'europe', 2021), {builders} = servingBuilders(new Set([row.id]));
    builders.prepareBudgetRows = async rows => {
      await Promise.resolve();
      if (mode === 'duplicate') return [rows[0], rows[0]];
      if (mode === 'foreign-id') return [{...rows[0], id: 'not-in-published-projection'}];
      if (mode === 'changed-market') return [{...rows[0], market: 'korea'}];
      return null as any;
    };
    const baseline = await storage.readJson('catalog/manifest.json', null), write = storage.writeJson.bind(storage);
    let budgetWrites = 0, manifestWrites = 0;
    storage.writeJson = async (key, value, condition) => {
      if (/\/indexes\/budget-(?:cards|count|prices|markets)-v3\//.test(key) || key.endsWith('/indexes/budget-count-v3.json')) budgetWrites++;
      if (key === 'catalog/manifest.json') manifestWrites++;
      return write(key, value, condition);
    };
    await assert.rejects(persistCatalogOffers([row], {expectedBaseGenerationId: 'gen_initial', preservePublicOffersByMarket: {europe: [row]},
      publicationReadModelBuilders: builders}), /catalog_publication_budget_selection_invalid/);
    assert.equal(budgetWrites, 0); assert.equal(manifestWrites, 0);
    assert.deepEqual(await storage.readJson('catalog/manifest.json', null), baseline);
  }));
}
