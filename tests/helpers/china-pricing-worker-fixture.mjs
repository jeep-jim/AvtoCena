import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {importCatalogFxBatch, resetCatalogRateCache} from '../../apps/web/lib/catalog/rates.ts';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {resetCalculationIndexForTests, checksum} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {resetCatalogEditorialCache} from '../../apps/web/lib/catalog/editorial.ts';
import {resetChinaCnyPriceCache} from '../../apps/web/lib/catalog/china-cny-price.ts';
import {invalidateEffectiveMarketsCache} from '../../apps/web/lib/effective-market-settings.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => hash(JSON.stringify(value));
export const at = '2026-11-24T11:00:00.000Z', observed = '2026-11-22T21:34:55.563Z';
const sourceId = 'autohome_used_china_open';
export function row(sourceOfferId, changes = {}) {
  return {id: hash(sourceId + ':' + sourceOfferId).slice(0, 24), sourceId, sourceOfferId, market: 'china',
    make: 'Fixture', model: 'Named combustion', year: 2022, offerType: 'fixed', status: 'active', priceMode: 'fixed',
    sourcePrice: 60000, sourceCurrency: 'CNY', engineCc: 1498, powerHp: 150, powerKw: 110.3248, icePowerKw: 110.3248,
    utilizationPowerKw: 110.3248, powertrainKind: 'combustion', fuel: 'petrol', vehicleCategory: 'M1',
    transmission: 'automatic', drive: 'fwd', bodyType: 'sedan', color: 'white',
    powerDataSource: 'fixture:source_named_ice_kw', powerDataConfidence: 'source_exact',
    totalRub: null, calculationStatus: 'needs_data', images: [], firstSeenAt: observed, updatedAt: observed,
    operational: {raw: {mustRemainOnlyInSource: 'raw-private-fixture'},
      semanticEvidence: Object.fromEntries(['engineCc', 'fuel', 'powertrainKind', 'powerHp', 'powerKw'].map(field =>
        [field, {status: 'exact', source: 'named fixture'}]))}, ...changes};
}
export function editorialEntry(offer, changes = {}) {
  return {id: offer.id, market: 'china', sourceId, sourceOfferId: offer.sourceOfferId, make: offer.make, model: offer.model,
    title: 'Manual title', photos: null, status: 'visible', reason: 'Fixture', version: 'manual-1', updatedAt: observed,
    updatedBy: 'fixture', updatedByName: 'Fixture', originalTitle: '', originalPhoto: '', ...changes};
}

export async function fixture(t, {offers, editorial = {revision: '0', entries: {}}, models = {}, batchDate = at, versions = []} = {}) {
  const previous = {cwd: process.cwd(), driver: process.env.JSON_STORAGE_DRIVER, live: process.env.CATALOG_LIVE_RATE_DISABLED};
  t.mock.timers.enable({apis: ['Date'], now: Date.parse(at)});
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-pricing-worker-test-'));
  const contextDirectory = path.join(directory, 'context'); await fs.mkdir(contextDirectory, {mode: 0o700});
  const index = {version: 1, models, digest: checksum(models), manifestDigest: 'fixture', createdAt: observed};
  const rates = Object.entries({CNY: 12.5, USD: 85, EUR: 95, RUB: 1}).map(([currency, cbrRate]) =>
    ({currency, cbrRate, nominal: 1, effectiveRate: cbrRate, rateDate: '2026-11-24', rateSource: 'cbr', fetchedAt: at}));
  const data = {
    'data/markets/markets.json': [{id: 'china', versions}],
    'data/fees/exchange-rates.json': {rates},
    'data/catalog-editorial/current.json': editorial,
    'data/catalog/china-cny-prices/current.json': {version: 1, entries: {}},
    'data/knowledge/encyclopedia/calculation-v1.json': index,
  };
  const files = [];
  for (const [file, value] of Object.entries(data)) {
    const bytes = Buffer.from(JSON.stringify(value)), filename = path.join(contextDirectory, file);
    await fs.mkdir(path.dirname(filename), {recursive: true, mode: 0o700}); await fs.writeFile(filename, bytes, {mode: 0o600});
    files.push({file, bytes: bytes.length, sha256: hash(bytes)});
  }
  const receipt = {version: 1, kind: 'china-verified-pricing-context-v1', market: 'china', runtimeSha: 'a'.repeat(40),
    calculationVersion: 'b'.repeat(64), effectiveInputsRechecked: true, currencies: ['CNY', 'EUR', 'USD', 'RUB'], files,
    encyclopedia: {digest: index.digest, indexSha256: files.at(-1).sha256}};
  const receiptBytes = Buffer.from(JSON.stringify(receipt)); await fs.writeFile(path.join(contextDirectory, 'RUNTIME_CONTEXT.json'), receiptBytes);
  process.env.JSON_STORAGE_DRIVER = 'local'; process.env.CATALOG_LIVE_RATE_DISABLED = '1'; process.chdir(contextDirectory);
  const reset = () => { resetCalculationIndexForTests(); resetCatalogEditorialCache(); resetChinaCnyPriceCache(); resetCatalogRateCache(); invalidateEffectiveMarketsCache(); };
  reset();
  t.after(async () => { process.chdir(previous.cwd); if (previous.driver === undefined) delete process.env.JSON_STORAGE_DRIVER; else process.env.JSON_STORAGE_DRIVER = previous.driver;
    if (previous.live === undefined) delete process.env.CATALOG_LIVE_RATE_DISABLED; else process.env.CATALOG_LIVE_RATE_DISABLED = previous.live;
    reset(); await fs.rm(directory, {recursive: true, force: true}); });
  let networkCalls = 0, sourceReads = 0, storageWrites = 0;
  t.mock.method(globalThis, 'fetch', async () => { networkCalls++; assert.fail('No network after FX capture'); });
  const storage = getJsonStorage();
  for (const method of ['writeJson', 'putBinary', 'deleteJson', 'deleteBinary'])
    t.mock.method(storage, method, async () => { storageWrites++; assert.fail('Pricing cannot write runtime storage'); });
  const fxReceipt = {version: 1, market: 'china', runId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', pricingAsOf: batchDate, observedAt: batchDate,
    rates: Object.fromEntries(rates.map(rate => [rate.currency, rate]))};
  const fxBatch = importCatalogFxBatch({receipt: fxReceipt, receiptSha256: jsonHash(fxReceipt)}, jsonHash(fxReceipt));
  offers ||= [row('1')];
  const source = {manifest: {version: 1, kind: 'china-refreshed-source-v1', market: 'china', sourceObservedAt: observed,
    supplierLatestVerified: true, source: {cursor: 1234}}, reconciliation: {sourceRows: offers.length},
    async *offers(options) { assert.deepEqual(options, {eligibleOnly: false}); sourceReads++; for (const offer of offers) yield offer; }};
  const context = {receipt, receiptSha256: hash(receiptBytes)}, outputDirectory = path.join(directory, 'output');
  const options = {source, context, fxBatch, generationId: 'gen_pricing_fixture_1', outputDirectory,
    semanticModels: [{make: 'Fixture', model: 'Named combustion', aliases: [], makeAliases: [], popularityDecile: 5},
      {make: 'Audi', model: 'A6', aliases: ['А6'], makeAliases: [], popularityDecile: 2}]};
  return {directory, contextDirectory, offers, source, options, reads: () => ({networkCalls, sourceReads, storageWrites})};
}

