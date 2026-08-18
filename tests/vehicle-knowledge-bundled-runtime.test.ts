import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { readBundledChunkedDataJson } from "../apps/web/lib/bundled-data";
import { readVehicleKnowledgeModels, readVehicleKnowledgeVariants, resetVehicleKnowledgeCache } from "../apps/web/lib/catalog/vehicle-knowledge";

test("bundled vehicle knowledge preserves production and adds only gated V2 runtime rows", async () => {
  const modelIndex = JSON.parse(fs.readFileSync("data/catalog/vehicle-knowledge/models-index.json", "utf8"));
  const variantIndex = JSON.parse(fs.readFileSync("data/catalog/vehicle-knowledge/variants-index.json", "utf8"));
  const bridgeModels = JSON.parse(fs.readFileSync("data/catalog/vehicle-knowledge/v2-bridge-models.json", "utf8"));
  const bridgeVariantIndex = JSON.parse(fs.readFileSync("data/catalog/vehicle-knowledge/v2-bridge-variants-index.json", "utf8"));

  assert.equal(modelIndex.total, 4_899, "production model denominator must not be replaced by V2");
  assert.equal(variantIndex.total, 15_735, "production variant denominator must not be replaced by V2");
  assert.equal(bridgeVariantIndex.total, 9, "calculator bridge must contain only zero-regression new-model variants");

  const models = await readBundledChunkedDataJson<any>("catalog/vehicle-knowledge/models.json", []);
  const variants = await readBundledChunkedDataJson<any>("catalog/vehicle-knowledge/variants.json", []);
  assert.equal(models.length, modelIndex.total);
  assert.equal(variants.length, variantIndex.total);

  const legacyModelIds = new Set(models.map((row: any) => row.id));
  const newBridgeModels = bridgeModels.filter((row: any) => !legacyModelIds.has(row.id));
  assert.equal(newBridgeModels.length, 6);
  assert.ok(newBridgeModels.some((row: any) => row.id === "honda/n-one-e"));
  assert.ok(newBridgeModels.some((row: any) => row.id === "toyota/land-cruiser-250"));

  resetVehicleKnowledgeCache();
  const resolvedModels = await readVehicleKnowledgeModels();
  const resolvedVariants = await readVehicleKnowledgeVariants();
  assert.equal(resolvedModels.length, 4_905);
  assert.equal(resolvedVariants.length, 15_744);
  assert.ok(resolvedVariants.some((row: any) => row.modelId === "honda/n-one-e"));
  assert.ok(resolvedVariants.some((row: any) => row.modelId === "toyota/land-cruiser-250"));
});
