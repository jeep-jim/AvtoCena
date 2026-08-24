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

test("every seen AutoPapa row forces an exact detail refresh because the detail page owns price", () => {
  for (const row of [
    offer({ images: Array.from({ length: 30 }) as any }),
    offer({ calculationStatus: "estimated", powerHp: 147 }),
    offer({ powertrainKind: "electric", calculationStatus: "estimated", powerHp: 204 }),
    offer({ powertrainKind: "other_hybrid", calculationStatus: "estimated", powerHp: 180 }),
  ]) {
    assert.equal(needsSourceDetailFactRefresh(row), true);
  }
});

test("the AutoPapa-specific detail refresh gate cannot affect another source", () => {
  assert.equal(needsSourceDetailFactRefresh(offer({ sourceId: "myauto_georgia_list" })), false);
});
