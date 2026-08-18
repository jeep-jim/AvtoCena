import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("new official active identities stay exact, English-canonical and production-isolated", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/brand-model-official-active-05.json")),
  ]);
  const brands = new Map(workspace.records.brand.map((brand) => [brand.id, brand]));
  const models = new Map(workspace.records.model.map((model) => [model.id, model]));
  const logoOwners = new Set(workspace.records.media.filter((media) => media.role === "brand_logo").map((media) => media.ownerId));

  assert.deepEqual(report.totals, {
    newSources: 9,
    newBrands: 4,
    newModels: 7,
    newGenerations: 3,
    newVariants: 3,
  });
  assert.equal(report.productionConnected, false);
  assert.deepEqual(report.brandIds, ["audi-china", "icaur", "jac-yiwei", "lepas"]);
  assert.equal(report.policy.icarAndIcaurNotMergedWithoutOfficialEvidence, true);

  assert.equal(brands.get("lepas")?.canonicalName, "LEPAS");
  assert.equal(brands.get("icaur")?.canonicalName, "iCAUR");
  assert.equal(brands.get("jac-yiwei")?.canonicalName, "JAC Yiwei");
  assert.equal(brands.get("audi-china")?.canonicalName, "AUDI China");
  assert.equal(brands.get("audi-china")?.aliases.find((alias) => alias.value === "AUDI")?.safe, false);
  for (const brandId of report.brandIds) assert.equal(logoOwners.has(brandId), false);

  assert.equal(models.get("audi-china/e5-sportback")?.canonicalName, "E5 Sportback");
  assert.equal(models.get("jac-yiwei/3")?.sourceNames.find((alias) => alias.value === "E30X")?.safe, true);
  assert.equal(models.get("jac-yiwei/3")?.sourceNames.find((alias) => alias.value === "钇为3")?.safe, true);
  assert.equal(models.get("icaur/v27")?.powertrainKinds[0], "EREV");
  for (const modelId of report.modelIds) assert.equal(models.get(modelId)?.status, "review");
});

test("Yiwei 3 and iCAUR V23 variants retain only exact official values", async () => {
  const workspace = await loadWorkspace(DATA_ROOT);
  const variants = new Map(workspace.records.variant.map((variant) => [variant.id, variant]));
  const yiwei = variants.get("jac-yiwei/3/current-china-2026/505-km");
  const v23Small = variants.get("icaur/v23/current-global-2026/59-93-kwh");
  const v23Large = variants.get("icaur/v23/current-global-2026/81-76-kwh");

  assert(yiwei);
  assert.equal(yiwei.motorPeakKw, 100);
  assert.equal(yiwei.batteryRatedKwh, 51.5);
  assert.equal(yiwei.rangeKm, 505);
  assert.equal(yiwei.lengthMm, 4025);
  assert.equal(yiwei.wheelbaseMm, 2620);
  assert.equal(yiwei.topSpeedKmh, 150);
  assert.equal("rangeStandard" in yiwei, false);
  assert.equal("power30MinKw" in yiwei, false);

  assert(v23Small);
  assert(v23Large);
  assert.equal(v23Small.batteryRatedKwh, 59.93);
  assert.equal(v23Small.motorPeakKw, 100);
  assert.equal(v23Large.batteryRatedKwh, 81.76);
  assert.equal(v23Large.motorPeakKw, 155);
  for (const variant of [v23Small, v23Large]) {
    assert.equal(variant.lengthMm, 4220);
    assert.equal(variant.widthMm, 1915);
    assert.equal(variant.heightMm, 1845);
    assert.equal(variant.wheelbaseMm, 2735);
    assert.equal("drive" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert.equal(variant.status, "review");
  }
});
