import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {gunzipSync} from 'node:zlib';
import {buildChinaPricingGeneration} from '../scripts/catalog-next/pricing-generation.mjs';
import {applyPreparedChinaCityPatch} from '../scripts/catalog-next/pricing-worker-prices.mjs';
import {openChinaQueryIndex} from '../scripts/catalog-next/query-index.mjs';
import {openChinaQuerySemantics} from '../scripts/catalog-next/query-semantics.mjs';
import {compileModelFacts, modelKey} from '../apps/web/lib/encyclopedia/calculation-index.ts';
import {catalogSearchProjectionComparator} from '../apps/web/lib/catalog/storage.ts';
import {applyPreparedChinaDeliveryLedger} from '../apps/web/lib/catalog/prepared-china-fixed-city.ts';
import {priceCardForCity} from '../apps/web/lib/catalog/card-city-delivery.ts';
import {quoteCityDelivery} from '../apps/web/lib/catalog/city-delivery.ts';
import {calculateAvtocenaFromBusinessConfig} from '../packages/engine/src/calculation/calculateAvtocena.ts';
import {fixture, row, editorialEntry, at, observed} from './helpers/china-pricing-worker-fixture.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');

test('the full offline worker preserves unknown data, uses manual/compiled facts and freezes every city without network', async t => {
  const good = row('1', {year: 2014}), pending = row('2', {powerHp: undefined, powerKw: undefined, icePowerKw: undefined,
    utilizationPowerKw: undefined, powerDataSource: undefined, powerDataConfidence: undefined, operational: {}});
  const missingPrice = row('3', {sourcePrice: null}), old = row('4', {year: 2013}), hidden = row('5'), manual = row('6');
  const encyclopedic = row('7', {make: 'Audi', model: 'A6', year: 2023, trim: '40 TDI S tronic', fuel: 'diesel',
    transmission: 'dct', engineCc: undefined, powerHp: undefined, powerKw: undefined, icePowerKw: undefined,
    utilizationPowerKw: undefined, powerDataSource: undefined, powerDataConfidence: undefined, operational: {}});
  const facts = compileModelFacts({id: 'fixture-model', make: 'Audi', model: 'A6', revision: 'r1', variants: [{
    id: 'v1', year: 2023, trim: encyclopedic.trim, status: 'observed', markets: ['china'], fuel: 'diesel', powertrainKind: 'combustion',
    engineCc: 1968, powerHp: 204, powerKw: 150, transmission: 'dct', drive: 'fwd', bodyType: 'sedan'}]});
  const offers = [good, pending, missingPrice, old, hidden, manual, encyclopedic], original = structuredClone(offers);
  const f = await fixture(t, {offers, editorial: {revision: 'manual-1', entries: {
    [hidden.id]: editorialEntry(hidden, {status: 'hidden'}), [manual.id]: editorialEntry(manual, {sellerPrice: {amount: 80000, currency: 'CNY'}})}},
    models: {[modelKey('Audi', 'A6')]: facts}});
  const result = await buildChinaPricingGeneration(f.options);
  assert.deepEqual(f.reads(), {networkCalls: 0, sourceReads: 1, storageWrites: 0}); assert.deepEqual(offers, original);
  assert.equal(result.reconciliation.sourceRows, 7); assert.equal(result.reconciliation.admittedRows, 5);
  assert.equal(result.reconciliation.pricedRows, 3); assert.equal(result.reconciliation.sellerOnlyRows, 1); assert.equal(result.reconciliation.unpricedRows, 1);
  assert.deepEqual(result.reconciliation.excluded, {year_before_minimum: 1, editorial_hidden: 1});
  assert.equal(result.reconciliation.missingPhotoRows, 5); assert.equal(result.manifest.source.sourceObservedAt, observed);
  assert.equal(result.manifest.pricingAsOf, at); assert.equal(result.manifest.published, false);
  assert.equal(hash(await fs.readFile(result.manifestPath)), result.manifestSha256);
  const db = new DatabaseSync(result.paths.details, {readOnly: true}); t.after(() => db.close());
  const get = id => JSON.parse(db.prepare('SELECT full_json FROM offers WHERE id=?').get(id).full_json);
  const a = get(good.id), m = get(manual.id), e = get(encyclopedic.id), p = get(pending.id), u = get(missingPrice.id);
  assert(a.totalRub > 0); assert.equal(a.updatedAt, observed); assert.equal(a.operational.raw, undefined);
  assert.equal(a.calculationSnapshot.currencyRate.effectiveRate, 12.5); assert.equal(a.calculationSnapshot.customsInput.importedAt, at);
  assert.equal(m.sourcePrice, 80000); assert.equal(m.editorialTitle, 'Manual title'); assert.equal(m.calculationSnapshot.currencyRate.sourcePriceRub, 1000000);
  assert.equal(e.engineCc, 1968); assert.equal(e.powerHp, 204); assert(e.totalRub > 0);
  assert.equal(p.totalRub, null); assert.equal(p.catalogPricingMode, 'seller'); assert.equal(p.sellerPriceRub, 750000); assert.equal(p.powerHp, undefined);
  assert.equal(u.totalRub, null); assert.equal(u.sellerPriceRub, undefined);
  const semantics = openChinaQuerySemantics(JSON.parse(await fs.readFile(result.paths.semantics)), result.manifest.filterSemanticsSha256);
  const query = await openChinaQueryIndex({filename: result.paths.query, manifest: result.queryIndex}); t.after(() => query.close());
  assert.equal(query.query().total, 5); assert.equal(query.query({hasPrice: 'yes'}).total, 3); assert.equal(query.query({hasPrice: 'no'}).total, 2);
  assert.equal(query.query(semantics.compileRequest({make: 'Audi', model: 'А6'})).total, 1);
  const all = query.query().items.map(item => item.projection);
  assert.deepEqual(all.map(item => item.id), [...all].sort(catalogSearchProjectionComparator()).map(item => item.id));
  assert(!query.query({powerTo: 160}).items.some(item => item.id === pending.id));
  let rawBytes = 0, gzipBytes = 0;
  for (const record of db.prepare('SELECT id,patches_gzip,patches_sha256 FROM city_ledgers').iterate()) {
    const mapJson = gunzipSync(record.patches_gzip).toString('utf8');
    assert.equal(hash(mapJson), record.patches_sha256); rawBytes += Buffer.byteLength(mapJson); gzipBytes += record.patches_gzip.length;
    const cityPatches = JSON.parse(mapJson);
    assert.deepEqual(Object.keys(cityPatches), semantics.cityKeys);
    for (const [cityKey, patch] of Object.entries(cityPatches)) {
    const full = get(record.id), city = semantics.cities.find(item => item.key === cityKey);
    const detailed = applyPreparedChinaCityPatch(full, patch);
    const savedProjection = JSON.parse(db.prepare('SELECT projection_json FROM offers WHERE id=?').get(record.id).projection_json);
    assert.equal(detailed.totalRub, savedProjection.totalRub ? priceCardForCity(savedProjection, city.city).offer.totalRub : null);
    if (savedProjection.totalRub) {
      assert.equal(detailed.calculationSnapshot.breakdown.reduce((sum, line) => sum + line.amountRub, 0), detailed.totalRub);
      if (quoteCityDelivery(city.city, 'china').amountRub > 0) {
        const native = applyPreparedChinaDeliveryLedger(full, savedProjection, city.city);
        assert.equal(detailed.totalRub, native.totalRub); assert.deepEqual(detailed.calculationSnapshot.breakdown, native.calculationSnapshot.breakdown);
        assert.deepEqual(detailed.calculationSnapshot.paymentPlan, native.calculationSnapshot.paymentPlan);
      }
    }
    const count = query.query({cityKey: city.key, countOnly: true}); assert.equal(count.total, 5);
    if (detailed.totalRub) assert(query.query({cityKey: city.key, budgetFrom: detailed.totalRub, budgetTo: detailed.totalRub}).items.some(item => item.id === full.id));
    }
  }
  t.diagnostic(JSON.stringify({cityMaps: result.reconciliation.cityLedgerRows, cityPriceRows: result.reconciliation.cityPriceRows,
    rawPatchBytes: rawBytes, gzipLevel1Bytes: gzipBytes,
    averageMapRaw: Math.round(rawBytes / result.reconciliation.cityLedgerRows), averageMapGzip: Math.round(gzipBytes / result.reconciliation.cityLedgerRows)}));
});

