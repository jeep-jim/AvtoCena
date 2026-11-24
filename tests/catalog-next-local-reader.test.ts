import './helpers/server-only-hook.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {fixture, row, editorialEntry} from './helpers/china-pricing-worker-fixture.mjs';
import {buildChinaPricingGeneration} from '../scripts/catalog-next/pricing-generation.mjs';
import {initializeLocalChinaReader, searchLocalChina, localChinaFacets, localChinaCounts,
  readLocalChinaOffer, localChinaPublicRates, resetLocalChinaReaderForTests, chinaLocalOfferGuard} from '../apps/web/lib/catalog/china-local-reader';
import {searchOffers, countCatalogOffers, readCatalogModelNames, publicOffer, readCatalogFacets, resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
import {readCatalogMarketPage} from '../apps/web/lib/catalog/market-page';
import {readPreparedChinaCompatibility, PreparedChinaCutChanged} from '../apps/web/lib/catalog/prepared-china-http-fixture';
import {priceCardForCity} from '../apps/web/lib/catalog/card-city-delivery';
import {applyActiveBusinessPricing, applyActiveBusinessPricingBatch} from '../apps/web/lib/catalog/live-business-pricing';
import {getJsonStorage} from '../apps/web/lib/data';
import {withCatalogEditorialSnapshot} from '../apps/web/lib/catalog/editorial';
import {offerCardPath} from '../apps/web/lib/catalog/offer-url';

const envKeys = ['CATALOG_CHINA_LOCAL_GENERATION_DIR', 'CATALOG_CHINA_LOCAL_MANIFEST_SHA256', 'CATALOG_CHINA_LOCAL_RUNTIME_SHA'];
async function pageApi() {
  // Next supplies server React and request caches in production. Plain Node's
  // React18 lacks cache; only those framework wrappers are identities here.
  const require = createRequire(import.meta.url);
  require('react').cache = (fn: any) => fn;
  require('next/cache').unstable_cache = (fn: any) => fn;
  return {...await import('../apps/web/lib/catalog/offer-display-data'), ...await import('../apps/web/lib/catalog/offer-page-data')};
}
async function setup(t: any, options: any = {}) {
  const f = await fixture(t, options);
  f.options.generationId = 'gen_china_45349439965_1';
  const built = await buildChinaPricingGeneration(f.options);
  const before = envKeys.map(key => process.env[key]);
  await resetLocalChinaReaderForTests();
  process.env.CATALOG_CHINA_LOCAL_GENERATION_DIR = f.options.outputDirectory;
  process.env.CATALOG_CHINA_LOCAL_MANIFEST_SHA256 = built.manifestSha256;
  process.env.CATALOG_CHINA_LOCAL_RUNTIME_SHA = built.manifest.runtimeSha;
  t.after(async () => {
    await resetLocalChinaReaderForTests();
    envKeys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; });
  });
  // Once preparation is complete every native request must use only its local
  // immutable files. No dynamic settings, editorial, encyclopedia or rate read.
  const storage = getJsonStorage(); let mutableReads = 0;
  t.mock.method(storage, 'readJson', async () => { mutableReads++; throw Error('mutable_storage_forbidden'); });
  return {...f, built, mutableReads: () => mutableReads};
}

