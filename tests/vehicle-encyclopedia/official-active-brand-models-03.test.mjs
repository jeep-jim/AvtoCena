import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("official active brand batch adds English identities without untraced logos", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/brand-model-official-active-03.json")),
  ]);
  const sources = new Map(workspace.records.source.map((source) => [source.id, source]));
  const brands = new Map(workspace.records.brand.map((brand) => [brand.id, brand]));
  const models = new Map(workspace.records.model.map((model) => [model.id, model]));
  const logoOwners = new Set(workspace.records.media.filter((media) => media.role === "brand_logo").map((media) => media.ownerId));

  assert.deepEqual(report.totals, { reviewedBrands: 3, newSources: 3, newBrands: 3, newModels: 20 });
  assert.deepEqual(report.brandIds, ["jmev", "micro", "srm-shineray"]);
  assert.equal(report.productionConnected, false);
  for (const brandId of report.brandIds) {
    const brand = brands.get(brandId);
    assert(brand);
    assert.equal(brand.status, "seed");
    assert.equal(logoOwners.has(brandId), false);
    assert(brand.evidence.some((evidence) => sources.get(evidence.sourceId)?.type === "manufacturer"));
    for (const alias of brand.aliases) assert.equal(alias.safe, true);
  }
  for (const modelId of report.modelIds) {
    const model = models.get(modelId);
    assert(model);
    assert.equal(model.status, "review");
    assert(report.brandIds.includes(model.brandId));
    assert(model.evidence.some((evidence) => sources.get(evidence.sourceId)?.type === "manufacturer"));
  }
});
