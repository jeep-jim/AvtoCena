import assert from "node:assert/strict";
import test from "node:test";
import { resolveKnowledgePower } from "../apps/web/lib/catalog/vehicle-knowledge";

test("unique matched variant replaces a large untrusted source horsepower conflict", () => {
  const result = resolveKnowledgePower({
    suppliedPowerHp: 100,
    suppliedConfidence: "estimated",
    suppliedSource: "listing-parser",
    variantPowerHp: 163,
    variantId: "toyota/land-cruiser-prado/j150/2tr-fe",
    representativePowerHp: 163,
    modelId: "toyota/land-cruiser-prado",
  });
  assert.equal(result.powerHp, 163);
  assert.equal(result.confidence, "reference");
  assert.equal(result.source, "vehicle-knowledge:toyota/land-cruiser-prado/j150/2tr-fe");
  assert.equal(result.conflict?.kind, "variant_override");
});

test("documented source horsepower is never replaced by model knowledge", () => {
  const result = resolveKnowledgePower({
    suppliedPowerHp: 150,
    suppliedConfidence: "source_exact",
    suppliedSource: "source-detail:1",
    variantPowerHp: 163,
    variantId: "variant-163",
    representativePowerHp: 163,
    modelId: "model",
  });
  assert.equal(result.powerHp, 150);
  assert.equal(result.confidence, "source_exact");
  assert.equal(result.source, "source-detail:1");
  assert.equal(result.conflict, undefined);
});

test("small source versus variant difference keeps source evidence", () => {
  const result = resolveKnowledgePower({
    suppliedPowerHp: 160,
    suppliedConfidence: "reference",
    suppliedSource: "source-summary",
    variantPowerHp: 163,
    variantId: "variant-163",
    representativePowerHp: 163,
    modelId: "model",
  });
  assert.equal(result.powerHp, 160);
  assert.equal(result.source, "source-summary");
});

test("wild untrusted model-wide conflict fails closed when no unique variant exists", () => {
  const result = resolveKnowledgePower({
    suppliedPowerHp: 100,
    suppliedConfidence: "estimated",
    suppliedSource: "listing-parser",
    representativePowerHp: 170,
    modelId: "toyota/example",
  });
  assert.equal(result.powerHp, undefined);
  assert.equal(result.conflict?.kind, "unresolved_model_conflict");
  assert.equal(result.usedRepresentative, false);
});