test('actual worker generation serves complete native pages, filters, names and public cards without mutable reads', async t => {
  const offers = Array.from({length: 63}, (_, i) => row(String(i + 1), {
    year: 2014 + i % 13, mileageKm: i * 1100, sourcePrice: 60000 + i * 100,
    ...(i % 3 === 0 ? {make: 'Audi', model: 'A6'} : {}),
    powerHp: i % 2 ? 150 : 180, utilizationPowerKw: (i % 2 ? 150 : 180) / 1.35962,
    color: i % 2 ? 'white' : 'black', vin: 'PRIVATE-VIN-FIXTURE', frameNumber: 'PRIVATE-FRAME-FIXTURE',
  }));
  const f = await setup(t, {offers});
  const state = (await initializeLocalChinaReader())!;
  const all = (await searchLocalChina({market: 'china', pageSize: 48}))!;
  assert.equal(all.total, 63); assert.equal(all.items.length, 48);
  const pages = await Promise.all([1, 2, 3, 4].map(page => readCatalogMarketPage({market: 'china', page})));
  assert.deepEqual(pages.map(page => page.items.length), [24, 24, 15, 0]);
  assert.equal(new Set(pages.flatMap(page => page.items.map(item => item.id))).size, 63);
  const byPower = (await searchOffers({market: 'china', powerTo: 160, pageSize: 48}))!;
  assert.equal(byPower.total, offers.filter(offer => offer.powerHp <= 160).length);
  assert.equal((await countCatalogOffers({market: 'china', powerTo: 160})).total, byPower.total);
  const alias = (await searchLocalChina({market: 'china', make: 'Audi', model: 'А6', yearFrom: 2014}))!;
  assert.equal(alias.total, 21);
  assert.equal((await localChinaCounts({make: 'Audi'}))!.counts.Audi, 21);
  assert.deepEqual(await readCatalogModelNames('Audi', 'china'), [{make: 'Audi', model: 'A6'}]);
  assert((await localChinaFacets())!.colors.length >= 2);
  for (const item of all.items) {
    assert.equal(item.operational, undefined); assert.equal(item.vin, undefined); assert.equal(item.frameNumber, undefined);
    assert.equal(item.sourceId, undefined); assert.equal(item.sourceGroup, undefined);
    assert(chinaLocalOfferGuard(item)); assert.equal(item.preparedChinaSelection.generationId, f.built.manifest.generationId);
  }
  for (const params of [{city: 'Новокузнецк'}, {city: 'Москва', powerTo: 160},
    {city: 'Кемерово', sort: 'totalRub', page: 2}, {city: 'Неизвестный город', budgetTo: 3_000_000}]) {
    const query = {market: 'china' as const, ...params};
    const expected = state.query.query(state.semantics.compileRequest({...query, pageSize: 24}));
    const actual = (await searchLocalChina(query, {marketPage: true}))!;
    assert.equal(actual.total, expected.total);
    assert.deepEqual(actual.items.map(item => item.id), expected.items.map((item: any) => item.id));
    actual.items.forEach((item, i) => {
      assert.equal(item.totalRub, expected.items[i].queryRub);
      assert.deepEqual(item.preparedChinaCityPrices.values, state.query.cityPrices(item.id));
    });
  }
  assert.equal(f.mutableReads(), 0); assert.equal(f.reads().networkCalls, 0);
});

test('saved city totals, detail ledger and client city changes stay equal without recalculating', async t => {
  const source = row('101'), f = await setup(t, {offers: [source]});
  const plain = (await readLocalChinaOffer(source.id))!.offer!;
  const baseRub = plain.totalRub;
  for (const city of ['Новокузнецк', 'Москва', 'Кемерово', 'Неизвестный город']) {
    const list = (await searchLocalChina({market: 'china', city}))!;
    const detail = (await readLocalChinaOffer(source.id, city))!.offer!;
    assert.equal(list.items[0].totalRub, detail.totalRub);
    assert.equal(priceCardForCity(plain, city).offer.totalRub, detail.totalRub);
    assert.equal(priceCardForCity(list.items[0], '').offer.totalRub, baseRub);
    const href = new URL(offerCardPath(list.items[0]), 'https://avtocena.com');
    assert.equal(href.searchParams.get('preparedCut'), f.built.manifest.generationId);
    assert.equal(href.searchParams.get('city'), city); assert.equal(href.searchParams.get('market'), 'china');
    assert.equal(detail.calculationSnapshot!.breakdown!.reduce((sum: number, line: any) => sum + line.amountRub, 0), detail.totalRub);
    assert.equal((await searchLocalChina({market: 'china', city, budgetFrom: detail.totalRub!, budgetTo: detail.totalRub!}))!.total, 1);
    if (city === 'Неизвестный город') assert.equal((detail.calculationSnapshot as any).deliveryQuote.status, 'needs_quote');
  }
  assert.equal(f.mutableReads(), 0); assert.equal(f.reads().networkCalls, 0);
});

