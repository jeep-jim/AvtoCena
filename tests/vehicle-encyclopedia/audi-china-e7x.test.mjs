import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("AUDI E7X retains only the exact latest production specification", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/audi-china-e7x-official-2026.json")),
  ]);
  const models = new Map(workspace.records.model.map((model) => [model.id, model]));
  const generations = new Map(workspace.records.generation.map((generation) => [generation.id, generation]));
  const variants = new Map(workspace.records.variant.map((variant) => [variant.id, variant]));

  assert.deepEqual(report.totals, { newSources: 1, newModels: 1, newGenerations: 1, newVariants: 2 });
  assert.equal(report.productionConnected, false);
  assert.equal(report.policy.latestProductionReleaseWins, true);
  assert.equal(models.get("audi-china/e7x")?.status, "review");
  assert.deepEqual(generations.get("audi-china/e7x/adp")?.platformCodes, ["ADP"]);

  const rwd = variants.get("audi-china/e7x/adp/300-kw-rwd");
  const quattro = variants.get("audi-china/e7x/adp/500-kw-quattro");
  assert(rwd);
  assert(quattro);
  assert.deepEqual([rwd.powerKw, rwd.drive], [300, "RWD"]);
  assert.deepEqual([quattro.powerKw, quattro.drive, quattro.zeroTo100Sec], [500, "AWD", 3.9]);
  for (const variant of [rwd, quattro]) {
    assert.deepEqual([variant.lengthMm, variant.widthMm, variant.heightMm, variant.wheelbaseMm], [5049, 1997, 1710, 3060]);
    assert.equal("batteryGrossKwh" in variant, false);
    assert.equal("rangeKm" in variant, false);
    assert.equal("seats" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert.equal(variant.status, "review");
  }
});
