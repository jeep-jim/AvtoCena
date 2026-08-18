import assert from "node:assert/strict";
import test from "node:test";
import { EncyclopediaIdentitySlugResolver, encyclopediaIdentitySlug } from "../apps/web/lib/catalog/encyclopedia-identity-slugs";

const alias = (value: string) => ({ value, kind: "source_spelling", safe: true, sourceIds: ["src"] });

function resolver() {
  return new EncyclopediaIdentitySlugResolver({
    brands: [
      { id: "aito", canonicalName: "AITO", slug: "aito", aliases: [alias("AITO Wenjie"), { ...alias("AITO 问界"), kind: "localized" }] },
      { id: "baw", canonicalName: "BAW", slug: "baw", aliases: [alias("Beijing Automobile Works")] },
      { id: "one", canonicalName: "One", slug: "one", aliases: [alias("Shared Name")] },
      { id: "two", canonicalName: "Two", slug: "two", aliases: [alias("Shared Name")] },
    ],
    models: [
      { id: "aito/m9", brandId: "aito", canonicalName: "M9", slug: "m9", aliases: [alias("AITO M9")] },
      { id: "aito/m7", brandId: "aito", canonicalName: "M7", slug: "m7", aliases: [] },
    ],
  } as any);
}

test("canonical brand and model slugs resolve to stable paths", () => {
  const identity = resolver();
  const brand = identity.resolveBrand("aito");
  assert.ok(brand);
  assert.equal(brand.canonical, true);
  assert.equal(identity.canonicalBrandPath(brand), "/cars/brand/aito");
  const model = identity.resolveModel("aito", "m9");
  assert.ok(model);
  assert.equal(identity.canonicalModelPath(brand, model), "/cars/brand/aito/model/m9");
});

test("safe historical ASCII aliases resolve to canonical redirect targets", () => {
  const identity = resolver();
  const brand = identity.resolveBrand("aito-wenjie");
  assert.ok(brand);
  assert.equal(brand.brandId, "aito");
  assert.equal(brand.canonical, false);
  assert.equal(identity.canonicalBrandPath(brand), "/cars/brand/aito");
  const model = identity.resolveModel("aito", "aito-m9");
  assert.ok(model);
  assert.equal(model.modelId, "aito/m9");
  assert.equal(model.canonicalSlug, "m9");
});

test("localized aliases are not guessed into Latin SEO routes", () => {
  assert.equal(encyclopediaIdentitySlug("AITO 问界"), "aito");
  const identity = resolver();
  const canonical = identity.resolveBrand("aito");
  assert.ok(canonical);
  assert.equal(canonical.canonical, true);
});

test("colliding alias slugs fail closed", () => {
  const identity = resolver();
  assert.equal(identity.resolveBrand("shared-name"), null);
});
