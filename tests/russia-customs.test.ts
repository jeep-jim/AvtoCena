import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateRussiaCustomsForIndividual,
  customsClearanceFeeRub,
  utilizationCoefficient2026,
  utilizationPowerKwForInput,
} from "../packages/engine/src/calculation/russiaCustoms";

const importedAt = new Date("2026-07-01T00:00:00.000Z");

test("calculates a 3 to 5 year old petrol car for personal use", () => {
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
  assert.equal(result.customsClearanceFeeRub, 13_541);
  assert.equal(result.importDutyRub, 540_000);
  assert.equal(result.utilizationFeeRub, 5_200);
  assert.equal(result.totalCustomsRub, 558_741);
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
  assert.equal(result.totalCustomsRub, 533_324);
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
  assert.equal(result.totalCustomsRub, 976_941);
});

test("does not publish a complete customs price without utilization power", () => {
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
  assert.ok(result.missing.includes("utilization_power_kw"));
});

test("uses the full 2026 coefficient above the personal power threshold", () => {
  const result = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    engineCc: 2_000,
    powerHp: 161,
    productionDate: "2022-07",
    fuel: "petrol",
    importedAt,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.utilizationCoefficient, 74.64);
  assert.equal(result.utilizationFeeRub, 1_492_800);
  assert.equal(result.totalCustomsRub, 2_046_341);
});

test("does not apply the personal ICE privilege above 3000 cc", () => {
  const coefficient = utilizationCoefficient2026({
    powertrainKind: "combustion",
    utilizationPowerKw: 100,
    engineCc: 3_500,
    ageBand: "up_to_3_years",
    personalUseEligible: true,
  });

  assert.equal(coefficient, 129.2);
});

test("sums documented motor powers for electric and hybrid vehicles", () => {
  assert.equal(utilizationPowerKwForInput({
    customsValueRub: 1,
    eurRateRub: 1,
    powertrainKind: "electric",
    power30MinKwByMotor: [40, 35],
  }), 75);

  assert.equal(utilizationPowerKwForInput({
    customsValueRub: 1,
    eurRateRub: 1,
    powertrainKind: "other_hybrid",
    icePowerKw: 110,
    power30MinKwByMotor: [30, 25],
  }), 165);
});

test("calculates a pure EV with 2026 tariff, excise, VAT and utilization fee", () => {
  const result = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    powertrainKind: "electric",
    powerKw: 90,
    power30MinKw: 90,
    productionDate: "2026-01",
    importedAt,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.importDutyRub, 300_000);
  assert.equal(result.exciseRub, 7_560);
  assert.equal(result.vatRub, 507_663);
  assert.equal(result.utilizationCoefficient, 65.88);
  assert.equal(result.utilizationFeeRub, 1_317_600);
  assert.equal(result.totalCustomsRub, 2_146_364);
});

test("uses engine displacement duty for a series hybrid", () => {
  const result = calculateRussiaCustomsForIndividual({
    customsValueRub: 1_000_000,
    eurRateRub: 100,
    engineCc: 1_500,
    powertrainKind: "series_hybrid",
    power30MinKw: 60,
    productionDate: "2026-01",
    importedAt,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.importDutyRub, 525_000);
  assert.equal(result.exciseRub, 0);
  assert.equal(result.vatRub, 0);
  assert.equal(result.utilizationCoefficient, 49.56);
  assert.equal(result.totalCustomsRub, 1_521_124);
});

test("uses the indexed 2026 customs-clearance tiers", () => {
  assert.equal(customsClearanceFeeRub(200_000), 1_231);
  assert.equal(customsClearanceFeeRub(2_000_000), 13_541);
  assert.equal(customsClearanceFeeRub(11_000_000), 73_860);
});
