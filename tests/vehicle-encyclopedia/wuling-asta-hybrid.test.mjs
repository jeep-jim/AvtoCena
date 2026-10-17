import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Wuling Asta uses the official English identity and two exact HEV grades", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-asta-hybrid-specifications.json")),
  ]);
  const model = workspace.records.model.find((record) => record.id === "wuling/xingchen");
  const variants = workspace.records.variant.filter((record) => record.generationId === "wuling/xingchen/hybrid-2022");

  assert.deepEqual(report.totals, { newSources: 2, replacedModels: 1, newGenerations: 1, newVariants: 2 });
  assert.deepEqual([model?.canonicalName, model?.slug, model?.productionFrom], ["Asta", "asta", "2021-09"]);
  assert(model?.aliases.some((alias) => alias.value === "Xingchen" && alias.safe));
  assert(model?.sourceNames.some((alias) => alias.value === "五菱 星辰" && alias.safe));
  assert(model?.powertrainKinds.includes("ICE"));
  assert(model?.powertrainKinds.includes("HEV"));
  assert.deepEqual(variants.map((variant) => variant.name).sort(), ["2.0L DHT Power", "2.0L DHT Speed"]);
  for (const variant of variants) {
    assert.deepEqual(
      [variant.powertrainKind, variant.engineCc, variant.transmission, variant.drive, variant.icePowerKw, variant.lengthMm, variant.widthMm, variant.heightMm, variant.wheelbaseMm, variant.tankCapacityL, variant.seats],
      ["HEV", 1999, "DHT", "FWD", 100, 4594, 1820, 1740, 2750, 52, 5],
    );
    assert.equal("motorPeakKw" in variant, false);
    assert.equal("powerKw" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert.equal("powerHp" in variant, false);
    assert.equal(variant.status, "review");
  }
});