test('unknown identity/photo and no price remain inventory while explicit year/heavy/withdrawal policies have reasons', async t => {
  const offers = [row('10', {make: '', model: '', sourcePrice: null}), row('11', {year: undefined}), row('12', {year: 2027}),
    row('13', {bodyType: 'truck', vehicleCategory: 'N2', grossVehicleWeightKg: 6500}), row('14', {status: 'sold'}),
    row('15', {productionDate: '2027-01-01'}), row('16', {year: 2014})];
  const f = await fixture(t, {offers}), result = await buildChinaPricingGeneration(f.options);
  assert.equal(result.reconciliation.admittedRows, 2); assert.equal(result.reconciliation.missingIdentityRows, 1);
  assert.deepEqual(result.reconciliation.excluded, {year_unknown: 1, year_future: 1, vehicle_excluded: 1, source_withdrawn: 1, source_date_future: 1});
});

test('a duplicate source row cannot seal a generation', async t => {
  const f = await fixture(t, {offers: [row('1'), row('1')]});
  await assert.rejects(buildChinaPricingGeneration(f.options), /UNIQUE/);
  await assert.rejects(fs.access(path.join(f.options.outputDirectory, 'GENERATION.json')), {code: 'ENOENT'});
  assert.equal(JSON.parse(await fs.readFile(path.join(f.options.outputDirectory, 'INCOMPLETE.json'))).complete, false);
});

