import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { readBundledChunkedDataJson } from "../apps/web/lib/bundled-data";
import { readVehicleKnowledgeModels, readVehicleKnowledgeVariants, resetVehicleKnowledgeCache } from "../apps/web/lib/catalog/vehicle-knowledge";

test("bundled vehicle knowledge ignores runtime Object Storage shadow copies", async () => {
  const modelIndex = JSON.parse(fs.readFileSync("data/catalog/vehicle-knowledge/models-index.json", "utf8"));
  const variantIndex = JSON.parse(fs.readFileSync("data/catalog/vehicle-knowledge/variants-index.json", "utf8"));
  assert.ok(modelIndex.total > 4_000, `expected bundled model corpus, got ${modelIndex.total}`);
  assert.ok(variantIndex.total > 10_000, `expected bundled variant corpus, got ${variantIndex.total}`);
  const models = await readBundledChunkedDataJson<any>("catalog/vehicle-knowledge/models.json", []);
  const variants = await readBundledChunkedDataJson<any>("catalog/vehicle-knowledge/variants.json", []);
  assert.equal(models.length, modelIndex.total);
  assert.equal(variants.length, variantIndex.total);
  resetVehicleKnowledgeCache();
  const resolvedModels = await readVehicleKnowledgeModels();
  const resolvedVariants = await readVehicleKnowledgeVariants();
  assert.equal(resolvedModels.length, modelIndex.total);
  assert.equal(resolvedVariants.length, variantIndex.total);
});
