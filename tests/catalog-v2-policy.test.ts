import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_V2_DEFAULT_POLICY,
  classifyCatalogV2Offer,
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

test("1000 является ориентиром, а не блокировкой остальных машин", () => {
  const result = selectCatalogV2MarketOffers([
    offer("priority"),
    offer("recent", { year: new Date().getFullYear() - 8, totalRub: 7_000_000 }),
    offer("extended", { year: new Date().getFullYear() - 12, totalRub: 18_000_000 }),
  ]);
  assert.equal(result.fallbackUnlocked, true);
  assert.equal(result.shortageToUnlock, 0);
  assert.deepEqual(result.selected.map((row) => row.id), ["priority", "recent", "extended"]);
  assert.equal(result.rejected.fallback_locked, 0);
});

test("дорогие проверенные машины не отбрасываются, а идут после приоритетных", () => {
  const result = selectCatalogV2MarketOffers([
    offer("priority"),
    offer("expensive", { totalRub: 50_000_000, year: new Date().getFullYear() - 3, powerHp: 500 }),
  ]);
  assert.deepEqual(result.selected.map((row) => row.id), ["priority", "expensive"]);
  assert.equal(result.recentCount, 1);
});

test("Япония принимает только аукционные карточки", () => {
  const privateListing = offer("private", { market: "japan", sourceId: "tcv_japan_open" });
  assert.equal(isJapanAuctionOffer(privateListing), false);
  assert.equal(classifyCatalogV2Offer(privateListing).reason, "japan_non_auction");

  const auction = offer("auction", {
    market: "japan",
    sourceId: "jpauc_japan_past_open",
    offerType: "auction",
    catalogKind: "auction_result",
    auctionResult: "sold",
    status: "sold",
  });
  assert.equal(isJapanAuctionOffer(auction), true);
  assert.equal(classifyCatalogV2Offer(auction).tier, "japan_auction");
  const result = selectCatalogV2MarketOffers([privateListing, auction]);
  assert.deepEqual(result.selected.map((row) => row.id), ["auction"]);
  assert.equal(result.auctionCount, 1);
  assert.equal(result.rejected.japan_non_auction, 1);
});

test("без полного расчёта предложение не публикуется", () => {
  const result = classifyCatalogV2Offer(offer("no-calc", { calculationSnapshot: undefined }));
  assert.equal(result.tier, "rejected");
  assert.equal(result.reason, "full_calculation");
});
