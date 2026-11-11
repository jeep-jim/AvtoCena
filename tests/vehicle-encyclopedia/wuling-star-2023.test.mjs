import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Wuling Star uses the official English name and preserves exact Chinese identities", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-star-2023-lineup.json")),
  ]);
  const model = workspace.records.model.find((record) => record.id === "wuling/xingyun");
  const variants = workspace.records.variant.filter((record) => record.generationId === "wuling/xingyun/launch-lineup-2023");

  assert.deepEqual(report.totals, { newSources: 2, replacedModels: 1, newGenerations: 1, newVariants: 2 });
  assert.deepEqual([model?.canonicalName, model?.slug, model?.productionFrom], ["Star", "star", "2023-09"]);
  assert.deepEqual(model?.bodyTypes, ["SUV"]);
  assert.deepEqual(model?.powertrainKinds, ["HEV"]);
  assert(model?.aliases.some((alias) => alias.value === "Xingyun" && alias.safe));
  assert(model?.sourceNames.some((alias) => alias.value === "五菱 星云" && alias.safe));
  assert.deepEqual(variants.map((variant) => variant.name).sort(), ["Flagship", "Standard"]);
  for (const variant of variants) {
    assert.deepEqual(
      [variant.bodyType, variant.powertrainKind, variant.transmission, variant.lengthMm, variant.widthMm, variant.heightMm, variant.wheelbaseMm, variant.groundClearanceMm],
      ["SUV", "HEV", "DHT", 4610, 1810, 1670, 2700, 178],
    );
    assert.equal("engineCc" in variant, false);
    assert.equal("motorPeakKw" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert.equal(variant.status, "review");
  }
});
