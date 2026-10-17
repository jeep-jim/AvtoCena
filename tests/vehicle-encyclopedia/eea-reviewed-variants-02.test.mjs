import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("second EEA batch keeps bulk observations review-only and labels synthetic containers", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/variant-eea-reviewed-02.json")),
  ]);
  const sources = new Map(workspace.records.source.map((source) => [source.id, source]));
  const generations = new Map(workspace.records.generation.map((generation) => [generation.id, generation]));
  const acceptedGenerations = new Set(report.generationIds);
  const acceptedVariants = new Set(report.variantIds);
  const generationRows = workspace.records.generation.filter((generation) => acceptedGenerations.has(generation.id));
  const variantRows = workspace.records.variant.filter((variant) => acceptedVariants.has(variant.id));

  assert.equal(report.productionConnected, false);
  assert.equal(report.inputCandidates, 22734);
  assert.equal(generationRows.length, report.acceptedObservationContainers);
  assert.equal(variantRows.length, report.acceptedVariants);
  assert.equal(report.acceptedObservationContainerVariants + report.acceptedExistingGenerationVariants, report.acceptedVariants);
  assert.equal(report.acceptedVariants, 16687);
  assert.equal(report.acceptedModels, 1163);
  assert.equal(report.acceptedObservationContainers, 1057);
  assert.equal(report.acceptedObservationContainerVariants, 12476);
  assert.equal(report.acceptedExistingGenerationVariants, 4211);
  assert.equal(report.representedRegistrations, 61787131);

  for (const generation of generationRows) {
    assert.equal(generation.status, "review");
    assert(generation.id.endsWith("/eea-registration-observations-2020-2025"));
    assert(generation.name.includes("EEA registration observations"));
    assert.deepEqual(generation.bodyTypes, ["Passenger car"]);
    assert(generation.researchNotes.some((note) => note.includes("Never publish")));
    for (const evidence of generation.evidence) {
      assert.equal(evidence.status, "verified");
      assert.equal(sources.get(evidence.sourceId)?.publisher, "European Environment Agency");
    }
  }

  for (const variant of variantRows) {
    assert.equal(variant.status, "review");
    assert.equal(variant.market, "Europe");
    assert.equal(variant.bodyType, "Passenger car");
    assert(["ICE", "BEV"].includes(variant.powertrainKind));
    assert.equal("powerHp" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert(generations.has(variant.generationId));
    assert(variant.evidence.some((evidence) => sources.get(evidence.sourceId)?.publisher === "European Environment Agency"));
    for (const evidence of variant.evidence) assert.equal(evidence.status, "verified");
    for (const alias of variant.aliases) assert.equal(alias.safe, false);
  }
});
