import assert from "node:assert/strict";
import test from "node:test";
import { isCrediblePublicOffer } from "../apps/web/lib/catalog/offer-quality";
import { catalogPowerDisplay } from "../apps/web/lib/catalog/power-display";
import type { VehicleOffer } from "../apps/web/lib/catalog/types";

const completeBreakdown = [
  { id: "car", title: "Стоимость автомобиля", amountRub: 1_800_000 },
  { id: "topavto-commission", title: "Комиссия Автодилера", amountRub: 90_000 },
  { id: "broker", title: "Брокер", amountRub: 35_000 },
  { id: "svh", title: "СВХ", amountRub: 35_000 },
  { id: "laboratory", title: "Лаборатория", amountRub: 15_000 },
  { id: "sbkts", title: "СБКТС", amountRub: 35_000 },
  { id: "epts", title: "ЭПТС", amountRub: 35_000 },
  { id: "rf-delivery", title: "Доставка по РФ", amountRub: 120_000 },
  { id: "customs", title: "Таможенные платежи", amountRub: 1_035_000 },
];

function electricOffer(overrides: Partial<VehicleOffer> = {}): VehicleOffer {
  const { calculationSnapshot, ...rest } = overrides;
  return {
    id: "offer_estimated_ev",
    sourceId: "autohome_used_china_open",
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
      customs: { status: "ready", totalCustomsRub: 1_035_000 },
      breakdown: completeBreakdown,
      ...(calculationSnapshot || {}),
    },
    firstSeenAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    operational: { sourceUrl: "https://www.che168.com/123", raw: {} },
    ...rest,
  } as VehicleOffer;
}

test("keeps an EV public while missing certified power remains unresolved", () => {
  const explicitlyMissing = electricOffer();
  const unresolved = electricOffer({
    calculationSnapshot: { pricingConfidence: "estimated", certified30MinutePowerMissing: false, customs: { status: "ready" } },
  });
  assert.equal(isCrediblePublicOffer(explicitlyMissing), true);
  assert.equal(isCrediblePublicOffer(unresolved), true);
  assert.equal(catalogPowerDisplay(explicitlyMissing), null);
  assert.equal(catalogPowerDisplay(unresolved), null);
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
    calculationSnapshot: { pricingConfidence: "exact", certified30MinutePowerMissing: false, customs: { status: "ready" } },
  })), true);
});