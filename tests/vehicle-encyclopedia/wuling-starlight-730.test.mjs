import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Starlight 730 keeps four exact launch configurations and three sparse 2026 grades", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-starlight-730-specifications.json")),
  ]);
  const model = workspace.records.model.find((record) => record.id === "wuling/starlight-730");
  const variants = workspace.records.variant.filter((record) => record.generationId === "wuling/starlight-730/launch-lineup-2025");
  const launch = variants.filter((variant) => variant.yearFrom === 2025);
  const exclusive = variants.filter((variant) => variant.yearFrom === 2026);

  assert.deepEqual(report.totals, { newSources: 3, replacedModels: 1, newGenerations: 1, newVariants: 7 });
  assert.deepEqual([model?.canonicalName, model?.productionFrom], ["Starlight 730", "2025-11"]);
  assert.deepEqual(model?.powertrainKinds, ["ICE", "PHEV", "BEV"]);
  assert.equal(launch.length, 4);
  assert.equal(exclusive.length, 3);

  const phev = launch.find((variant) => variant.id.endsWith("phev-125-km-luxury"));
  const bev = launch.find((variant) => variant.id.endsWith("bev-500-km-luxury"));
  assert.deepEqual([phev?.icePowerKw, phev?.motorPeakKw, phev?.rangeKm, phev?.rangeStandard, phev?.acChargeKw], [78, 145, 125, "CLTC", 3.3]);
  assert.deepEqual([bev?.motorPeakKw, bev?.rangeKm, bev?.rangeStandard, bev?.acChargeKw], [100, 500, "CLTC", 6.6]);
  for (const variant of launch) {
    assert.deepEqual([variant.bodyType, variant.drive, variant.lengthMm, variant.widthMm, variant.wheelbaseMm, variant.seats, variant.doors], ["MPV", "FWD", 4910, 1850, 2910, 7, 5]);
    assert.equal("engineCc" in variant, false);
    assert.equal("batteryGrossKwh" in variant, false);
    assert.equal("batteryUsableKwh" in variant, false);
    assert.equal("batteryRatedKwh" in variant, false);
    assert.equal("power30MinKw" in variant, false);
  }
  for (const variant of exclusive) {
    assert.match(variant.name, /^[\x20-\x7E]+$/);
    assert.equal("motorPeakKw" in variant, false);
    assert.equal("curbWeightKg" in variant, false);
    assert.equal(variant.status, "review");
  }
});
