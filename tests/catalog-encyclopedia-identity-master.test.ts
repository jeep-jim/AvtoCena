import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { EncyclopediaIdentityResolver } from "../apps/web/lib/catalog/encyclopedia-identity";
import { applyEncyclopediaIdentityMaster } from "../apps/web/lib/catalog/encyclopedia-identity-master";

const resolver = new EncyclopediaIdentityResolver({
  brands: [{ id: "mercedes-benz", canonicalName: "Mercedes-Benz", aliases: [] }],
  models: [{
    id: "mercedes-benz/c-class",
    brandId: "mercedes-benz",
    canonicalName: "C-Class",
    aliases: [],
    sourceNames: [{ value: "C 220 d", safe: true, kind: "source_spelling" }],
  }],
});

test("safe sourceNames are exact encyclopedia identity authority", () => {
  const result = resolver.resolve({ make: "Mercedes-Benz", model: "C 220 d" });
  assert.equal(result.brandId, "mercedes-benz");
  assert.equal(result.modelId, "mercedes-benz/c-class");
  assert.equal(result.canonicalModel, "C-Class");
  assert.equal(result.modelSource, "safe_alias");
});

test("presentation translation can feed the strict resolver without replacing raw identity", () => {
  const output = applyEncyclopediaIdentityMaster(resolver, {
    market: "korea",
    make: "벤츠",
    model: "C-Class",
    operational: { raw: { make: "벤츠" } },
  });
  assert.equal(output.make, "Mercedes-Benz");
  assert.equal(output.model, "C-Class");
  assert.equal(output.operational.encyclopediaIdentity.rawMake, "벤츠");
  assert.equal(output.operational.encyclopediaIdentity.rawModel, "C-Class");
  assert.equal(output.operational.encyclopediaIdentity.canonicalBrandId, "mercedes-benz");
  assert.equal(output.operational.encyclopediaIdentity.canonicalModelId, "mercedes-benz/c-class");
  assert.match(output.operational.encyclopediaIdentity.makeSource, /^presentation:/);
  assert.deepEqual(output.operational.raw, { make: "벤츠" });
});

test("brand-only translation never invents a canonical model", () => {
  const output = applyEncyclopediaIdentityMaster(resolver, {
    market: "korea",
    make: "벤츠",
    model: "알수없는모델",
    operational: { raw: {} },
  });
  assert.equal(output.make, "Mercedes-Benz");
  assert.equal(output.model, "알수없는모델");
  assert.equal(output.operational.encyclopediaIdentity.canonicalBrandId, "mercedes-benz");
  assert.equal(output.operational.encyclopediaIdentity.canonicalModelId, null);
  assert.equal(output.operational.encyclopediaIdentity.fullyResolved, false);
});

test("unresolved live catalog strings cannot create public encyclopedia models", async () => {
  const source = await fs.readFile(new URL("../apps/web/lib/catalog/model-directory.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /live-catalog-identity/);
  assert.doesNotMatch(source, /const\s+liveOnly\s*=/);
  assert.match(source, /Unknown live parser strings must never create public\/SEO model entities/);
});
