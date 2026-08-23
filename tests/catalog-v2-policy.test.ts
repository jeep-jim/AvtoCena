import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_V2_DEFAULT_POLICY,
  classifyCatalogV2Offer,
  isCatalogLowPowerOffer,
  isCompletedJapanAuction,
  isJapanAuctionOffer,
  selectCatalogV2MarketOffers,
} from "../apps/web/lib/catalog/catalog-v2-policy";
import {
  assertCatalogV2SourceRegistry,
  CATALOG_V2_SOURCE_SLOTS,
} from "../apps/web/lib/catalog/catalog-v2-source-registry";
import { catalogImportSources } from "../apps/web/lib/catalog/importer";
import type { VehicleOffer } from "../apps/web/lib/catalog/types";

function offer(id: string, overrides: Partial<VehicleOffer> = {}): VehicleOffer {
  const year = new Date().getFullYear() - 2;
  return {
    id,
    sourceId: "test_source",
    sourceOfferId: id,
    market: "korea",
    make: "Hyundai",
    model: "Elantra",
    year,
    mileageKm: 50_000,
    engineCc: 1_600,
    fuel: "Бензин",
    transmission: "Автомат",
    drive: "Передний",
    bodyType: "Седан",
    powerHp: 150,
    sourcePrice: 1_000_000,
    sourceCurrency: "RUB",
    totalRub: 2_500_000,
    status: "active",
    offerType: "fixed",
    priceMode: "fixed",
    calculationStatus: "ready",
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    images: [{ id: `${id}-image`, url: `https://example.test/${id}.jpg`, objectKey: `${id}.jpg`, checksum: id, size: 100_000, mimeType: "image/jpeg" }],
    calculationSnapshot: {
      customs: { status: "ready", totalCustomsRub: 500_000 },
      breakdown: [
        { id: "car", title: "Цена автомобиля", amountRub: 1_000_000 },
        { id: "customs", title: "Таможенные платежи", amountRub: 500_000 },
      ],
    },
    operational: { sourceUrl: `https://example.test/${id}` },
    ...overrides,
  } as VehicleOffer;
}

function policy(overrides: Partial<typeof CATALOG_V2_DEFAULT_POLICY> = {}) {
  return { ...CATALOG_V2_DEFAULT_POLICY, ...overrides };
}

