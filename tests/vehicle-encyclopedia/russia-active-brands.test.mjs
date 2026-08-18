import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";
import { buildSearchIndex, resolveSearch } from "../../scripts/vehicle-encyclopedia/search.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("active Russian 2020-2026 brands and model identities are source-backed", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/brand-model-russia-active-01.json")),
  ]);
  assert.deepEqual(report.totals, { reviewedBrands: 5, newSources: 5, newBrands: 5, newModels: 20 });
  assert.equal(report.productionConnected, false);
  const brands = new Map(workspace.records.brand.map((brand) => [brand.id, brand]));
  const models = new Map(workspace.records.model.map((model) => [model.id, model]));
  for (const id of ["evolute", "solaris", "sollers", "tenet", "xcite"]) {
    assert.deepEqual(brands.get(id)?.countries, ["Russia"]);
    assert.equal(brands.get(id)?.status, "seed");
  }
  for (const id of ["evolute/i-space", "solaris/hc", "sollers/atlant", "tenet/t7", "xcite/x-cross-8"]) {
    assert.equal(models.get(id)?.status, "review");
    assert(models.get(id)?.evidence.some((evidence) => evidence.status === "verified"));
  }
});

test("active Russian model titles resolve to one English review identity", async () => {
  const index = buildSearchIndex(await loadWorkspace(DATA_ROOT));
  for (const [query, make, entityId] of [
    ["i-SPACE", "EVOLUTE", "evolute/i-space"],
    ["HC", "Solaris", "solaris/hc"],
    ["Atlant", "Sollers", "sollers/atlant"],
    ["T7", "TENET", "tenet/t7"],
    ["X-Cross 8", "XCITE", "xcite/x-cross-8"],
  ]) {
    const result = resolveSearch(index, query, { make });
    assert.equal(result.resolved, null);
    assert.equal(result.matches[0]?.entry.entityId, entityId);
    assert.equal(result.matches[0]?.entry.safe, false);
    assert.equal(result.matches[0]?.canonical.status, "review");
  }
});
