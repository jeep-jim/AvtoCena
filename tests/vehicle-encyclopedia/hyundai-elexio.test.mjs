import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Hyundai ELEXIO keeps an English identity and only exact official launch facts", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/hyundai-elexio-official-2025.json")),
  ]);
  const model = workspace.records.model.find((record) => record.id === "hyundai/elexio");
  const generation = workspace.records.generation.find((record) => record.id === "hyundai/elexio/e-gmp");
  const variant = workspace.records.variant.find((record) => record.id === "hyundai/elexio/e-gmp/china-722-km-cltc");

  assert.deepEqual(report.totals, { newSources: 1, newModels: 1, newGenerations: 1, newVariants: 1 });
  assert.equal(report.productionConnected, false);
  assert.equal(report.policy.englishCanonicalNameRequired, true);
  assert.equal(model?.canonicalName, "ELEXIO");
  assert.deepEqual(model?.sourceNames, [{
    value: "羿欧",
    kind: "localized",
    safe: true,
    language: "zh-CN",
    market: "China",
    sourceIds: ["src-huawei-hicar-current-models-2026"],
  }]);
  assert.deepEqual(generation?.platformCodes, ["E-GMP"]);
  assert(variant);
  assert.deepEqual([variant.rangeKm, variant.rangeStandard], [722, "CLTC"]);
  assert.equal("batteryGrossKwh" in variant, false);
  assert.equal("batteryUsableKwh" in variant, false);
  assert.equal("batteryRatedKwh" in variant, false);
  assert.equal("power30MinKw" in variant, false);
  assert.equal(variant.status, "review");
});
