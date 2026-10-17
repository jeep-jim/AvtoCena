import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { EncyclopediaIdentityResolver } from "../apps/web/lib/catalog/encyclopedia-identity";
import { enrichOfferWithKnowledgeCore } from "../apps/web/lib/catalog/knowledge-core";
import { resolveKnowledgeModelIdentity } from "../apps/web/lib/catalog/knowledge-model-identity";

const fixture = JSON.parse(fs.readFileSync("tests/fixtures/encar-bridge-model-identity-20260907.json", "utf8"));
const offer = (id: string) => structuredClone(fixture.offers.find((row: any) => row.sourceOfferId === id));

test("CORE resolves safe localized aliases without treating an alias as a modification", () => {
  const resolver = new EncyclopediaIdentityResolver({
    brands: [{ id: "genesis", canonicalName: "Genesis", aliases: [{ value: "제네시스", safe: true }] }],
    models: [{ id: "genesis/g70", brandId: "genesis", canonicalName: "G70" }],
  });
  assert.equal(resolveKnowledgeModelIdentity(offer("42193546"), resolver).modelId, "genesis/g70");
  assert.equal(resolveKnowledgeModelIdentity({ ...offer("42193546"), make: "unknown" }, resolver).modelId, null);
});

test("fresh Encar list-bound English family connects CORE but never invents engine power", async () => {
  for (const [id, expected] of [["42499123", "mini/cooper"], ["42637532", "mercedes-benz/glb"],
    ["42663085", "audi/a5"], ["41987912", "ford/explorer"], ["42344441", "bmw/x3"]]) {
    const original = offer(id);
    const enriched = await enrichOfferWithKnowledgeCore(original);
    assert.equal(enriched.operational.knowledgeCore.modelId, expected);
    assert.equal(enriched.operational.knowledgeCore.variantId, null);
    assert.deepEqual(enriched.operational.knowledgeCore.fieldsApplied, []);
    assert.equal(enriched.powerHp, undefined);
    assert.equal(enriched.make, original.make);
    assert.equal(enriched.model, original.model);
  }
});

test("Encar broad groups and mismatched listing categories cannot relabel models", async () => {
  const grand = await enrichOfferWithKnowledgeCore(offer("42033231"));
  assert.equal(grand.operational.knowledgeCore.modelId, null);
  assert.equal(grand.operational.knowledgeCore.modelIdentity.reason, "encar_model_group_is_broader_than_model");
  for (const change of [(row: any) => { row.sourceOfferId = "other"; },
    (row: any) => { row.operational.raw.detail.category.modelName = "X3 M"; },
    (row: any) => { row.sourceId = "unrelated_source"; }]) {
    const row = offer("42637532");
    change(row);
    assert.equal((await enrichOfferWithKnowledgeCore(row)).operational.knowledgeCore.modelId, null);
  }
});
