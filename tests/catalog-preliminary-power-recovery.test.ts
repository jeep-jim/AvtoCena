import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  isPreliminaryElectrifiedCalculation,
  isPreliminaryPowerPendingCalculation,
} from "../apps/web/lib/catalog/customs-pricing";

const publisher = fs.readFileSync(new URL("../scripts/catalog-live-recovery-publish-batch.mjs", import.meta.url), "utf8");

function preliminary(powertrainKind: string) {
  return {
    powertrainKind,
    totalRub: 2_500_000,
    calculationStatus: "preliminary_power_pending",
    calculationSnapshot: {
      pricingConfidence: "preliminary",
      priceIncludesUtilizationFee: false,
      missing: ["utilization_power_kw"],
      customs: { status: "needs_data", missing: ["utilization_power_kw"] },
    },
  } as any;
}

test("recovery accepts documented lower-bound combustion pricing without classifying it as electrified", () => {
  const offer = preliminary("combustion");
  assert.equal(isPreliminaryPowerPendingCalculation(offer), true);
  assert.equal(isPreliminaryElectrifiedCalculation(offer), false);
});

test("preliminary recovery rejects non-power gaps", () => {
  const offer = preliminary("combustion");
  offer.calculationSnapshot.missing = ["engine_cc"];
  offer.calculationSnapshot.customs.missing = ["engine_cc"];
  assert.equal(isPreliminaryPowerPendingCalculation(offer), false);
});


test("atomic recovery publisher accepts the same preliminary power contract", () => {
  assert.match(publisher, /isPreliminaryPowerPendingCalculation/);
  assert.doesNotMatch(publisher, /isPreliminaryElectrifiedCalculation/);
});
