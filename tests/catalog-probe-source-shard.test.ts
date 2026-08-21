import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const probe = fs.readFileSync(new URL("../scripts/catalog-probe-source-shard.mjs", import.meta.url), "utf8");
const rebuild = fs.readFileSync(new URL("../scripts/catalog-rebuild-source-shard.mjs", import.meta.url), "utf8");
const validator = fs.readFileSync(new URL("../scripts/catalog-validate-source-scale.mjs", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-source-scale.mjs", import.meta.url), "utf8");
const gallery = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-fast-gallery-wrapper.ts", import.meta.url), "utf8");
const fullGallery = fs.readFileSync(new URL("../apps/web/lib/catalog/full-gallery-wrapper.ts", import.meta.url), "utf8");
const sourceRegistry = fs.readFileSync(new URL("../apps/web/lib/catalog/catalog-v2-source-registry.ts", import.meta.url), "utf8");
const requiredSources = fs.readFileSync(new URL("../apps/web/lib/catalog/required-catalog-sources.ts", import.meta.url), "utf8");
const japanWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-v2-japan.yml", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-v2-production.yml", import.meta.url), "utf8");
const legacyWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");
const knowledgeBlock = workflow.slice(workflow.indexOf("\n  knowledge:"), workflow.indexOf("\n  collect:"));
const collectBlock = workflow.slice(workflow.indexOf("\n  collect:"), workflow.indexOf("\n  publish:"));
const publishBlock = workflow.slice(workflow.indexOf("\n  publish:"), workflow.indexOf("\n  health:"));

test("probe activates productive adapters and prevents two-hour no-progress crawls", () => {
  assert.match(probe, /catalogImportSources\s*\.filter/);
  assert.match(probe, /activeSourceIds/);
  assert.match(probe, /inactiveSourceIds/);
  assert.match(probe, /GITHUB_ENV/);
  assert.match(probe, /CATALOG_REBUILD_SOURCE_IDS=\$\{sourceIdsForRebuild\}/);
  assert.match(probe, /CATALOG_V2_SOURCE_SLOTS_ONLY=0/);
  assert.match(probe, /CATALOG_REBUILD_IGNORE_PROBE=0/);
  assert.match(probe, /CATALOG_REBUILD_MAX_EMPTY_PAGES=25/);
  assert.match(probe, /CATALOG_REBUILD_MAX_SOURCE_ERRORS=3/);
  assert.match(collectBlock, /Diagnose source routes and select productive adapters/);
  assert.match(collectBlock, /Collect productive registered sources with checkpoints/);
});

test("Japan rollout combines mandatory and optional completed auction histories", () => {
  const japanPlanStart = probe.indexOf("  japan:");
  const japanPlanEnd = probe.indexOf("\n  uae:", japanPlanStart);
  const japanPlan = probe.slice(japanPlanStart, japanPlanEnd);
  assert.ok(japanPlanStart >= 0 && japanPlanEnd > japanPlanStart);
  assert.match(requiredSources, /jpauc_japan_past_open/);
  assert.match(requiredSources, /carvector_japan_stat_open/);
  assert.match(requiredSources, /auctiondatasearch_japan_open/);
  assert.match(japanPlan, /japantransit_japan_stat_open/);
  assert.match(japanPlan, /auctions22_japan_past_open/);
  assert.doesNotMatch(japanPlan, /jpauc_japan_current_open/);
  assert.doesNotMatch(japanPlan, /auctions22_japan_upcoming_open/);
  assert.match(sourceRegistry, /market === "japan"\) return source\.role === "auction_history"/);
  assert.match(japanWorkflow, /workflow_dispatch:/);
  assert.match(japanWorkflow, /schedule:/);
  assert.match(japanWorkflow, /cron: "17 5,17 \* \* \*"/);
  assert.match(japanWorkflow, /retention_ms: "15552000000"/);
  assert.match(japanWorkflow, /catalog-v3-market-10k-reusable\.yml/);
  assert.doesNotMatch(japanWorkflow, /\bneeds:/);
});

