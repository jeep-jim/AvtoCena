import assert from "node:assert/strict";
import test from "node:test";
import { EncyclopediaIdentityResolver } from "../apps/web/lib/catalog/encyclopedia-identity";
import { resolveCatalogSearchParamsWithEncyclopedia } from "../apps/web/lib/catalog/encyclopedia-identity-query";

const resolver = new EncyclopediaIdentityResolver({
  brands: [
    { id: "aito", canonicalName: "AITO", aliases: [{ value: "AITO Wenjie", safe: true }, { value: "AITO 问界", safe: true }] },
    { id: "baw", canonicalName: "BAW", aliases: [{ value: "BAW (Beijing Automobile Works)", safe: true }] },
  ],
  models: [
    { id: "aito/m9", brandId: "aito", canonicalName: "M9", aliases: [{ value: "问界 M9", safe: true }] },
  ],
});

test("historical safe make/model aliases become canonical query values", () => {
  const result = resolveCatalogSearchParamsWithEncyclopedia(resolver, { make: "AITO Wenjie", model: "问界 M9", yearFrom: 2024 });
  assert.deepEqual(result, { make: "AITO", model: "M9", yearFrom: 2024 });
});

test("comma-separated makes canonicalize and deduplicate", () => {
  const result = resolveCatalogSearchParamsWithEncyclopedia(resolver, { make: "AITO,AITO 问界,BAW (Beijing Automobile Works)" });
  assert.equal(result.make, "AITO,BAW");
});

test("unresolved makes and free-text models remain searchable", () => {
  const result = resolveCatalogSearchParamsWithEncyclopedia(resolver, { make: "New Unknown Brand", model: "Prototype X" });
  assert.equal(result.make, "New Unknown Brand");
  assert.equal(result.model, "Prototype X");
});

test("model is not rewritten when multiple brand scopes are requested", () => {
  const result = resolveCatalogSearchParamsWithEncyclopedia(resolver, { make: "AITO,BAW", model: "问界 M9" });
  assert.equal(result.make, "AITO,BAW");
  assert.equal(result.model, "问界 M9");
});
