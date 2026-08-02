import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_V2_DEFAULT_POLICY,
  classifyCatalogV2Offer,
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

test("каждый рынок Catalog V2 имеет минимум пять независимых source slots", () => {
  assert.equal(assertCatalogV2SourceRegistry(), true);
  assert.equal(Object.keys(CATALOG_V2_SOURCE_SLOTS).length, 7);
  for (const sources of Object.values(CATALOG_V2_SOURCE_SLOTS)) {
    assert.ok(new Set(sources.map((source) => source.sourceId)).size >= 5);
  }
});

test("каждый source slot Catalog V2 соответствует реально зарегистрированному адаптеру", () => {
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

test("рынок вмещает до 100 тысяч проверенных предложений", () => {
  assert.equal(CATALOG_V2_DEFAULT_POLICY.maximumPerMarket, 100_000);
});

test("приоритетный слой требует до 6 лет, до 160 л.с. и до 6 млн рублей", () => {
  assert.equal(classifyCatalogV2Offer(offer("priority")).tier, "priority");
  assert.equal(classifyCatalogV2Offer(offer("power", { powerHp: 161 })).tier, "recent");
  assert.equal(classifyCatalogV2Offer(offer("price", { totalRub: 6_000_001 })).tier, "recent");
  assert.equal(classifyCatalogV2Offer(offer("age", { year: new Date().getFullYear() - 7 })).tier, "recent");
});

test("второй слой охватывает машины до 15 лет", () => {
  assert.equal(CATALOG_V2_DEFAULT_POLICY.recentMaxAgeYears, 15);
  assert.equal(classifyCatalogV2Offer(offer("age-15", { year: new Date().getFullYear() - 15, powerHp: 250 })).tier, "recent");
  assert.equal(classifyCatalogV2Offer(offer("age-16", { year: new Date().getFullYear() - 16, powerHp: 250 })).tier, "extended");
});

test("остальные слои открываются только после наполнения приоритетного целевого объёма", () => {
  const options = policy({ priorityTarget: 2 });
  const recent = offer("recent", { year: new Date().getFullYear() - 8, totalRub: 7_000_000 });
  const extended = offer("extended", { year: new Date().getFullYear() - 16, totalRub: 18_000_000 });
  const locked = selectCatalogV2MarketOffers([offer("priority-1"), recent, extended], options);
  assert.equal(locked.fallbackUnlocked, false);
  assert.equal(locked.shortageToUnlock, 1);
  assert.deepEqual(locked.selected.map((row) => row.id), ["priority-1"]);
  assert.equal(locked.rejected.fallback_locked, 2);

  const unlocked = selectCatalogV2MarketOffers([offer("priority-1"), offer("priority-2"), recent, extended], options);
  assert.equal(unlocked.fallbackUnlocked, true);
  assert.equal(unlocked.shortageToUnlock, 0);
  assert.deepEqual(unlocked.selected.map((row) => row.id), ["priority-1", "priority-2", "recent", "extended"]);
});

test("дорогие проверенные машины добавляются после наполнения приоритетного слоя", () => {
  const result = selectCatalogV2MarketOffers([
    offer("priority"),
    offer("expensive", { totalRub: 50_000_000, year: new Date().getFullYear() - 3, powerHp: 500 }),
  ], policy({ priorityTarget: 1 }));
  assert.deepEqual(result.selected.map((row) => row.id), ["priority", "expensive"]);
  assert.equal(result.recentCount, 1);
});

test("Япония публикует только завершённые аукционные лоты с финальной ценой", () => {
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
  const result = selectCatalogV2MarketOffers(
    [privateListing, currentAuction, missingFinalPrice, completedAuction],
    policy({ priorityTarget: 0 }),
  );
  assert.deepEqual(result.selected.map((row) => row.id), ["completed-auction"]);
  assert.equal(result.auctionCount, 1);
  assert.equal(result.rejected.japan_non_auction, 1);
  assert.equal(result.rejected.japan_auction_not_completed, 1);
  assert.equal(result.rejected.japan_final_price_missing, 1);
});

test("завершённый японский лот до 6 лет, 160 л.с. и 6 млн входит в приоритет", () => {
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
  const selected = selectCatalogV2MarketOffers([auction], policy({ priorityTarget: 1 }));
  assert.equal(selected.auctionCount, 1);
});

test("неполный расчёт без явного статуса ожидания не публикуется", () => {
  const result = classifyCatalogV2Offer(offer("no-calc", { calculationSnapshot: undefined }));
  assert.equal(result.tier, "rejected");
  assert.equal(result.reason, "full_calculation");
});

test("реальная карточка с ожидающим таможенным расчётом хранится в следующем слое", () => {
  const pending = offer("pending", {
    totalRub: null,
    calculationStatus: "needs_customs_data",
    calculationSnapshot: undefined,
  });
  const classification = classifyCatalogV2Offer(pending);
  assert.equal(classification.eligible, true);
  assert.equal(classification.tier, "recent");
  assert.equal(classification.reason, "recent_calculation_pending");
  const locked = selectCatalogV2MarketOffers([pending]);
  assert.deepEqual(locked.selected, []);
  assert.equal(locked.rejected.fallback_locked, 1);
});

test("завершённый японский лот с ожидающим расчётом сохраняется, но не подменяет приоритет", () => {
  const pendingAuction = offer("pending-auction", {
    market: "japan",
    sourceId: "carvector_japan_stat_open",
    offerType: "auction",
    catalogKind: "auction_result",
    auctionResult: "sold",
    status: "active",
    totalRub: null,
    calculationStatus: "needs_power_data",
    calculationSnapshot: undefined,
  });
  const classification = classifyCatalogV2Offer(pendingAuction);
  assert.equal(classification.eligible, true);
  assert.equal(classification.tier, "japan_auction");
  assert.equal(classification.reason, "completed_auction_calculation_pending");
});
