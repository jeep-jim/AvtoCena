import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("official HiCar gaps add exact model identities without invented specifications", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/huawei-hicar-model-gaps-2026.json")),
  ]);
  const models = new Map(workspace.records.model.map((model) => [model.id, model]));
  assert.deepEqual(report.totals, { candidateModels: 35, newModels: 35 });
  assert.equal(report.productionConnected, false);
  assert.equal(report.policy.compatibilityYearsNotProductionDates, true);
  assert.equal(report.policy.bodyAndPowertrainNotInferred, true);
  for (const modelId of report.modelIds) {
    const model = models.get(modelId);
    assert(model, modelId);
    assert.equal(model.status, "review");
    const hicarEvidence = model.evidence.find((row) => row.sourceId === "src-huawei-hicar-current-models-2026");
    assert.deepEqual(hicarEvidence?.fields, ["canonicalName"]);
    const hasLaterManufacturerEvidence = model.evidence.some((row) => row.sourceId !== "src-huawei-hicar-current-models-2026");
    if (!hasLaterManufacturerEvidence) {
      assert.equal(model.productionFrom, null);
      assert.deepEqual(model.bodyTypes, []);
      assert.deepEqual(model.powertrainKinds, []);
    }
    assert.deepEqual(model.mediaIds, []);
    assert.ok(model.sourceNames.length >= 1);
    assert.ok(model.sourceNames.every((sourceName) => sourceName.safe === true));
  }
  assert.equal(models.get("xpeng/mona-m03")?.canonicalName, "MONA M03");
  assert.equal(models.get("xpeng/mona-m03")?.sourceNames[0].value, "小鹏 M03");
  assert.equal(models.get("xpeng/p7-plus")?.canonicalName, "P7+");
  assert.equal(models.get("wuling/bingo-s")?.canonicalName, "Bingo S");
  assert.equal(models.get("baojun/xiangjing")?.sourceNames[0].value, "宝骏 享境");
  assert.equal(models.get("im-motors/ls9")?.canonicalName, "LS9");
});
