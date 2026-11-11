import test from "node:test";
import assert from "node:assert/strict";
import {countCanonicalCatalogModels} from "../apps/web/lib/catalog/canonical-model-counts";

test("autocatalog counts unique active canonical identities and rejects ambiguous/raw model names", () => {
  const models = [
    {id: "a", make: "Toyota", model: "Corolla", aliases: ["Corolla sedan", "shared"]},
    {id: "b", make: "Toyota", model: "Yaris", aliases: ["shared"]},
    {id: "c", make: "Toyota", model: "Hidden", active: false},
  ];
  const rows = ["Corolla", "Corolla sedan", "shared", "Unknown trim", "Hidden"].map(model => ({make: "Toyota", model}));
  const result = countCanonicalCatalogModels(models, rows);
  assert.equal(result.counts.Toyota, 5);
  assert.equal(result.canonicalModelCounts.Toyota, 1);
  assert.deepEqual(countCanonicalCatalogModels(models, []).canonicalModelCounts, {});
});
