import assert from "node:assert/strict";
import test from "node:test";
import { needsSourceDetailFactRefresh } from "../apps/web/lib/catalog/importer-impl";
import type { VehicleOffer } from "../apps/web/lib/catalog/types";

function offer(overrides: Partial<VehicleOffer> = {}) {
  return {
    sourceId: "autopapa_georgia_open",
    sourceOfferId: "932906",
    market: "georgia",
    powertrainKind: "combustion",
    calculationStatus: "preliminary_power_pending",
    powerHp: undefined,
    ...overrides,
  } as VehicleOffer;
}

test("existing AutoPapa combustion preliminary rows force an exact detail refresh even with a complete gallery", () => {
  assert.equal(needsSourceDetailFactRefresh(offer({ images: Array.from({ length: 30 }) as any })), true);
});

test("AutoPapa combustion rows with missing power still request exact detail facts", () => {
  assert.equal(needsSourceDetailFactRefresh(offer({ calculationStatus: "estimated", powerHp: undefined })), true);
});

test("already powered AutoPapa rows still refresh the live asking price", () => {
  assert.equal(needsSourceDetailFactRefresh(offer({ calculationStatus: "estimated", powerHp: 147 })), true);
});

test("electrified AutoPapa rows refresh price without treating peak power as certified power", () => {
  for (const powertrainKind of ["electric", "series_hybrid", "other_hybrid"] as const) {
    const row = offer({ powertrainKind });
    assert.equal(needsSourceDetailFactRefresh(row), true);
    assert.equal(row.power30MinKw, undefined);
  }
});

test("the AutoPapa-specific detail refresh gate cannot affect another source", () => {
  assert.equal(needsSourceDetailFactRefresh(offer({ sourceId: "myauto_georgia_open" })), false);
});