test('a missing source row and a changed descriptor cannot seal a generation', async t => {
  const f = await fixture(t);
  f.source.reconciliation.sourceRows++;
  await assert.rejects(buildChinaPricingGeneration(f.options), /census/);
  await assert.rejects(fs.access(path.join(f.options.outputDirectory, 'GENERATION.json')), {code: 'ENOENT'});
  f.source.reconciliation.sourceRows--;
  let checked = 0;
  const outputDirectory = path.join(f.directory, 'changed-output');
  await assert.rejects(buildChinaPricingGeneration({...f.options, outputDirectory, assertInputs: async () => {
    if (++checked === 2) f.source.manifest.source.cursor++;
  }}), /input_descriptor_changed/);
  await assert.rejects(fs.access(path.join(outputDirectory, 'GENERATION.json')), {code: 'ENOENT'});
});

test('stale FX is rejected before a misleading unpriced generation can be prepared', async t => {
  const f = await fixture(t, {batchDate: '2026-11-30T11:00:00.000Z'});
  await assert.rejects(buildChinaPricingGeneration(f.options), /fx_stale/);
  await assert.rejects(fs.access(f.options.outputDirectory), {code: 'ENOENT'});
  assert.deepEqual(f.reads(), {networkCalls: 0, sourceReads: 0, storageWrites: 0});
});

test('source observation and frozen pricing clocks remain independent facts', async t => {
  const f = await fixture(t);
  f.source.manifest.sourceObservedAt = '2026-11-24T11:01:00.000Z';
  const result = await buildChinaPricingGeneration(f.options);
  assert.equal(result.manifest.source.sourceObservedAt, '2026-11-24T11:01:00.000Z');
  assert.equal(result.manifest.pricingAsOf, at);
});

test('saved city patches match the actual business engine with percent fees and the existing Che168 adjustment', async t => {
  const source = row('101', {sourcePrice: 8000, sourceCurrency: 'USD', operational: {...row('101').operational,
    sourceUrl: 'https://global.che168.com/Car/101.html'}});
  const versions = [{id: 'profile', status: 'active', active: true, version: 1, effectiveFrom: '2026-01-01T00:00:00.000Z',
    securityDepositRub: 30000, topAvtoCommissionRub: 90000, logisticsRub: 130000, brokerRub: 60000, svhRub: 15000,
    laboratoryRub: 10000, sbktsRub: 10000, eptsRub: 10000, rfDeliveryRub: 120000, otherFixedExpensesRub: 3500,
    percentExpenses: [{id: 'extra-percent', title: 'Fixture percent', percent: 2.5}]}];
  const f = await fixture(t, {offers: [source], versions}), result = await buildChinaPricingGeneration(f.options);
  const db = new DatabaseSync(result.paths.details, {readOnly: true}); t.after(() => db.close());
  const full = JSON.parse(db.prepare('SELECT full_json FROM offers').get().full_json);
  assert(full.totalRub > 0); assert.equal(full.chinaPriceConversion.sourceCurrency, 'USD');
  assert.equal(full.calculationSnapshot.sourcePriceAdjustment.percent, -2);
  const map = JSON.parse(gunzipSync(db.prepare('SELECT patches_gzip FROM city_ledgers').get().patches_gzip));
  for (const [key, patch] of Object.entries(map)) {
    const snapshot = full.calculationSnapshot, quote = quoteCityDelivery(key === '__unquoted__' ? '' : key, 'china');
    const oracle = calculateAvtocenaFromBusinessConfig({marketId: 'china', marketConfig: snapshot.marketConfig,
      sourcePriceRub: snapshot.currencyRate.sourcePriceRub, customsRub: snapshot.customs.knownCustomsRub,
      utilizationFeeRub: snapshot.customs.utilizationFeeRub, cityDeliveryRub: quote.amountRub, deliveryCity: quote.city,
      sourcePriceAdjustmentRub: snapshot.sourcePriceAdjustment.adjustmentRub,
      sourcePriceAdjustmentLabel: snapshot.sourcePriceAdjustment.label, sourcePriceAdjustmentNote: snapshot.sourcePriceAdjustment.warning});
    const saved = applyPreparedChinaCityPatch(full, patch);
    assert.equal(saved.totalRub, oracle.totalRub, key);
    assert.deepEqual(saved.calculationSnapshot.paymentPlan, oracle.snapshot.paymentPlan, key);
    assert.deepEqual(saved.calculationSnapshot.breakdown.map(line => [line.id, line.amountRub]).filter(line => line[1] !== 0).sort(),
      oracle.snapshot.breakdown.map(line => [line.id, line.amountRub]).filter(line => line[1] !== 0).sort(), key);
  }
});

test('context file hashes are verified before reading prices and again before sealing output', async t => {
  const f = await fixture(t), filename = path.join(f.contextDirectory, 'data/markets/markets.json');
  const original = await fs.readFile(filename); await fs.writeFile(filename, '[]');
  await assert.rejects(buildChinaPricingGeneration(f.options), /context_file_changed/);
  await fs.writeFile(filename, original);
  let changed = false;
  await assert.rejects(buildChinaPricingGeneration({...f.options, onProgress: async event => {
    if (event.phase === 'china_frozen_pricing' && !changed) { changed = true; await fs.writeFile(filename, '[]'); }
  }}), /context_file_changed/);
  await assert.rejects(fs.access(path.join(f.options.outputDirectory, 'GENERATION.json')), {code: 'ENOENT'});
});