test('live city cards and details reuse one verified ledger while every returned value stays detached', async t => {
  const source = row('105'), f = await setup(t, {offers: [source]});
  const state = (await initializeLocalChinaReader())!;
  const get = state.city.get.bind(state.city), reads = t.mock.method(state.city, 'get', (...args: any[]) => get(...args));
  const plain = (await readLocalChinaOffer(source.id))!.offer!;
  const card = (await searchLocalChina({market: 'china', city: 'Новокузнецк'}))!.items[0];
  const detail = (await readLocalChinaOffer(source.id, 'Новокузнецк'))!.offer!;
  const expectedCard = structuredClone(card), expectedDetail = structuredClone(detail);
  assert.equal(reads.mock.callCount(), 1);
  card.totalRub = -1;
  (card.calculationSnapshot as any).deliveryQuote.amountRub = -2;
  (card.calculationSnapshot as any).paymentPlan.remainingAfterInitialRub = -3;
  (card.preparedChinaCityPrices as any).values['Новокузнецк'] = -4;
  const replacement = detail.calculationSnapshot!.breakdown!.find(line => line.id === 'rf-delivery')!;
  replacement.amountRub = -5; replacement.title = 'mutated by a consumer';
  (detail.calculationSnapshot as any).deliveryPricingBasis.subtotalRub = -6;
  assert.deepEqual((await searchLocalChina({market: 'china', city: 'Новокузнецк'}))!.items[0], expectedCard);
  assert.deepEqual((await readLocalChinaOffer(source.id, 'Новокузнецк'))!.offer, expectedDetail);
  for (const {key, city: preparedCity} of state.semantics.cities) {
    const city = preparedCity || 'Неизвестный город';
    const list = (await searchLocalChina({market: 'china', city}))!;
    const offer = (await readLocalChinaOffer(source.id, city))!.offer!;
    assert.equal(list.items[0].totalRub, state.query.cityPrices(source.id)[key]);
    assert.equal(offer.totalRub, list.items[0].totalRub);
    assert.equal(priceCardForCity(plain, city).offer.totalRub, offer.totalRub);
    assert.equal(offer.calculationSnapshot!.breakdown!.reduce((sum, line) => sum + line.amountRub, 0), offer.totalRub);
  }
  const unknown = (await readLocalChinaOffer(source.id, 'Другой неизвестный город'))!.offer!;
  assert.equal((unknown.calculationSnapshot as any).deliveryQuote.city, 'Другой неизвестный город');
  assert.equal((unknown.calculationSnapshot as any).deliveryQuote.status, 'needs_quote');
  assert.equal(reads.mock.callCount(), 1);
  // Keep the original returned owners live through the final reuse assertion.
  assert(chinaLocalOfferGuard(card)); assert(chinaLocalOfferGuard(detail));
  assert.equal(f.mutableReads(), 0); assert.equal(f.reads().networkCalls, 0);
});

test('a warmed city ledger never bypasses changed configuration, pinned cut or file identity', async t => {
  const source = row('106'), f = await setup(t, {offers: [source]});
  const state = (await initializeLocalChinaReader())!;
  const get = state.city.get.bind(state.city), reads = t.mock.method(state.city, 'get', (...args: any[]) => get(...args));
  const city = 'Новокузнецк', card = (await searchLocalChina({market: 'china', city}))!.items[0];
  const check = chinaLocalOfferGuard(card)!;
  const original = envKeys.map(key => process.env[key]);
  for (const [index, key] of envKeys.entries()) {
    process.env[key] = index === 0 ? path.join(f.directory, 'another-generation') : '0'.repeat(index === 1 ? 64 : 40);
    assert.throws(check, /generation_changed/);
    await assert.rejects(searchLocalChina({market: 'china', city}), /generation_changed/);
    await assert.rejects(readLocalChinaOffer(source.id, city), /generation_changed/);
    process.env[key] = original[index];
  }
  await assert.rejects(searchLocalChina({market: 'china', city, preparedCut: 'gen_changed'}), /cut_changed/);
  await assert.rejects(readLocalChinaOffer(source.id, city, 'gen_changed'), /cut_changed/);
  const cached = state.cityLedgers.get.bind(state.cityLedgers);
  const changedDuringRead = t.mock.method(state.cityLedgers, 'get', (id: string) => {
    const ledger = cached(id); process.env.CATALOG_CHINA_LOCAL_RUNTIME_SHA = '0'.repeat(40); return ledger;
  });
  for (const request of [() => searchLocalChina({market: 'china', city}), () => readLocalChinaOffer(source.id, city)]) {
    try { await assert.rejects(request(), /generation_changed/); }
    finally { process.env.CATALOG_CHINA_LOCAL_RUNTIME_SHA = original[2]; }
  }
  changedDuringRead.mock.restore();
  assert.equal((await readLocalChinaOffer(source.id, city))!.offer!.totalRub, card.totalRub);
  await fs.chmod(f.built.paths.details, 0o600);
  assert.throws(check, /generation_changed/);
  await assert.rejects(searchLocalChina({market: 'china', city}), /generation_changed/);
  await assert.rejects(readLocalChinaOffer(source.id, city), /generation_changed/);
  assert.equal(reads.mock.callCount(), 1);
  assert.equal(f.mutableReads(), 0); assert.equal(f.reads().networkCalls, 0);
});

