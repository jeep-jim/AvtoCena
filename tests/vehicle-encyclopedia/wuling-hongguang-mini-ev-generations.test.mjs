import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Hongguang MINI EV keeps English identities and seven exact official configurations", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-hongguang-mini-ev-generations.json")),
  ]);
  const model = workspace.records.model.find((record) => record.id === "wuling/hongguang-mini-ev");
  const fourDoor = workspace.records.variant.filter((record) => record.generationId === "wuling/hongguang-mini-ev/four-door-2025");
  const fifth = workspace.records.variant.filter((record) => record.generationId === "wuling/hongguang-mini-ev/fifth-generation");

  assert.deepEqual(report.totals, { newSources: 5, replacedModels: 1, newGenerations: 2, newVariants: 7 });
  assert.deepEqual([model?.canonicalName, model?.productionFrom], ["Hongguang MINI EV", "2020"]);
  assert.deepEqual(model?.bodyTypes, ["Hatchback"]);
  assert.equal(fourDoor.length, 3);
  assert.equal(fifth.length, 4);

  for (const variant of fourDoor) {
    assert.deepEqual(
      [variant.yearFrom, variant.drive, variant.motorPeakKw, variant.rangeKm, variant.rangeStandard],
      [2025, "RWD", 30, 205, "CLTC"],
    );
    assert.deepEqual(
      [variant.lengthMm, variant.widthMm, variant.heightMm, variant.wheelbaseMm, variant.curbWeightKg, variant.seats, variant.doors, variant.topSpeedKmh],
      [3256, 1510, 1578, 2190, 780, 4, 4, 100],
    );
  }

  assert.deepEqual(fifth.map((variant) => variant.rangeKm).toSorted((left, right) => left - right), [205, 205, 301, 301]);
  for (const variant of [...fourDoor, ...fifth]) {
    assert.match(variant.name, /^[\x20-\x7E]+$/);
    assert.equal(variant.aliases[0]?.language, "zh-CN");
    assert.equal(variant.aliases[0]?.safe, true);
    assert.equal(variant.powertrainKind, "BEV");
    assert.equal("batteryGrossKwh" in variant, false);
    assert.equal("batteryUsableKwh" in variant, false);
    assert.equal("batteryRatedKwh" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert.equal(variant.status, "review");
  }
});
