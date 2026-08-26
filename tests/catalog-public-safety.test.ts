import assert from "node:assert/strict";
import test from "node:test";
import { catalogOfferVisibleRub, findCatalogPriceOutliers } from "../apps/web/lib/catalog/public-priority";
import { hasCredibleOfferContent } from "../apps/web/lib/catalog/offer-quality";

// Regression coverage for the exact public failures reported from production cards.
const priceLines = ["car", "topavto-commission", "broker", "svh", "laboratory", "sbkts", "epts", "rf-delivery", "customs"]
  .map((id) => ({ id, amountRub: 1000 }));

function calculatedOffer(totalRub: number, market = "korea") {
  return {
    totalRub,
    market,
    sourcePrice: 1_500_000,
    sourceCurrency: "RUB",
    powertrainKind: "combustion",
    engineCc: 1_998,
    powerHp: 150,
    calculationStatus: "ready",
    calculationSnapshot: {
      customs: { status: "ready" },
      breakdown: priceLines,
    },
  } as any;
}

function images(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `image-${index}`,
    url: `https://example.com/car-${index}.jpg`,
    objectKey: "",
    checksum: "",
    size: 0,
    mimeType: "image/jpeg",
  }));
}

function sourceOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: "offer-1",
    sourceId: "dongchedi_china_open",
    sourceOfferId: "source-1",
    market: "china",
    status: "active",
    sourceTitle: "Changan CS15 EV",
    make: "Changan",
    model: "CS15 EV",
    year: 2024,
    mileageKm: 10000,
    sourcePrice: 55000,
    sourceCurrency: "CNY",
    images: images(5),
    operational: { sourceUrl: "https://www.dongchedi.com/usedcar/123", raw: {} },
    ...overrides,
  } as any;
}

test("public price requires a complete calculation and enforces the 15M product ceiling", () => {
  assert.equal(catalogOfferVisibleRub(calculatedOffer(3_200_000)), 3_200_000);
  assert.equal(catalogOfferVisibleRub(calculatedOffer(15_000_000)), 15_000_000);
  assert.equal(catalogOfferVisibleRub(calculatedOffer(15_000_001)), 0);
  assert.equal(catalogOfferVisibleRub(calculatedOffer(346_980_250)), 0);
  assert.equal(catalogOfferVisibleRub({ ...calculatedOffer(3_200_000), calculationSnapshot: { customs: { status: "ready" }, breakdown: [] } }), 0);
});

test("compact card projections expose only already validated non-preliminary prices", () => {
  const exactProjection = {
    ...calculatedOffer(3_200_000),
    calculationSnapshot: { pricingConfidence: "estimated" },
    publicVisibleRub: 3_200_000,
    cardProjectionVersion: 1,
  } as any;
  assert.equal(catalogOfferVisibleRub(exactProjection), 3_200_000);
  assert.equal(catalogOfferVisibleRub({ ...exactProjection, calculationStatus: "preliminary_power_pending", calculationSnapshot: { pricingConfidence: "preliminary" } }), 0);
  assert.equal(catalogOfferVisibleRub({ ...exactProjection, engineCc: undefined }), 0);
  assert.equal(catalogOfferVisibleRub({ ...exactProjection, cardProjectionVersion: 2 }), 3_200_000);
});

test("public priority rejects a delivered total eight times the source car price", async () => {
  const { catalogPublicPriority } = await import("../apps/web/lib/catalog/public-priority");
  const base = calculatedOffer(4_000_000) as any;
  base.calculationSnapshot.currencyRate = { sourcePriceRub: 500_000 };
  assert.equal(catalogPublicPriority(base).reason, "total_to_car_price_ratio");
  base.calculationSnapshot.currencyRate.sourcePriceRub = 500_001;
  assert.equal(catalogPublicPriority(base).eligible, true);
});

test("preliminary price is never exposed as a delivered public total", () => {
  const offer = {
    market: "japan",
    powertrainKind: "combustion",
    totalRub: 2_450_000,
    calculationStatus: "preliminary_power_pending",
    calculationSnapshot: {
      pricingConfidence: "preliminary",
      priceIncludesUtilizationFee: false,
      missing: ["utilization_power_kw"],
      customs: { status: "needs_data", knownCustomsRub: 720_000, missing: ["utilization_power_kw"] },
      breakdown: [
        { id: "car", amountRub: 1_200_000 },
        { id: "customs", amountRub: 720_000 },
      ],
    },
  } as any;
  assert.equal(catalogOfferVisibleRub(offer), 0);
  offer.calculationSnapshot.missing = ["engine_cc"];
  offer.calculationSnapshot.customs.missing = ["engine_cc"];
  assert.equal(catalogOfferVisibleRub(offer), 0);
});

