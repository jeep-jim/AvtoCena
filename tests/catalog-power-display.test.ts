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

test("uses calculated customs power as fallback for electric vehicles", () => {
  const result = catalogPowerDisplay({
    powertrainKind: "series_hybrid",
    calculationSnapshot: { customs: { utilizationPowerKw: 58.84 } },
  });

  assert.ok(result);
  assert.equal(result.thirtyMinutePowerKw, 58.84);
  assert.equal(result.thirtyMinuteLabel, "30 мин: 58,84 кВт");
});

test("labels preliminary power as an estimate instead of certified 30-minute power", () => {
  const result = catalogPowerDisplay({
    powertrainKind: "electric",
    calculationSnapshot: {
      certified30MinutePowerMissing: true,
      customs: { utilizationPowerKw: 110 },
    },
  });

  assert.ok(result);
  assert.equal(result.thirtyMinutePowerKw, 110);
  assert.equal(result.thirtyMinuteLabel, "Расчёт: 110 кВт");
  assert.equal(result.estimated, true);
  assert.match(result.sourceLabel, /предварительной цены/i);
});
