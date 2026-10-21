import assert from "node:assert/strict";
import test from "node:test";
import { EncyclopediaIdentityResolver } from "../apps/web/lib/catalog/encyclopedia-identity";
import { applyEncyclopediaIdentityForMode, catalogEncyclopediaIdentityMode } from "../apps/web/lib/catalog/encyclopedia-identity-runtime";

const resolver = new EncyclopediaIdentityResolver({
  brands: [{ id: "aito", canonicalName: "AITO", aliases: [{ value: "AITO 问界", safe: true }] }],
  models: [{ id: "aito/m9", brandId: "aito", canonicalName: "M9", aliases: [{ value: "问界 M9", safe: true }] }],
});

const input = { make: "AITO 问界", model: "问界 M9", operational: { raw: { make: "AITO 问界" } } };

test("runtime mode defaults to manifest-controlled auto and invalid overrides fail safe to off", () => {
  assert.equal(catalogEncyclopediaIdentityMode(undefined), "auto");
  assert.equal(catalogEncyclopediaIdentityMode(""), "auto");
  assert.equal(catalogEncyclopediaIdentityMode("garbage"), "off");
  assert.equal(catalogEncyclopediaIdentityMode("off"), "off");
  assert.equal(catalogEncyclopediaIdentityMode(" SHADOW "), "shadow");
  assert.equal(catalogEncyclopediaIdentityMode("apply"), "apply");
});

test("off mode is a true no-op", () => {
  const output = applyEncyclopediaIdentityForMode(resolver, input, "off");
  assert.equal(output, input);
});

test("shadow mode records identity but does not change public naming", () => {
  const output = applyEncyclopediaIdentityForMode(resolver, input, "shadow");
  assert.equal(output.make, "AITO 问界");
  assert.equal(output.model, "问界 M9");
  assert.equal(output.operational?.encyclopediaIdentity.canonicalBrandId, "aito");
  assert.equal(output.operational?.encyclopediaIdentity.canonicalModelId, "aito/m9");
  assert.deepEqual(output.operational?.raw, { make: "AITO 问界" });
});

test("apply mode changes only proven public identity and preserves source spelling", () => {
  const output = applyEncyclopediaIdentityForMode(resolver, input, "apply");
  assert.equal(output.make, "AITO");
  assert.equal(output.model, "M9");
  assert.equal(output.operational?.encyclopediaIdentity.rawMake, "AITO 问界");
  assert.equal(output.operational?.encyclopediaIdentity.rawModel, "问界 M9");
});
