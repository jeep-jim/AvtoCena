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
  assert.equal(result.utilizationCoefficient, 82.1);
  assert.equal(result.utilizationFeeRub, 1_642_000);
  assert.equal(result.totalCustomsRub, 2_195_541);
});

test("does not apply the personal ICE privilege above 3000 cc", () => {
  const coefficient = utilizationCoefficient2026({
    powertrainKind: "combustion",
    utilizationPowerKw: 100,
    engineCc: 3_500,
    ageBand: "up_to_3_years",
    personalUseEligible: true,
  });
  assert.equal(coefficient, 142.12);
});

test("uses representative 2026 rows for every engine-volume band", () => {
  assert.equal(utilizationCoefficient2026({
    powertrainKind: "combustion", utilizationPowerKw: 150, engineCc: 900,
    ageBand: "over_5_years", personalUseEligible: false,
  }), 32.21);
  assert.equal(utilizationCoefficient2026({
    powertrainKind: "combustion", utilizationPowerKw: 250, engineCc: 1_500,
    ageBand: "up_to_3_years", personalUseEligible: false,
  }), 80.26);
  assert.equal(utilizationCoefficient2026({
    powertrainKind: "combustion", utilizationPowerKw: 300, engineCc: 2_500,
    ageBand: "over_5_years", personalUseEligible: false,
  }), 231.53);
  assert.equal(utilizationCoefficient2026({
    powertrainKind: "combustion", utilizationPowerKw: 350, engineCc: 3_200,
    ageBand: "up_to_3_years", personalUseEligible: false,
  }), 218.46);
  assert.equal(utilizationCoefficient2026({
    powertrainKind: "combustion", utilizationPowerKw: 400, engineCc: 4_000,
    ageBand: "over_5_years", personalUseEligible: false,
  }), 378.71);
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
  assert.equal(result.exciseRub, 7_680);
  assert.equal(result.vatRub, 507_690);
  assert.equal(result.utilizationCoefficient, 72.47);
  assert.equal(result.utilizationFeeRub, 1_449_400);
  assert.equal(result.totalCustomsRub, 2_278_311);
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
  assert.equal(result.utilizationCoefficient, 54.52);
  assert.equal(result.totalCustomsRub, 1_620_324);
});

test("uses the indexed 2026 customs-clearance tiers", () => {
  assert.equal(customsClearanceFeeRub(200_000), 1_231);
  assert.equal(customsClearanceFeeRub(2_000_000), 13_541);
  assert.equal(customsClearanceFeeRub(11_000_000), 73_860);
});
