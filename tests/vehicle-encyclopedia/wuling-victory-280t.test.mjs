import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Wuling Victory replaces the Kaijie romanization and keeps two exact 280T grades", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-victory-280t-specifications.json")),
  ]);
  const model = workspace.records.model.find((record) => record.id === "wuling/kaijie");
  const variants = workspace.records.variant.filter((record) => record.generationId === "wuling/kaijie/280t-2022");

  assert.deepEqual(report.totals, { newSources: 3, replacedModels: 1, newGenerations: 1, newVariants: 2 });
  assert.deepEqual([model?.canonicalName, model?.slug], ["Victory", "victory"]);
  assert(model?.aliases.some((item) => item.value === "Kaijie" && item.safe));
  assert(model?.sourceNames.some((item) => item.value === "五菱 凯捷" && item.safe));
  assert.deepEqual(variants.map((variant) => variant.name).sort(), ["1.5T CVT 280T Flagship", "1.5T CVT 280T Premium"]);

  for (const variant of variants) {
    assert.deepEqual(
      [variant.market, variant.yearFrom, variant.bodyType, variant.powertrainKind, variant.engineCc, variant.transmission, variant.drive, variant.powerHp, variant.powerHpStandard, variant.icePowerKw, variant.lengthMm, variant.widthMm, variant.heightMm, variant.wheelbaseMm, variant.curbWeightKg, variant.tankCapacityL, variant.seats, variant.topSpeedKmh],
      ["China", 2022, "MPV", "ICE", 1498, "CVT", "FWD", 177, "PS", 130, 4875, 1880, 1700, 2800, 1700, 56, 6, 170],
    );
    assert.equal(variant.fuel, undefined);
    assert.equal(variant.gears, undefined);
    assert.equal(variant.power30MinKw, undefined);
    assert.equal(variant.status, "review");
  }
});
