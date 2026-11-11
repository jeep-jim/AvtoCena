import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";
import { buildSearchIndex, resolveSearch } from "../../scripts/vehicle-encyclopedia/search.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("second active Russian 2020-2026 brand batch is source-backed", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/brand-model-russia-active-02.json")),
  ]);
  assert.deepEqual(report.totals, { reviewedBrands: 4, newSources: 4, newBrands: 4, newModels: 11 });
  assert.equal(report.productionConnected, false);
  const brands = new Map(workspace.records.brand.map((brand) => [brand.id, brand]));
  const models = new Map(workspace.records.model.map((model) => [model.id, model]));
  for (const id of ["amberauto", "ambertruck", "eonyx", "nordcross"]) {
    assert.deepEqual(brands.get(id)?.countries, ["Russia"]);
    assert.equal(brands.get(id)?.status, "seed");
  }
  for (const id of ["amberauto/a5", "ambertruck/work-nf", "eonyx/city", "nordcross/001"]) {
    assert.equal(models.get(id)?.status, "review");
    assert(models.get(id)?.evidence.some((evidence) => evidence.status === "verified"));
  }
});

test("Russian localized brands resolve to English canonical identities", async () => {
  const index = buildSearchIndex(await loadWorkspace(DATA_ROOT));
  for (const [query, make, entityId] of [
    ["A5", "АМБЕРАВТО", "amberauto/a5"],
    ["WORK NF", "АМБЕРТРАК", "ambertruck/work-nf"],
    ["City", "EONY X", "eonyx/city"],
    ["001", "Nordcross", "nordcross/001"],
  ]) {
    const result = resolveSearch(index, query, { make });
    assert.equal(result.resolved, null);
    assert.equal(result.matches[0]?.entry.entityId, entityId);
    assert.equal(result.matches[0]?.entry.safe, false);
    assert.equal(result.matches[0]?.canonical.status, "review");
  }
});
