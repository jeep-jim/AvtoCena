import assert from "node:assert/strict";
import test from "node:test";
import {
  autoPapaExactPrimaryVin,
  validatedVpicCombustionPowerHp,
  type VpicPowerCandidate,
} from "../apps/web/lib/catalog/georgia-vpic-power-recovery";
import type { VehicleOffer } from "../apps/web/lib/catalog/types";

function offer(overrides: Partial<VehicleOffer> = {}) {
  return {
    sourceId: "autopapa_georgia_open",
    sourceOfferId: "913963",
    market: "georgia",
    make: "Kia",
    model: "Sorento",
    year: 2021,
    engineCc: 2500,
    fuel: "petrol",
    powertrainKind: "combustion",
    ...overrides,
  } as VehicleOffer;
}

function decoded(overrides: Partial<VpicPowerCandidate> = {}): VpicPowerCandidate {
  return {
    make: "KIA",
    model: "Sorento",
    modelYear: 2021,
    displacementL: 2.5,
    engineHp: 191.3,
    fuelTypePrimary: "Gasoline",
    errorCode: "0",
    ...overrides,
  };
}

test("AutoPapa primary VIN parser only accepts one VIN from the exact facts block", () => {
  const markup = `
    <div>Body Type: suv VIN: 5XYRK4LF0MG067107 Engine Vol: 2.5 l Power:</div>
    <div>Car description</div>
    <div>Recommendation VIN: 5NPEH4AF1PH275628</div>
  `;
  assert.equal(autoPapaExactPrimaryVin(markup), "5XYRK4LF0MG067107");
});

test("AutoPapa primary VIN parser rejects ambiguous exact facts", () => {
  const markup = `<div>Body Type: suv VIN 5XYRK4LF0MG067107 alternate 5NPEH4AF1PH275628 Car description</div>`;
  assert.equal(autoPapaExactPrimaryVin(markup), null);
});

test("strict vPIC match accepts exact combustion horsepower", () => {
  assert.equal(validatedVpicCombustionPowerHp(offer(), decoded()), 191.3);
});

test("strict vPIC match rejects wrong year, model, make or displacement", () => {
  assert.equal(validatedVpicCombustionPowerHp(offer(), decoded({ modelYear: 2022 })), null);
  assert.equal(validatedVpicCombustionPowerHp(offer(), decoded({ model: "Sportage" })), null);
  assert.equal(validatedVpicCombustionPowerHp(offer(), decoded({ make: "Hyundai" })), null);
  assert.equal(validatedVpicCombustionPowerHp(offer(), decoded({ displacementL: 3.3 })), null);
});

test("strict vPIC match rejects missing horsepower, decode errors and electrified fuels", () => {
  assert.equal(validatedVpicCombustionPowerHp(offer(), decoded({ engineHp: null })), null);
  assert.equal(validatedVpicCombustionPowerHp(offer(), decoded({ errorCode: "6" })), null);
  assert.equal(validatedVpicCombustionPowerHp(offer(), decoded({ fuelTypePrimary: "Electric" })), null);
  assert.equal(validatedVpicCombustionPowerHp(offer({ powertrainKind: "other_hybrid" }), decoded()), null);
});
