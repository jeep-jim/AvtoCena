import assert from "node:assert/strict";
import test from "node:test";
import { customsVehicleIdentityEvidence } from "../apps/web/lib/catalog/customs-pricing";
import { calculateRussiaCustomsForIndividual } from "../packages/engine/src/calculation/russiaCustomsV2";

test("customs keeps the original pickup identity after model canonicalization", () => {
  const sourceTitle = customsVehicleIdentityEvidence({
    make: "KGM",
    model: "Rexton Sports Khan",
  }, {
    make: "KGM",
    model: "Rexton",
    bodyType: "suv",
  });

  const result = calculateRussiaCustomsForIndividual({
    customsValueRub: 1_500_000,
    eurRateRub: 95,
    engineCc: 2_157,
    powerHp: 187,
    year: 2021,
    make: "KGM",
    model: "Rexton",
    bodyType: "suv",
    sourceTitle,
  });

  assert.match(sourceTitle, /Rexton Sports Khan/);
  assert.equal(result.status, "needs_data");
  assert.equal(result.vehicleCategory, "unknown");
  assert.ok(result.missing.includes("vehicle_category"));
});

test("customs identity evidence does not invent pickup semantics for an ordinary SUV", () => {
  const sourceTitle = customsVehicleIdentityEvidence({
    make: "KGM",
    model: "Rexton",
    bodyType: "suv",
  }, {
    make: "KGM",
    model: "Rexton",
    bodyType: "suv",
  });

  const result = calculateRussiaCustomsForIndividual({
    customsValueRub: 1_500_000,
    eurRateRub: 95,
    engineCc: 2_157,
    powerHp: 187,
    year: 2021,
    make: "KGM",
    model: "Rexton",
    bodyType: "suv",
    sourceTitle,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.vehicleCategory, "M1");
  assert.equal(result.vehicleCategoryAssumed, true);
});