test("listing photos are cached before optional detail enrichment", () => {
  const cacheAt = gallery.indexOf("cacheImageFromUrl(url");
  const fastReturnAt = gallery.indexOf("listingImages.length >= minimum");
  const detailAt = gallery.indexOf("source.fetchImages(offer)");
  assert.ok(cacheAt >= 0 && fastReturnAt > cacheAt && detailAt > fastReturnAt);
  assert.match(gallery, /Math\.min\(30/);
});

test("Japan auction images keep source-bound URLs without binary cache fallbacks", () => {
  assert.match(fullGallery, /sourceGalleryUrls\(offer\)/);
  assert.match(fullGallery, /externalImage/);
  assert.match(fullGallery, /uniqueExternalImages/);
  assert.match(fullGallery, /gallerySafetyMode: "source_urls_only"/);
  assert.match(fullGallery, /galleryStoredAs: "json_urls"/);
});

test("Catalog V2 retains verified offers, continues cursors and can use all productive registered adapters", () => {
  assert.match(rebuild, /retention_loaded/);
  assert.match(rebuild, /readMarketOffers/);
  assert.match(rebuild, /readAllOffersForMaintenance/);
  assert.match(rebuild, /catalogV2SourceIds/);
  assert.match(rebuild, /CATALOG_REBUILD_RESET_CURSOR/);
  assert.match(rebuild, /CATALOG_V2_SOURCE_SLOTS_ONLY/);
  assert.match(rebuild, /CATALOG_REBUILD_SOURCE_IDS/);
  assert.match(rebuild, /enrichOfferWithVehicleKnowledge/);
  assert.match(rebuild, /bases\.sort\(quality\)/);
  assert.doesNotMatch(rebuild, /businessPriority/);
});

test("volume shortages remain explicit diagnostics", () => {
  assert.match(validator, /per_market_volume_and_integrity_audit/);
  assert.match(validator, /targetPerMarket/);
  assert.match(validator, /warnings/);
  assert.match(validator, /publishableMarkets/);
});

test("publisher uses atomic Catalog V2 tiers and preserves manifest on an empty market", () => {
  assert.match(publisher, /readMarketOffers/);
  assert.match(publisher, /readAllOffersForMaintenance/);
  assert.match(publisher, /catalog_v2_tiered_atomic_all_markets/);
  assert.match(publisher, /selectCatalogV2MarketOffers/);
  assert.match(publisher, /fallbackUnlocked/);
  assert.match(publisher, /shortageToUnlock/);
  assert.match(publisher, /emptyMarkets\.length === 0/);
  assert.match(publisher, /catalog_v2_empty_markets/);
  assert.match(publisher, /previousManifestPreserved/);
  assert.match(publisher, /calculateOfferWithRussiaCustoms/);
});

test("Catalog V2 audits the existing encyclopedia instead of rebuilding it for two hours", () => {
  assert.ok(knowledgeBlock.length > 0);
  assert.match(knowledgeBlock, /Verify current vehicle encyclopedia/);
  assert.match(knowledgeBlock, /timeout-minutes: 15/);
  assert.match(knowledgeBlock, /Audit current encyclopedia snapshot/);
  assert.match(knowledgeBlock, /catalog-audit-vehicle-knowledge\.mjs/);
  assert.match(knowledgeBlock, /CATALOG_VEHICLE_KNOWLEDGE_MIN_MODELS: "6000"/);
  assert.doesNotMatch(knowledgeBlock, /catalog-sync-vehicle-models\.mjs/);
  assert.doesNotMatch(knowledgeBlock, /catalog-enrich-drom-vehicle-variants\.mjs/);
  assert.doesNotMatch(knowledgeBlock, /catalog-build-vehicle-variants\.mjs/);
  assert.doesNotMatch(knowledgeBlock, /catalog-build-power-knowledge\.mjs/);
  assert.match(collectBlock, /needs: \[validate, knowledge\]/);
  assert.match(publishBlock, /needs: \[validate, knowledge, collect\]/);
});

test("Catalog V2 caps every production stage and preserves the 100000-offer targets", () => {
  assert.match(workflow, /Catalog V2 production/);
  assert.match(workflow, /productive sources/);
  assert.match(workflow, /shard: \[0, 1, 2, 3, 4\]/);
  assert.match(workflow, /max-parallel: 20/);
  assert.match(workflow, /CATALOG_REBUILD_SHARD_COUNT: "5"/);
  assert.match(workflow, /CATALOG_V2_PRIORITY_TARGET: "1000"/);
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_SOURCE: "100000"/);
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_MARKET: "100000"/);
  assert.match(workflow, /CATALOG_PUBLISH_MIN_PRODUCTIVE_SOURCES: "1"/);
  assert.match(workflow, /CATALOG_OFFER_RETENTION_MS: "259200000"/);
  assert.match(workflow, /CATALOG_COLLECTION_IMAGE_LIMIT: "30"/);
  assert.match(workflow, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER: "30"/);
  assert.match(collectBlock, /timeout-minutes: 45/);
  assert.match(collectBlock, /CATALOG_REBUILD_TIME_LIMIT_MS: "6300000"/);
  assert.match(publishBlock, /timeout-minutes: 25/);
  assert.match(workflow, /Publish only a complete seven-market generation/);
  assert.match(workflow, /missing = markets\.filter/);
  assert.match(workflow, /badFallback/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test("legacy catalog no longer runs on schedule or main pushes", () => {
  assert.match(legacyWorkflow, /Legacy catalog source-scale \(manual only\)/);
  assert.match(legacyWorkflow, /workflow_dispatch/);
  assert.doesNotMatch(legacyWorkflow, /schedule:/);
  assert.doesNotMatch(legacyWorkflow, /push:/);
  assert.doesNotMatch(legacyWorkflow, /catalog-rebuild-source-shard/);
});
