import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("reviewed EEA variants stay inside explicit generation and source boundaries", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/variant-eea-reviewed-01.json")),
  ]);
  const sources = new Map(workspace.records.source.map((source) => [source.id, source]));
  const generations = new Map(workspace.records.generation.map((generation) => [generation.id, generation]));
  const accepted = new Set(report.variantIds);
  const variants = workspace.records.variant.filter((variant) => accepted.has(variant.id));
  assert.equal(variants.length, report.acceptedVariants);
  assert.equal(new Set(variants.map((variant) => variant.modelId)).size, report.acceptedModels);
  assert.equal(report.productionConnected, false);
  for (const variant of variants) {
    const generation = generations.get(variant.generationId);
    assert(generation);
    assert.equal(variant.status, "review");
    assert.equal(variant.market, "Europe");
    assert.equal("power30MinKw" in variant, false);
    assert(["ICE", "BEV"].includes(variant.powertrainKind));
    assert(variant.engineCc !== null || variant.powerKw !== null);
    const from = generation.productionFrom ? Number(generation.productionFrom.slice(0, 4)) : null;
    const to = generation.productionTo ? Number(generation.productionTo.slice(0, 4)) : null;
    if (from !== null) assert(variant.yearFrom >= from);
    if (to !== null) assert(variant.yearTo <= to);
    assert(variant.evidence.some((evidence) => sources.get(evidence.sourceId)?.publisher === "European Environment Agency"));
    assert(variant.evidence.some((evidence) => evidence.fields.includes("bodyType")));
    for (const evidence of variant.evidence) assert.equal(evidence.status, "verified");
    for (const alias of variant.aliases || []) assert.equal(alias.safe, false);
  }
});
