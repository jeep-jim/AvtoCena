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

test("saved total delta takes priority over a contrary exchange movement", () => {
  const trend = resolvePriceTrend({ totalRub: 1_466_795, priceDeltaRub: -2300, sourcePrice: 6400,
    calculationSnapshot: {currencyRate: {effectiveRate: 96.7442, previousEffectiveRate: 96.5915}} });
  assert.equal(trend?.deltaRub, -2300);
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

test("recalculated price recovers its own dated comparison without changing the quote", async () => {
  const {withLiveRate} = await import('../apps/web/components/catalog/PriceTrend');
  const offer = {totalRub: 2_000_000, sourceCurrency:'EUR', calculationSnapshot:{currencyRate:{currency:'EUR',effectiveRate:95,rateDate:'2026-09-26',rateSource:'cbr_live',sourcePrice:10_000}}};
  const live = {currency:'EUR',effectiveRate:98,rateDate:'2026-09-29',history:[{date:'2026-09-25',effectiveRate:96},{date:'2026-09-26',effectiveRate:95},{date:'2026-09-29',effectiveRate:98}]};
  const restored = withLiveRate(offer,live);
  assert.equal(restored.totalRub,offer.totalRub);
  assert.equal(restored.calculationSnapshot?.currencyRate?.effectiveRate,95);
  assert.equal(restored.calculationSnapshot?.currencyRate?.rateDate,'2026-09-26');
  assert.equal(resolvePriceTrend(restored)?.deltaRub,-10_000);
  assert.equal(withLiveRate(offer,{...live,history:[]}),offer);
  assert.equal(withLiveRate({...offer,calculationSnapshot:{currencyRate:{...offer.calculationSnapshot.currencyRate,rateSource:'atb_akebono'}}},live).calculationSnapshot?.currencyRate?.previousEffectiveRate,undefined);
  assert.equal(withLiveRate(offer,{...live,currency:'USD'}),offer);
});
