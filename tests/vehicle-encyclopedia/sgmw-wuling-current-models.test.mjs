import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("current Wuling families use English model identities without promoting grades", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/sgmw-wuling-current-models-2026.json")),
  ]);
  const byId = new Map(workspace.records.model.map((model) => [model.id, model]));
  assert.deepEqual(report.totals, { candidateModels: 24, newSources: 3, newModels: 24 });
  assert.equal(report.productionConnected, false);
  assert.equal(report.policy.gradesAndGenerationsNotDuplicatedAsModels, true);
  assert.equal(byId.get("wuling/hongguang-mini-ev")?.canonicalName, "Hongguang MINI EV");
  assert.deepEqual(byId.get("wuling/hongguang-mini-ev")?.powertrainKinds, ["BEV"]);
  assert.equal(byId.get("wuling/bingo-plus")?.sourceNames[0].value, "五菱 缤果PLUS");
  assert.deepEqual(byId.get("wuling/hongguang")?.powertrainKinds, ["BEV", "EREV"]);
  assert.equal(byId.get("wuling/hongguang-s")?.productionFrom, null);
  assert.equal(byId.has("wuling/macaron"), false);
  assert.equal(byId.has("wuling/gameboy"), false);
  assert.equal(byId.has("wuling/new-hongguang-s"), false);
});
