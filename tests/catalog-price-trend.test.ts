import assert from "node:assert/strict";
import test from "node:test";
import { applyPriceTrend } from "../apps/web/lib/catalog/importer";
import { resolvePriceTrend } from "../apps/web/components/catalog/PriceTrend";
import type { VehicleOffer } from "../apps/web/lib/catalog/types";

function offer(totalRub: number, extra: Partial<VehicleOffer> = {}): VehicleOffer {
  return {
    id: "offer-1",
    sourceId: "test",
    sourceOfferId: "1",
    market: "korea",
    offerType: "fixed",
    status: "active",
    make: "Kia",
    model: "K3",
    year: 2024,
    sourcePrice: 10_000_000,
    sourceCurrency: "KRW",
    priceMode: "fixed",
    images: [],
    totalRub,
    calculationStatus: "ready",
    firstSeenAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    operational: {},
    ...extra,
  };
}

test("catalog import stores a decrease against the previous calculation", () => {
  const next = applyPriceTrend(offer(1_391_300), offer(1_400_300), "2026-07-15T12:00:00.000Z");
  assert.equal(next.previousTotalRub, 1_400_300);
  assert.equal(next.priceDeltaRub, -9_000);
  assert.equal(next.priceChangedAt, "2026-07-15T12:00:00.000Z");
  assert.deepEqual(resolvePriceTrend(next), { direction: "down", deltaRub: -9_000, formattedDelta: "9K" });
});

test("catalog import stores an increase and formats large changes", () => {
  const next = applyPriceTrend(offer(2_440_000), offer(2_300_000), "2026-07-15T12:00:00.000Z");
  assert.equal(next.priceDeltaRub, 140_000);
  assert.deepEqual(resolvePriceTrend(next), { direction: "up", deltaRub: 140_000, formattedDelta: "140K" });
});

test("unchanged recalculation keeps the latest meaningful movement", () => {
  const previous = offer(1_391_300, { previousTotalRub: 1_400_300, priceDeltaRub: -9_000, priceChangedAt: "2026-07-15T12:00:00.000Z" });
  const next = applyPriceTrend(offer(1_391_300), previous, "2026-07-15T18:00:00.000Z");
  assert.equal(next.priceDeltaRub, -9_000);
  assert.equal(next.priceChangedAt, "2026-07-15T12:00:00.000Z");
});

test("completed Japanese auction result never receives a current-price trend", () => {
  const previous = offer(2_700_000, { market: "japan", previousTotalRub: 2_600_000, priceDeltaRub: 100_000 });
  const next = applyPriceTrend(offer(2_900_000, { market: "japan" }), previous, "2026-08-19T12:00:00.000Z");
  assert.equal(next.totalRub, 2_700_000);
  assert.equal(next.previousTotalRub, null);
  assert.equal(next.priceDeltaRub, null);
  assert.equal(next.priceChangedAt, undefined);
  assert.equal(resolvePriceTrend(next), null);
});

test("repeated Japanese import keeps the saved historical calculation", () => {
  const previous = offer(1_930_000, {
    market: "japan",
    sourcePrice: 1_200_000,
    sourceCurrency: "JPY",
    calculationStatus: "ready",
    calculationSnapshot: { currencyRate: { rateToRub: 0.56, capturedAt: "2026-08-01T00:00:00.000Z" } },
  });
  const recalculated = offer(2_140_000, {
    market: "japan",
    sourcePrice: 1_200_000,
    sourceCurrency: "jpy",
    calculationStatus: "ready",
    calculationSnapshot: { currencyRate: { rateToRub: 0.63, capturedAt: "2026-08-19T00:00:00.000Z" } },
  });

  const result = applyPriceTrend(recalculated, previous, "2026-08-19T00:00:00.000Z");
  assert.equal(result.totalRub, 1_930_000);
  assert.equal(result.calculationSnapshot?.currencyRate?.rateToRub, 0.56);
  assert.equal(result.previousTotalRub, null);
  assert.equal(result.priceDeltaRub, null);
});
