import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getJsonStorage } from '../apps/web/lib/data';
import { getEffectiveMarketVersion, getEffectiveMarketsWithDefaults, invalidateEffectiveMarketsCache } from '../apps/web/lib/effective-market-settings';
import { resetChinaCnyPriceCache, withChinaCnyPrices, type ChinaPriceConversion } from '../apps/web/lib/catalog/china-cny-price';
import { calculateOfferWithVerifiedSpecifications } from '../apps/web/lib/catalog/customs-pricing';
import { resetCatalogEditorialCache } from '../apps/web/lib/catalog/editorial';
import { applyActiveBusinessPriceBatch } from '../apps/web/lib/catalog/live-business-pricing';
import { budgetPricingFingerprint } from '../apps/web/lib/catalog/shared-budget-prices';
import { captureCatalogFxBatch, catalogPricingNow, convertToRub, importCatalogFxBatch, resetCatalogRateCache, verifyCatalogFxReadback, withCatalogFxBatch } from '../apps/web/lib/catalog/rates';
import type { VehicleOffer } from '../apps/web/lib/catalog/types';
import { calculateRussiaCustomsForIndividual } from '../packages/engine/src/calculation/russiaCustomsV2';

const day = '2026-11-20';
const start = Date.parse(`${day}T23:59:59.000Z`);

function fixture(t: TestContext, options: { live?: boolean; versions?: any[]; foreignMarkets?: any[] } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const previousDisabled = process.env.CATALOG_LIVE_RATE_DISABLED;
  if (options.live) delete process.env.CATALOG_LIVE_RATE_DISABLED;
  else process.env.CATALOG_LIVE_RATE_DISABLED = '1';
  const db = getJsonStorage();
  const quotes = { USD: 85, CNY: 125, EUR: 95 };
  const anchors: Record<string, ChinaPriceConversion> = {};
  let storedReads = 0, officialReads = 0, writes = 0, dated = true;
  const rates = () => Object.entries(quotes).map(([currency, cbrRate]) => ({
    currency, cbrRate, nominal: currency === 'CNY' ? 10 : 1, rateDate: day,
    effectiveRate: 999, // Legacy reserve must never replace official quote / nominal.
    rateSource: 'cbr', fetchedAt: new Date(start).toISOString(),
  }));
  t.mock.method(db, 'readJsonWithMeta', async <T>(key: string, fallback: T) => {
    if (key === 'fees/exchange-rates.json') { storedReads++; return { found: true, value: { rates: rates() } as T }; }
    if (key === 'markets/markets.json') return { found: true, value: [{ id: 'china', versions: options.versions || [] }, ...(options.foreignMarkets || [])] as T };
    if (key === 'catalog/china-cny-prices/current.json') return { found: true, value: { version: 1, entries: anchors } as T };
    if (key === 'catalog-editorial/current.json') return { found: false, value: fallback };
    assert.fail(`Unexpected storage read: ${key}`);
  });
  t.mock.method(db, 'readJson', async <T>(key: string, fallback: T) => (await db.readJsonWithMeta(key, fallback)).value);
  t.mock.method(db, 'writeJson', async () => { writes++; assert.fail('Frozen preparation must not write source or configuration'); });
  t.mock.method(globalThis, 'fetch', async (input: any) => {
    assert.equal(String(input), 'https://www.cbr.ru/scripts/XML_daily.asp');
    officialReads++;
    assert.ok(options.live, 'Stored offline batch must not fetch');
    return new Response(`<ValCurs${dated ? ' Date="20.11.2026"' : ''}>${rates().map(rate =>
      `<Valute><CharCode>${rate.currency}</CharCode><Nominal>${rate.nominal}</Nominal><Value>${rate.cbrRate}</Value></Valute>`).join('')}</ValCurs>`);
  });
  const reset = () => { resetCatalogRateCache(); resetChinaCnyPriceCache(); resetCatalogEditorialCache(); invalidateEffectiveMarketsCache(); };
  reset();
  t.after(() => {
    if (previousDisabled === undefined) delete process.env.CATALOG_LIVE_RATE_DISABLED;
    else process.env.CATALOG_LIVE_RATE_DISABLED = previousDisabled;
    reset();
  });
  return { quotes, anchors, reads: () => ({ storedReads, officialReads, writes }), setDated: (value: boolean) => { dated = value; } };
}

