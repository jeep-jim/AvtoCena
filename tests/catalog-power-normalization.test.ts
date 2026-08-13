import assert from "node:assert/strict";
import test from "node:test";
import { preferExplicitCombustionPowertrain } from "../apps/web/lib/catalog/powertrain-safety";
import { normalizeVehicleOfferSpecs } from "../apps/web/lib/catalog/spec-normalization";

test("extracts structured peak kW without treating it as 30-minute power", () => {
  const normalized = normalizeVehicleOfferSpecs({ make: "Example", model: "EV", operational: { raw: { specification: { maxPowerKw: 150 } } } });
  assert.equal(normalized.powerKw, 150);
  assert.equal(normalized.powerHp, 203.94);
  assert.equal(normalized.power30MinKw, undefined);
  assert.equal(normalized.utilizationPowerKw, undefined);
});

test("sums documented 30-minute power for multiple traction motors", () => {
  const normalized = normalizeVehicleOfferSpecs({ make: "Example", model: "Dual Motor EV", powertrainKind: "electric" as const, power30MinKwByMotor: [40, 35], powerDataSource: "EPTS" });
  assert.deepEqual(normalized.power30MinKwByMotor, [40, 35]);
  assert.equal(normalized.power30MinKw, 75);
  assert.equal(normalized.utilizationPowerKw, 75);
  assert.equal(normalized.powerDataConfidence, "documented");
});

test("adds ICE and documented motor power for a non-series hybrid", () => {
  const normalized = normalizeVehicleOfferSpecs({ make: "Example", model: "PHEV", powertrainKind: "other_hybrid" as const, icePowerKw: 110, power30MinKwByMotor: [30, 25] });
  assert.equal(normalized.power30MinKw, 55);
  assert.equal(normalized.utilizationPowerKw, 165);
});

test("extracts exact 30-minute power from structured source fields", () => {
  const normalized = normalizeVehicleOfferSpecs({ make: "Example", model: "EV", powertrainKind: "electric" as const, operational: { raw: { certification: { maximum30MinutePowerKw: 72 } } } });
  assert.equal(normalized.power30MinKw, 72);
  assert.equal(normalized.utilizationPowerKw, 72);
  assert.equal(normalized.powerDataConfidence, "source_exact");
});

test("extracts exact 30-minute power from source text", () => {
  const normalized = normalizeVehicleOfferSpecs({ make: "Example", model: "EV", powertrainKind: "electric" as const, operational: { raw: { specs: "Maximum 30-minute power: 68 kW" } } });
  assert.equal(normalized.power30MinKw, 68);
  assert.equal(normalized.utilizationPowerKw, 68);
});

test("extracts Russian horsepower unit", () => {
  assert.equal(normalizeVehicleOfferSpecs({ trim: "Мощность 190 л.с." }).powerHp, 190);
});

test("extracts Chinese power unit", () => {
  assert.equal(normalizeVehicleOfferSpecs({ operational: { raw: { specs: "最大功率 150 kW" } } }).powerHp, 203.94);
});

test("extracts Georgian horsepower unit", () => {
  assert.equal(normalizeVehicleOfferSpecs({ operational: { raw: { specs: "სიმძლავრე 190 ცხენის ძალა" } } }).powerHp, 190);
});

test("extracts engine volume from nested raw details", () => {
  const normalized = normalizeVehicleOfferSpecs({ operational: { raw: { technical: { engine_capacity: "1.5 L" } } } });
  assert.equal(normalized.engineCc, 1500);
});

test("explicit petrol engine overrides unrelated hybrid text in raw listing payload", () => {
  const normalized = normalizeVehicleOfferSpecs({
    make: "Toyota",
    model: "RAV4",
    fuel: "petrol",
    engineCc: 2500,
    powerHp: 203,
    operational: { raw: { imageUrl: "https://cdn.example/hybrid/recommendation/photo.jpg" } },
  });
  assert.equal(normalized.powertrainKind, "combustion");
  const safe = preferExplicitCombustionPowertrain(normalized);
  assert.equal(safe.powertrainKind, "combustion");
  assert.equal(safe.power30MinKw, undefined);
  assert.equal(safe.utilizationPowerKw, safe.powerKw);
});

test("explicit hybrid title is never downgraded to combustion", () => {
  const safe = preferExplicitCombustionPowertrain({
    make: "Toyota",
    model: "RAV4",
    trim: "2.5 Plug-in Hybrid",
    fuel: "petrol",
    engineCc: 2500,
    powertrainKind: "other_hybrid" as const,
  });
  assert.equal(safe.powertrainKind, "other_hybrid");
});

test("pure EV drops impossible engine displacement before customs", () => {
  const normalized = normalizeVehicleOfferSpecs({
    make: "Hyundai",
    model: "Casper Electric",
    fuel: "electric",
    powertrainKind: "electric" as const,
    engineCc: 3000,
    operational: { raw: { recommendation: { displacement: 3000 } } },
  });
  const safe = preferExplicitCombustionPowertrain(normalized);
  assert.equal(safe.powertrainKind, "electric");
  assert.equal(safe.engineCc, undefined);
  assert.equal((safe.operational?.raw as any)?.powertrainSafety?.reason, "pure_ev_cannot_have_engine_displacement");
  assert.equal((safe.operational?.raw as any)?.powertrainSafety?.rejectedEngineCc, 3000);
});

test("real combustion displacement above 3000 cc is preserved exactly", () => {
  const safe = preferExplicitCombustionPowertrain({
    make: "Kia",
    model: "K9",
    trim: "3.3 GDI AWD",
    fuel: "petrol",
    engineCc: 3342,
    powerHp: 370,
    powertrainKind: "combustion" as const,
  });
  assert.equal(safe.engineCc, 3342);
  assert.equal(safe.powertrainKind, "combustion");
});
