import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_V2_DEFAULT_POLICY,
  classifyCatalogV2Offer,
  selectCatalogV2MarketOffers,
} from "../apps/web/lib/catalog/catalog-v2-policy";
import {
  assertCatalogV2SourceRegistry,
  CATALOG_V2_SOURCE_SLOTS,
} from "../apps/web/lib/catalog/catalog-v2-source-registry";
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
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    images: [{ id: `${id}-image`, url: `https://example.test/${id}.jpg` }],
    calculationSnapshot: {
      customs: { status: "ready", totalCustomsRub: 500_000 },
      breakdown: [
        { id: "car", label: "Автомобиль", amountRub: 1_000_000 },
        { id: "customs", label: "Таможня", amountRub: 500_000 },
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

test("приоритетный слой требует до 6 лет, до 160 л.с. и до 6 млн рублей", () => {
  assert.equal(classifyCatalogV2Offer(offer("priority")).tier, "priority");
  assert.equal(classifyCatalogV2Offer(offer("power", { powerHp: 161 })).tier, "recent");
  assert.equal(classifyCatalogV2Offer(offer("price", { totalRub: 6_000_001 })).tier, "recent");
  assert.equal(classifyCatalogV2Offer(offer("age", { year: new Date().getFullYear() - 7 })).tier, "recent");
});

test("fallback заблокирован, пока рынок не набрал 1000 приоритетных машин", () => {
  const result = selectCatalogV2MarketOffers([
    offer("priority"),
    offer("fallback", { year: new Date().getFullYear() - 8, totalRub: 7_000_000 }),
  ]);
  assert.equal(result.fallbackUnlocked, false);
  assert.deepEqual(result.selected.map((row) => row.id), ["priority"]);
  assert.equal(result.shortageToUnlock, 999);
  assert.equal(result.rejected.fallback_locked, 1);
});

test("после достижения квоты добавляются машины до 10 лет и затем расширенный слой", () => {
  const options = { ...CATALOG_V2_DEFAULT_POLICY, priorityTarget: 2 };
  const result = selectCatalogV2MarketOffers([
    offer("p1"),
    offer("p2"),
    offer("recent", { year: new Date().getFullYear() - 8, totalRub: 7_000_000 }),
    offer("extended", { year: new Date().getFullYear() - 12, totalRub: 8_000_000 }),
  ], options);
  assert.equal(result.fallbackUnlocked, true);
  assert.deepEqual(result.selected.map((row) => row.id), ["p1", "p2", "recent", "extended"]);
});

test("завершённые японские аукционы сохраняются отдельным слоем", () => {
  const result = selectCatalogV2MarketOffers([
    offer("auction", {
      market: "japan",
      sourceId: "jpauc_japan_past_open",
      year: new Date().getFullYear() - 12,
      totalRub: 9_000_000,
    }),
  ]);
  assert.equal(result.selected.length, 1);
  assert.equal(result.auctionCount, 1);
});

test("без полного расчёта предложение не публикуется", () => {
  const result = classifyCatalogV2Offer(offer("no-calc", { calculationSnapshot: undefined }));
  assert.equal(result.tier, "rejected");
  assert.equal(result.reason, "full_calculation");
});