function verifiedOffer(id: string): VehicleOffer {
  return {
    id, market: 'china', sourceId: 'autohome_used_china_open', sourceOfferId: id,
    make: 'Fixture', model: 'Named combustion', year: 2022, sourcePrice: 60000, sourceCurrency: 'CNY',
    engineCc: 2998, powerHp: 370, powerKw: 272, icePowerKw: 272, utilizationPowerKw: 272,
    powertrainKind: 'combustion', fuel: 'petrol', vehicleCategory: 'M1',
    powerDataSource: 'fixture:source_named_ice_kw', powerDataConfidence: 'source_exact',
    totalRub: null, calculationStatus: 'needs_data',
    updatedAt: '2026-11-18T08:00:00.000Z', // Source time precedes current price capture and stays unchanged.
    operational: { semanticEvidence: Object.fromEntries(['engineCc', 'fuel', 'powertrainKind', 'powerHp', 'powerKw'].map(field => [field, { status: 'exact', source: 'named fixture' }])) },
  } as VehicleOffer;
}

test('China captures one official observation, then customs, logistics and batches retain it across cache expiry and midnight', async t => {
  const f = fixture(t, { live: true });
  const batch = await captureCatalogFxBatch('china', [' cny ', 'CNY']);
  assert.deepEqual(f.reads(), { storedReads: 1, officialReads: 1, writes: 0 });
  assert.equal(batch.receipt.rates.CNY.nominal, 10);
  assert.equal(batch.receipt.rates.CNY.effectiveRate, 12.5);
  assert.equal(batch.receipt.rates.CNY.rateSource, 'cbr_live');
  assert.ok(Object.isFrozen(batch.receipt.rates.CNY));
  const original = verifiedOffer('frozen-china-1');
  const result = await withCatalogFxBatch(batch, async () => {
    const fingerprint = await budgetPricingFingerprint('china');
    const native = await calculateOfferWithVerifiedSpecifications(original);
    assert.ok(Number(native.totalRub) > 0, JSON.stringify(native.calculationSnapshot?.missing));
    const [first] = await applyActiveBusinessPriceBatch([native], { readOnly: true, retainFullSnapshot: true });
    f.quotes.USD = 91; f.quotes.CNY = 140; f.quotes.EUR = 101;
    // Cross midnight, the five-minute resolver TTL and rate-freshness threshold.
    t.mock.timers.tick(5 * 86400000);
    assert.equal(catalogPricingNow(), start);
    const laterNative = await calculateOfferWithVerifiedSpecifications({ ...original, id: 'frozen-china-2' });
    const [second] = await applyActiveBusinessPriceBatch([laterNative], { readOnly: true, retainFullSnapshot: true });
    for (const row of [first, second]) {
      assert.equal(row.calculationSnapshot?.currencyRate?.effectiveRate, 12.5);
      assert.equal(row.calculationSnapshot?.eurRate?.effectiveRate, 95);
      assert.equal(row.calculationSnapshot?.customsInput?.importedAt?.toISOString(), batch.receipt.pricingAsOf);
      assert.equal(row.calculationSnapshot?.businessRepricedAt, batch.receipt.pricingAsOf);
      assert.equal(row.updatedAt, original.updatedAt, 'Price capture must not change source observation');
      assert.deepEqual(row.calculationSnapshot?.customs, calculateRussiaCustomsForIndividual(row.calculationSnapshot!.customsInput!));
    }
    assert.equal(first.totalRub, second.totalRub);
    assert.equal(await budgetPricingFingerprint('china'), fingerprint);
    assert.equal((await convertToRub(1500, 'USD', { preferLive: true }))?.sourcePriceRub, 127500);
    return first;
  });
  assert.ok(result.calculationSnapshot?.breakdown?.length, 'Offline output retains the complete ledger');
  assert.equal(catalogPricingNow(), start + 5 * 86400000, 'Wall clock resumes outside the batch');
  assert.deepEqual(f.reads(), { storedReads: 1, officialReads: 1, writes: 0 });
});

test('new capture within the usual rate-cache TTL resolves new quotes; concurrent scopes remain independent', async t => {
  const f = fixture(t, { live: true });
  const first = await captureCatalogFxBatch('china', ['CNY']);
  f.quotes.CNY = 140; f.quotes.USD = 91;
  t.mock.timers.tick(1);
  const second = await captureCatalogFxBatch('china', ['CNY']);
  const amounts = await Promise.all([first, second].map(batch => withCatalogFxBatch(batch, async () => {
    await Promise.resolve();
    return (await convertToRub(100, 'CNY'))?.sourcePriceRub;
  })));
  assert.deepEqual(amounts, [1250, 1400]);
  assert.notEqual(first.receiptSha256, second.receiptSha256);
  assert.deepEqual(f.reads(), { storedReads: 2, officialReads: 2, writes: 0 });
});

