import test from "node:test";
import assert from "node:assert/strict";
import { catalogPowerDisplay } from "../apps/web/lib/catalog/power-display";

test("shows certified 30-minute power for a pure electric vehicle", () => {
  const result = catalogPowerDisplay({
    powertrainKind: "electric",
    power30MinKw: 65,
    utilizationPowerKw: 65,
  });

  assert.ok(result);
  assert.equal(result.thirtyMinutePowerKw, 65);
  assert.equal(result.thirtyMinuteLabel, "30 мин: 65 кВт");
  assert.equal(result.utilizationLabel, undefined);
  assert.equal(result.estimated, false);
});

test("shows each traction motor and their 30-minute sum", () => {
  const result = catalogPowerDisplay({
    powertrainKind: "electric",
    power30MinKwByMotor: [35.5, 42.25],
    utilizationPowerKw: 77.75,
  });

  assert.ok(result);
  assert.equal(result.thirtyMinutePowerKw, 77.75);
  assert.equal(result.thirtyMinuteLabel, "30 мин: 35,5 + 42,25 = 77,75 кВт");
});

test("shows separate utilization power for a non-series hybrid", () => {
  const result = catalogPowerDisplay({
    powertrainKind: "other_hybrid",
    power30MinKw: 50,
    utilizationPowerKw: 130,
  });

  assert.ok(result);
  assert.equal(result.thirtyMinuteLabel, "30 мин: 50 кВт");
  assert.equal(result.utilizationLabel, "Для утиля: 130 кВт");
});

test("does not present calculated customs power as certified 30-minute power", () => {
  const result = catalogPowerDisplay({
    powertrainKind: "series_hybrid",
    calculationSnapshot: { customs: { utilizationPowerKw: 58.84 } },
  });

  assert.equal(result, null);
});

test("does not show preliminary customs power in the certified power slot", () => {
  const result = catalogPowerDisplay({
    powertrainKind: "electric",
    calculationSnapshot: {
      certified30MinutePowerMissing: true,
      customs: { utilizationPowerKw: 110 },
    },
  });

  assert.equal(result, null);
});

test("does not derive certified 30-minute power from legacy peak horsepower", () => {
  const result = catalogPowerDisplay({
    powertrainKind: "electric",
    fuel: "electric",
    powerHp: 340,
  });

  assert.equal(result, null);
});
