import assert from "node:assert/strict";
import test from "node:test";
import { isCatalogOfferBusinessLiquid } from "../apps/web/lib/catalog/offer-quality";
import type { VehicleOffer } from "../apps/web/lib/catalog/types";

function offer(overrides: Partial<VehicleOffer> = {}): VehicleOffer {
  return {
    id: "liquidity-test",
    sourceId: "prestige_japan_exact",
    sourceOfferId: "lot-1",
    market: "japan",
    offerType: "auction_result",
    status: "active",
    make: "Toyota",
    model: "Crown",
    year: new Date().getFullYear() - 7,
    fuel: "petrol",
    powerHp: 200,
    sourcePrice: 1_000_000,
    sourceCurrency: "JPY",
    priceMode: "auction_result",
    images: [],
    calculationStatus: "needs_data",
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    operational: {},
    ...overrides,
  } as VehicleOffer;
}

test("model-wide representative horsepower cannot reject a specific older listing", () => {
  assert.equal(isCatalogOfferBusinessLiquid(offer({
    powerHp: 220,
    powerDataConfidence: "estimated",
    powerDataSource: "vehicle-model-representative:toyota/crown",
  })), true);
});

test("variant-bound high horsepower still applies the older ICE liquidity rule", () => {
  assert.equal(isCatalogOfferBusinessLiquid(offer({
    powerHp: 220,
    powerDataConfidence: "reference",
    powerDataSource: "vehicle-knowledge:drom_variant_220hp",
  })), false);
});

test("source-exact high horsepower still applies the older ICE liquidity rule", () => {
  assert.equal(isCatalogOfferBusinessLiquid(offer({
    powerHp: 220,
    powerDataConfidence: "source_exact",
    powerDataSource: "source:horsepower",
  })), false);
});
