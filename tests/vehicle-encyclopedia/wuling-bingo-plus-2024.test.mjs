import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Bingo Plus keeps three exact 2024 five-seat configurations", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-bingo-plus-2024-specifications.json")),
  ]);
  const model = workspace.records.model.find((record) => record.id === "wuling/bingo-plus");
  const variants = workspace.records.variant.filter((record) => record.generationId === "wuling/bingo-plus/five-seat-2024");

  assert.deepEqual(report.totals, { newSources: 2, replacedModels: 1, newGenerations: 1, newVariants: 3 });
  assert.deepEqual([model?.canonicalName, model?.productionFrom], ["Bingo Plus", "2024-09"]);
  assert.deepEqual(model?.bodyTypes, ["Hatchback"]);
  assert.equal(variants.length, 3);
  assert.deepEqual(variants.map((variant) => variant.rangeKm).toSorted((left, right) => left - right), [330, 401, 510]);
  assert.deepEqual(variants.map((variant) => variant.acChargeKw).toSorted((left, right) => left - right), [3.3, 3.3, 6.6]);

  for (const variant of variants) {
    assert.match(variant.name, /^[\x20-\x7E]+$/);
    assert.deepEqual(
      [variant.yearFrom, variant.bodyType, variant.powertrainKind, variant.motorPeakKw, variant.rangeStandard, variant.lengthMm, variant.widthMm, variant.heightMm, variant.wheelbaseMm, variant.seats, variant.doors, variant.topSpeedKmh],
      [2024, "Hatchback", "BEV", 75, "CLTC", 4090, 1720, 1575, 2610, 5, 5, 140],
    );
    assert.equal("drive" in variant, false);
    assert.equal("batteryGrossKwh" in variant, false);
    assert.equal("batteryUsableKwh" in variant, false);
    assert.equal("batteryRatedKwh" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert.equal(variant.status, "review");
  }
});
