import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Baojun mass-model batch keeps three models and thirteen exact official configurations", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/baojun-mass-models-batch-01.json")),
  ]);
  assert.deepEqual(report.totals, { newSources: 7, replacedModels: 3, newGenerations: 3, newVariants: 13 });
  assert.deepEqual(report.perModel, {
    "baojun/yunhai": { variants: 5 },
    "baojun/yep-plus": { variants: 4 },
    "baojun/xiangjing": { variants: 4 },
  });

  const models = Object.fromEntries(
    workspace.records.model
      .filter((record) => report.modelIds.includes(record.id))
      .map((record) => [record.id, record]),
  );
  assert.deepEqual([models["baojun/yunhai"]?.canonicalName, models["baojun/yunhai"]?.productionFrom, models["baojun/yunhai"]?.bodyTypes], ["Yunhai", "2024-09", ["SUV"]]);
  assert.deepEqual([models["baojun/yep-plus"]?.canonicalName, models["baojun/yep-plus"]?.productionFrom, models["baojun/yep-plus"]?.bodyTypes], ["Yep Plus", "2024-04", ["SUV"]]);
  assert.deepEqual([models["baojun/xiangjing"]?.canonicalName, models["baojun/xiangjing"]?.productionFrom, models["baojun/xiangjing"]?.bodyTypes], ["Xiangjing", "2024-12", ["Sedan"]]);
  assert.ok(models["baojun/yunhai"]?.aliases.some((record) => record.value === "Yun Hai" && record.safe));
  assert.ok(models["baojun/xiangjing"]?.aliases.some((record) => record.value === "Xiang Jing" && record.safe));

  const yunhai = workspace.records.variant.filter((record) => record.modelId === "baojun/yunhai");
  assert.equal(yunhai.length, 5);
  assert.deepEqual(yunhai.map((record) => record.rangeKm).sort((a, b) => a - b), [140, 500, 500, 600, 600]);
  assert.ok(yunhai.every((record) => record.yearFrom === 2026 && record.bodyType === "SUV" && record.drive === "FWD" && record.motorPeakKw === 150));
  assert.equal(yunhai.filter((record) => record.powertrainKind === "PHEV").length, 1);

  const yepPlus = workspace.records.variant.filter((record) => record.modelId === "baojun/yep-plus");
  assert.equal(yepPlus.length, 4);
  assert.deepEqual(yepPlus.map((record) => record.rangeKm).sort((a, b) => a - b), [301, 401, 501, 501]);
  assert.ok(yepPlus.every((record) => record.yearFrom === 2026 && record.powertrainKind === "BEV" && record.drive === "FWD" && record.motorPeakKw === 75));

  const xiangjing = workspace.records.variant.filter((record) => record.modelId === "baojun/xiangjing");
  assert.equal(xiangjing.length, 4);
  assert.deepEqual(xiangjing.map((record) => record.rangeKm).sort((a, b) => a - b), [140, 140, 600, 600]);
  assert.ok(xiangjing.every((record) => record.rangeStandard === "CLTC" && record.drive === "FWD" && record.lengthMm === 5005 && record.widthMm === 1900 && record.wheelbaseMm === 2900));
  assert.ok(xiangjing.filter((record) => record.powertrainKind === "PHEV").every((record) => record.icePowerKw === 105 && record.motorPeakKw === 160 && record.tankCapacityL === 53));
  assert.ok(xiangjing.filter((record) => record.powertrainKind === "BEV").every((record) => record.motorPeakKw === 186));

  for (const variant of [...yunhai, ...yepPlus, ...xiangjing]) {
    assert.equal("batteryGrossKwh" in variant, false);
    assert.equal("batteryUsableKwh" in variant, false);
    assert.equal("batteryRatedKwh" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert.equal(variant.status, "review");
  }
  assert.ok([...yunhai, ...yepPlus].every((record) => !("rangeStandard" in record)));
  assert.ok(xiangjing.filter((record) => record.powertrainKind === "PHEV").every((record) => !("engineCc" in record)));
});
