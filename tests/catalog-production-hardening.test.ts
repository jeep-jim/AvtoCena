import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseDubizzleLabelBoundDetailFields } from "../apps/web/lib/catalog/dubizzle-exact-source";

const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-v2-production.yml", import.meta.url), "utf8");
const cleanupWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-storage-cleanup.yml", import.meta.url), "utf8");
const prestigeRepairWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-v6-prestige-repair.yml", import.meta.url), "utf8");
const audit = fs.readFileSync(new URL("../scripts/catalog-audit-vehicle-knowledge.mjs", import.meta.url), "utf8");
const postPersistAudit = fs.readFileSync(new URL("../scripts/catalog-live-postpersist-audit.mjs", import.meta.url), "utf8");
const knowledgeSync = fs.readFileSync(new URL("../scripts/catalog-sync-vehicle-models.mjs", import.meta.url), "utf8");
const cleanup = fs.readFileSync(new URL("../scripts/catalog-clean-object-storage.mjs", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-source-scale.mjs", import.meta.url), "utf8");
const standardMarketPublisher = fs.readFileSync(new URL("../scripts/catalog-publish-market.mjs", import.meta.url), "utf8");
const recoveryPublisher = fs.readFileSync(new URL("../scripts/catalog-live-recovery-publish-batch.mjs", import.meta.url), "utf8");
const singleRecoveryPublisher = fs.readFileSync(new URL("../scripts/catalog-live-recovery-publish.mjs", import.meta.url), "utf8");
const verifiedGenerationRestore = fs.readFileSync(new URL("../scripts/catalog-restore-verified-generation.mjs", import.meta.url), "utf8");
const verifiedGenerationRestoreWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-restore-verified-generation.yml", import.meta.url), "utf8");
const v3MarketWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-v3-market-10k-reusable.yml", import.meta.url), "utf8");
const dataStorage = fs.readFileSync(new URL("../apps/web/lib/data.ts", import.meta.url), "utf8");
const storage = fs.readFileSync(new URL("../apps/web/lib/catalog/storage.ts", import.meta.url), "utf8");
const strictSourceDetail = fs.readFileSync(new URL("../apps/web/lib/catalog/strict-source-detail-wrapper.ts", import.meta.url), "utf8");
const customs = fs.readFileSync(new URL("../packages/engine/src/calculation/russiaCustoms.ts", import.meta.url), "utf8");
const controls = fs.readFileSync(new URL("../docs/catalog-production-controls.md", import.meta.url), "utf8");

test("production workflow audits the existing vehicle knowledge snapshot without a two-hour rebuild gate", () => {
  const knowledgeStart = workflow.indexOf("\n  knowledge:");
  const collect = workflow.indexOf("\n  collect:");
  const knowledgeBlock = workflow.slice(knowledgeStart, collect);

  assert.ok(knowledgeStart >= 0);
  assert.ok(collect > knowledgeStart);
  assert.match(knowledgeBlock, /Verify current vehicle encyclopedia/);
  assert.match(knowledgeBlock, /timeout-minutes: 15/);
  assert.match(knowledgeBlock, /Audit current encyclopedia snapshot/);
  assert.match(knowledgeBlock, /catalog-audit-vehicle-knowledge\.mjs/);
  assert.match(knowledgeBlock, /CATALOG_VEHICLE_KNOWLEDGE_MIN_MODELS: "6000"/);
  assert.doesNotMatch(knowledgeBlock, /Refresh model encyclopedia/);
  assert.doesNotMatch(knowledgeBlock, /Accumulate model variants from verified listings/);
  assert.doesNotMatch(knowledgeBlock, /Accumulate power knowledge/);
  assert.doesNotMatch(knowledgeBlock, /catalog-sync-vehicle-models\.mjs/);
});

test("production workflow serializes catalog builds and never cancels a running build", () => {
  assert.match(workflow, /group: catalog-v2-production\n  cancel-in-progress: false/);
  assert.match(workflow, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER: "30"/);
  assert.match(workflow, /CATALOG_MAX_IMAGES_PER_OFFER: "30"/);
});

test("Prestige failed-chunk repair uses GitHub CLI artifact downloads and remains no-publish", () => {
  assert.match(prestigeRepairWorkflow, /permissions:\n  actions: read\n  contents: read/);
  assert.match(prestigeRepairWorkflow, /gh run download "\$SOURCE_RUN_ID"/);
  assert.match(prestigeRepairWorkflow, /--pattern 'prestige-japan-chunk-\*'/);
  assert.doesNotMatch(prestigeRepairWorkflow, /\bcurl\b/);
  assert.doesNotMatch(prestigeRepairWorkflow, /catalog-publish|persistCatalogOffers|JSON_STORAGE_DRIVER|YC_OBJECT_STORAGE/);
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

test("post-persist market audit rejects broken source identity and shallow Korea galleries", () => {
  assert.match(postPersistAudit, /hasCredibleCatalogIdentity/);
  assert.match(postPersistAudit, /invalidIdentityCount/);
  assert.match(postPersistAudit, /invalid_identity/);
  assert.match(postPersistAudit, /market === "korea"[\s\S]*belowFiveImagesCount/);
  assert.match(postPersistAudit, /korea:below_five_images/);
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

test("recovery publisher always preserves untouched full maintenance state exactly", () => {
  assert.match(recoveryPublisher, /readAllOffersForMaintenance/);
  assert.match(recoveryPublisher, /const preserveUntouchedExact = true/);
  assert.match(recoveryPublisher, /preservedInternalByMarket/);
  assert.match(recoveryPublisher, /preservedPublicHashByMarket/);
  assert.match(recoveryPublisher, /recovery_batch_preserved_internal_gate_failed/);
  assert.match(recoveryPublisher, /recovery_batch_preserved_manifest_mismatch/);
  assert.match(recoveryPublisher, /recovery_batch_preserved_hash_mismatch/);
  assert.match(recoveryPublisher, /beforePublishValidate\(publishedOffers\)/);
  assert.match(recoveryPublisher, /previousPublicCountByMarket/);
  assert.match(recoveryPublisher, /recovery_batch_public_regression_guard/);
});

test("recovery preservation gates keep untouched public rows exact before any generation write", () => {
  assert.match(storage, /preservePublicOffersByMarket/);
  assert.match(storage, /exactPreserveMarkets\.has\(offer\.market\)[\s\S]*\? offer[\s\S]*enrichOfferWithVehicleKnowledge/);
  assert.match(storage, /canonicalizePublicCatalogOffers\(publicOffers, exactPreserveMarkets\)/);
  assert.match(storage, /skipDisplayIdentityMarkets\.has\(offer\.market\)[\s\S]*\? offer[\s\S]*applyEncyclopediaDisplayIdentity\(offer\)/);
  assert.match(storage, /const publicOffers = nextOffers\.filter\(\(offer\) => !exactPreserveMarkets\.has\(offer\.market\) && isPublicOffer\(offer\)\);[\s\S]*Object\.entries\(preservedPublicOffersByMarket\)[\s\S]*beforePersistValidate\(publicOffers\)[\s\S]*const generationId[\s\S]*persistInternalCatalog/);
  assert.match(singleRecoveryPublisher, /preservePublicOffersByMarket: preservedPublicRowsByMarket[\s\S]*beforePersistValidate\(publicOffers\)[\s\S]*recovery_prewrite_preservation_gate_failed/);
  assert.match(recoveryPublisher, /preservePublicOffersByMarket: preserveUntouchedExact \? preservedPublicRowsByMarket : undefined[\s\S]*beforePersistValidate\(publicOffers\)[\s\S]*recovery_batch_prewrite_preservation_gate_failed/);
  assert.match(singleRecoveryPublisher, /function stableJsonValue/);
  assert.match(recoveryPublisher, /function stableJsonValue/);
});

test("standard one-market publisher cannot shrink the target or mutate untouched markets", () => {
  assert.match(standardMarketPublisher, /readAllOffersForMaintenance/);
  assert.match(standardMarketPublisher, /preservePublicOffersByMarket: preservedPublicRowsByMarket/);
  assert.match(standardMarketPublisher, /beforePersistValidate\(publicOffers\)/);
  assert.match(standardMarketPublisher, /beforePublishValidate\(publishedOffers\)/);
  assert.match(standardMarketPublisher, /catalog_prewrite_preservation_gate_failed/);
  assert.match(standardMarketPublisher, /catalog_public_regression_guard/);
  assert.match(standardMarketPublisher, /previousPublicCount = currentMarketRows\.length/);
  assert.doesNotMatch(standardMarketPublisher, /otherCutoff/);
  assert.match(storage, /beforePublishValidate\?:/);
  assert.match(storage, /canonicalizePublicCatalogOffers\(publicOffers, exactPreserveMarkets\)[\s\S]*beforePublishValidate\(publishedOffers\)[\s\S]*const generationId/);
});

test("verified-generation restore is preflight-first and shares the global writer lock", () => {
  assert.match(verifiedGenerationRestore, /catalog_restore_chunk_invalid/);
  assert.match(verifiedGenerationRestore, /catalog_restore_market_missing/);
  assert.match(verifiedGenerationRestore, /previewCanonicalPublicCatalogOffers/);
  assert.match(verifiedGenerationRestore, /catalog_restore_canonical_total_mismatch/);
  assert.match(verifiedGenerationRestore, /catalog_restore_forbidden_makes/);
  assert.match(verifiedGenerationRestore, /preservePublicOffersByMarket/);
  assert.match(verifiedGenerationRestore, /preservePublicOffersByMarket: preservedPublicOffersByMarket/);
  assert.match(verifiedGenerationRestore, /beforePersistValidate\(publicOffers\)/);
  assert.match(verifiedGenerationRestore, /beforePublishValidate\(publishedOffers\)/);
  assert.match(verifiedGenerationRestore, /persistCatalogOffers\(\[\.\.\.combinedById\.values\(\)\]/);
  assert.ok(verifiedGenerationRestore.indexOf("catalog_restore_canonical_total_mismatch") < verifiedGenerationRestore.indexOf("persistCatalogOffers("));
  assert.doesNotMatch(verifiedGenerationRestore, /writeJson\("catalog\/manifest\.json"/);
  assert.match(verifiedGenerationRestoreWorkflow, /group: catalog-live-daily-working-markets/);
  assert.match(verifiedGenerationRestoreWorkflow, /cancel-in-progress: \$\{\{ contains\(github\.event\.head_commit\.message, '\[preempt-restore\]'\) \}\}/);
  assert.match(verifiedGenerationRestoreWorkflow, /set -euo pipefail/);
  assert.match(v3MarketWorkflow, /group: catalog-live-daily-working-markets/);
});

test("single recovery publisher preserves full maintenance state and enforces target gallery depth", () => {
  assert.match(singleRecoveryPublisher, /readAllOffersForMaintenance/);
  assert.match(singleRecoveryPublisher, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER\s*\|\|\s*5/);
  assert.match(singleRecoveryPublisher, /recovery_target_image_gate_failed/);
  assert.match(singleRecoveryPublisher, /preservedInternalByMarket/);
  assert.match(singleRecoveryPublisher, /preservedPublicHashByMarket/);
  assert.match(singleRecoveryPublisher, /postPersistPublicHashByMarket/);
  assert.match(singleRecoveryPublisher, /preservationFailures/);
  assert.match(singleRecoveryPublisher, /recovery_preserved_internal_gate_failed/);
  assert.match(singleRecoveryPublisher, /recovery_duplicate_id_in_full_state/);
});

test("daily cleanup keeps a bounded six-hour grace while preserving both live manifests", () => {
  assert.match(dataStorage, /listObjects\?/);
  assert.match(dataStorage, /requested \? normalizeStorageKey\(requested\) : ""/);
  assert.match(dataStorage, /requested \? normalizeStorageKey\(requested\) : ""\]\s*\.filter\(Boolean\)\.join\("\/"\)/);
  assert.match(dataStorage, /listBucketObjects\?\(prefix\?: string\)/);
  assert.match(dataStorage, /listObjectVersions\?\(\)/);
  assert.match(dataStorage, /listMultipartUploads\?\(\)/);
  assert.match(dataStorage, /listRawObjects\(normalizedPrefix: string, stripConfiguredPrefix: boolean\)/);
  assert.match(dataStorage, /listBucketObjects\(prefix = ""\)/);
  assert.match(dataStorage, /deletePrefix\?/);
  assert.match(dataStorage, /list-type/);
  assert.match(dataStorage, /NextContinuationToken/);
  assert.match(cleanup, /EMERGENCY \? 0 : 2/);
  assert.match(cleanup, /\.\.\.\(!EMERGENCY && internalGeneration/);
  assert.match(cleanup, /\.\.\.\(!EMERGENCY \? generationIds\.slice/);
  assert.match(cleanup, /includeInternal/);
  assert.match(cleanup, /protectedInternalPaths/);
  assert.match(cleanup, /protectedInternalPaths\.has\(key\)/);
  assert.match(cleanup, /readLiveImageKeys\(protectedGenerations, internalManifest, true\)/);
  assert.match(cleanup, /const oldEnough = EMERGENCY \|\|/);
  assert.match(cleanup, /storage\.deletePrefix\(`catalog\/generations\/\$\{generationId\}`\)/);
  assert.match(cleanup, /plannedBytes/);
  assert.match(cleanup, /storage\.listObjects\("catalog"\)/);
  assert.match(cleanup, /storage\.listObjects\(""\)/);
  assert.match(cleanup, /catalogInventory/);
  assert.match(cleanup, /namespaceInventory/);
  assert.match(cleanup, /physicalBucketInventory/);
  assert.match(cleanup, /outsideConfiguredNamespaceBytes/);
  assert.match(cleanup, /storage\.listBucketObjects\?\.\(""\)/);
  assert.match(cleanup, /objectVersionInventory/);
  assert.match(cleanup, /nonCurrentBytes/);
  assert.match(cleanup, /multipartUploadInventory/);
  assert.match(cleanup, /nonCatalogBytes/);
  assert.match(cleanup, /unaccountedBytes/);
  assert.match(cleanup, /objectPrefixSummary\(catalogObjects\)/);
  assert.match(cleanup, /objectPrefixSummary\(namespaceObjects\)/);
  assert.match(cleanup, /plannedDeletes > MAX_DELETES/);
  assert.match(cleanupWorkflow, /cron: "40 2 \* \* \*"/);
  assert.match(cleanupWorkflow, /apps\/web\/lib\/data\.ts/);
  assert.match(cleanup, /version: 5/);
  assert.match(cleanupWorkflow, /CATALOG_STORAGE_CLEANUP_DRY_RUN: "false"/);
  assert.match(cleanupWorkflow, /CATALOG_STORAGE_KEEP_GENERATIONS: "2"/);
  assert.match(cleanupWorkflow, /CATALOG_STORAGE_EMERGENCY: "false"/);
  assert.match(cleanupWorkflow, /CATALOG_STORAGE_CLEANUP_GRACE_MS: "21600000"/);
  assert.match(cleanupWorkflow, /group: catalog-object-storage-cleanup/);
  assert.doesNotMatch(cleanupWorkflow, /group: catalog-live-daily-working-markets/);
  assert.match(cleanup, /const MIN_GRACE_MS = EMERGENCY \? 0 : 6 \* 60 \* 60 \* 1_000/);
  assert.match(cleanup, /generations: objectBytes\(generationObjects\)/);
  assert.doesNotMatch(cleanupWorkflow, /createWorkflowDispatch/);
});

test("large catalog search uses compact projections and bounded fallback chunk reads", () => {
  assert.match(storage, /const maps: Record<string, Map<string, string\[\]>> = \{ market: new Map\(\) \}/);
  assert.doesNotMatch(storage, /power: new Map\(\)/);
  assert.match(storage, /const searchProjectionCache = new Map/);
  assert.match(storage, /readSearchProjection\(manifest\.generationId, market\)/);
  assert.match(storage, /indexes\/projection/);
  assert.match(storage, /const needsProjection = Boolean/);
  assert.match(storage, /CATALOG_SEARCH_CHUNK_CONCURRENCY/);
  assert.match(storage, /mapWithConcurrency\(chunkLocations/);
  assert.doesNotMatch(storage, /Promise\.all\(\[\.\.\.chunkKeys\.values\(\)\]\)/);
});

test("Object Storage publication bounds dynamic index keys and reports the failing path", () => {
  assert.match(storage, /MAX_INDEX_SHARD_BYTES = 180/);
  assert.match(storage, /catalogIndexShardKey/);
  assert.match(storage, /Buffer\.byteLength\(normalized, "utf8"\)/);
  assert.match(storage, /createHash\("sha256"\)/);
  assert.match(dataStorage, /object_storage_\$\{method\}_\$\{response\.status\}/);
  assert.match(dataStorage, /path=\$\{normalizedPath\.slice/);
  assert.match(publisher, /Buffer\.byteLength\(normalized, "utf8"\) <= 180/);
});

test("generic source detail wrapper is fail-closed and never scrapes page-wide semantics or galleries", () => {
  assert.match(strictSourceDetail, /strict_source_adapter_identity_only/);
  assert.match(strictSourceDetail, /photoIdentityVerified/);
  assert.match(strictSourceDetail, /originalFetchImages/);
  assert.doesNotMatch(strictSourceDetail, /findStructuredValue/);
  assert.doesNotMatch(strictSourceDetail, /mergeStructuredFields/);
  assert.doesNotMatch(strictSourceDetail, /mergeTextFields/);
  assert.doesNotMatch(strictSourceDetail, /htmlAttributeImages/);
  assert.doesNotMatch(strictSourceDetail, /scriptImages/);
  assert.doesNotMatch(strictSourceDetail, /\bfetch\s*\(/);
});

test("Dubizzle detail semantics are label-bound to Car Overview and ignore seller/recommendation noise", () => {
  const markup = `
    <section><h2>Car Overview</h2>
      <div>Body Type</div><div>Sedan</div>
      <div>Fuel Type</div><div>Petrol</div>
      <div>Transmission Type</div><div>Automatic</div>
      <div>Drive Type</div><div>RWD</div>
      <div>Engine Capacity</div><div>3.0 L</div>
      <div>Horsepower</div><div>375 HP</div>
      <div>Mileage</div><div>48,200 km</div>
    </section>
    <h2>Description</h2><p>Seller says SUV AWD Hybrid CVT 999 HP in unrelated marketing text.</p>
    <aside>Recommended cars: SUV AWD Diesel Manual</aside>`;
  const fields = parseDubizzleLabelBoundDetailFields(markup);
  assert.equal(fields.bodyType, "Sedan");
  assert.equal(fields.fuel, "Petrol");
  assert.equal(fields.transmission, "Automatic");
  assert.equal(fields.drive, "RWD");
  assert.equal(fields.engineCc, 3000);
  assert.equal(fields.powerHp, 375);
  assert.equal(fields.mileageKm, 48200);
});

test("Dubizzle refuses semantic inference when Car Overview labels are absent", () => {
  const fields = parseDubizzleLabelBoundDetailFields(`<p>Seller description: SUV AWD Automatic Hybrid, 500 HP, only 10,000 km.</p>`);
  assert.deepEqual(fields, {});
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
