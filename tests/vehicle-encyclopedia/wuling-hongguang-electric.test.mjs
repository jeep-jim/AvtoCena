import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Hongguang stages exact 2024 BEV and 2025 EREV grades without collapsing seat choices", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-hongguang-electric-lineup.json")),
  ]);
  const model = workspace.records.model.find((record) => record.id === "wuling/hongguang");
  const bev = workspace.records.variant.filter((record) => record.generationId === "wuling/hongguang/bev-2024");
  const erev = workspace.records.variant.filter((record) => record.generationId === "wuling/hongguang/erev-2025");

  assert.deepEqual(report.totals, { newSources: 5, replacedModels: 1, newGenerations: 2, newVariants: 5 });
  assert.deepEqual([model?.canonicalName, model?.productionFrom], ["Hongguang", "2010"]);
  assert.deepEqual(model?.bodyTypes, ["MPV"]);
  assert.deepEqual(model?.powertrainKinds, ["BEV", "EREV"]);
  assert.equal(bev.length, 2);
  assert.equal(erev.length, 3);

  for (const variant of bev) {
    assert.deepEqual(
      [variant.yearFrom, variant.drive, variant.motorPeakKw, variant.rangeKm, variant.rangeStandard],
      [2024, "RWD", 75, 300, "CLTC"],
    );
    assert.deepEqual(
      [variant.lengthMm, variant.widthMm, variant.heightMm, variant.wheelbaseMm, variant.curbWeightKg, variant.grossWeightKg, variant.topSpeedKmh],
      [4515, 1725, 1790, 2850, 1275, 1850, 135],
    );
    assert.equal("seats" in variant, false);
  }

  assert.deepEqual(erev.map((variant) => variant.seats).toSorted((left, right) => left - right), [5, 5, 7]);
  assert.deepEqual(erev.map((variant) => variant.tankCapacityL).toSorted((left, right) => left - right), [55, 56, 57]);
  for (const variant of erev) {
    assert.deepEqual(
      [variant.yearFrom, variant.powertrainKind, variant.fuel, variant.engineCc, variant.icePowerKw, variant.drive, variant.motorPeakKw, variant.rangeKm, variant.rangeStandard],
      [2025, "EREV", "Petrol", 1498, 73, "RWD", 75, 50, "CLTC"],
    );
    assert.equal(variant.grossWeightKg, 1990);
  }

  for (const variant of [...bev, ...erev]) {
    assert.match(variant.name, /^[\x20-\x7E]+$/);
    assert.equal("batteryGrossKwh" in variant, false);
    assert.equal("batteryUsableKwh" in variant, false);
    assert.equal("batteryRatedKwh" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert.equal(variant.status, "review");
  }
});
