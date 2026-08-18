import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Wuling mass-model batch keeps three models and seventeen exact official configurations", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-mass-models-batch-02.json")),
  ]);

  assert.deepEqual(report.totals, { newSources: 8, replacedModels: 3, newGenerations: 3, newVariants: 17 });
  assert.deepEqual(report.perModel, {
    "wuling/yangguang": { variants: 8 },
    "wuling/bingo-s": { variants: 5 },
    "wuling/bingo-pro": { variants: 4 },
  });

  const models = Object.fromEntries(
    workspace.records.model
      .filter((record) => report.modelIds.includes(record.id))
      .map((record) => [record.id, record]),
  );
  assert.deepEqual(
    [models["wuling/yangguang"]?.canonicalName, models["wuling/yangguang"]?.productionFrom, models["wuling/yangguang"]?.bodyTypes],
    ["Yangguang", "2024-03", ["Van"]],
  );
  assert.deepEqual(
    [models["wuling/bingo-s"]?.canonicalName, models["wuling/bingo-s"]?.productionFrom, models["wuling/bingo-s"]?.bodyTypes],
    ["Bingo S", "2025-09", ["Hatchback"]],
  );
  assert.deepEqual(
    [models["wuling/bingo-pro"]?.canonicalName, models["wuling/bingo-pro"]?.productionFrom, models["wuling/bingo-pro"]?.bodyTypes],
    ["Bingo Pro", "2026-05", ["Hatchback"]],
  );

  const yangguang = workspace.records.variant.filter((record) => record.modelId === "wuling/yangguang");
  assert.equal(yangguang.length, 8);
  assert.deepEqual([...new Set(yangguang.map((record) => record.seats))].sort((a, b) => a - b), [2, 6, 9]);
  assert.ok(yangguang.every((record) => record.drive === "RWD" && record.acChargeKw === 6.6));
  const duplicatedPassengerAliases = yangguang
    .flatMap((record) => record.aliases)
    .filter((record) => record.value === "440km 客车版舒适型");
  assert.equal(duplicatedPassengerAliases.length, 2);
  assert.ok(duplicatedPassengerAliases.every((record) => record.safe === false));

  const bingoS = workspace.records.variant.filter((record) => record.modelId === "wuling/bingo-s");
  assert.equal(bingoS.length, 5);
  assert.deepEqual(bingoS.map((record) => record.rangeKm).sort((a, b) => a - b), [325, 325, 430, 430, 525]);
  assert.ok(bingoS.every((record) => record.rangeStandard === "CLTC" && record.motorPeakKw === 75 && record.drive === "FWD"));
  assert.equal(bingoS.find((record) => record.name === "525 km Flagship")?.yearFrom, 2026);

  const bingoPro = workspace.records.variant.filter((record) => record.modelId === "wuling/bingo-pro");
  assert.equal(bingoPro.length, 4);
  assert.deepEqual(bingoPro.map((record) => record.rangeKm).sort((a, b) => a - b), [330, 330, 403, 403]);
  assert.ok(bingoPro.every((record) => record.lengthMm === 4050 && record.widthMm === 1758 && record.heightMm === 1580 && record.seats === 5));

  for (const variant of [...yangguang, ...bingoS, ...bingoPro]) {
    assert.equal("batteryGrossKwh" in variant, false);
    assert.equal("batteryUsableKwh" in variant, false);
    assert.equal("batteryRatedKwh" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert.equal(variant.status, "review");
  }
  assert.ok(yangguang.every((record) => !("rangeStandard" in record)));
  assert.ok(bingoPro.every((record) => !("rangeStandard" in record) && !("motorPeakKw" in record)));
});
