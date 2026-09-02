import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  classifySpecificationEvidence,
  isElectrifiedSpecification,
} from "../apps/web/lib/catalog/specification-evidence-audit";

const script = fs.readFileSync(new URL("../scripts/catalog-audit-source-specifications.mjs", import.meta.url), "utf8");

test("source specification audit is read-only and covers the canonical 17 sources", () => {
  assert.match(script, /REQUIRED_CATALOG_SOURCES/);
  assert.match(script, /PUBLIC_CATALOG_MARKETS/);
  assert.match(script, /storage\.listObjects\(CANDIDATE_PREFIX\)/);
  assert.match(script, /writes: false/);
  assert.doesNotMatch(script, /writeDataJson|replaceChunkedDataJson|persistCatalogOffers/);
});

test("valid source specifications classify as exact", () => {
  const offer = {
    year: 2023,
    fuel: "petrol",
    powertrainKind: "combustion",
    engineCc: 1498,
    powerHp: 150,
    powerDataConfidence: "source_exact",
    powerDataSource: "source:detail",
    operational: { semanticEvidence: { fuel: { status: "exact" }, engineCc: { status: "exact" }, powerHp: { status: "exact" } } },
  } as any;
  assert.equal(classifySpecificationEvidence(offer, "year").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "fuelPowertrain").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "engineCc").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "powerHp").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "certifiedPower").state, "not_applicable");
});

test("semantic conflicts and retained ranges fail closed", () => {
  const conflict = {
    fuel: "petrol",
    powertrainKind: "combustion",
    operational: { semanticEvidence: { fuel: { status: "conflict" } } },
  } as any;
  const range = {
    engineCc: 1499,
    operational: { semanticEvidence: { engineCc: { status: "ambiguous", rawValue: "0 - 1,499 cc" } } },
  } as any;
  assert.equal(classifySpecificationEvidence(conflict, "fuelPowertrain").state, "conflict");
  assert.equal(classifySpecificationEvidence(range, "engineCc").state, "ambiguous");
});

test("review and representative knowledge never become exact", () => {
  const review = {
    engineCc: 1498,
    operational: { knowledgeCore: { variantId: "review-accord", variantStatus: "review", fieldsApplied: ["engineCc"] } },
  } as any;
  const representative = {
    powerHp: 147,
    powerDataConfidence: "reference",
    powerDataSource: "vehicle-model-representative:honda-accord",
    operational: {},
  } as any;
  assert.equal(classifySpecificationEvidence(review, "engineCc").state, "ambiguous");
  assert.equal(classifySpecificationEvidence(representative, "powerHp").state, "ambiguous");
});

test("electrified rows require certified 30-minute power", () => {
  const missing = { fuel: "hybrid", powertrainKind: "other_hybrid", engineCc: 1580 } as any;
  const exact = {
    ...missing,
    power30MinKw: 32,
    powerDataConfidence: "source_exact",
    powerDataSource: "manufacturer_official:30-minute-power",
  } as any;
  assert.equal(isElectrifiedSpecification(missing), true);
  assert.equal(classifySpecificationEvidence({ ...missing, powertrainKind: "electric", engineCc: undefined }, "engineCc").state, "not_applicable");
  assert.equal(classifySpecificationEvidence(missing, "certifiedPower").state, "missing");
  assert.equal(classifySpecificationEvidence(exact, "certifiedPower").state, "exact");
});

test("unclassified stored values remain ambiguous until provenance is preserved", () => {
  const offer = {
    fuel: "petrol",
    powertrainKind: "combustion",
    engineCc: 1998,
    powerHp: 150,
    operational: {},
  } as any;
  assert.equal(classifySpecificationEvidence(offer, "fuelPowertrain").state, "ambiguous");
  assert.equal(classifySpecificationEvidence(offer, "engineCc").state, "ambiguous");
  assert.equal(classifySpecificationEvidence(offer, "powerHp").state, "ambiguous");
});
