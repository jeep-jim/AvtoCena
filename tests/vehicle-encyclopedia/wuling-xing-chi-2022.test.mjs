import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Wuling Xing Chi uses its official English identity and exact current 1.5L columns", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-xing-chi-2022-specifications.json")),
  ]);
  const model = workspace.records.model.find((record) => record.id === "wuling/xingchi");
  const variants = workspace.records.variant.filter((record) => record.generationId === "wuling/xingchi/launch-2022");

  assert.deepEqual(report.totals, { newSources: 2, replacedModels: 1, newGenerations: 1, newVariants: 2 });
  assert.deepEqual([model?.canonicalName, model?.productionFrom], ["Xing Chi", "2022-09"]);
  assert.deepEqual(model?.bodyTypes, ["SUV"]);
  assert.equal(model?.aliases.some((alias) => alias.value === "Xingchi"), true);
  assert.deepEqual(variants.map((variant) => variant.name).sort(), ["1.5L 6MT Freedom", "1.5L CVT Play"]);

  for (const variant of variants) {
    assert.deepEqual([variant.market, variant.yearFrom, variant.bodyType, variant.powertrainKind, variant.fuel, variant.engineCc, variant.drive, variant.icePowerKw], ["China", 2022, "SUV", "ICE", "Petrol", 1485, "FWD", 73]);
    assert.deepEqual([variant.lengthMm, variant.widthMm, variant.heightMm, variant.wheelbaseMm, variant.tankCapacityL], [4350, 1750, 1610, 2550, 45]);
    assert.equal(variant.powerHp, undefined);
    assert.equal(variant.power30MinKw, undefined);
    assert.equal(variant.status, "review");
  }

  const manual = variants.find((variant) => variant.transmission === "6-speed manual");
  assert.deepEqual([manual?.gears, manual?.curbWeightKg], [6, 1190]);
  const cvt = variants.find((variant) => variant.transmission === "CVT");
  assert.deepEqual([cvt?.gears, cvt?.curbWeightKg], [undefined, 1240]);
});
