import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Zhiguang EV keeps three exact 2025 configurations without inventing CLTC or legal power", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-zhiguang-ev-2025-specifications.json")),
  ]);
  const model = workspace.records.model.find((record) => record.id === "wuling/zhiguang");
  const variants = workspace.records.variant.filter((record) => record.generationId === "wuling/zhiguang/ev-2025");

  assert.deepEqual(report.totals, { newSources: 3, replacedModels: 1, newGenerations: 1, newVariants: 3 });
  assert.deepEqual([model?.canonicalName, model?.bodyTypes], ["Zhiguang", ["Van"]]);
  assert.equal(variants.length, 3);
  assert.deepEqual(variants.map((variant) => variant.rangeKm).toSorted((left, right) => left - right), [201, 201, 305]);
  assert.deepEqual(variants.map((variant) => variant.grossWeightKg).toSorted((left, right) => left - right), [1220, 1220, 1350]);

  for (const variant of variants) {
    assert.match(variant.name, /^[\x20-\x7E]+$/);
    assert.deepEqual(
      [variant.yearFrom, variant.bodyType, variant.powertrainKind, variant.drive, variant.motorPeakKw, variant.lengthMm, variant.widthMm, variant.wheelbaseMm, variant.seats, variant.topSpeedKmh],
      [2025, "Van", "BEV", "RWD", 30, 3685, 1530, 2600, 4, 100],
    );
    assert.equal("rangeStandard" in variant, false);
    assert.equal("batteryGrossKwh" in variant, false);
    assert.equal("batteryUsableKwh" in variant, false);
    assert.equal("batteryRatedKwh" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert.equal(variant.status, "review");
  }
});
