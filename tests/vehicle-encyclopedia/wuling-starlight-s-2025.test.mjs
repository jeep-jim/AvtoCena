import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Wuling Starlight S keeps six exact 2025 configurations and no inferred battery basis", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-starlight-s-2025-specifications.json")),
  ]);
  const model = workspace.records.model.find((record) => record.id === "wuling/starlight-s");
  const variants = workspace.records.variant.filter((record) => record.generationId === "wuling/starlight-s/2025-model-year");
  assert.deepEqual(report.totals, { newSources: 1, replacedModels: 1, newGenerations: 1, newVariants: 6 });
  assert.deepEqual(model?.powertrainKinds, ["PHEV", "BEV"]);
  assert.equal(model?.productionFrom, "2025");
  assert.equal(variants.length, 6);

  const highPower = variants.find((variant) => variant.id.endsWith("130-km-high-power-flagship"));
  const bev = variants.find((variant) => variant.id.endsWith("510-km-leading"));
  assert.deepEqual([highPower?.powertrainKind, highPower?.icePowerKw, highPower?.motorPeakKw, highPower?.topSpeedKmh], ["PHEV", 105, 160, 185]);
  assert.deepEqual([bev?.powertrainKind, bev?.rangeKm, bev?.rangeStandard, bev?.acChargeKw], ["BEV", 510, "CLTC", 6.6]);
  for (const variant of variants) {
    assert.equal(variant.drive, "FWD");
    assert.deepEqual([variant.lengthMm, variant.widthMm, variant.wheelbaseMm, variant.seats, variant.doors], [4745, 1890, 2800, 5, 5]);
    assert.equal("batteryGrossKwh" in variant, false);
    assert.equal("batteryUsableKwh" in variant, false);
    assert.equal("batteryRatedKwh" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert.equal(variant.status, "review");
  }
});
