import assert from "node:assert/strict";
import test from "node:test";
import { EncyclopediaIdentityResolver } from "../apps/web/lib/catalog/encyclopedia-identity";
import { applyEncyclopediaIdentity } from "../apps/web/lib/catalog/encyclopedia-identity-application";

const resolver = new EncyclopediaIdentityResolver({
  brands: [{ id: "aito", canonicalName: "AITO", aliases: [{ value: "AITO 问界", safe: true }] }],
  models: [{ id: "aito/m9", brandId: "aito", canonicalName: "M9", aliases: [{ value: "问界 M9", safe: true }] }],
});

test("fully resolved identity canonicalizes public strings and preserves raw source identity", () => {
  const input = { make: "AITO 问界", model: "问界 M9", operational: { sourceUrl: "https://example.test/1", raw: { maker: "AITO 问界" } } };
  const output = applyEncyclopediaIdentity(resolver, input);
  assert.equal(output.make, "AITO");
  assert.equal(output.model, "M9");
  assert.deepEqual(output.operational.encyclopediaIdentity, {
    version: 2,
    rawMake: "AITO 问界",
    rawModel: "问界 M9",
    canonicalBrandId: "aito",
    canonicalModelId: "aito/m9",
    makeSource: "safe_alias",
    modelSource: "safe_alias",
    fullyResolved: true,
    ambiguous: false,
  });
  assert.equal(output.operational.sourceUrl, "https://example.test/1");
  assert.deepEqual(output.operational.raw, { maker: "AITO 问界" });
  assert.equal(input.make, "AITO 问界");
});

test("safe brand resolution can collapse a brand duplicate without inventing model identity", () => {
  const input = { make: "AITO 问界", model: "Unknown New Model", operational: { raw: {} } };
  const output = applyEncyclopediaIdentity(resolver, input);
  assert.equal(output.make, "AITO");
  assert.equal(output.model, "Unknown New Model");
  assert.equal(output.operational.encyclopediaIdentity.canonicalBrandId, "aito");
  assert.equal(output.operational.encyclopediaIdentity.canonicalModelId, null);
  assert.equal(output.operational.encyclopediaIdentity.fullyResolved, false);
  assert.equal(output.operational.encyclopediaIdentity.ambiguous, false);
});

test("unresolved make remains ingestible and is explicitly recorded for later alias work", () => {
  const input = { make: "Brand Never Seen", model: "X", operational: { raw: { a: 1 } } };
  const output = applyEncyclopediaIdentity(resolver, input);
  assert.equal(output.make, "Brand Never Seen");
  assert.equal(output.model, "X");
  assert.deepEqual(output.operational.raw, { a: 1 });
  assert.deepEqual(output.operational.encyclopediaIdentity, {
    version: 2,
    rawMake: "Brand Never Seen",
    rawModel: "X",
    canonicalBrandId: null,
    canonicalModelId: null,
    makeSource: "unresolved",
    modelSource: "unresolved",
    fullyResolved: false,
    ambiguous: false,
  });
});