test('price context retains the market version selected at pricingAsOf across a scheduled-version boundary', async t => {
  const profile = { status: 'active', active: true, securityDepositRub: 1000, topAvtoCommissionRub: 2000,
    logisticsRub: 1, brokerRub: 1, svhRub: 1, laboratoryRub: 1, sbktsRub: 1, eptsRub: 1, rfDeliveryRub: 1, otherFixedExpensesRub: 1 };
  fixture(t, { versions: [
    { ...profile, id: 'before', version: 1, effectiveFrom: new Date(start - 86400000).toISOString() },
    { ...profile, id: 'after', version: 2, status: 'scheduled', effectiveFrom: new Date(start + 1000).toISOString() },
  ] });
  const batch = await captureCatalogFxBatch('china', ['CNY']);
  await withCatalogFxBatch(batch, async () => {
    assert.equal((await getEffectiveMarketVersion('china'))?.id, 'before');
    t.mock.timers.tick(120000);
    assert.equal((await getEffectiveMarketVersion('china'))?.id, 'before');
    assert.equal((await getEffectiveMarketsWithDefaults()).find(m => m.id === 'china')?.effectiveVersion.id, 'before');
  });
  assert.equal((await getEffectiveMarketVersion('china'))?.id, 'after');
  assert.equal((await getEffectiveMarketsWithDefaults()).find(m => m.id === 'china')?.effectiveVersion.id, 'after');
});

test('China keeps existing CNY anchors, creates new conversions from sealed rates, and writes no anchors', async t => {
  const f = fixture(t);
  const saved = { id: 'china-saved', market: 'china', sourcePrice: 1000, sourceCurrency: 'USD' } as Partial<VehicleOffer>;
  const previous: ChinaPriceConversion = { sourceCurrency: 'USD', sourcePrice: 1000, sourcePriceCny: 7200, usdRub: 90, cnyRub: 12.5, rateDate: '2026-11-18' };
  f.anchors[createHash('sha256').update(JSON.stringify([saved.id, saved.sourcePrice])).digest('hex')] = previous;
  const fresh = { ...saved, id: 'china-new' };
  const batch = await captureCatalogFxBatch('china', ['USD']);
  f.quotes.USD = 91; f.quotes.CNY = 140;
  const rows = await withCatalogFxBatch(batch, () => withChinaCnyPrices([saved, fresh]));
  assert.equal(rows[0].sourcePrice, 7200);
  assert.deepEqual(rows[0].chinaPriceConversion, previous);
  assert.equal(rows[1].sourceCurrency, 'CNY');
  assert.equal(rows[1].sourcePrice, 1000 * 85 / 12.5);
  assert.equal(rows[1].chinaPriceConversion?.rateDate, day);
  assert.deepEqual(f.reads(), { storedReads: 1, officialReads: 0, writes: 0 });
});

test('malformed foreign market versions cannot block a frozen China calculation', async t => {
  const f = fixture(t, { foreignMarkets: [
    { id: 'korea', versions: { invalid: true } },
    { id: 'europe', versions: [null] },
  ] });
  const fx = await captureCatalogFxBatch('china', ['CNY']);
  await withCatalogFxBatch(fx, async () => {
    const verified = await calculateOfferWithVerifiedSpecifications(verifiedOffer('china-isolated'));
    const [priced] = await applyActiveBusinessPriceBatch([verified], { readOnly: true, retainFullSnapshot: true });
    assert.ok(Number(priced.totalRub) > 0);
    assert.equal(priced.calculationSnapshot?.currencyRate?.effectiveRate, 12.5);
    assert.equal(priced.calculationSnapshot?.customsInput?.importedAt?.toISOString(), fx.receipt.pricingAsOf);
  });
  assert.deepEqual(f.reads(), { storedReads: 1, officialReads: 0, writes: 0 });
  // Existing mixed-market callers retain their own validation and behavior.
  await assert.rejects(getEffectiveMarketsWithDefaults(), TypeError);
});

