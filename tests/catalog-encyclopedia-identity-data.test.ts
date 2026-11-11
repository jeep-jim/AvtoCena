import assert from "node:assert/strict";
import test from "node:test";
import {
  assertEncyclopediaIdentityDataset,
  assertEncyclopediaIdentityProductionConnected,
} from "../apps/web/lib/catalog/encyclopedia-identity-data";

function makeAlias(value = "AITO 问界") {
  return { value, kind: "localized", safe: true, sourceIds: ["src-aito"] };
}

function dataset() {
  return {
    manifest: {
      schemaVersion: 2,
      workspace: "vehicle-encyclopedia-v2",
      productionConnected: false,
      identityProductionConnected: false,
      collections: { brand: { records: 1 }, model: { records: 1 } },
    },
    brands: [{ id: "aito", canonicalName: "AITO", aliases: [makeAlias()] }],
    models: [{ id: "aito/m9", brandId: "aito", canonicalName: "M9", aliases: [makeAlias("问界 M9")], sourceNames: [] }],
    searchEntries: [
      { entityType: "brand", entityId: "aito", brandId: "aito", term: "AITO", safe: true },
      { entityType: "model", entityId: "aito/m9", brandId: "aito", modelId: "aito/m9", term: "M9", safe: true },
    ],
  };
}

test("valid V2 identity dataset passes runtime validation", () => {
  const input = dataset();
  assert.equal(assertEncyclopediaIdentityDataset(input), input);
});

test("identity production opt-in is independent from full Encyclopedia productionConnected", () => {
  const input: any = dataset();
  assert.equal(input.manifest.productionConnected, false);
  assert.throws(() => assertEncyclopediaIdentityProductionConnected(input), /catalog_encyclopedia_identity_production_not_connected/);
  input.manifest.identityProductionConnected = true;
  assert.equal(assertEncyclopediaIdentityProductionConnected(input), input);
  assert.equal(input.manifest.productionConnected, false);
});

test("runtime loader rejects string aliases even though the generic resolver can model legacy input", () => {
  const input: any = dataset();
  input.brands[0].aliases = ["AITO Wenjie"];
  assert.throws(() => assertEncyclopediaIdentityDataset(input), /encyclopedia_identity_invalid_brand_aliases:aito/);
});

test("runtime loader requires an explicit safe boolean on aliases", () => {
  const input: any = dataset();
  delete input.brands[0].aliases[0].safe;
  assert.throws(() => assertEncyclopediaIdentityDataset(input), /encyclopedia_identity_invalid_brand_aliases:aito/);
});

test("models cannot reference a brand missing from the same checkpoint", () => {
  const input: any = dataset();
  input.models[0].brandId = "missing";
  assert.throws(() => assertEncyclopediaIdentityDataset(input), /encyclopedia_identity_model_brand_missing:aito\/m9:missing/);
});

test("manifest record counts are enforced before activation", () => {
  const input: any = dataset();
  input.manifest.collections.model.records = 2;
  assert.throws(() => assertEncyclopediaIdentityDataset(input), /encyclopedia_identity_model_count_mismatch:1:2/);
});

test("safe search-index identities must reference existing entities", () => {
  const input: any = dataset();
  input.searchEntries[1].modelId = "aito/missing";
  assert.throws(() => assertEncyclopediaIdentityDataset(input), /encyclopedia_identity_search_model_missing/);
});
