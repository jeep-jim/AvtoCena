import assert from "node:assert/strict";
import test from "node:test";
import { isCrediblePublicOffer } from "../apps/web/lib/catalog/offer-quality";
import type { VehicleOffer } from "../apps/web/lib/catalog/types";

function electricOffer(overrides: Partial<VehicleOffer> = {}): VehicleOffer {
  return {
    id: "offer_estimated_ev",
    sourceId: "che168_china_exact",
    sourceOfferId: "123",
    market: "china",
    offerType: "fixed",
    status: "active",
    make: "Tesla",
    model: "Model 3",
    year: 2024,
    mileageKm: 20_000,
    fuel: "electric",
    powertrainKind: "electric",
    powerHp: 299,
    powerKw: 220,
    utilizationPowerKw: 220,
    powerDataConfidence: "estimated",
    powerDataSource: "estimated-utilization-preview",
    sourcePrice: 180_000,
    sourceCurrency: "CNY",
    priceMode: "estimated",
    images: [{ id: "img1", url: "https://autoimg.cn/car/tesla-1.jpg", objectKey: "catalog/images/china/tesla-1.jpg", size: 120_000, checksum: "abc", mimeType: "image/jpeg", width: 1200, height: 800 }],
    totalRub: 3_200_000,
    calculationStatus: "estimated",
    calculationSnapshot: {
      pricingConfidence: "estimated",
      certified30MinutePowerMissing: true,
      customs: { status: "ready", totalCustomsRub: 1_100_000 },
    },
    firstSeenAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    operational: { sourceUrl: "https://che168.com/123", raw: {} },
    ...overrides,
  } as VehicleOffer;
}

test("publishes an EV only when the missing certified power is explicitly marked as an estimate", () => {
  assert.equal(isCrediblePublicOffer(electricOffer()), true);
  assert.equal(isCrediblePublicOffer(electricOffer({
    calculationSnapshot: { pricingConfidence: "estimated", customs: { status: "ready" } },
  })), false);
});

test("publishes an EV with exact documented 30-minute power", () => {
  assert.equal(isCrediblePublicOffer(electricOffer({
    power30MinKw: 88,
    power30MinKwByMotor: [88],
    utilizationPowerKw: 88,
    powerDataConfidence: "documented",
    powerDataSource: "OTTS:example",
    priceMode: "fixed",
    calculationStatus: "ready",
    calculationSnapshot: { pricingConfidence: "exact", customs: { status: "ready" } },
  })), true);
});
