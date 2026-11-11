import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Wuling Air EV keeps all four official 2022 China grades without invented battery or legal power", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-air-ev-2022-lineup.json")),
  ]);
  const model = workspace.records.model.find((record) => record.id === "wuling/air-ev");
  const variants = workspace.records.variant.filter((record) => record.generationId === "wuling/air-ev/china-launch-2022");

  assert.deepEqual(report.totals, { newSources: 4, replacedModels: 1, newGenerations: 1, newVariants: 4 });
  assert.deepEqual([model?.canonicalName, model?.productionFrom], ["Air EV", "2022-08"]);
  assert.deepEqual(model?.bodyTypes, ["City car"]);
  assert.deepEqual(variants.map((variant) => variant.name).sort(), [
    "2-seat Advanced",
    "2-seat Standard",
    "4-seat Advanced",
    "4-seat Standard",
  ]);

  for (const variant of variants) {
    assert.deepEqual([variant.market, variant.yearFrom, variant.bodyType, variant.powertrainKind, variant.rangeKm, variant.rangeStandard], ["China", 2022, "City car", "BEV", 300, "CLTC"]);
    assert.equal(variant.motorPeakKw, variant.seats === 2 ? 30 : 50);
    assert.equal("batteryGrossKwh" in variant, false);
    assert.equal("batteryUsableKwh" in variant, false);
    assert.equal("batteryRatedKwh" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert.equal(variant.status, "review");
  }

  const twoSeat = variants.find((variant) => variant.name === "2-seat Standard");
  assert.deepEqual([twoSeat?.lengthMm, twoSeat?.widthMm, twoSeat?.heightMm, twoSeat?.wheelbaseMm], [undefined, undefined, undefined, undefined]);
  const fourSeat = variants.find((variant) => variant.name === "4-seat Standard");
  assert.deepEqual([fourSeat?.lengthMm, fourSeat?.widthMm, fourSeat?.heightMm, fourSeat?.wheelbaseMm], [2974, 1505, 1631, 2010]);
});
