import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_V2_DEFAULT_POLICY,
  classifyCatalogV2Offer,
  selectCatalogV2MarketOffers,
} from "../apps/web/lib/catalog/catalog-v2-policy";

function offer(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    sourceId: "source",
    sourceOfferId: id,
    market: "uae",
    offerType: "fixed",
    status: "active",
    make: "Toyota",
    model: "Camry",
    year: 2024,
    sourcePrice: 100_000,
    sourceCurrency: "AED",
    totalRub: 5_000_000,
    powerHp: 150,
    images: [],
    firstSeenAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    operational: { sourceUrl: `https://example.test/${id}`, raw: {} },
    ...overrides,
  } as any;
}

test("production year floor is 2010 for Japan and 2020 everywhere else", () => {
  assert.equal(classifyCatalogV2Offer(offer("uae-2019", { year: 2019 })).eligible, false);
  assert.equal(classifyCatalogV2Offer(offer("uae-2020", { year: 2020 })).eligible, true);
  assert.equal(classifyCatalogV2Offer(offer("jp-2009", { market: "japan", year: 2009 })).eligible, false);
  assert.equal(classifyCatalogV2Offer(offer("jp-2010", { market: "japan", year: 2010 })).eligible, true);
});

test("core priority is based on delivered price up to 8M and power up to 160 hp", () => {
  assert.equal(classifyCatalogV2Offer(offer("edge", { totalRub: 8_000_000, powerHp: 160 })).tier, "priority");
  assert.equal(classifyCatalogV2Offer(offer("price-tail", { totalRub: 8_000_001, powerHp: 160 })).tier, "recent");
  assert.equal(classifyCatalogV2Offer(offer("power-tail", { totalRub: 8_000_000, powerHp: 161 })).tier, "recent");
  assert.equal(CATALOG_V2_DEFAULT_POLICY.priorityTarget, 0.8);
  assert.equal(CATALOG_V2_DEFAULT_POLICY.priorityMaxTotalRub, 8_000_000);
  assert.equal(CATALOG_V2_DEFAULT_POLICY.priorityMaxPowerHp, 160);
});

test("selection fills 80 percent core before allowing the 20 percent tail", () => {
  const rows = [
    ...Array.from({ length: 12 }, (_, index) => offer(`core-${index}`)),
    ...Array.from({ length: 12 }, (_, index) => offer(`tail-${index}`, { totalRub: 9_000_000, powerHp: 200 })),
  ];
  const result = selectCatalogV2MarketOffers(rows, { ...CATALOG_V2_DEFAULT_POLICY, maximumPerMarket: 10 });
  assert.equal(result.selected.length, 10);
  assert.equal(result.priorityCount, 8);
  assert.equal(result.recentCount, 2);
  assert.equal(result.fallbackUnlocked, true);
});

test("tail cannot dilute a market below 80 percent when core supply is short", () => {
  const rows = [
    ...Array.from({ length: 4 }, (_, index) => offer(`core-short-${index}`)),
    ...Array.from({ length: 20 }, (_, index) => offer(`tail-short-${index}`, { totalRub: 9_000_000, powerHp: 200 })),
  ];
  const result = selectCatalogV2MarketOffers(rows, { ...CATALOG_V2_DEFAULT_POLICY, maximumPerMarket: 10 });
  assert.equal(result.priorityCount, 4);
  assert.equal(result.recentCount, 1);
  assert.equal(result.selected.length, 5);
  assert.equal(result.fallbackUnlocked, false);
  assert.equal(result.shortageToUnlock, 4);
});

test("completed Japan auctions obey the same core price and power priority", () => {
  const auction = offer("jp-auction", {
    market: "japan",
    year: 2020,
    sourceId: "jpauc_japan_past_open",
    offerType: "auction",
    catalogKind: "auction_result",
    auctionResult: "sold",
    operational: { sourceUrl: "https://example.test/jp-auction", raw: { status: "sold" } },
  });
  const classification = classifyCatalogV2Offer(auction);
  assert.equal(classification.eligible, true);
  assert.equal(classification.tier, "priority");
});
