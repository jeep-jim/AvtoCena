import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Baojun batch 02 keeps four models and fourteen exact official configurations", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/baojun-mass-models-batch-02.json")),
  ]);
  assert.deepEqual(report.totals, { newSources: 8, newModels: 2, replacedModels: 2, newGenerations: 5, newVariants: 14 });
  assert.deepEqual(report.perModel, {
    "baojun/valli": { variants: 4 },
    "baojun/kiwi-ev": { variants: 5 },
    "baojun/yunduo": { variants: 4 },
    "baojun/e6": { variants: 1 },
  });

  const models = Object.fromEntries(
    workspace.records.model
      .filter((record) => report.modelIds.includes(record.id))
      .map((record) => [record.id, record]),
  );
  assert.deepEqual([models["baojun/valli"]?.canonicalName, models["baojun/valli"]?.productionFrom, models["baojun/valli"]?.bodyTypes], ["Valli", "2021-06", ["Wagon"]]);
  assert.deepEqual([models["baojun/kiwi-ev"]?.canonicalName, models["baojun/kiwi-ev"]?.productionFrom, models["baojun/kiwi-ev"]?.powertrainKinds], ["KiWi EV", "2021-08", ["BEV"]]);
  assert.deepEqual([models["baojun/yunduo"]?.canonicalName, models["baojun/yunduo"]?.productionFrom, models["baojun/yunduo"]?.bodyTypes], ["Yunduo", "2023-08", ["Hatchback"]]);
  assert.deepEqual([models["baojun/e6"]?.canonicalName, models["baojun/e6"]?.productionFrom, models["baojun/e6"]?.bodyTypes], ["E6", null, ["SUV"]]);
  assert.ok(models["baojun/yunduo"]?.sourceNames.some((record) => record.value === "宝骏云朵"));

  const valli = workspace.records.variant.filter((record) => record.modelId === "baojun/valli");
  assert.equal(valli.length, 4);
  assert.equal(valli.filter((record) => record.transmission === "Manual").length, 1);
  assert.equal(valli.filter((record) => record.transmission === "CVT").length, 3);
  assert.ok(valli.every((record) => record.yearFrom === 2021 && record.bodyType === "Wagon" && record.icePowerKw === 108 && record.lengthMm === 4685 && record.seats === 5));

  const kiwi = workspace.records.variant.filter((record) => record.modelId === "baojun/kiwi-ev");
  assert.equal(kiwi.length, 5);
  const kiwi2021 = kiwi.filter((record) => record.yearFrom === 2021);
  const kiwi2023 = kiwi.filter((record) => record.yearFrom === 2023);
  assert.equal(kiwi2021.length, 2);
  assert.equal(kiwi2023.length, 3);
  assert.ok(kiwi2021.every((record) => record.motorPeakKw === 40 && record.rangeKm === 305 && record.topSpeedKmh === 100 && record.seats === 4));
  assert.ok(kiwi2023.every((record) => record.motorPeakKw === 50 && !("rangeKm" in record) && !("lengthMm" in record)));

  const yunduo = workspace.records.variant.filter((record) => record.modelId === "baojun/yunduo");
  assert.equal(yunduo.length, 4);
  assert.deepEqual(yunduo.map((record) => record.name).sort(), ["2023 360 Plus", "2023 360 Pro", "2023 460 Max", "2023 460 Pro"]);
  assert.ok(yunduo.every((record) => record.bodyType === "Hatchback" && record.powertrainKind === "BEV" && record.motorPeakKw === 100 && record.topSpeedKmh === 150 && record.seats === 5));
  assert.ok(yunduo.every((record) => !("rangeKm" in record)));

  const e6 = workspace.records.variant.filter((record) => record.modelId === "baojun/e6");
  assert.equal(e6.length, 1);
  assert.deepEqual(
    [e6[0].yearFrom, e6[0].rangeKm, e6[0].motorPeakKw, e6[0].drive, e6[0].lengthMm, e6[0].widthMm, e6[0].heightMm, e6[0].wheelbaseMm, e6[0].curbWeightKg],
    [2026, 500, 150, "FWD", 4541, 1880, 1608, 2750, 1675],
  );

  for (const variant of [...valli, ...kiwi, ...yunduo, ...e6]) {
    assert.equal("batteryGrossKwh" in variant, false);
    assert.equal("batteryUsableKwh" in variant, false);
    assert.equal("batteryRatedKwh" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert.equal(variant.status, "review");
  }
  assert.ok([...kiwi2021, ...e6].every((record) => !("rangeStandard" in record)));
});
