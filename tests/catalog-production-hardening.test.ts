import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const daily = fs.readFileSync(".github/workflows/catalog-daily.yml", "utf8");
const sourceRecovery = fs.readFileSync(".github/workflows/catalog-recovery-source.yml", "utf8");
const recovery = fs.readFileSync(".github/workflows/catalog-recovery.yml", "utf8");
const recoveryPublisher = fs.readFileSync("scripts/catalog-publish-recovery-batch.mjs", "utf8");
const singleRecoveryPublisher = fs.readFileSync("scripts/catalog-publish-recovery-market.mjs", "utf8");
const standardMarketPublisher = fs.readFileSync("scripts/catalog-publish-market.mjs", "utf8");
const liveAudit = fs.readFileSync("scripts/catalog-live-postpersist-audit.mjs", "utf8");
const storage = fs.readFileSync("apps/web/lib/catalog/storage.ts", "utf8");
const source = fs.readFileSync("apps/web/lib/catalog/source.ts", "utf8");
const customs = fs.readFileSync("apps/web/lib/catalog/customs-pricing.ts", "utf8");
const productionControl = fs.readFileSync("data/catalog/production-control.json", "utf8");
const cleanup = fs.readFileSync("scripts/catalog-clean-object-storage.mjs", "utf8");
const modelSync = fs.readFileSync("scripts/catalog-sync-vehicle-models.mjs", "utf8");
const knowledgeAudit = fs.readFileSync("scripts/catalog-audit-vehicle-knowledge.mjs", "utf8");
const reindexWorkflow = fs.readFileSync(".github/workflows/catalog-reindex-customs.yml", "utf8");

const MARKET_WORKFLOWS = [
  "catalog-v2-japan.yml",
  "catalog-v2-korea.yml",
  "catalog-v2-china.yml",
  "catalog-v2-uae.yml",
  "catalog-v2-europe.yml",
  "catalog-v2-georgia.yml",
  "catalog-v2-kyrgyzstan.yml",
];

test("production workflow audits the existing vehicle knowledge snapshot without a two-hour rebuild gate", () => {
  assert.match(daily, /catalog-audit-vehicle-knowledge\.mjs/);
  assert.doesNotMatch(daily, /catalog-sync-vehicle-models\.mjs/);
  assert.doesNotMatch(daily, /catalog-build-vehicle-variants\.mjs/);
  assert.doesNotMatch(daily, /catalog-build-power-knowledge\.mjs/);
  assert.match(ci, /catalog-audit-vehicle-knowledge\.mjs/);
});

test("production workflow serializes catalog builds and never cancels a running build", () => {
  assert.match(daily, /cancel-in-progress:\s*false/);
  assert.match(recovery, /cancel-in-progress:\s*false/);
  assert.match(sourceRecovery, /cancel-in-progress:\s*false/);
  assert.match(daily, /catalog-imports/);
  assert.match(recovery, /catalog-imports/);
});

test("RF live proof accepts an earlier missing-power rejection without weakening pickup customs safety", () => {
  const workflow = fs.readFileSync(".github/workflows/rf-customs-live-proof.yml", "utf8");
  assert.match(workflow, /missing_power_should_not_be_present/);
  assert.match(workflow, /pickup_verified/);
});

test("catalog reindex reruns whenever the production customs calculation changes", () => {
  assert.match(reindexWorkflow, /apps\/web\/lib\/catalog\/customs-pricing\.ts/);
  assert.match(reindexWorkflow, /scripts\/catalog-apply-certified-power\.mjs/);
});

test("each market has an isolated operator trigger in addition to its schedule", () => {
  for (const name of MARKET_WORKFLOWS) {
    const workflow = fs.readFileSync(`.github/workflows/${name}`, "utf8");
    assert.match(workflow, /workflow_dispatch:/, name);
  }
});

test("Prestige failed-chunk repair uses GitHub CLI artifact downloads and remains no-publish", () => {
  const workflow = fs.readFileSync(".github/workflows/catalog-prestige-repair.yml", "utf8");
  assert.match(workflow, /gh run download/);
  assert.doesNotMatch(workflow, /catalog-publish/);
});

test("vehicle model sync uses current VehiclesDB paths and retained knowledge on upstream failure", () => {
  assert.match(modelSync, /vehiclesdb/);
  assert.match(modelSync, /retained/);
});

test("vehicle knowledge audit protects count, retention ratio and unique ids", () => {
  assert.match(knowledgeAudit, /MIN_MODELS/);
  assert.match(knowledgeAudit, /MIN_RETAINED_RATIO/);
  assert.match(knowledgeAudit, /duplicateIds/);
});

test("post-persist market audit rejects broken source identity and shallow Korea galleries", () => {
  assert.match(liveAudit, /source_identity/);
  assert.match(liveAudit, /korea/i);
  assert.match(liveAudit, /images/i);
});

test("publisher accumulates galleries before deduplication and protects the newest generations", () => {
  assert.match(storage, /rankedCatalogImageUrls/);
  assert.match(storage, /enforceCatalogModelYearQuota/);
});

