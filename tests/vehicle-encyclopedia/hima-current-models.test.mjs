import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("current HIMA families have exact English canonical and Chinese source identities", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/hima-current-models-2026.json")),
  ]);
  const models = new Map(workspace.records.model.map((model) => [model.id, model]));
  assert.deepEqual(report.totals, { newSources: 6, newModels: 15 });
  assert.deepEqual(report.brandIds, ["aito", "luxeed", "maextro", "shangjie", "stelato"]);
  assert.equal(report.productionConnected, false);
  assert.equal(report.policy.headlineSpecsNotPromotedToVariants, true);
  assert.equal(report.policy.compatibilityYearsNotProductionDates, true);

  const expected = {
    "aito/m5": "问界 M5",
    "aito/m6": "问界 M6",
    "aito/m7": "问界 M7",
    "aito/m8": "问界 M8",
    "luxeed/r7": "智界 R7",
    "luxeed/s7": "智界 S7",
    "luxeed/v9": "智界 V9",
    "maextro/s800": "尊界 S800",
    "maextro/v680": "尊界 V680",
    "maextro/v800": "尊界 V800",
    "shangjie/h5": "尚界 H5",
    "shangjie/z7": "尚界 Z7",
    "shangjie/z7t": "尚界 Z7T",
    "stelato/s9": "享界 S9",
    "stelato/s9t": "享界 S9T",
  };
  for (const [modelId, localized] of Object.entries(expected)) {
    const model = models.get(modelId);
    assert(model, modelId);
    assert.equal(model.status, "review");
    assert.equal(model.sourceNames.find((alias) => alias.value === localized)?.safe, true);
    assert.deepEqual(model.mediaIds, []);
    assert.equal(model.productionFrom, null);
  }
  assert.deepEqual(models.get("aito/m6")?.powertrainKinds, ["EREV", "BEV"]);
  assert.deepEqual(models.get("luxeed/v9")?.bodyTypes, ["MPV"]);
  assert.deepEqual(models.get("maextro/v680")?.powertrainKinds, []);
  assert.deepEqual(models.get("shangjie/z7t")?.bodyTypes, []);
});