test("Catalog V2 source registry keeps every configured adapter valid", () => {
  assert.equal(assertCatalogV2SourceRegistry(), true);
  assert.equal(Object.keys(CATALOG_V2_SOURCE_SLOTS).length, 7);
  const adapters = new Map(catalogImportSources.map((source) => [source.sourceId, source]));
  const failures: string[] = [];
  for (const [market, slots] of Object.entries(CATALOG_V2_SOURCE_SLOTS)) {
    for (const slot of slots) {
      const adapter = adapters.get(slot.sourceId);
      if (!adapter) failures.push(`${market}:${slot.sourceId}:missing`);
      else if (adapter.market !== market && adapter.market !== "multi") failures.push(`${market}:${slot.sourceId}:actual=${adapter.market}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("default production policy is 30k with an 80 percent <=160 hp contract", () => {
  assert.equal(CATALOG_V2_DEFAULT_POLICY.maximumPerMarket, 30_000);
  assert.equal(CATALOG_V2_DEFAULT_POLICY.priorityTarget, 24_000);
  assert.equal(CATALOG_V2_DEFAULT_POLICY.lowPowerMinShare, 0.8);
  assert.equal(CATALOG_V2_DEFAULT_POLICY.priorityMaxPowerHp, 160);
  assert.equal(CATALOG_V2_DEFAULT_POLICY.priorityMaxTotalRub, 6_000_000);
});

test("commercial priority is <=160 hp and <=6m while low-power mix is price-independent", () => {
  assert.equal(classifyCatalogV2Offer(offer("priority")).tier, "priority");
  assert.equal(classifyCatalogV2Offer(offer("power", { powerHp: 161 })).tier, "recent");
  assert.equal(classifyCatalogV2Offer(offer("price", { totalRub: 6_000_001 })).tier, "recent");
  assert.equal(isCatalogLowPowerOffer(offer("expensive-low-power", { totalRub: 9_000_000, powerHp: 150 })), true);
  assert.equal(isCatalogLowPowerOffer(offer("high-power", { powerHp: 161 })), false);
});

test("year gates keep Japan at 2010+ and other markets at 2020+", () => {
  assert.equal(classifyCatalogV2Offer(offer("korea-2019", { year: 2019 })).reason, "year");
  const japan2009 = offer("japan-2009", { market: "japan", year: 2009, sourceId: "jpauc_japan_past_open", offerType: "auction", catalogKind: "auction_result", auctionResult: "sold", status: "sold" });
  assert.equal(classifyCatalogV2Offer(japan2009).reason, "year");
  const japan2010 = offer("japan-2010", { market: "japan", year: 2010, sourceId: "jpauc_japan_past_open", offerType: "auction", catalogKind: "auction_result", auctionResult: "sold", status: "sold" });
  assert.equal(classifyCatalogV2Offer(japan2010).eligible, true);
});

test("selection never lets >160 hp exceed 20 percent when enough low-power cars exist", () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, index) => offer(`low-${index}`, { powerHp: 150 })),
    ...Array.from({ length: 20 }, (_, index) => offer(`high-${index}`, { powerHp: 220 })),
  ];
  const result = selectCatalogV2MarketOffers(rows, policy({ maximumPerMarket: 10, priorityTarget: 8 }));
  assert.equal(result.selected.length, 10);
  assert.equal(result.lowPowerCount, 8);
  assert.equal(result.selected.filter((row) => Number(row.powerHp || 0) > 160).length, 2);
  assert.equal(result.lowPowerCount / result.selected.length, 0.8);
  assert.ok(result.rejected.fallback_locked >= 18);
});

test("selection shrinks instead of flooding a market with high-power fallback", () => {
  const rows = [
    ...Array.from({ length: 4 }, (_, index) => offer(`low-${index}`, { powerHp: 150 })),
    ...Array.from({ length: 20 }, (_, index) => offer(`high-${index}`, { powerHp: 220 })),
  ];
  const result = selectCatalogV2MarketOffers(rows, policy({ maximumPerMarket: 10, priorityTarget: 8 }));
  assert.equal(result.selected.length, 5);
  assert.equal(result.lowPowerCount, 4);
  assert.equal(result.selected.filter((row) => Number(row.powerHp || 0) > 160).length, 1);
  assert.equal(result.lowPowerCount / result.selected.length, 0.8);
});

test("affordable recent low-power cars sort ahead of old expensive high-power cars", () => {
  const rows = [
    offer("old-expensive", { year: 2015, powerHp: 220, totalRub: 8_000_000 }),
    offer("recent-cheap", { year: 2025, powerHp: 120, totalRub: 2_000_000 }),
    offer("recent-cheap-2", { year: 2024, powerHp: 130, totalRub: 2_200_000 }),
    offer("recent-cheap-3", { year: 2023, powerHp: 140, totalRub: 2_400_000 }),
    offer("recent-cheap-4", { year: 2022, powerHp: 150, totalRub: 2_600_000 }),
  ];
  const result = selectCatalogV2MarketOffers(rows, policy({ maximumPerMarket: 5, priorityTarget: 4 }));
  assert.equal(result.selected[0].id, "recent-cheap");
  assert.equal(result.selected.at(-1)?.id, "old-expensive");
});

test("Japan publishes only completed auction lots with an explicit final price", () => {
  const privateListing = offer("private", { market: "japan", sourceId: "tcv_japan_open" });
  assert.equal(isJapanAuctionOffer(privateListing), false);
  assert.equal(classifyCatalogV2Offer(privateListing).reason, "japan_non_auction");

  const currentAuction = offer("current-auction", {
    market: "japan",
    sourceId: "jpauc_japan_current_open",
    offerType: "auction",
    status: "active",
  });
  assert.equal(isJapanAuctionOffer(currentAuction), true);
  assert.equal(isCompletedJapanAuction(currentAuction), false);
  assert.equal(classifyCatalogV2Offer(currentAuction).reason, "japan_auction_not_completed");

  const missingFinalPrice = offer("missing-final-price", {
    market: "japan",
    sourceId: "jpauc_japan_past_open",
    sourcePrice: 0,
    offerType: "auction",
    catalogKind: "auction_result",
    auctionResult: "sold",
    status: "sold",
  });
  assert.equal(classifyCatalogV2Offer(missingFinalPrice).reason, "japan_final_price_missing");

  const completedAuction = offer("completed-auction", {
    market: "japan",
    sourceId: "jpauc_japan_past_open",
    offerType: "auction",
    catalogKind: "auction_result",
    auctionResult: "sold",
    status: "sold",
    powerHp: 200,
  });
  assert.equal(isCompletedJapanAuction(completedAuction), true);
  assert.equal(classifyCatalogV2Offer(completedAuction).tier, "japan_auction");
  const result = selectCatalogV2MarketOffers([privateListing, currentAuction, missingFinalPrice, completedAuction], policy({ priorityTarget: 0, lowPowerMinShare: 0 }));
  assert.deepEqual(result.selected.map((row) => row.id), ["completed-auction"]);
});

test("completed Japanese <=160 hp <=6m lot enters the priority layer", () => {
  const auction = offer("japan-priority", {
    market: "japan",
    sourceId: "carvector_japan_stat_open",
    offerType: "auction",
    catalogKind: "auction_result",
    auctionResult: "sold",
  });
  const classification = classifyCatalogV2Offer(auction);
  assert.equal(classification.eligible, true);
  assert.equal(classification.tier, "priority");
  assert.equal(classification.reason, "japan_completed_priority");
});

test("incomplete calculation remains in collection classification but cannot masquerade as priority", () => {
  const pending = offer("pending", {
    totalRub: null,
    powerHp: undefined,
    calculationStatus: "needs_customs_data",
    calculationSnapshot: undefined,
  });
  const classification = classifyCatalogV2Offer(pending);
  assert.equal(classification.eligible, true);
  assert.equal(classification.tier, "recent");
  const selected = selectCatalogV2MarketOffers([pending]);
  assert.equal(selected.selected.length, 0);
  assert.equal(selected.lowPowerCount, 0);
});
