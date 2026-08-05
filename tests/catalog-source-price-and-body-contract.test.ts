import assert from "node:assert/strict";
import test from "node:test";
import { classifyCatalogV2Offer, selectCatalogV2MarketOffers } from "../apps/web/lib/catalog/catalog-v2-policy";

const base = {
  id: "encar-1",
  market: "korea",
  sourceId: "encar",
  sourceUrl: "https://example.test/car/1",
  make: "Kia",
  model: "K5",
  year: 2023,
  powerHp: 160,
  sourcePrice: 25_000_000,
  sourceCurrency: "KRW",
  images: ["https://example.test/1.jpg"],
};

test("catalog rejects missing source price", () => {
  const result = classifyCatalogV2Offer({ ...base, sourcePrice: 0 } as any);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "source_price_missing");
});

test("catalog rejects request-only price text even when a placeholder number exists", () => {
  const result = classifyCatalogV2Offer({
    ...base,
    operational: { raw: { priceText: "가격 문의" } },
  } as any);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "price_on_request");
});

test("conflicting crossover default is removed for unambiguous sedan model", () => {
  const selection = selectCatalogV2MarketOffers([{ ...base, bodyType: "crossover" } as any], {
    priorityTarget: 0,
    maximumPerMarket: 10,
    priorityMaxAgeYears: 6,
    recentMaxAgeYears: 15,
    priorityMaxPowerHp: 160,
    priorityMaxTotalRub: 6_000_000,
    hardMaxTotalRub: 100_000_000,
  });
  assert.equal(selection.selected.length, 1);
  assert.equal(selection.selected[0].bodyType, undefined);
});
