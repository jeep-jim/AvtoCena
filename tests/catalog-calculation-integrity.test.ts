import assert from "node:assert/strict";
import test from "node:test";
import { calculateAvtocenaFromBusinessConfig } from "../packages/engine/src/calculation/calculateAvtocena";
import { calculateRussiaCustomsForIndividual } from "../packages/engine/src/calculation/russiaCustoms";

const importedAt = new Date("2026-07-26T00:00:00.000Z");

test("security deposit is shown but does not increase the full vehicle price twice", () => {
  const result = calculateAvtocenaFromBusinessConfig({
    marketId: "china",
    sourcePriceRub: 1_000_000,
    customsRub: 500_000,
    marketConfig: {
      id: "china-test",
      securityDepositRub: 160_000,
      topAvtoCommissionRub: 90_000,
    },
  });

  assert.equal(result.totalRub, 1_590_000);
  assert.equal(result.breakdown.find((line) => line.id === "car")?.amountRub, 840_000);
  assert.equal(result.breakdown.find((line) => line.id === "security-deposit")?.amountRub, 160_000);
  assert.match(result.breakdown.find((line) => line.id === "security-deposit")?.note || "", /Засчитывается/);
});

test("Japan first payment keeps 31k deposit plus 39k commission without double counting", () => {
  const result = calculateAvtocenaFromBusinessConfig({
    marketId: "japan",
    sourcePriceRub: 900_000,
    customsRub: 400_000,
    marketConfig: {
      id: "japan-test",
      securityDepositRub: 31_000,
      topAvtoCommissionRub: 39_000,
    },
  });

  assert.equal(result.totalRub, 1_339_000);
  assert.equal(
    (result.breakdown.find((line) => line.id === "security-deposit")?.amountRub || 0)
      + (result.breakdown.find((line) => line.id === "topavto-commission")?.amountRub || 0),
    70_000,
  );
});

test("customs duty and utilization fee are separate lines without changing the total", () => {
  const result = calculateAvtocenaFromBusinessConfig({
    marketId: "korea",
    sourcePriceRub: 1_000_000,
    customsRub: 420_000,
    utilizationFeeRub: 131_040,
    marketConfig: { id: "korea-split-customs" },
  });

  assert.equal(result.totalRub, 1_551_040);
  assert.deepEqual(
    result.breakdown
      .filter((line) => line.id === "customs" || line.id === "utilization-fee")
      .map((line) => [line.id, line.title, line.amountRub]),
    [
      ["customs", "Таможенная пошлина", 420_000],
      ["utilization-fee", "Утилизационный сбор", 131_040],
    ],
  );
});

test("pure EV is incomplete when only peak power is known", () => {
  const result = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    powertrainKind: "electric",
    powerKw: 180,
    productionDate: "2026-01",
    importedAt,
  });

  assert.equal(result.status, "needs_data");
  assert.equal(result.totalCustomsRub, undefined);
  assert.ok(result.missing.includes("certified_30_minute_power_kw"));
});

test("parallel hybrid is incomplete without documented motor 30-minute power", () => {
  const result = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    engineCc: 1_500,
    powertrainKind: "other_hybrid",
    icePowerKw: 110,
    powerKw: 230,
    productionDate: "2025-01",
    importedAt,
  });

  assert.equal(result.status, "needs_data");
  assert.equal(result.totalCustomsRub, undefined);
  assert.ok(result.missing.includes("utilization_power_kw"));
});

test("parallel hybrid uses ICE plus documented traction-motor 30-minute power", () => {
  const result = calculateRussiaCustomsForIndividual({
    customsValueRub: 2_000_000,
    eurRateRub: 100,
    engineCc: 1_500,
    powertrainKind: "other_hybrid",
    icePowerKw: 110,
    power30MinKwByMotor: [30, 25],
    productionDate: "2025-01",
    importedAt,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.utilizationPowerKw, 165);
});
