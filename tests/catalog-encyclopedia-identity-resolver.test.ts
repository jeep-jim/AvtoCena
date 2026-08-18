import assert from "node:assert/strict";
import test from "node:test";
import { EncyclopediaIdentityResolver, encyclopediaIdentityKey } from "../apps/web/lib/catalog/encyclopedia-identity";

function resolver() {
  return new EncyclopediaIdentityResolver({
    brands: [
      {
        id: "aito",
        canonicalName: "AITO",
        aliases: [
          { value: "AITO Wenjie", safe: true },
          { value: "AITO 问界", safe: true },
          { value: "Huawei AITO", safe: false },
        ],
      },
      {
        id: "baw",
        canonicalName: "BAW",
        aliases: [{ value: "Beijing Automobile Works", safe: true }],
      },
      { id: "changan", canonicalName: "Changan", aliases: [{ value: "长安", safe: true }] },
      { id: "other", canonicalName: "Other", aliases: [{ value: "Collision", safe: true }] },
      { id: "other-2", canonicalName: "Other 2", aliases: [{ value: "Collision", safe: true }] },
    ],
    models: [
      { id: "aito/m9", brandId: "aito", canonicalName: "M9", aliases: [{ value: "问界 M9", safe: true }] },
      { id: "changan/cs75-plus", brandId: "changan", canonicalName: "CS75 Plus", aliases: [{ value: "CS75 PLUS", safe: true }] },
      { id: "baw/m7", brandId: "baw", canonicalName: "M7" },
    ],
    searchEntries: [
      { entityType: "model", entityId: "aito/m9", brandId: "aito", modelId: "aito/m9", term: "AITO M9", safe: true, kind: "canonical_make_model" },
      { entityType: "brand", entityId: "aito", brandId: "aito", term: "问界", safe: true, kind: "localized" },
    ],
  });
}

test("identity key is Unicode-aware and punctuation-insensitive", () => {
  assert.equal(encyclopediaIdentityKey(" AITO 问界 "), "aito问界");
  assert.equal(encyclopediaIdentityKey("Lynk & Co"), "lynkandco");
});

test("safe brand aliases collapse source spellings to one canonical make", () => {
  const identity = resolver();
  for (const make of ["AITO", "AITO Wenjie", "AITO 问界", "问界"]) {
    const result = identity.resolve({ make, model: "M9" });
    assert.equal(result.brandId, "aito");
    assert.equal(result.canonicalMake, "AITO");
    assert.equal(result.modelId, "aito/m9");
    assert.equal(result.canonicalModel, "M9");
    assert.equal(result.resolved, true);
  }
});

test("canonical make+model search-index terms resolve without fuzzy guessing", () => {
  const result = resolver().resolve({ make: "AITO", model: "AITO M9" });
  assert.equal(result.modelId, "aito/m9");
  assert.equal(result.modelSource, "search_index");
});

test("unsafe aliases never auto-merge", () => {
  const result = resolver().resolve({ make: "Huawei AITO", model: "M9" });
  assert.equal(result.brandId, null);
  assert.equal(result.canonicalMake, "Huawei AITO");
  assert.equal(result.resolved, false);
});

test("ambiguous aliases fail closed instead of selecting an arbitrary entity", () => {
  const identity = resolver();
  const result = identity.resolve({ make: "Collision", model: "X" });
  assert.equal(result.brandId, null);
  assert.equal(result.ambiguous, true);
  assert.ok(identity.collisions.some((collision) => collision.scope === "brand" && collision.key === "collision"));
});

test("model identity is scoped to the resolved brand", () => {
  const identity = resolver();
  assert.equal(identity.resolve({ make: "BAW", model: "M7" }).modelId, "baw/m7");
  assert.equal(identity.resolve({ make: "AITO", model: "M7" }).modelId, null);
});

test("source aliases preserve correct parent brand instead of flattening subbrands", () => {
  const result = resolver().resolve({ make: "长安", model: "CS75 PLUS" });
  assert.equal(result.brandId, "changan");
  assert.equal(result.modelId, "changan/cs75-plus");
  assert.equal(result.canonicalMake, "Changan");
  assert.equal(result.canonicalModel, "CS75 Plus");
});
