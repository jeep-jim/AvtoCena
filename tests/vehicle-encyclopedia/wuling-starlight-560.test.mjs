import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Starlight 560 keeps all four exact 2026 launch grades without invented specifications", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-starlight-560-lineup.json")),
  ]);
  const model = workspace.records.model.find((record) => record.id === "wuling/starlight-560");
  const variants = workspace.records.variant.filter((record) => record.generationId === "wuling/starlight-560/launch-lineup-2026");

  assert.deepEqual(report.totals, { newSources: 2, replacedModels: 1, newGenerations: 1, newVariants: 4 });
  assert.deepEqual([model?.canonicalName, model?.productionFrom], ["Starlight 560", "2026-01"]);
  assert.deepEqual(model?.bodyTypes, ["SUV"]);
  assert.deepEqual(model?.powertrainKinds, ["ICE", "PHEV", "BEV"]);
  assert.equal(variants.length, 4);

  const phev = variants.find((variant) => variant.id.endsWith("phev-125-km-luxury"));
  const bev = variants.find((variant) => variant.id.endsWith("bev-500-km-luxury"));
  assert.deepEqual([phev?.rangeKm, "rangeStandard" in phev], [125, false]);
  assert.deepEqual([bev?.rangeKm, bev?.rangeStandard], [500, "CLTC"]);
  for (const variant of variants) {
    assert.match(variant.name, /^[\x20-\x7E]+$/);
    assert.equal(variant.bodyType, "SUV");
    assert.equal(variant.yearFrom, 2026);
    assert.equal("engineCc" in variant, false);
    assert.equal("motorPeakKw" in variant, false);
    assert.equal("batteryGrossKwh" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert.equal(variant.status, "review");
  }
});