test("public priority keeps calculation-critical gaps internal until delivered price is complete", async () => {
  const { catalogPublicPriority } = await import("../apps/web/lib/catalog/public-priority");
  const combustion = {
    ...calculatedOffer(3_200_000),
    sourcePrice: 1_500_000,
    sourceCurrency: "RUB",
  } as any;
  assert.equal(catalogPublicPriority({ ...combustion, engineCc: undefined }).eligible, false);
  assert.equal(catalogPublicPriority({ ...combustion, engineCc: undefined }).reason, "missing_engine_cc");
  assert.equal(catalogPublicPriority({ ...combustion, powerHp: undefined }).eligible, false);
  assert.equal(catalogPublicPriority({ ...combustion, powerHp: undefined }).reason, "missing_power_hp");

  const electric = {
    ...combustion,
    powertrainKind: "electric",
    engineCc: undefined,
    powerHp: 299,
    powerKw: 220,
    power30MinKw: 88,
    utilizationPowerKw: 88,
  };
  assert.equal(catalogPublicPriority(electric).eligible, true);
  assert.equal(catalogPublicPriority({ ...electric, power30MinKw: undefined }).eligible, false);
  assert.equal(catalogPublicPriority({ ...electric, power30MinKw: undefined }).reason, "missing_certified_30min_kw");
  assert.equal(catalogPublicPriority({ ...electric, utilizationPowerKw: undefined }).eligible, false);
  assert.equal(catalogPublicPriority({ ...electric, utilizationPowerKw: undefined }).reason, "missing_utilization_power_kw");

  const hybrid = { ...electric, powertrainKind: "other_hybrid", engineCc: 1_498, icePowerKw: 74 };
  assert.equal(catalogPublicPriority(hybrid).eligible, true);
  assert.equal(catalogPublicPriority({ ...hybrid, icePowerKw: undefined }).eligible, false);
  assert.equal(catalogPublicPriority({ ...hybrid, icePowerKw: undefined }).reason, "missing_ice_power_kw");
});

test("mandatory source offer is hidden until its exact-card photo identity is verified", () => {
  assert.equal(hasCredibleOfferContent(sourceOffer()), false);
  assert.equal(hasCredibleOfferContent(sourceOffer({
    operational: {
      sourceUrl: "https://www.dongchedi.com/usedcar/123",
      photoIdentityVerified: true,
      raw: { detailIdentityVerified: true },
    },
  })), true);
});

test("JPAuc may publish its verified three source photos", () => {
  const offer = sourceOffer({
    sourceId: "jpauc_japan_past_open",
    market: "japan",
    sourceCurrency: "JPY",
    sourcePrice: 2_600_000,
    images: images(3),
    operational: {
      sourceUrl: "https://jpauc.com/auction/past/detail/123",
      photoIdentityVerified: true,
      raw: { detailIdentityVerified: true },
    },
  });
  assert.equal(hasCredibleOfferContent(offer), true);
});

test("same-model peer median rejects a tenfold price parse without hiding legitimate peers", () => {
  const fordEverest = [
    ["everest-1", 1_251_986],
    ["everest-2", 1_304_265],
    ["everest-3", 1_384_049],
    ["everest-4", 1_428_965],
    ["everest-bad", 14_800_816],
  ].map(([id, totalRub]) => ({
    ...calculatedOffer(Number(totalRub), "uae"),
    id,
    make: "Ford",
    model: "Everest",
    year: 2024,
    priceMode: "fixed",
    powertrainKind: "combustion",
  }));
  const outliers = findCatalogPriceOutliers(fordEverest);
  assert.equal(outliers.length, 1);
  assert.equal(outliers[0].id, "everest-bad");
  assert.equal(outliers[0].direction, "above");
  assert.equal(outliers[0].peerCount, 4);
  assert.ok(outliers[0].ratioToMedian > 10);
});

test("price comparison keeps auction starts separate from fixed-price listings", () => {
  const fixed = [7_000_000, 7_300_000, 7_600_000, 7_900_000].map((totalRub, index) => ({
    ...calculatedOffer(totalRub, "japan"),
    id: `fixed-${index}`,
    make: "Toyota",
    model: "Land Cruiser",
    year: 2024,
    priceMode: "fixed",
    powertrainKind: "combustion",
  }));
  const auction = {
    ...calculatedOffer(900_000, "japan"),
    id: "auction-start",
    make: "Toyota",
    model: "Land Cruiser",
    year: 2024,
    priceMode: "auction_start",
    powertrainKind: "combustion",
  };
  assert.deepEqual(findCatalogPriceOutliers([...fixed, auction]), []);
});
