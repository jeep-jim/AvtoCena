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
          "Unreviewed AITO String",
        ],
      },
      {
        id: "baw",
        canonicalName: "BAW",
        aliases: [{ value: "Beijing Automobile Works", safe: true }],
      },
      { id: "changan", canonicalName: "Changan", aliases: [{ value: "长安", safe: true }] },
      { id: "xpeng", canonicalName: "XPeng", aliases: [] },
      { id: "other", canonicalName: "Other", aliases: [{ value: "Collision", safe: true }] },
      { id: "other-2", canonicalName: "Other 2", aliases: [{ value: "Collision", safe: true }] },
    ],
    models: [
      {
        id: "aito/m9",
        brandId: "aito",
        canonicalName: "M9",
        aliases: [{ value: "问界 M9", safe: true }],
        sourceNames: ["Seller M9 Name", { value: "Raw M9 Source", safe: true }],
      },
      { id: "changan/cs75-plus", brandId: "changan", canonicalName: "CS75 Plus", aliases: [{ value: "CS75 PLUS", safe: true }] },
      { id: "baw/m7", brandId: "baw", canonicalName: "M7" },
      { id: "xpeng/p7", brandId: "xpeng", canonicalName: "P7" },
      { id: "xpeng/p7-plus", brandId: "xpeng", canonicalName: "P7+" },
    ],
    searchEntries: [
      { entityType: "model", entityId: "aito/m9", brandId: "aito", modelId: "aito/m9", term: "AITO M9", safe: true, kind: "canonical_make_model" },
      { entityType: "brand", entityId: "aito", brandId: "aito", term: "问界", safe: true, kind: "localized" },
    ],
  });
}

test("identity key is Unicode-aware while preserving semantic model symbols", () => {
  assert.equal(encyclopediaIdentityKey(" AITO 问界 "), "aito问界");
  assert.equal(encyclopediaIdentityKey("Lynk & Co"), "lynkandco");
  assert.equal(encyclopediaIdentityKey("P7"), "p7");
  assert.equal(encyclopediaIdentityKey("P7+"), "p7plus");
  assert.notEqual(encyclopediaIdentityKey("P7"), encyclopediaIdentityKey("P7+"));
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

test("plus-suffixed model identity stays distinct from the base model", () => {
  const identity = resolver();
  assert.equal(identity.resolve({ make: "XPeng", model: "P7" }).modelId, "xpeng/p7");
  assert.equal(identity.resolve({ make: "XPeng", model: "P7+" }).modelId, "xpeng/p7-plus");
  assert.ok(!identity.collisions.some((collision) => collision.key === "xpeng:p7"));
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

test("raw string aliases are discovery input, not automatic merge authority", () => {
  const result = resolver().resolve({ make: "Unreviewed AITO String", model: "M9" });
  assert.equal(result.brandId, null);
  assert.equal(result.resolved, false);
});

test("sourceNames stay audit-only even when a source record carries a safe-looking flag", () => {
  const identity = resolver();
  for (const model of ["Seller M9 Name", "Raw M9 Source"]) {
    const result = identity.resolve({ make: "AITO", model });
    assert.equal(result.brandId, "aito");
    assert.equal(result.modelId, null);
    assert.equal(result.canonicalModel, model);
    assert.equal(result.resolved, false);
  }
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
