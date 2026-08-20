import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateRussiaCustomsForIndividual,
  certifiedElectricExcisePowerKw,
  customsClearanceFeeRub,
  legalProductionReference,
  utilizationCoefficient2026,
  utilizationPowerKwForInput,
} from "../packages/engine/src/calculation/russiaCustomsV2";

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
  assert.equal(result.productionReferenceDate, "2022-07-15");
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

test("year-only production uses the legal 1 July reference date", () => {
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
  assert.equal(result.ageEstimated, false);
  assert.deepEqual(result.possibleAgeBands, ["up_to_3_years"]);
  assert.equal(result.productionReferenceDate, "2023-07-01");
  assert.equal(result.productionReferenceBasis, "year_midpoint");
  assert.equal(result.ageBand, "up_to_3_years");
  assert.equal(result.importDutyRub, 960_000);
  assert.equal(result.totalCustomsRub, 976_941);
});

test("month-only production uses the 15th and crosses the three-year boundary by date", () => {
  const august = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    engineCc: 1_500,
    powerHp: 150,
    productionDate: "2023-08",
    fuel: "petrol",
    importedAt: new Date("2026-08-20T00:00:00Z"),
  });
  const september = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    engineCc: 1_500,
    powerHp: 150,
    productionDate: "2023-09",
    fuel: "petrol",
    importedAt: new Date("2026-08-20T00:00:00Z"),
  });
  assert.equal(august.productionReferenceDate, "2023-08-15");
  assert.equal(august.ageBand, "from_3_to_5_years");
  assert.equal(august.importDutyRub, 255_000);
  assert.equal(august.totalCustomsRub, 273_741);
  assert.equal(september.productionReferenceDate, "2023-09-15");
  assert.equal(september.ageBand, "up_to_3_years");
  assert.equal(september.importDutyRub, 960_000);
  assert.equal(september.totalCustomsRub, 976_941);
});

test("exact production dates keep the three-year anniversary in the young band", () => {
  const onAnniversary = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    engineCc: 1_500,
    powerHp: 150,
    productionDate: "2023-08-15",
    fuel: "petrol",
    importedAt: new Date("2026-08-15T23:59:59Z"),
  });
  const nextDay = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    engineCc: 1_500,
    powerHp: 150,
    productionDate: "2023-08-15",
    fuel: "petrol",
    importedAt: new Date("2026-08-16T00:00:00Z"),
  });
  assert.equal(onAnniversary.ageBand, "up_to_3_years");
  assert.equal(nextDay.ageBand, "from_3_to_5_years");
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

test("pure EV excise uses certified 30-minute power, never peak power", () => {
  assert.equal(certifiedElectricExcisePowerKw({
    customsValueRub: 1,
    eurRateRub: 1,
    powertrainKind: "electric",
    powerKw: 300,
    power30MinKw: 90,
  }), 90);
  const result = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    powertrainKind: "electric",
    powerKw: 300,
    powerHp: 408,
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

test("pure EV peak power alone cannot produce an exact excise or utilization fee", () => {
  const result = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    powertrainKind: "electric",
    powerKw: 300,
    powerHp: 408,
    productionDate: "2026-01",
    importedAt,
  });
  assert.equal(result.status, "needs_data");
  assert.equal(result.totalCustomsRub, undefined);
  assert.ok(result.missing.includes("certified_30_minute_power_kw"));
  assert.ok(result.missing.includes("electric_excise_power_kw"));
  assert.equal(result.importDutyRub, 300_000);
  assert.equal(result.exciseRub, 0);
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

test("N1 and unclassified pickups fail closed instead of receiving an M1 tariff", () => {
  const n1 = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    engineCc: 2_800,
    powerHp: 200,
    productionDate: "2025-01",
    vehicleCategory: "N1",
    tnVedCode: "8704 21",
    bodyType: "pickup",
    importedAt,
  });
  const unknownPickup = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    engineCc: 2_800,
    powerHp: 200,
    productionDate: "2025-01",
    bodyType: "pickup",
    importedAt,
  });
  assert.equal(n1.status, "needs_data");
  assert.equal(n1.totalCustomsRub, undefined);
  assert.ok(n1.missing.includes("n1_customs_tariff"));
  assert.equal(unknownPickup.vehicleCategory, "unknown");
  assert.equal(unknownPickup.totalCustomsRub, undefined);
  assert.ok(unknownPickup.missing.includes("vehicle_category"));
});

test("personal-use privilege is explicit in the result and can be disabled", () => {
  const assumed = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    engineCc: 2_000,
    powerHp: 150,
    productionDate: "2022-07",
    fuel: "petrol",
    importedAt,
  });
  const ineligible = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    engineCc: 2_000,
    powerHp: 150,
    productionDate: "2022-07",
    fuel: "petrol",
    personalUseEligible: false,
    vehicleCategory: "M1",
    importedAt,
  });
  assert.equal(assumed.personalUseAssumed, true);
  assert.equal(assumed.vehicleCategoryAssumed, true);
  assert.equal(assumed.utilizationFeeRub, 5_200);
  assert.match(assumed.warnings.join(" "), /льготный утильсбор/i);
  assert.equal(ineligible.personalUseAssumed, false);
  assert.equal(ineligible.vehicleCategoryAssumed, false);
  assert.equal(ineligible.utilizationCoefficient, 77.48);
  assert.equal(ineligible.utilizationFeeRub, 1_549_600);
});

test("legal production reference accepts exact, month-only and year-only source values", () => {
  assert.deepEqual(legalProductionReference({ productionDate: "2024-02-29" }), { year: 2024, month: 2, day: 29, basis: "exact_date" });
  assert.deepEqual(legalProductionReference({ productionDate: "2024/02" }), { year: 2024, month: 2, day: 15, basis: "month_midpoint" });
  assert.deepEqual(legalProductionReference({ year: 2024 }), { year: 2024, month: 7, day: 1, basis: "year_midpoint" });
});

test("uses the indexed 2026 customs-clearance tiers", () => {
  assert.equal(customsClearanceFeeRub(200_000), 1_231);
  assert.equal(customsClearanceFeeRub(2_000_000), 13_541);
  assert.equal(customsClearanceFeeRub(11_000_000), 73_860);
});
