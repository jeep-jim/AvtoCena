import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  Che168GlobalExactAdapter,
  che168GlobalSpecificationEvidence,
} from "../apps/web/lib/catalog/che168-global-exact-source";
import { catalogSemanticEvidenceRejectionReason } from "../apps/web/lib/catalog/offer-quality";
import { classifySpecificationEvidence } from "../apps/web/lib/catalog/specification-evidence-audit";

const source = new Che168GlobalExactAdapter();

const che168WorkflowPaths = [
  ".github/workflows/catalog-v6-che168-exact-readiness.yml",
  ".github/workflows/catalog-v6-che168-strict-ladder.yml",
];

function listing(overrides: Record<string, unknown> = {}) {
  return {
    infoid: 123456,
    carname: "Toyota Camry 2024 2.0",
    brandname: "Toyota",
    seriesname: "Camry",
    specname: "2024 2.0 Luxury",
    mileage: 12000,
    price: 23000,
    regdate: "2024-01",
    fuelname: "Gasoline",
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    ...listing(),
    engine: "2.0 L 173 hp",
    gearbox: "Automatic",
    drivingmode: "FWD",
    structure: "Sedan",
    catepiclist: [{
      title: "Exterior",
      list: Array.from({ length: 5 }, (_, index) => `https://erscglobal2.autoimg.cn/escimg/auto/2026/1400x0_c42_autohomecar__camry_${index}.jpg`),
    }],
    ...overrides,
  };
}

test("Che168 carinfo accepts one explicit engine and power value", () => {
  const evidence = che168GlobalSpecificationEvidence({
    listingYear: 2024,
    detailYear: 2024,
    listingFuel: "Gasoline",
    detailFuel: "Gasoline",
    detailEngine: "2.0 L 127 kW (173 hp)",
  });
  assert.equal(evidence.fuel.status, "exact");
  assert.equal(evidence.year.status, "exact");
  assert.equal(evidence.fuel.value, "petrol");
  assert.equal(evidence.engineCc.status, "exact");
  assert.equal(evidence.engineCc.value, 2000);
  assert.equal(evidence.powerHp.status, "exact");
  assert.ok(Math.abs(Number(evidence.powerHp.value) - 173) <= 1);
});

test("Che168 never promotes a range or conflicting carinfo values", () => {
  assert.equal(che168GlobalSpecificationEvidence({ detailEngine: "1.5-2.0 L" }).engineCc.status, "ambiguous");
  assert.equal(che168GlobalSpecificationEvidence({ detailEngine: "2.0 L / 2.5 L" }).engineCc.status, "conflict");
  assert.equal(che168GlobalSpecificationEvidence({ detailEngine: "150 hp / 190 hp" }).powerHp.status, "conflict");
  assert.equal(che168GlobalSpecificationEvidence({ listingFuel: "Gasoline", detailFuel: "Diesel" }).fuel.status, "conflict");
  assert.equal(che168GlobalSpecificationEvidence({ listingYear: 2024, detailYear: 2023 }).year.status, "conflict");
});

test("Che168 listing stores classified fuel provenance without inventing detail metrics", () => {
  const offer = source.normalizeOffer(listing());
  assert.ok(offer);
  assert.equal(offer!.fuel, "petrol");
  assert.equal(offer!.powertrainKind, "combustion");
  assert.equal(classifySpecificationEvidence(offer!, "fuelPowertrain").state, "exact");
  assert.equal(classifySpecificationEvidence(offer!, "engineCc").state, "missing");
  assert.equal(classifySpecificationEvidence(offer!, "powerHp").state, "missing");
});

test("Che168 exact carinfo preserves field provenance", async () => {
  const offer = source.normalizeOffer(listing());
  assert.ok(offer);
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ returncode: 0, result: detail() }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  try {
    const images = await source.fetchImages(offer!);
    assert.equal(images.length, 5);
    assert.equal(offer!.engineCc, 2000);
    assert.equal(offer!.powerHp, 173);
    assert.equal(offer!.powerDataConfidence, "source_exact");
    assert.equal(classifySpecificationEvidence(offer!, "fuelPowertrain").state, "exact");
    assert.equal(classifySpecificationEvidence(offer!, "engineCc").state, "exact");
    assert.equal(classifySpecificationEvidence(offer!, "powerHp").state, "exact");
    assert.equal(catalogSemanticEvidenceRejectionReason(offer!), "");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Che168 conflicting carinfo clears calculation fields and fails closed", async () => {
  const offer = source.normalizeOffer(listing());
  assert.ok(offer);
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    returncode: 0,
    result: detail({ fuelname: "Diesel", engine: "2.0 L / 2.5 L 150 hp / 190 hp" }),
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    await source.fetchImages(offer!);
    assert.equal(offer!.fuel, undefined);
    assert.equal(offer!.powertrainKind, "unknown");
    assert.equal(offer!.engineCc, undefined);
    assert.equal(offer!.powerHp, undefined);
    assert.equal(offer!.powerKw, undefined);
    assert.equal(offer!.calculationStatus, "needs_data");
    assert.equal((offer!.operational as any).semanticEvidence.fuel.status, "conflict");
    assert.equal((offer!.operational as any).semanticEvidence.engineCc.status, "conflict");
    assert.equal((offer!.operational as any).semanticEvidence.powerHp.status, "conflict");
    assert.equal(catalogSemanticEvidenceRejectionReason(offer!), "semantic_fuel_conflict");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Che168 workflows validate canonical provenance instead of raw fuel spelling", () => {
  for (const path of che168WorkflowPaths) {
    const workflow = fs.readFileSync(path, "utf8");
    assert.doesNotMatch(workflow, /clean\(offer\.fuel\)\s*!==\s*clean\(detail\.fuelname\)/);
    assert.match(workflow, /fuel_evidence_not_exact/);
    assert.match(workflow, /fuel_not_bound_to_carinfo/);
    assert.match(workflow, /unsafe_engine_promoted/);
    assert.match(workflow, /unsafe_power_promoted/);
  }
});
