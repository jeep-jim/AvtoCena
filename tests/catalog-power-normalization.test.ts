import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVehicleOfferSpecs } from "../apps/web/lib/catalog/spec-normalization";

test("extracts structured peak kW without treating it as 30-minute power", () => {
  const normalized = normalizeVehicleOfferSpecs({
    make: "Example",
    model: "EV",
    operational: { raw: { specification: { maxPowerKw: 150 } } },
  });

  assert.equal(normalized.powerKw, 150);
  assert.equal(normalized.powerHp, 204);
  assert.equal(normalized.power30MinKw, undefined);
  assert.equal(normalized.utilizationPowerKw, undefined);
});

test("sums documented 30-minute power for multiple traction motors", () => {
  const normalized = normalizeVehicleOfferSpecs({
    make: "Example",
    model: "Dual Motor EV",
    powertrainKind: "electric" as const,
    power30MinKwByMotor: [40, 35],
    powerDataSource: "EPTS",
  });

  assert.deepEqual(normalized.power30MinKwByMotor, [40, 35]);
  assert.equal(normalized.power30MinKw, 75);
  assert.equal(normalized.utilizationPowerKw, 75);
  assert.equal(normalized.powerDataConfidence, "documented");
});

test("adds ICE and documented motor power for a non-series hybrid", () => {
  const normalized = normalizeVehicleOfferSpecs({
    make: "Example",
    model: "PHEV",
    powertrainKind: "other_hybrid" as const,
    icePowerKw: 110,
    power30MinKwByMotor: [30, 25],
  });

  assert.equal(normalized.power30MinKw, 55);
  assert.equal(normalized.utilizationPowerKw, 165);
});

test("extracts exact 30-minute power from structured source fields", () => {
  const normalized = normalizeVehicleOfferSpecs({
    make: "Example",
    model: "EV",
    powertrainKind: "electric" as const,
    operational: { raw: { certification: { maximum30MinutePowerKw: 72 } } },
  });

  assert.equal(normalized.power30MinKw, 72);
  assert.equal(normalized.utilizationPowerKw, 72);
  assert.equal(normalized.powerDataConfidence, "source_exact");
});

test("extracts exact 30-minute power from source text", () => {
  const normalized = normalizeVehicleOfferSpecs({
    make: "Example",
    model: "EV",
    powertrainKind: "electric" as const,
    operational: { raw: { specs: "Maximum 30-minute power: 68 kW" } },
  });

  assert.equal(normalized.power30MinKw, 68);
  assert.equal(normalized.utilizationPowerKw, 68);
});

test("extracts Russian, Chinese and Georgian power units", () => {
  assert.equal(normalizeVehicleOfferSpecs({ trim: "Мощность 190 л.с." }).powerHp, 190);
  assert.equal(normalizeVehicleOfferSpecs({ operational: { raw: { specs: "最大功率 150 kW" } } }).powerHp, 204);
  assert.equal(normalizeVehicleOfferSpecs({ operational: { raw: { specs: "სიმძლავრე 190 ცხ.ძ." } } }).powerHp, 190);
});

test("extracts engine volume from nested raw details", () => {
  const normalized = normalizeVehicleOfferSpecs({
    operational: { raw: { technical: { engine_capacity: "1.5 L" } } },
  });

  assert.equal(normalized.engineCc, 1500);
});