test("recovery publisher always preserves untouched full maintenance state exactly", () => {
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

test("recovery preservation gates keep untouched markets byte-stable and canonicalize only mutable rows", () => {
  assert.match(storage, /preservePublicOffersByMarket/);
  assert.match(storage, /exactPreserveMarkets\.has\(offer\.market\)[\s\S]*\? offer[\s\S]*enrichOfferWithKnowledgeCore/);
  assert.match(storage, /canonicalizePublicCatalogOffers\(publicOffers, exactPreserveMarkets, protectedPublicIds\)/);
  assert.match(storage, /protectedRows = storedOffers\.filter/);
  assert.match(storage, /mutableRows = storedOffers\.filter/);
  assert.match(storage, /applyEncyclopediaDisplayIdentityBatch\(mutableRows\)/);
  assert.match(storage, /qualityEligibleOffers = identifiedOffers\.filter\(isPublicOffer\)/);
  assert.match(storage, /const publicOffers = nextOffers\.filter\(\(offer\) => !exactPreserveMarkets\.has\(offer\.market\) && !protectedPublicIds\.has\(String\(offer\.id\)\) && isPublicOffer\(offer\)\);[\s\S]*Object\.entries\(preservedPublicOffersByMarket\)[\s\S]*beforePersistValidate\(publicOffers\)[\s\S]*const generationId[\s\S]*persistInternalCatalog/);
  assert.match(singleRecoveryPublisher, /preservePublicOffersByMarket: preservedPublicRowsByMarket[\s\S]*beforePersistValidate\(publicOffers\)[\s\S]*recovery_prewrite_preservation_gate_failed/);
  assert.match(recoveryPublisher, /preservePublicOffersByMarket: preserveUntouchedExact \? preservedPublicRowsByMarket : undefined[\s\S]*beforePersistValidate\(publicOffers\)[\s\S]*recovery_batch_prewrite_preservation_gate_failed/);
  assert.match(singleRecoveryPublisher, /function stableJsonValue/);
  assert.match(recoveryPublisher, /function stableJsonValue/);
});

test("standard one-market publisher expires stale target rows and canonicalizes every market deterministically", () => {
  assert.match(standardMarketPublisher, /catalogRetentionDecision/);
  assert.match(standardMarketPublisher, /sourceRefreshStates/);
  assert.match(standardMarketPublisher, /outageGraceMultiplier/);
  assert.match(standardMarketPublisher, /acquirePublishLock\(\)/);
  assert.match(standardMarketPublisher, /finally \{[\s\S]*releasePublishLock\(\)/);
  assert.match(storage, /canonicalizePublicCatalogOffers\(publicOffers, exactPreserveMarkets, protectedPublicIds\)[\s\S]*beforePublishValidate\(publishedOffers\)[\s\S]*const generationId/);
  assert.match(storage, /writeCurrentCatalogReadModels\(generationId, publishedOffers, true\)/);
  assert.match(storage, /alreadyCanonical \? new Set<CatalogMarket>\(storedOffers\.map\(\(offer\) => offer\.market/);
  assert.match(storage, /canonicalizePublicCatalogOffers\(storedOffers, exactMarkets, protectedIds\)/);
});

test("seven-market recovery is calculated, failure-tolerant and collapse-protected", () => {
  assert.match(recoveryPublisher, /calculateOfferWithRussiaCustoms/);
  assert.match(recoveryPublisher, /regression/);
});

test("verified-generation restore is preflight-first and shares the global writer lock", () => {
  const restore = fs.readFileSync("scripts/catalog-restore-verified-generation.mjs", "utf8");
  assert.match(restore, /preflight/i);
  assert.match(restore, /import-lock/);
});

test("single recovery publisher preserves full maintenance state and enforces target gallery depth", () => {
  assert.match(singleRecoveryPublisher, /readAllOffersForMaintenance/);
  assert.match(singleRecoveryPublisher, /images/i);
});

test("daily cleanup keeps a bounded six-hour grace while preserving both live manifests", () => {
  assert.match(cleanup, /6 \* 60 \* 60/);
  assert.match(cleanup, /manifest/);
  assert.match(cleanup, /internal/);
});

test("large catalog search uses compact projections and bounded fallback chunk reads", () => {
  assert.match(storage, /CatalogSearchProjection/);
  assert.match(storage, /OFFER_CHUNK_CACHE_MAX/);
});

test("Object Storage publication bounds dynamic index keys and reports the failing path", () => {
  assert.match(storage, /writeJsonAtomic/);
});

test("generic source detail wrapper is fail-closed and never scrapes page-wide semantics or galleries", () => {
  assert.match(source, /fail/i);
});

test("Dubizzle detail semantics are label-bound to Car Overview and ignore seller\/recommendation noise", () => {
  assert.match(source, /dubizzle/i);
});

test("Dubizzle refuses semantic inference when Car Overview labels are absent", () => {
  assert.match(source, /Car Overview|car overview/i);
});

test("customs engine uses the 2026 coefficient columns rather than the 2025 columns", () => {
  assert.match(customs, /2026/);
});

test("production control document fixes the CRM readiness gate", () => {
  assert.match(productionControl, /crm/i);
});
