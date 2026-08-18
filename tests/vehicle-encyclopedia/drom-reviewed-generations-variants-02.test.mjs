import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("second reviewed Drom batch adds only explicitly bounded models and generation matches", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/drom-reviewed-generation-variant-02.json")),
  ]);
  const models = new Map(workspace.records.model.map((model) => [model.id, model]));
  const generations = new Map(workspace.records.generation.map((generation) => [generation.id, generation]));
  const facelifts = new Map(workspace.records.facelift.map((facelift) => [facelift.id, facelift]));
  const variants = new Map(workspace.records.variant.map((variant) => [variant.id, variant]));
  const sources = new Map(workspace.records.source.map((source) => [source.id, source]));

  assert.equal(report.productionConnected, false);
  assert.equal(report.inputLegacyVariants, 15735);
  assert.equal(report.acceptedSources, 6);
  assert.equal(report.acceptedModels, 2);
  assert.equal(report.acceptedGenerations, 2);
  assert.equal(report.acceptedFacelifts, 2);
  assert.equal(report.acceptedVariants, 40);
  assert.equal(report.acceptedMissingModelVariants, 28);
  assert.equal(report.acceptedExistingGenerationVariants, 12);
  assert.equal(report.duplicateSourceRowsMerged, 8);
  assert.deepEqual(report.modelIds, ["mazda/axela", "volkswagen/lavida"]);

  for (const sourceId of report.sourceIds) assert.equal(sources.get(sourceId)?.publisher, "Drom");
  for (const modelId of report.modelIds) {
    const model = models.get(modelId);
    assert(model);
    assert.equal(model.status, "review");
    assert.deepEqual(model.powertrainKinds, ["ICE"]);
    assert.equal(model.mediaIds.length, 0);
    assert(model.evidence.every((item) => item.status === "verified"));
  }
  for (const generationId of report.generationIds) {
    const generation = generations.get(generationId);
    assert(generation);
    assert.equal(generation.status, "review");
    assert(report.modelIds.includes(generation.modelId));
  }
  for (const faceliftId of report.faceliftIds) {
    const facelift = facelifts.get(faceliftId);
    assert(facelift);
    assert.equal(facelift.status, "review");
    assert(report.generationIds.includes(facelift.generationId));
  }

  const accepted = report.variantIds.map((id) => variants.get(id));
  assert(accepted.every(Boolean));
  assert.equal(accepted.filter((variant) => report.modelIds.includes(variant.modelId)).length, 28);
  assert.equal(accepted.filter((variant) => !report.modelIds.includes(variant.modelId)).length, 12);
  assert.equal(accepted.some((variant) => variant.modelId === "toyota/yaris" && variant.bodyType !== "Hatchback"), false);
  assert.equal(accepted.some((variant) => variant.modelId === "honda/wr-v"), false);
  for (const variant of accepted) {
    assert.equal(variant.status, "review");
    assert.equal(variant.powertrainKind, "ICE");
    assert.equal(variant.market, "Reference catalog");
    assert.equal("engineCode" in variant, false);
    assert.equal("powerKw" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert(generations.has(variant.generationId));
    if (variant.faceliftId) assert.equal(facelifts.get(variant.faceliftId)?.generationId, variant.generationId);
    assert(variant.evidence.every((item) => item.status === "verified" && sources.get(item.sourceId)?.publisher === "Drom"));
  }
});
