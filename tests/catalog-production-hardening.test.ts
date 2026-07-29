import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");
const cleanupWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-storage-cleanup.yml", import.meta.url), "utf8");
const audit = fs.readFileSync(new URL("../scripts/catalog-audit-vehicle-knowledge.mjs", import.meta.url), "utf8");
const knowledgeSync = fs.readFileSync(new URL("../scripts/catalog-sync-vehicle-models.mjs", import.meta.url), "utf8");
const cleanup = fs.readFileSync(new URL("../scripts/catalog-clean-object-storage.mjs", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-source-scale.mjs", import.meta.url), "utf8");
const dataStorage = fs.readFileSync(new URL("../apps/web/lib/data.ts", import.meta.url), "utf8");
const storage = fs.readFileSync(new URL("../apps/web/lib/catalog/storage.ts", import.meta.url), "utf8");
const customs = fs.readFileSync(new URL("../packages/engine/src/calculation/russiaCustoms.ts", import.meta.url), "utf8");
const controls = fs.readFileSync(new URL("../docs/catalog-production-controls.md", import.meta.url), "utf8");

test("production workflow repairs vehicle knowledge only when the retained base is unhealthy", () => {
  const retainedAudit = workflow.indexOf("Audit retained production knowledge first");
  const syncModels = workflow.indexOf("scripts/catalog-sync-vehicle-models.mjs", retainedAudit);
  const syncSeed = workflow.indexOf("scripts/catalog-sync-vehicle-knowledge-seed.mjs", syncModels);
  const buildVariants = workflow.indexOf("scripts/catalog-build-vehicle-variants.mjs", syncSeed);
  const buildPower = workflow.indexOf("scripts/catalog-build-power-knowledge.mjs", buildVariants);
  const finalAudit = workflow.indexOf("scripts/catalog-audit-vehicle-knowledge.mjs", buildPower);
  const collect = workflow.indexOf("Collect listings, calculations and progressive galleries");

  assert.ok(retainedAudit >= 0, "the current production base must be audited before any external sync");
  assert.ok(syncModels > retainedAudit, "full model sync must be a repair path, not an unconditional blocker");
  assert.ok(syncSeed > syncModels, "manual seed records must be applied after the repair sync");
  assert.ok(buildVariants > syncSeed, "variant knowledge must be rebuilt after model repair");
  assert.ok(buildPower > buildVariants, "power knowledge must be rebuilt after variants");
  assert.ok(finalAudit > buildPower, "a final blocking audit must run after any repair");
  assert.ok(collect > finalAudit, "catalog collection must start only after a healthy final audit");
  assert.match(workflow, /if: steps\.retained_knowledge\.outcome != 'success'/);
  assert.match(workflow, /CATALOG_VEHICLE_KNOWLEDGE_MIN_MODELS: "5000"/);
  assert.match(workflow, /knowledge: \$\{\{ needs\.knowledge\.result \}\}/);
  assert.match(workflow, /needs\.knowledge\.result[^\n]*!= "success"/);
});

test("production workflow serializes knowledge writes and never cancels a running catalog build", () => {
  assert.match(workflow, /group: catalog-source-scale-daily\n  cancel-in-progress: false/);
  assert.match(workflow, /group: vehicle-knowledge-production-json\n      cancel-in-progress: false/);
  assert.match(workflow, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER: "30"/);
  assert.match(workflow, /CATALOG_MAX_IMAGES_PER_OFFER: "30"/);
});

test("vehicle model sync uses current VehiclesDB paths and retained knowledge on upstream failure", () => {
  assert.match(knowledgeSync, /vehiclesdb\/vehiclesdb@latest\/vehicles\.csv/);
  assert.doesNotMatch(knowledgeSync, /vehiclesdb\/vehiclesdb@latest\/dist\/vehicles\.csv/);
  assert.match(knowledgeSync, /huggingface\.co\/datasets\/vehiclesdb\/vehiclesdb\/resolve\/main\/vehicles\.csv/);
  assert.match(knowledgeSync, /fetchFirstAvailable/);
  assert.match(knowledgeSync, /retained_knowledge_used/);
  assert.match(knowledgeSync, /CATALOG_VEHICLE_KNOWLEDGE_MIN_MODELS/);
  assert.match(knowledgeSync, /upstream_model_count_below_minimum/);
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

test("publisher accumulates galleries before deduplication and protects the newest generations", () => {
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

test("daily Object Storage cleanup removes complete old prefixes and only orphaned aged images", () => {
  assert.match(dataStorage, /listObjects\?/);
  assert.match(dataStorage, /deletePrefix\?/);
  assert.match(dataStorage, /list-type/);
  assert.match(dataStorage, /NextContinuationToken/);
  assert.match(cleanup, /protectedGenerations/);
  assert.match(cleanup, /candidateGenerations/);
  assert.match(cleanup, /storage\.deletePrefix\(`catalog\/generations\/\$\{generationId\}`\)/);
  assert.match(cleanup, /liveImageKeys/);
  assert.match(cleanup, /internalChunks/);
  assert.match(cleanup, /modifiedAt < cutoff/);
  assert.match(cleanup, /plannedDeletes > MAX_DELETES/);
  assert.match(cleanupWorkflow, /cron: "17 2 \* \* \*"/);
  assert.match(cleanupWorkflow, /CATALOG_STORAGE_CLEANUP_DRY_RUN: "false"/);
  assert.match(cleanupWorkflow, /CATALOG_STORAGE_KEEP_GENERATIONS: "2"/);
  assert.match(cleanupWorkflow, /CATALOG_STORAGE_CLEANUP_GRACE_MS: "345600000"/);
});

test("large catalog search uses range shards and bounded chunk reads", () => {
  assert.match(storage, /power: new Map\(\)/);
  assert.match(storage, /mileage: new Map\(\)/);
  assert.match(storage, /engine: new Map\(\)/);
  assert.match(storage, /unionIndexIds\(manifest, "budget"/);
  assert.match(storage, /unionIndexIds\(manifest, "year"/);
  assert.match(storage, /unionIndexIds\(manifest, "mileage"/);
  assert.match(storage, /unionIndexIds\(manifest, "engine"/);
  assert.match(storage, /unionIndexIds\(manifest, "power"/);
  assert.match(storage, /CATALOG_SEARCH_CHUNK_CONCURRENCY/);
  assert.match(storage, /mapWithConcurrency\(chunkLocations/);
  assert.doesNotMatch(storage, /Promise\.all\(\[\.\.\.chunkKeys\.values\(\)\]/);
});

test("customs engine uses the 2026 coefficient columns rather than the 2025 columns", () => {
  assert.match(customs, /\[58\.84, 44\.05, 77\.48\]/);
  assert.match(customs, /\[139\.75, 49\.5, 82\.1\]/);
  assert.match(customs, /\[117\.68, 123\.78, 187\.4\]/);
  assert.doesNotMatch(customs, /\[58\.84, 40\.04, 70\.44\]/);
});

test("production control document fixes the CRM readiness gate", () => {
  assert.match(controls, /двух последовательных ежедневных production-проходов/);
  assert.match(controls, /не менее 5 000 активных моделей/);
  assert.match(controls, /Пиковая мощность электромотора не подставляется/);
  assert.match(controls, /Новая версия объявления не должна уменьшать уже накопленную галерею/);
  assert.match(controls, /destructive cleanup не запускается внутри неудачной публикации/);
});
