import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("reviewed legacy catalog batch adds only bounded exact ICE specifications", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/drom-reviewed-generation-variant-01.json")),
  ]);
  const brands = new Map(workspace.records.brand.map((brand) => [brand.id, brand]));
  const models = new Map(workspace.records.model.map((model) => [model.id, model]));
  const sources = new Map(workspace.records.source.map((source) => [source.id, source]));
  const generations = new Map(workspace.records.generation.map((generation) => [generation.id, generation]));
  const facelifts = new Map(workspace.records.facelift.map((facelift) => [facelift.id, facelift]));
  const acceptedGenerations = new Set(report.generationIds);
  const acceptedFacelifts = new Set(report.faceliftIds);
  const acceptedVariants = new Set(report.variantIds);
  const generationRows = workspace.records.generation.filter((generation) => acceptedGenerations.has(generation.id));
  const faceliftRows = workspace.records.facelift.filter((facelift) => acceptedFacelifts.has(facelift.id));
  const variantRows = workspace.records.variant.filter((variant) => acceptedVariants.has(variant.id));

  assert.equal(report.productionConnected, false);
  assert.equal(report.inputLegacyVariants, 15735);
  assert.equal(report.acceptedSourceRows, 1802);
  assert.equal(report.duplicateSourceRowsMerged, 421);
  assert.equal(report.acceptedSources, 102);
  assert.equal(report.acceptedModels, 101);
  assert.equal(report.acceptedGenerations, 139);
  assert.equal(report.acceptedFacelifts, 91);
  assert.equal(report.acceptedVariants, 1381);
  assert.equal(generationRows.length, report.acceptedGenerations);
  assert.equal(faceliftRows.length, report.acceptedFacelifts);
  assert.equal(variantRows.length, report.acceptedVariants);

  for (const generation of generationRows) {
    assert.equal(generation.status, "review");
    assert(generation.id.includes("/drom-"));
    assert(generation.bodyTypes.length > 0);
    assert(models.has(generation.modelId));
    for (const alias of generation.aliases) assert.equal(alias.safe, false);
    for (const evidence of generation.evidence) {
      assert.equal(evidence.status, "verified");
      assert(["Drom", "Toyota", "Volkswagen"].includes(sources.get(evidence.sourceId)?.publisher));
    }
  }

  for (const facelift of faceliftRows) {
    assert.equal(facelift.status, "review");
    assert(acceptedGenerations.has(facelift.generationId));
    for (const alias of facelift.aliases) assert.equal(alias.safe, false);
  }

  const specificationKeys = new Set();
  for (const variant of variantRows) {
    const model = models.get(variant.modelId);
    const brand = brands.get(model?.brandId);
    const cutoff = brand?.countries?.includes("Japan") ? 2015 : 2020;
    assert(model);
    assert(generations.has(variant.generationId));
    assert.equal(variant.status, "review");
    assert.equal(variant.powertrainKind, "ICE");
    assert(["Petrol", "Diesel", "LPG"].includes(variant.fuel));
    assert(variant.yearTo === null || variant.yearTo >= cutoff);
    assert(variant.yearFrom <= 2026);
    assert.equal("engineCode" in variant, false);
    assert.equal("powerHpStandard" in variant, false);
    assert.equal("powerKw" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    if (variant.faceliftId) assert.equal(facelifts.get(variant.faceliftId)?.generationId, variant.generationId);
    assert(["Reference catalog", "Japan", "Global"].includes(variant.market));
    assert(variant.evidence.some((evidence) => ["Drom", "Toyota", "Volkswagen"].includes(sources.get(evidence.sourceId)?.publisher)));
    for (const evidence of variant.evidence) assert.equal(evidence.status, "verified");
    const key = [
      variant.modelId, variant.generationId, variant.faceliftId, variant.yearFrom, variant.yearTo,
      variant.engineCc, variant.fuel, variant.transmission, variant.drive, variant.bodyType, variant.powerHp,
    ].join("|");
    assert.equal(specificationKeys.has(key), false);
    specificationKeys.add(key);
  }
});
