import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Wuling Zhengcheng keeps all four official 2021 configurations without collapsing seat choices", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-zhengcheng-2021-specifications.json")),
  ]);
  const model = workspace.records.model.find((record) => record.id === "wuling/zhengcheng");
  const variants = workspace.records.variant.filter((record) => record.generationId === "wuling/zhengcheng/launch-2021");

  assert.deepEqual(report.totals, { newSources: 3, replacedModels: 1, newGenerations: 1, newVariants: 4 });
  assert.deepEqual([model?.canonicalName, model?.productionFrom], ["Zhengcheng", "2021-08"]);
  assert.deepEqual(model?.bodyTypes, ["MPV", "Van"]);
  assert.deepEqual(variants.map((variant) => variant.name).sort(), [
    "1.5T 6MT Comfort 7-seat",
    "1.5T 6MT Comfort Window Van 2-seat",
    "1.5T 6MT Luxury 7-seat",
    "1.5T 6MT Luxury Commercial 7-seat",
  ]);

  for (const variant of variants) {
    assert.deepEqual(
      [variant.market, variant.yearFrom, variant.powertrainKind, variant.fuel, variant.engineCc, variant.transmission, variant.gears, variant.drive, variant.icePowerKw, variant.lengthMm, variant.widthMm, variant.wheelbaseMm, variant.tankCapacityL],
      ["China", 2021, "ICE", "Petrol", 1451, "6-speed manual", 6, "RWD", 108, 5150, 1840, 3180, 53],
    );
    assert.equal(variant.powerHp, undefined);
    assert.equal(variant.power30MinKw, undefined);
    assert.equal(variant.status, "review");
  }

  const van = variants.find((variant) => variant.bodyType === "Van");
  assert.deepEqual([van?.heightMm, van?.curbWeightKg, van?.seats, van?.topSpeedKmh], [1910, 1475, 2, 165]);
  const commercial = variants.find((variant) => variant.name.includes("Luxury Commercial"));
  assert.equal(commercial?.curbWeightKg, undefined);
  assert.equal(commercial?.topSpeedKmh, undefined);
});
