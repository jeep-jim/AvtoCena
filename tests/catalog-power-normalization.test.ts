import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVehicleOfferSpecs } from "../apps/web/lib/catalog/spec-normalization";

test("extracts structured kW and derives horsepower", () => {
  const normalized = normalizeVehicleOfferSpecs({
    make: "Example",
    model: "EV",
    operational: { raw: { specification: { maxPowerKw: 150 } } },
  });

  assert.equal(normalized.powerKw, 150);
  assert.equal(normalized.powerHp, 204);
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
