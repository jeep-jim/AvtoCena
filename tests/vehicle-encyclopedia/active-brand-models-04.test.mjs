import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Kuayue and CIIMO remain distinct source-backed identities", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/brand-model-active-04.json")),
  ]);
  const brands = new Map(workspace.records.brand.map((brand) => [brand.id, brand]));
  const models = new Map(workspace.records.model.map((model) => [model.id, model]));
  const sources = new Map(workspace.records.source.map((source) => [source.id, source]));
  const logoOwners = new Set(workspace.records.media.filter((media) => media.role === "brand_logo").map((media) => media.ownerId));

  assert.deepEqual(report.totals, { newSources: 3, newBrands: 2, newModels: 6 });
  assert.deepEqual(report.brandIds, ["kuayue", "ciimo"]);
  assert.equal(report.productionConnected, false);
  const kuayue = brands.get("kuayue");
  const ciimo = brands.get("ciimo");
  assert(kuayue);
  assert(ciimo);
  assert.equal(kuayue.status, "seed");
  assert.equal(ciimo.status, "review");
  assert(kuayue.aliases.every((alias) => alias.safe), true);
  assert(ciimo.aliases.every((alias) => !alias.safe), true);
  assert.equal(logoOwners.has("kuayue"), false);
  assert.equal(logoOwners.has("ciimo"), false);
  assert.equal(sources.get(ciimo.evidence[0].sourceId)?.type, "secondary_reference");
  for (const modelId of report.modelIds) {
    const model = models.get(modelId);
    assert(model);
    assert.equal(model.status, "review");
    assert(["kuayue", "ciimo"].includes(model.brandId));
  }
  assert.equal(models.get("ciimo/m-nv")?.powertrainKinds[0], "BEV");
});