test('a failed city checksum cannot seed reuse for a later request', async t => {
  const source = row('107'), f = await setup(t, {offers: [source]});
  const state = (await initializeLocalChinaReader())!;
  const get = state.city.get.bind(state.city);
  const reads = t.mock.method(state.city, 'get', (...args: any[]) => ({...get(...args), patches_sha256: '0'.repeat(64)}));
  await assert.rejects(searchLocalChina({market: 'china', city: 'Новокузнецк'}), /city_patch_checksum/);
  reads.mock.restore();
  const card = (await searchLocalChina({market: 'china', city: 'Новокузнецк'}))!.items[0];
  assert.equal((await readLocalChinaOffer(source.id, 'Новокузнецк'))!.offer!.totalRub, card.totalRub);
  assert.equal(f.mutableReads(), 0); assert.equal(f.reads().networkCalls, 0);
});

test('selected-ID city batches require every prepared city and retain read-only before/after fences', async t => {
  const sources = [row('108'), row('109')], f = await setup(t, {offers: sources});
  const state = (await initializeLocalChinaReader())!;
  const ids = sources.map(source => source.id), expected = new Map(ids.map(id => [id, state.query.cityPrices(id)]));
  assert.deepEqual(state.cityPricesForIds(ids), expected);
  assert.deepEqual(state.cityPricesForIds([]), new Map());
  assert.throws(() => state.cityPricesForIds([ids[0], ids[0]]), /city_price_identity/);
  assert.throws(() => state.cityPricesForIds(['not-an-id']), /city_price_identity/);
  assert.throws(() => state.cityPricesForIds(['f'.repeat(24)]), /city_price_coverage/);
  assert.equal(state.cityPriceDb.prepare('PRAGMA query_only').get()!.query_only, 1);
  assert.throws(() => state.cityPriceDb.exec('DELETE FROM city_prices'), /readonly/i);
  const prepare = state.cityPriceDb.prepare.bind(state.cityPriceDb);
  let mode = 'missing';
  const replaced = t.mock.method(state.cityPriceDb, 'prepare', (sql: string) => {
    const statement = prepare(sql), all = statement.all.bind(statement);
    t.mock.method(statement, 'all', (...args: any[]) => {
      const rows = all(...args);
      if (mode === 'missing') return rows.slice(1);
      if (mode === 'duplicate') return [...rows, rows[0]];
      if (mode === 'foreign') return [{...rows[0], id: 'f'.repeat(24)}, ...rows.slice(1)];
      process.env.CATALOG_CHINA_LOCAL_RUNTIME_SHA = '0'.repeat(40); return rows;
    });
    return statement;
  });
  for (mode of ['missing', 'duplicate', 'foreign'])
    assert.throws(() => state.cityPricesForIds(ids), /city_price_(coverage|identity)/);
  mode = 'changed';
  try { assert.throws(() => state.cityPricesForIds(ids), /generation_changed/); }
  finally { process.env.CATALOG_CHINA_LOCAL_RUNTIME_SHA = f.built.manifest.runtimeSha; }
  replaced.mock.restore();
  const neverRead = t.mock.method(state.cityPriceDb, 'prepare', () => { throw Error('count_must_not_read_city_prices'); });
  assert.equal((await searchLocalChina({market: 'china', city: 'Новокузнецк'}, {countOnly: true}))!.total, sources.length);
  assert.equal(neverRead.mock.callCount(), 0);
  assert.equal(f.mutableReads(), 0); assert.equal(f.reads().networkCalls, 0);
});

