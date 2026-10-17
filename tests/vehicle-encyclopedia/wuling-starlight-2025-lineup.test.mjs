import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Wuling Starlight keeps all six exact 2025 model-year grades", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-starlight-2025-lineup.json")),
  ]);
  const model = workspace.records.model.find((record) => record.id === "wuling/starlight");
  const variants = workspace.records.variant.filter((record) => record.generationId === "wuling/starlight/2025-model-year");

  assert.deepEqual(report.totals, { newSources: 2, replacedModels: 1, newGenerations: 1, newVariants: 6 });
  assert.deepEqual([model?.canonicalName, model?.productionFrom], ["Starlight", "2023-12"]);
  assert.deepEqual(model?.bodyTypes, ["Sedan"]);
  assert.deepEqual(model?.powertrainKinds, ["PHEV", "BEV"]);
  assert.equal(variants.length, 6);
  assert.equal(variants.filter((variant) => variant.powertrainKind === "PHEV").length, 3);
  assert.equal(variants.filter((variant) => variant.powertrainKind === "BEV").length, 3);
  assert.deepEqual([...new Set(variants.map((variant) => variant.rangeKm))].sort((a, b) => a - b), [70, 150, 510, 610]);
  for (const variant of variants) {
    assert.match(variant.name, /^[\x20-\x7E]+$/);
    assert.equal(variant.aliases.length, 1);
    assert.equal(variant.bodyType, "Sedan");
    assert.equal("rangeStandard" in variant, false);
    assert.equal("batteryGrossKwh" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert.equal(variant.status, "review");
  }
});
