import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Wuling Bingo keeps four exact 2024 configurations without invented legal power", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-bingo-2024-specifications.json")),
  ]);
  const model = workspace.records.model.find((record) => record.id === "wuling/bingo");
  const variants = workspace.records.variant.filter((record) => record.generationId === "wuling/bingo/2024-model-year");
  assert.deepEqual(report.totals, { newSources: 1, replacedModels: 1, newGenerations: 1, newVariants: 4 });
  assert.equal(model?.productionFrom, "2024");
  assert.deepEqual(model?.powertrainKinds, ["BEV"]);
  assert.equal(variants.length, 4);
  const base = variants.find((variant) => variant.id.endsWith("light-203-km"));
  const longRange = variants.find((variant) => variant.id.endsWith("lingxi-premium-410-km"));
  assert.deepEqual([base?.rangeKm, base?.motorPeakKw, base?.topSpeedKmh], [203, 30, 100]);
  assert.deepEqual([longRange?.rangeKm, longRange?.motorPeakKw, longRange?.topSpeedKmh], [410, 50, 130]);
  for (const variant of variants) {
    assert.deepEqual([variant.drive, variant.rangeStandard, variant.acChargeKw], ["FWD", "CLTC", 3.3]);
    assert.deepEqual([variant.lengthMm, variant.widthMm, variant.heightMm, variant.wheelbaseMm, variant.seats, variant.doors], [3950, 1708, 1580, 2560, 4, 5]);
    assert.equal("batteryGrossKwh" in variant, false);
    assert.equal("batteryUsableKwh" in variant, false);
    assert.equal("batteryRatedKwh" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert.equal(variant.status, "review");
  }
});