test('a historical total without customs replay inputs cannot carry old FX into a frozen generation', async t => {
  const f = fixture(t);
  const input = {...verifiedOffer('china-legacy-price'), cardProjectionVersion: 3,
    totalRub: 2000000, publicVisibleRub: 2000000, publicSpecificationVerified: true,
    calculationStatus: 'ready', calculationSnapshot: {
      currencyRate: {currency: 'CNY', cbrRate: 20, nominal: 1, effectiveRate: 20, rateDate: day,
        rateSource: 'cbr', sourcePrice: 60000, sourcePriceRub: 1200000},
      sourcePriceRub: 1200000,
      customs: {status: 'ready', totalCustomsRub: 320000, knownCustomsRub: 300000, utilizationFeeRub: 20000},
      missing: [], priceIncludesAllCustoms: true, priceIncludesUtilizationFee: true,
      breakdown: [{key: 'old_total', rub: 2000000}],
    }} as unknown as VehicleOffer;
  const fx = await captureCatalogFxBatch('china', ['CNY']);
  const [priced] = await withCatalogFxBatch(fx, () => applyActiveBusinessPriceBatch([input], {readOnly: true, retainFullSnapshot: true}));
  assert.equal(priced.id, input.id);
  assert.equal(priced.totalRub, null);
  assert.equal(priced.publicVisibleRub, undefined);
  assert.equal(priced.publicSpecificationVerified, false);
  assert.equal(priced.catalogPricingMode, 'seller');
  assert.equal(priced.calculationStatus, 'needs_customs_data');
  assert.equal(priced.sellerPriceRub, 750000);
  assert.equal(priced.calculationSnapshot?.currencyRate?.effectiveRate, 12.5);
  assert.equal(priced.calculationSnapshot?.sourcePriceRub, 750000);
  assert.equal(priced.calculationSnapshot?.customs, undefined);
  assert.deepEqual(priced.calculationSnapshot?.breakdown, []);
  assert.deepEqual(priced.calculationSnapshot?.missing, ['customs_replay_inputs']);
  assert.deepEqual(f.reads(), {storedReads: 1, officialReads: 0, writes: 0});
  assert.equal(input.calculationSnapshot?.currencyRate?.effectiveRate, 20, 'Original source is not mutated');
  const [legacy] = await applyActiveBusinessPriceBatch([input], {readOnly: true});
  assert.ok(Number(legacy.totalRub) > 0, 'Ordinary legacy callers keep their existing behavior');
  assert.equal(legacy.calculationSnapshot?.currencyRate?.effectiveRate, 20);
});

test('receipt import authenticates independent bytes, rejects mutation and enforces market/currency scope', async t => {
  fixture(t);
  const batch = await captureCatalogFxBatch('china', ['CNY']);
  const wire = JSON.parse(JSON.stringify(batch));
  const imported = importCatalogFxBatch(wire, batch.receiptSha256);
  wire.receipt.rates.CNY.effectiveRate = 999;
  assert.equal(imported.receipt.rates.CNY.effectiveRate, 12.5, 'Import clones and freezes untrusted transport');
  assert.throws(() => importCatalogFxBatch(wire, batch.receiptSha256), /receipt_mismatch/);
  assert.throws(() => importCatalogFxBatch(batch, '0'.repeat(64)), /receipt_mismatch/);
  verifyCatalogFxReadback(imported, batch.receipt, batch.receiptSha256);
  assert.throws(() => verifyCatalogFxReadback(imported, wire.receipt, batch.receiptSha256), /receipt_mismatch/);
  assert.throws(() => withCatalogFxBatch(JSON.parse(JSON.stringify(batch)), () => 1), /batch_scope/);
  await withCatalogFxBatch(imported, async () => {
    assert.throws(() => withCatalogFxBatch(batch, () => 1), /batch_scope/);
    await assert.rejects(convertToRub(1, 'GBP'), /unsealed_currency/);
    await assert.rejects(captureCatalogFxBatch('china', ['CNY']), /batch_scope/);
    await assert.rejects(applyActiveBusinessPriceBatch([{ ...verifiedOffer('foreign'), market: 'korea' }]), /offer_scope/);
    await assert.rejects(applyActiveBusinessPriceBatch([{ ...verifiedOffer('unsealed'), sourceCurrency: 'GBP' }]), /offer_scope/);
    await assert.rejects(budgetPricingFingerprint('korea'), /batch_market/);
    await assert.rejects(applyActiveBusinessPriceBatch([verifiedOffer('external')], { readOnly: true }, []), /external_market_snapshot/);
  });
  await assert.rejects(applyActiveBusinessPriceBatch([verifiedOffer('outside')], { readOnly: true, retainFullSnapshot: true }), /full_snapshot_scope/);
  await assert.rejects(captureCatalogFxBatch('japan', ['JPY']), /batch_scope/);
  await assert.rejects(captureCatalogFxBatch('china', ['XXX']), /batch_currency/);
});

test('ordinary conversion still uses official quote / nominal and refreshes when its existing TTL expires', async t => {
  const f = fixture(t);
  assert.equal((await convertToRub(100, 'CNY'))?.sourcePriceRub, 1250);
  f.quotes.CNY = 140;
  assert.equal((await convertToRub(100, 'CNY'))?.sourcePriceRub, 1250);
  t.mock.timers.tick(5 * 60000 + 1);
  assert.equal((await convertToRub(100, 'CNY'))?.sourcePriceRub, 1400);
  assert.deepEqual(f.reads(), { storedReads: 2, officialReads: 0, writes: 0 });
});
