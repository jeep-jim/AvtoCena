import assert from "node:assert/strict";
import test from "node:test";
import { calculateRussiaCustomsForIndividual } from "../packages/engine/src/calculation/russiaCustoms";

const importedAt = new Date("2026-07-01T00:00:00.000Z");

test("calculates a 3 to 5 year old petrol car", () => {
  const result = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    engineCc: 2_000,
    powerHp: 150,
    productionDate: "2022-07",
    fuel: "petrol",
    importedAt,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.ageBand, "from_3_to_5_years");
  assert.equal(result.customsClearanceFeeRub, 8_530);
  assert.equal(result.importDutyRub, 540_000);
  assert.equal(result.utilizationFeeRub, 5_200);
  assert.equal(result.totalCustomsRub, 553_730);
});

test("calculates a vehicle up to three years old", () => {
  const result = calculateRussiaCustomsForIndividual({
    customsValueRub: 1_000_000,
    eurRateRub: 100,
    engineCc: 1_500,
    powerHp: 120,
    productionDate: "2025-07",
    fuel: "petrol",
    importedAt,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.ageBand, "up_to_3_years");
  assert.equal(result.importDutyRub, 525_000);
  assert.equal(result.utilizationFeeRub, 3_400);
  assert.equal(result.totalCustomsRub, 531_500);
});

test("uses the conservative maximum when production month is absent", () => {
  const result = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    engineCc: 1_500,
    powerHp: 150,
    year: 2023,
    fuel: "petrol",
    importedAt,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.ageEstimated, true);
  assert.deepEqual(result.possibleAgeBands, ["from_3_to_5_years", "up_to_3_years"]);
  assert.equal(result.ageBand, "up_to_3_years");
  assert.equal(result.importDutyRub, 960_000);
  assert.equal(result.totalCustomsRub, 971_930);
});

test("does not publish a complete customs price without power", () => {
  const result = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    engineCc: 2_000,
    productionDate: "2022-07",
    fuel: "petrol",
    importedAt,
  });

  assert.equal(result.status, "needs_data");
  assert.equal(result.totalCustomsRub, undefined);
  assert.ok(result.missing.includes("power_hp"));
});

test("marks cars above 160 hp for the full utilization coefficient", () => {
  const result = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    engineCc: 2_000,
    powerHp: 161,
    productionDate: "2022-07",
    fuel: "petrol",
    importedAt,
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.totalCustomsRub, undefined);
  assert.ok(result.missing.includes("full_utilization_coefficient"));
});
