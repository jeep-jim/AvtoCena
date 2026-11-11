import assert from "node:assert/strict";
import test from "node:test";
import { resolvePriceTrend, priceAtCurrencyRate, currencyName } from "../apps/web/components/catalog/PriceTrend";

test("a falling customer price resolves to the green down state", () => {
  const trend = resolvePriceTrend({ totalRub: 2_900_000, previousTotalRub: 3_100_000 });
  assert.equal(trend?.direction, "down");
  assert.equal(trend?.deltaRub, -200_000);
});

test("a rising customer price resolves to the red up state", () => {
  const trend = resolvePriceTrend({ totalRub: 3_300_000, previousTotalRub: 3_100_000 });
  assert.equal(trend?.direction, "up");
  assert.equal(trend?.deltaRub, 200_000);
});


test("currency impact never converts fixed ruble fees", () => {
  assert.equal(priceAtCurrencyRate(1_361_230, 6400, 96.7442, 95.8709), 1_355_641);
  assert.equal(priceAtCurrencyRate(1_361_230, 6400, 96.7442, 96.7442), 1_361_230);
  assert.equal(priceAtCurrencyRate(1_361_230, 0, 96.7442, 95.8709), 0);
});

test("currency movement ignores a contrary saved total delta", () => {
  const trend = resolvePriceTrend({ totalRub: 1_466_795, priceDeltaRub: -2300, sourcePrice: 6400,
    calculationSnapshot: {currencyRate: {effectiveRate: 96.7442, previousEffectiveRate: 96.5915}} });
  assert.equal(trend?.deltaRub, 977);
});

test("saved exchange movement uses the actual source amount only", () => {
  const offer = {totalRub: 1_361_230, sourcePrice: 6400,
    calculationSnapshot: {currencyRate: {effectiveRate: 96.7442, previousEffectiveRate: 96.5915}}};
  assert.equal(resolvePriceTrend(offer)?.deltaRub, 977);
  assert.equal(resolvePriceTrend({...offer, sourcePrice: undefined}), null);
});

test("currency names are readable in Russian", () => {
  assert.equal(currencyName("eur"), "Евро");
  assert.equal(currencyName("KRW"), "Южнокорейская вона");
});

test("latest publication drives the indicator without repricing the saved quote", async () => {
  const {withLiveRate, currentCurrencyRate} = await import('../apps/web/components/catalog/PriceTrend');
  const offer = {totalRub: 8_811_105, priceDeltaRub: 700, sourcePrice:404_125, sourceCurrency:'CNY', calculationSnapshot:{currencyRate:{currency:'CNY',effectiveRate:12.5629,previousEffectiveRate:12.5355,rateDate:'2026-09-29',previousRateDate:'2026-09-26',rateSource:'cbr_live'}}};
  const live = {currency:'CNY',effectiveRate:12.4028,rateDate:'2026-10-02',previousEffectiveRate:12.4728,previousRateDate:'2026-10-01',history:[{date:'2026-09-29',effectiveRate:12.5629},{date:'2026-10-01',effectiveRate:12.4728},{date:'2026-10-02',effectiveRate:12.4028}]};
  const updated = withLiveRate(offer,live);
  assert.equal(updated.totalRub,offer.totalRub);
  assert.equal(updated.calculationSnapshot?.currencyRate?.calculatedEffectiveRate,12.5629);
  assert.equal(updated.calculationSnapshot?.currencyRate?.rateDate,'2026-10-02');
  assert.equal(resolvePriceTrend(updated)?.deltaRub,-28_289);
  assert.equal(resolvePriceTrend(updated)?.direction,'down');
  assert.equal(currentCurrencyRate(updated.calculationSnapshot!.currencyRate!,live).calculatedEffectiveRate,12.5629);
  const flat = withLiveRate(offer,{...live,effectiveRate:12.4728,history:[]});
  assert.equal(resolvePriceTrend(flat),null,'flat latest publication cannot inherit an old positive change');
  const atb = {...offer,calculationSnapshot:{currencyRate:{...offer.calculationSnapshot.currencyRate,rateSource:'atb_akebono'}}};
  assert.equal(withLiveRate(atb,live).calculationSnapshot?.currencyRate?.effectiveRate,12.5629);
  assert.equal(withLiveRate(offer,{...live,currency:'USD'}).calculationSnapshot?.currencyRate?.effectiveRate,12.5629);
  assert.equal(withLiveRate(updated,{...live,rateDate:'2026-09-28',history:[]}).calculationSnapshot?.currencyRate?.rateDate,'2026-10-02');
  assert.equal(resolvePriceTrend(withLiveRate({...offer,sourcePrice:undefined},live)),null,'no fabricated impact without source amount');
});
