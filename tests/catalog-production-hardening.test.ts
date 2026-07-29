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

function jobBlock(name: string, next: string) {
  return workflow.slice(workflow.indexOf(`\n  ${name}:`), workflow.indexOf(`\n  ${next}:`));
}

test("vehicle knowledge is audited without blocking the market collectors", () => {
  const knowledge = jobBlock("knowledge", "collect");
  const collect = jobBlock("collect", "publish");
  const publish = jobBlock("publish", "health");

  assert.match(knowledge, /Audit vehicle knowledge \(diagnostic\)/);
  assert.match(knowledge, /continue-on-error: true/);
  assert.match(knowledge, /Audit current production knowledge without rewriting it/);
  assert.doesNotMatch(knowledge, /catalog-sync-vehicle-models\.mjs/);
  assert.doesNotMatch(knowledge, /catalog-build-vehicle-variants\.mjs/);
  assert.match(collect, /needs: validate/);
  assert.doesNotMatch(collect, /needs: \[validate, knowledge\]/);
  assert.match(publish, /needs: \[validate, collect\]/);
  assert.doesNotMatch(publish, /needs: \[validate, knowledge, collect\]/);
  assert.match(workflow, /knowledge diagnostic: \$\{\{ needs\.knowledge\.result \}\}/);
  assert.doesNotMatch(workflow, /needs\.knowledge\.result[^\n]*!= "success"/);
});

test("production workflow serializes knowledge access and never cancels a running catalog build", () => {
  assert.match(workflow, /group: catalog-source-scale-daily\n  cancel-in-progress: false/);
  assert.match(workflow, /group: vehicle-knowledge-production-json\n      cancel-in-progress: false/);
  assert.match(workflow, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER: "30"/);
  assert.match(workflow, /CATALOG_MAX_IMAGES_PER_OFFER: "30"/);
  assert.match(workflow, /market: \[korea, china, japan, uae, europe, georgia, kyrgyzstan\]/);
  assert.match(workflow, /shard: \[0, 1, 2\]/);
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
