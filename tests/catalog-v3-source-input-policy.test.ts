import assert from "node:assert/strict";
import test from "node:test";

import { classifyCatalogV2Offer, selectCatalogV2MarketOffers } from "../apps/web/lib/catalog/catalog-v2-policy";

function offer(overrides: Record<string, unknown> = {}) {
  return {
    id: `offer-${Math.random()}`,
    market: "korea",
    make: "Hyundai",
    model: "Avante",
    year: new Date().getFullYear() - 2,
    powerHp: 123,
    sourcePrice: 18_000_000,
    sourceCurrency: "KRW",
    images: [{ id: "image-1", url: "https://example.com/car.jpg" }],
    calculationStatus: "needs_data",
    operational: { sourceUrl: "https://www.encar.com/dc/dc_cardetailview.do?pageid=dc_carsearch&carid=1", raw: {} },
    ...overrides,
  } as any;
}

test("source price, year and power qualify a recent <=160 hp offer before knowledge enrichment", () => {
  const result = classifyCatalogV2Offer(offer(), {
    priorityTarget: 5_001,
    maximumPerMarket: 10_000,
    priorityMaxAgeYears: 6,
    recentMaxAgeYears: 15,
    priorityMaxPowerHp: 160,
    priorityMaxTotalRub: 6_000_000,
    hardMaxTotalRub: 100_000_000,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.tier, "priority");
});

test("Smoke10 publishes collected real offers without the full-market priority gate", () => {
  const offers = Array.from({ length: 10 }, (_, index) => offer({ id: `korea-${index}`, year: 2015, powerHp: 200 }));
  const result = selectCatalogV2MarketOffers(offers, {
    priorityTarget: 1_000,
    maximumPerMarket: 10,
    priorityMaxAgeYears: 6,
    recentMaxAgeYears: 15,
    priorityMaxPowerHp: 160,
    priorityMaxTotalRub: 6_000_000,
    hardMaxTotalRub: 100_000_000,
  });
  assert.equal(result.fallbackUnlocked, true);
  assert.equal(result.selected.length, 10);
});
