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
const importer = fs.readFileSync(new URL("../apps/web/lib/catalog/importer.ts", import.meta.url), "utf8");
const yandexBridge = fs.readFileSync(new URL("../apps/web/lib/catalog/yandex-source-bridge.ts", import.meta.url), "utf8");
const encarBridgeRoute = fs.readFileSync(new URL("../apps/web/app/api/internal/encar-egress-71b8e4/route.ts", import.meta.url), "utf8");
const dubizzleBridgeRoute = fs.readFileSync(new URL("../apps/web/app/api/internal/dubizzle-egress-a4c907/route.ts", import.meta.url), "utf8");
const removedSourceBridgeRoute = fs.readFileSync(new URL("../apps/web/app/api/internal/goonet-egress-f7c2a9/route.ts", import.meta.url), "utf8");
const encarAdapter = fs.readFileSync(new URL("../apps/web/lib/catalog/adapters.ts", import.meta.url), "utf8");
const japanWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-v2-japan.yml", import.meta.url), "utf8");
const sequentialQueue = fs.readFileSync(new URL("../.github/workflows/catalog-v3-sequential-queue.yml", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-v2-production.yml", import.meta.url), "utf8");
const legacyWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");
const knowledgeBlock = workflow.slice(workflow.indexOf("\n  knowledge:"), workflow.indexOf("\n  collect:"));
const collectBlock = workflow.slice(workflow.indexOf("\n  collect:"), workflow.indexOf("\n  publish:"));
const publishBlock = workflow.slice(workflow.indexOf("\n  publish:"), workflow.indexOf("\n  health:"));

test("probe contacts only approved sources and can never drop one from the real crawl", () => {
  assert.match(probe, /catalogImportSources\s*\.filter/);
  assert.match(probe, /activeSourceIds/);
  assert.match(probe, /inactiveSourceIds/);
  assert.match(probe, /requiredSourceIdsForShard/);
  assert.match(probe, /sourceIdsForRebuildList = \[\.\.\.new Set\(\[\.\.\.requiredSourceIdsForShard, \.\.\.activeSourceIds\]\)\]/);
  assert.match(probe, /sourceIdsForRebuild = sourceIdsForRebuildList\.join/);
  assert.match(probe, /GITHUB_ENV/);
  assert.match(probe, /CATALOG_REBUILD_SOURCE_IDS=\$\{sourceIdsForRebuild\}/);
  assert.match(probe, /CATALOG_V2_SOURCE_SLOTS_ONLY=0/);
  assert.match(probe, /CATALOG_REBUILD_IGNORE_PROBE=0/);
  assert.match(probe, /CATALOG_REBUILD_MAX_EMPTY_PAGES=25/);
  assert.match(probe, /CATALOG_REBUILD_MAX_SOURCE_ERRORS=3/);
  assert.match(collectBlock, /Diagnose source routes and select productive adapters/);
  assert.match(collectBlock, /Collect productive registered sources with checkpoints/);
});

test("canonical mandatory market source contract cannot silently drift", () => {
  const required = [
    ["dubizzle_uae_open", "https://uae.dubizzle.com/"],
    ["dubicars_uae_exact", "https://www.dubicars.com/"],
    ["encar_direct", "https://www.encar.com/"],
    ["kcar_korea_open", "https://www.kcar.com/"],
    ["mobile_de_open", "https://www.mobile.de/"],
    ["autoscout_europe_open", "https://www.autoscout24.com/"],
    ["myauto_georgia_list", "https://www.myauto.ge/"],
    ["autopapa_georgia_open", "https://autopapa.ge/"],
    ["autohome_used_china_open", "https://www.che168.com/"],
    ["dongchedi_china_open", "https://www.dongchedi.com/"],
    ["guazi_china_open", "https://www.guazi.com/"],
    ["autohome_new_china_open", "https://www.autohome.com.cn/"],
    ["jpauc_japan_past_open", "https://jpauc.com/auction/past"],
    ["carvector_japan_stat_open", "https://carvector.com/stat"],
    ["prestige_japan_auctions_open", "https://prestigemotorsport.com.au/auctions/"],
    ["auctiondatasearch_japan_open", "https://www.auctiondatasearch.jp/"],
    ["jpcenter_japan_catalog_open", "https://jp.center/"],
  ];
  for (const [sourceId, canonicalUrl] of required) {
    assert.match(requiredSources, new RegExp(sourceId));
    assert.match(requiredSources, new RegExp(canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(sourceRegistry, /catalog_strict_source_allowlist_broken/);
  assert.match(sourceRegistry, /excluded_from_collection/);
});

test("GitHub collection keeps Encar mandatory and uses the fixed production egress bridge", () => {
  assert.match(yandexBridge, /type BridgeKind = [^;]*"encar"/);
  assert.match(yandexBridge, /\/api\/internal\/encar-egress-71b8e4\?page=\$\{page\}/);
  assert.match(importer, /withGithubYandexSourceBridge\(encarCompleteSource, "encar"\)/);
  assert.match(importer, /encarCollectionSource/);
  assert.match(encarBridgeRoute, /sourceId: "encar_direct"/);
  assert.match(encarBridgeRoute, /const PAGE_SIZE = 20/);
  assert.match(encarBridgeRoute, /new EncarCompleteAdapter\(PAGE_SIZE\)/);
  assert.match(encarBridgeRoute, /fetchImages\(offer\)/);
  assert.match(encarAdapter, /origin: "https:\/\/car\.encar\.com"/);
});

test("GitHub collection keeps Dubizzle mandatory and uses the production egress bridge", () => {
  assert.match(yandexBridge, /type BridgeKind = "dubizzle" \|/);
  assert.match(yandexBridge, /\/api\/internal\/dubizzle-egress-a4c907\?page=\$\{page\}/);
  assert.match(importer, /withGithubYandexSourceBridge\(dubizzleUaeExactSource, "dubizzle"\)/);
  assert.match(importer, /dubizzleCollectionSource/);
  assert.match(dubizzleBridgeRoute, /sourceId: "dubizzle_uae_open"/);
  assert.match(dubizzleBridgeRoute, /new DubizzleUaeExactAdapter\(\)/);
  assert.match(yandexBridge, /payload\.error \|\| payload\.causeCode/);
  assert.match(yandexBridge, /yandex_bridge_http_\$\{response\.status\}_\$\{kind\}_\$\{page\}/);
});

test("Japan rollout includes only the five approved auction/catalog sources", () => {
  for (const sourceId of [
    "jpauc_japan_past_open",
    "carvector_japan_stat_open",
    "prestige_japan_auctions_open",
    "auctiondatasearch_japan_open",
    "jpcenter_japan_catalog_open",
  ]) {
    assert.match(requiredSources, new RegExp(sourceId));
  }
  assert.doesNotMatch(probe, /japantransit_japan_stat_open|auctions22_japan_past_open|jpauc_japan_current_open|auctions22_japan_upcoming_open/);
  assert.match(probe, /configuredApproved = configured\.filter\(\(sourceId\) => requiredSourceIds\.includes\(sourceId\)\)/);
  assert.match(probe, /plannedAll = configuredApproved\.length && allowRequiredSubset[\s\S]*: \[\.\.\.requiredSourceIds\]/);
  assert.match(sourceRegistry, /japan: \[\.\.\.REQUIRED_CATALOG_SOURCES\.japan\]/);
  assert.doesNotMatch(requiredSources, /goonet_japan_exact|goo-net-exchange\.com/i);
  assert.doesNotMatch(yandexBridge, /goonet|goo-net/i);
  assert.doesNotMatch(importer, /goonetJapanExactSource|goonetCollectionSource/);
  assert.match(removedSourceBridgeRoute, /catalog_source_not_approved/);
  assert.doesNotMatch(removedSourceBridgeRoute, /fetchPage|GoonetExactAdapter/);
  assert.match(japanWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(japanWorkflow, /^\s+schedule:/m);
  assert.match(japanWorkflow, /retention_ms: "2592000000"/);
  assert.match(japanWorkflow, /catalog-v3-market-10k-reusable\.yml/);
  assert.doesNotMatch(japanWorkflow, /\bneeds:/);
  assert.doesNotMatch(sequentialQueue, /^\s*schedule:\s*$/m);
  assert.doesNotMatch(sequentialQueue, /cron: "17 21 \* \* \*"/);
  assert.match(sequentialQueue, /Production collection is intentionally paused/);
  assert.match(sequentialQueue, /01\|08\|15\|22/);
  assert.match(sequentialQueue, /target_per_market: "30000"/);
  assert.match(sequentialQueue, /retention_ms: "2592000000"/);
});

test("listing photos stay source-bound and detail enrichment continues to preferred depth", () => {
  const sourceModeAt = gallery.indexOf("if (sourceUrlsOnly)");
  const binaryFallbackAt = gallery.indexOf("cacheImageFromUrl(url", sourceModeAt);
  const fastReturnAt = gallery.indexOf("listingImages.length >= preferred");
  const detailAt = gallery.indexOf("source.fetchImages(offer)");
  assert.ok(sourceModeAt >= 0);
  assert.ok(binaryFallbackAt > sourceModeAt, "binary cache must remain a non-source-URL fallback");
  assert.ok(fastReturnAt > binaryFallbackAt && detailAt > fastReturnAt);
  assert.match(gallery, /CATALOG_IMAGE_STORAGE_MODE/);
  assert.match(gallery, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER \|\| 30/);
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
  assert.match(rebuild, /enrichOfferWithKnowledgeCore/);
  assert.match(rebuild, /bases\.sort\(quality\)/);
  assert.doesNotMatch(rebuild, /businessPriority/);
});

test("volume shortages remain explicit diagnostics but missing mandatory sources block publication", () => {
  assert.match(validator, /per_market_volume_and_integrity_audit/);
  assert.match(validator, /targetPerMarket/);
  assert.match(validator, /warnings/);
  assert.match(validator, /publishableMarkets/);
  assert.match(validator, /blockingMarkets/);
  assert.match(validator, /requiredSourcesAttempted/);
  assert.match(validator, /requiredSourcesHealthy/);
  assert.match(validator, /requiredSourcesComplete/);
  assert.match(validator, /required_sources_unattempted/);
  assert.match(validator, /required_sources_unhealthy/);
  assert.match(validator, /if \(!report\.ok\) process\.exitCode = 1/);
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
  assert.match(workflow, /Publish only a complete six-market generation/);
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
