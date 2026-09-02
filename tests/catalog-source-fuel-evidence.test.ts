import assert from "node:assert/strict";
import test from "node:test";
import { extractEncarExactFuel } from "../apps/web/lib/catalog/encar-complete-source";
import { catalogSemanticEvidenceRejectionReason } from "../apps/web/lib/catalog/offer-quality";
import { canonicalSourceFuel } from "../apps/web/lib/catalog/powertrain-safety";
import { normalizeVehicleOfferSpecs } from "../apps/web/lib/catalog/spec-normalization";

const sixMarketHybridLabels = [
  ["korea", "가솔린 + 전기"],
  ["china", "汽油 + 电动"],
  ["japan", "ガソリン + 電気"],
  ["uae", "Petrol + Electricity"],
  ["europe", "Benzin / Elektro"],
  ["georgia", "ბენზინი + ელექტრო"],
] as const;

for (const [market, label] of sixMarketHybridLabels) {
  test(`${market} combustion plus electricity is normalized as hybrid`, () => {
    assert.equal(canonicalSourceFuel(label), "hybrid");
    const offer = normalizeVehicleOfferSpecs({ market, make: "Example", model: "Exact source vehicle", fuel: label, engineCc: 1580 });
    assert.equal(offer.fuel, "hybrid");
    assert.equal(offer.powertrainKind, "other_hybrid");
  });
}

test("Encar exact detail joins separate gasoline and electricity evidence", () => {
  const result = extractEncarExactFuel({
    specification: { fuelType: "Gasoline" },
    energy: { fuelTypeName: "Electricity" },
  });
  assert.equal(result.fuel, "hybrid");
  assert.equal(result.status, "exact");
  assert.deepEqual(result.rawValues, ["Gasoline", "Electricity"]);
});

test("Encar exact detail prefers a combined fuel label over an earlier generic value", () => {
  const result = extractEncarExactFuel({
    summary: { fuelType: "Gasoline" },
    vehicle: { fuelName: "Gasoline + Electricity" },
  });
  assert.equal(result.fuel, "hybrid");
  assert.equal(result.status, "exact");
});

test("contradictory combustion fuels fail closed", () => {
  const result = extractEncarExactFuel({ primary: { fuel: "Gasoline" }, secondary: { fuel: "Diesel" } });
  assert.equal(result.fuel, undefined);
  assert.equal(result.status, "conflict");
});

test("publication rejects source semantic conflicts at the common quality gate", () => {
  assert.equal(catalogSemanticEvidenceRejectionReason({
    operational: { semanticEvidence: { fuel: { status: "conflict", rawValues: ["Gasoline", "Diesel"] } } },
  }), "semantic_fuel_conflict");
  assert.equal(catalogSemanticEvidenceRejectionReason({
    operational: { semanticEvidence: { fuel: { status: "exact", rawValues: ["Gasoline + Electricity"] } } },
  }), "");
});