test('pending manual cards remain unpriced and public detail serialization preserves frozen editorial and FX', async t => {
  const {resolveOfferDisplay, getOfferDetailRecord} = await pageApi();
  const ready = row('102'), pending = row('103', {powerHp: undefined, powerKw: undefined, icePowerKw: undefined,
    utilizationPowerKw: undefined, powerDataSource: undefined, powerDataConfidence: undefined, operational: {}});
  const savedEdit = editorialEntry(pending, {sellerPrice: {amount: 80000, currency: 'CNY'}});
  const f = await setup(t, {offers: [ready, pending], editorial: {revision: 'sealed', entries: {[pending.id]: savedEdit}}});
  const result = (await searchLocalChina({market: 'china', hasPrice: 'no'}))!;
  assert.equal(result.total, 1); assert.equal(result.items[0].id, pending.id);
  assert.equal(result.items[0].totalRub, null); assert.equal(result.items[0].sourcePrice, 80000);
  const detailed = (await readLocalChinaOffer(pending.id))!.offer!;
  assert.equal(detailed.totalRub, null); assert.equal(detailed.editorialTitle, 'Manual title');
  const displayed = await resolveOfferDisplay(detailed);
  assert.equal(displayed.raw.totalRub, null); assert.equal(displayed.raw.operational, undefined);
  const full = (await getOfferDetailRecord(ready.id))!;
  assert(chinaLocalOfferGuard(full));
  assert.equal(await applyActiveBusinessPricing(full), full);
  const priced = await applyActiveBusinessPricingBatch([full, detailed]);
  assert.equal(priced[0], full); assert.equal(priced[1], detailed);
  const changedEditor = {revision: 'changed', entries: {[ready.id]: editorialEntry(ready, {sellerPrice: {amount: 1, currency: 'USD'}})}};
  await withCatalogEditorialSnapshot(changedEditor, async () => {
    const publicValue = publicOffer(full);
    assert.equal(publicValue.sourcePrice, full.sourcePrice);
    assert.equal(publicValue.totalRub, full.totalRub);
    assert.equal((publicValue as any).operational, undefined);
  });
  const rates = (await localChinaPublicRates())!;
  assert.equal(rates.rates.find(rate => rate.currency === 'CNY')!.effectiveRate, 12.5);
  assert.equal(rates.ratesUpdatedAt, f.built.manifest.pricingAsOf);
  assert.equal(f.mutableReads(), 0); assert.equal(f.reads().networkCalls, 0);
});

test('pinned cut and local file replacement fail without returning a legacy China generation', async t => {
  const {readOfferDetailForPage} = await pageApi();
  const source = row('104'), f = await setup(t, {offers: [source]});
  await initializeLocalChinaReader();
  await assert.rejects(readPreparedChinaCompatibility({market: 'china'}, {expectedGeneration: 'gen_other'}), PreparedChinaCutChanged);
  const before = await readOfferDetailForPage(source.id, true, {market: 'china'});
  assert.equal(before.offer?.id, source.id);
  await fs.chmod(f.built.paths.details, 0o600);
  const after = await readOfferDetailForPage(source.id, true, {market: 'china'});
  assert.equal(after.offer, null); assert.equal(after.unavailable, true);
  await assert.rejects(searchLocalChina({market: 'china'}), /generation_changed/);
  assert.equal(f.mutableReads(), 0);
});

test('wrong manifest binding is refused before exposing any records', async t => {
  const f = await setup(t);
  process.env.CATALOG_CHINA_LOCAL_MANIFEST_SHA256 = '0'.repeat(64);
  await assert.rejects(initializeLocalChinaReader(), /manifest_checksum/);
  assert.equal(f.mutableReads(), 0);
  assert.equal(f.reads().networkCalls, 0);
});

test('startup keeps foreign routes available while a rejected China generation remains rejected', async t => {
  const f = await setup(t);
  process.env.CATALOG_CHINA_LOCAL_MANIFEST_SHA256 = '0'.repeat(64);
  const previous = process.env.NEXT_RUNTIME; process.env.NEXT_RUNTIME = 'nodejs';
  t.after(() => { if (previous === undefined) delete process.env.NEXT_RUNTIME; else process.env.NEXT_RUNTIME = previous; });
  const logs: string[] = []; t.mock.method(console, 'error', (line: string) => { logs.push(line); });
  const {register} = await import('../apps/web/instrumentation');
  await register();
  assert.deepEqual(logs.map(line => JSON.parse(line)), [{event: 'china_local_unavailable', phase: 'startup'}]);
  await assert.rejects(searchLocalChina({market: 'china'}), /manifest_checksum/);
  assert.equal(f.mutableReads(), 0); assert.equal(f.reads().networkCalls, 0);
});

