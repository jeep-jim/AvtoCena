import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("current Baojun portfolio keeps English models and folds sales editions", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/baojun-current-models-2026.json")),
  ]);
  const byId = new Map(workspace.records.model.map((model) => [model.id, model]));
  assert.deepEqual(report.totals, { candidateModels: 3, newSources: 3, newModels: 3 });
  assert.equal(report.productionConnected, false);
  assert.equal(byId.get("baojun/yunhai")?.canonicalName, "Yunhai");
  assert.equal(byId.get("baojun/e6")?.sourceNames[0].value, "宝骏 E6");
  assert.deepEqual(byId.get("baojun/yep-plus")?.powertrainKinds, ["BEV"]);
  assert.equal(byId.get("baojun/yep-plus")?.productionFrom, "2024-04");
  assert.equal(byId.has("baojun/yunhai-travel-edition"), false);
  assert.equal(byId.has("baojun/xiangjing-official-service-edition"), false);
});
