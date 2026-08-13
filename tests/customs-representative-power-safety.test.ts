import assert from "node:assert/strict";
import test from "node:test";
import { discardRepresentativeModelPowerForCustoms } from "../apps/web/lib/catalog/customs-pricing";
import type { VehicleOffer } from "../apps/web/lib/catalog/types";

function offer(overrides: Partial<VehicleOffer> = {}): VehicleOffer {
  return {
    id: "rep-test",
    sourceId: "autopapa_georgia_open",
    sourceOfferId: "954125",
    market: "georgia",
    offerType: "fixed",
    status: "active",
    make: "Toyota",
    model: "Corolla",
    year: 2026,
    engineCc: 2000,
    fuel: "petrol",
    mileageKm: 1000,
    sourcePrice: 15_000,
    sourceCurrency: "USD",
    priceMode: "fixed",
    images: [],
    calculationStatus: "needs_data",
    firstSeenAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    operational: {},
    ...overrides,
  };
}

test("model-wide representative horsepower is not eligible for customs", () => {
  const result = discardRepresentativeModelPowerForCustoms(offer({
    powerHp: 94,
    powerKw: 69.14,
    powerDataConfidence: "estimated",
    powerDataSource: "vehicle-model-representative:toyota/corolla",
  }));
  assert.equal(result.powerHp, undefined);
  assert.equal(result.powerKw, undefined);
  assert.equal(result.powerDataConfidence, undefined);
  assert.equal(result.powerDataSource, undefined);
  assert.equal(result.engineCc, 2000);
});

test("exact and variant-bound horsepower remains eligible for customs", () => {
  const exact = discardRepresentativeModelPowerForCustoms(offer({
    powerHp: 155,
    powerKw: 114,
    powerDataConfidence: "source_exact",
    powerDataSource: "autopapa-detail:954125",
  }));
  assert.equal(exact.powerHp, 155);
  assert.equal(exact.powerDataSource, "autopapa-detail:954125");

  const variant = discardRepresentativeModelPowerForCustoms(offer({
    powerHp: 155,
    powerKw: 114,
    powerDataConfidence: "reference",
    powerDataSource: "vehicle-knowledge:drom_557278549f95be08442f2b86",
  }));
  assert.equal(variant.powerHp, 155);
  assert.equal(variant.powerDataSource, "vehicle-knowledge:drom_557278549f95be08442f2b86");
});