test('mixed facet failure keeps confirmed foreign names and cannot leak the obsolete China directory', async t => {
  const f = await setup(t);
  const sample = (await searchLocalChina({market: 'china'}))!.items[0];
  const foreign = {...sample, id: '1'.repeat(24), market: 'europe', make: 'Foreign', model: 'Saved model', cardImageUrl: 'https://example.invalid/photo.jpg'};
  const oldChina = {...sample, id: '2'.repeat(24), make: 'Obsolete China', model: 'Must not return', cardImageUrl: 'https://example.invalid/photo.jpg'};
  const generationId = 'gen_foreign_fixture', storage = getJsonStorage();
  const values: Record<string, any> = {
    'catalog/manifest.json': {version: 2, generationId, updatedAt: foreign.updatedAt, markets: {europe: {count: 1}, china: {count: 1}}},
    'catalog-editorial/current.json': {revision: 'foreign', entries: {}},
    'catalog/public/facets.json': {generationId, makes: ['Foreign', 'Obsolete China'], models: [], markets: ['china', 'europe'], bodyTypes: [], fuels: [], transmissions: [], drives: []},
    'catalog/public/projection/all.json': {generationId, items: [foreign, oldChina]},
  };
  t.mock.method(storage, 'readJson', async (key: string, fallback: any) => values[key] ?? fallback);
  t.mock.method(storage, 'readJsonWithMeta', async (key: string, fallback: any) => ({value: values[key] ?? fallback, found: Object.hasOwn(values, key)}));
  resetCatalogReadCachesForTests(); t.after(() => resetCatalogReadCachesForTests());
  await fs.chmod(f.built.paths.details, 0o600);
  await assert.rejects(readCatalogFacets({market: 'china'}), /generation_changed/);
  const result = await readCatalogFacets({yearFrom: 2014});
  assert.deepEqual(result.makes, ['Foreign']);
  assert.deepEqual(result.models, [{make: 'Foreign', model: 'Saved model'}]);
  assert.equal(f.reads().networkCalls, 0);
});

test('an unavailable China generation cannot hide a confirmed foreign detail behind an unqualified URL', async () => {
  const values: any = {offer: null};
  const key = '__chinaNativeForeignDetailFixture'; (globalThis as any)[key] = values;
  const mocks: Record<string, string> = {
    react: 'export const cache=fn=>fn;', 'next/cache': 'export const unstable_cache=fn=>fn;',
    './management-knowledge': 'export const attachManagementKnowledge=async rows=>rows;',
    './collection-controls': 'export class CollectionDisabledError extends Error{}',
    './ajes-client': 'export class AjesUnavailable extends Error{}',
    './editorial': 'export const readCatalogEditorial=async()=>({entries:{}});export const editorialHidden=()=>false;export const applyCatalogEditorial=offer=>offer;',
    './china-local-reader': 'export const chinaLocalRuntimeConfigured=()=>true;export const chinaLocalOfferGuard=()=>undefined;export const readLocalChinaOffer=async()=>{throw Error("china_unavailable")};',
    './prepared-china-http-fixture': 'export class PreparedChinaFixtureUnavailable extends Error{};export const hasPreparedChinaHttpFixture=()=>true,hasIndependentChinaHttpFixture=()=>true,preparedChinaNormalRegcloudEnabled=()=>false;export const assertIndependentChinaFallbackAllowed=async()=>{throw Error("no legacy China fallback")};export const readPreparedChinaFixtureOffer=async()=>null;',
    './storage': `export const getOfferWithoutEditorial=async()=>globalThis.${key}.offer;export const getOfferFromCurrentShard=async()=>globalThis.${key}.offer;export const getOfferFromCurrentProjection=async()=>globalThis.${key}.offer;export const isJapanCatalogOfferId=()=>false;`,
  };
  try {
    const result = await build({entryPoints: [fileURLToPath(new URL('../apps/web/lib/catalog/offer-page-data.ts', import.meta.url))],
      bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [{name: 'foreign-detail-fixture', setup(b) {
        b.onResolve({filter: /.*/}, args => mocks[args.path] ? {path: args.path, namespace: 'fixture'} : undefined);
        b.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents: mocks[args.path]}));
      }}]});
    const module = {exports: {} as any};
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
    for (const market of ['korea', 'japan', 'uae', 'europe', 'georgia']) {
      values.offer = {id: '1'.repeat(24), sourceId: 'fixture', market, totalRub: 1234567};
      const actual = await module.exports.readOfferDetailForPage(values.offer.id);
      assert.equal(actual.offer, values.offer); assert.equal(actual.unavailable, false, market);
    }
    values.offer = {id: '2'.repeat(24), sourceId: 'fixture', market: 'china', totalRub: 7654321};
    const unavailable = await module.exports.readOfferDetailForPage(values.offer.id);
    assert.equal(unavailable.offer, null); assert.equal(unavailable.unavailable, true);
  } finally { delete (globalThis as any)[key]; }
});
