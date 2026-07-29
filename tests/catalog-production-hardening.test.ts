import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");
const audit = fs.readFileSync(new URL("../scripts/catalog-audit-vehicle-knowledge.mjs", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-source-scale.mjs", import.meta.url), "utf8");
const controls = fs.readFileSync(new URL("../docs/catalog-production-controls.md", import.meta.url), "utf8");

test("production workflow performs a full vehicle-knowledge sync and blocks catalogue publication on collapse", () => {
  const syncModels = workflow.indexOf("scripts/catalog-sync-vehicle-models.mjs");
  const syncSeed = workflow.indexOf("scripts/catalog-sync-vehicle-knowledge-seed.mjs");
  const buildVariants = workflow.indexOf("scripts/catalog-build-vehicle-variants.mjs");
  const buildPower = workflow.indexOf("scripts/catalog-build-power-knowledge.mjs");
  const auditKnowledge = workflow.indexOf("scripts/catalog-audit-vehicle-knowledge.mjs");
  const collect = workflow.indexOf("Collect listings, calculations and progressive galleries");

  assert.ok(syncModels >= 0, "full model sync must run in production");
  assert.ok(syncSeed > syncModels, "manual seed records must be applied after the full model sync");
  assert.ok(buildVariants > syncSeed, "variant knowledge must be rebuilt after model sync");
  assert.ok(buildPower > buildVariants, "power knowledge must be rebuilt after variants");
  assert.ok(auditKnowledge > buildPower, "knowledge health gate must run after all knowledge builders");
  assert.ok(collect > auditKnowledge, "catalog collection must start only after a healthy knowledge audit");
  assert.match(workflow, /CATALOG_VEHICLE_KNOWLEDGE_MIN_MODELS: "5000"/);
  assert.match(workflow, /knowledge: \$\{\{ needs\.knowledge\.result \}\}/);
  assert.match(workflow, /needs\.knowledge\.result[^\n]*!= "success"/);
});

test("vehicle knowledge audit protects count, retention ratio and unique ids", () => {
  assert.match(audit, /CATALOG_VEHICLE_KNOWLEDGE_MIN_MODELS/);
  assert.match(audit, /CATALOG_VEHICLE_KNOWLEDGE_MIN_RETAINED_RATIO/);
  assert.match(audit, /models_below_minimum/);
  assert.match(audit, /models_collapse/);
  assert.match(audit, /duplicate_model_ids/);
  assert.match(audit, /duplicate_variant_ids/);
  assert.match(audit, /variantsWithThirtyMinutePower/);
  assert.match(audit, /certifiedPowerReferencesWithThirtyMinutePower/);
  assert.match(audit, /writeDataJson\(HEALTH_PATH, report\)/);
});

test("publisher accumulates galleries before deduplication and cleans only inventoried old generations", () => {
  assert.match(publisher, /function mergeOfferVersions/);
  assert.match(publisher, /images: uniqueImages\(\[\.\.\.\(primary\?\.images/);
  assert.match(publisher, /retainedById/);
  assert.match(publisher, /generatedById/);
  assert.match(publisher, /galleriesAccumulated/);
  assert.match(publisher, /generationInventory/);
  assert.match(publisher, /generationKeepCount/);
  assert.match(publisher, /generationCleanupGraceMs/);
  assert.match(publisher, /entry\.objectKeys\.length > 0/);
  assert.match(publisher, /manifest = await persistCatalogOffers\(offers\);[\s\S]*recordAndCleanupGenerations/);
});

test("production control document fixes the CRM readiness gate", () => {
  assert.match(controls, /двух последовательных ежедневных production-проходов/);
  assert.match(controls, /не менее 5 000 активных моделей/);
  assert.match(controls, /Пиковая мощность электромотора не подставляется/);
  assert.match(controls, /Новая версия объявления не должна уменьшать уже накопленную галерею/);
  assert.match(controls, /не запускать destructive cleanup после неудачной публикации/);
});
