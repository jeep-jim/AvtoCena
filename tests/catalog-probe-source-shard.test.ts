import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const probe = fs.readFileSync(new URL("../scripts/catalog-probe-source-shard.mjs", import.meta.url), "utf8");
const rebuild = fs.readFileSync(new URL("../scripts/catalog-rebuild-source-shard.mjs", import.meta.url), "utf8");
const validator = fs.readFileSync(new URL("../scripts/catalog-validate-source-scale.mjs", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-source-scale.mjs", import.meta.url), "utf8");
const gallery = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-fast-gallery-wrapper.ts", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");
const knowledgeBlock = workflow.slice(workflow.indexOf("\n  knowledge:"), workflow.indexOf("\n  collect:"));
const collectBlock = workflow.slice(workflow.indexOf("\n  collect:"), workflow.indexOf("\n  publish:"));
const publishBlock = workflow.slice(workflow.indexOf("\n  publish:"), workflow.indexOf("\n  health:"));

test("probe checks every registered source and passes only live sources to network collection", () => {
  assert.match(probe, /priorityPlan/);
  assert.match(probe, /catalogImportSources\s*\.filter/);
  assert.match(probe, /isUsableOffer/);
  assert.match(probe, /Number\(offer\.sourcePrice \|\| 0\) > 0/);
  assert.match(probe, /activeSourceIds/);
  assert.match(probe, /inactiveSourceIds/);
  assert.match(probe, /sourceIdsForRebuild = activeSourceIds\.join/);
  assert.match(probe, /guazi_china_ru/);
  assert.match(probe, /auto_georgia_open/);
  assert.doesNotMatch(probe, /connectedMarketSources/);
});

test("listing photos are cached before optional detail enrichment", () => {
  const cacheAt = gallery.indexOf("cacheImageFromUrl(url");
  const fastReturnAt = gallery.indexOf("listingImages.length >= minimum");
  const detailAt = gallery.indexOf("source.fetchImages(offer)");
  assert.ok(cacheAt >= 0 && fastReturnAt > cacheAt && detailAt > fastReturnAt);
  assert.match(gallery, /CATALOG_GALLERY_FAST_PATH/);
  assert.match(gallery, /Math\.min\(30/);
});

test("temporary source failures retain verified offers before any network crawl", () => {
  assert.match(rebuild, /retention_loaded/);
  assert.match(rebuild, /readMarketOffers/);
  assert.match(rebuild, /readAllOffersForMaintenance/);
  assert.match(rebuild, /firstSeen/);
  assert.match(rebuild, /retentionSourceIds/);
  assert.match(rebuild, /liveSourceIds/);
  assert.match(rebuild, /storage\.readJson/);
  assert.match(rebuild, /storage\.writeJson/);
  assert.match(rebuild, /enrichOfferWithVehicleKnowledge/);
  assert.doesNotMatch(rebuild, /connectedMarketSources/);
});

test("volume shortages remain diagnostics inside validation", () => {
  assert.match(validator, /per_market_volume_and_integrity_audit/);
  assert.match(validator, /targetPerMarket/);
  assert.match(validator, /warnings/);
  assert.match(validator, /publishableMarkets/);
  assert.doesNotMatch(validator, /throw new Error\(`catalog_publication_gate_failed/);
});

test("publisher accumulates verified current markets and keeps previous manifest on failure", () => {
  assert.match(publisher, /readMarketOffers/);
  assert.match(publisher, /readAllOffersForMaintenance/);
  assert.match(publisher, /catalog_v2_tiered_atomic_all_markets/);
  assert.match(publisher, /selectCatalogV2MarketOffers/);
  assert.match(publisher, /emptyMarkets\.length === 0/);
  assert.match(publisher, /catalog_v2_empty_markets/);
  assert.match(publisher, /previousManifestPreserved/);
  assert.match(publisher, /no_verified_offers_keep_previous_manifest/);
  assert.match(publisher, /calculateOfferWithRussiaCustoms/);
  assert.match(publisher, /marketsBelowTarget/);
});

test("knowledge audit is diagnostic while missing generation still makes production red", () => {
  assert.ok(knowledgeBlock.length > 0);
  assert.match(knowledgeBlock, /Audit vehicle knowledge \(diagnostic\)/);
  assert.match(knowledgeBlock, /continue-on-error: true/);
  assert.match(knowledgeBlock, /Audit current production knowledge without rewriting it/);
  assert.match(collectBlock, /needs: validate/);
  assert.doesNotMatch(collectBlock, /needs: \[validate, knowledge\]/);
  assert.match(collectBlock, /continue-on-error: true/);
  assert.match(workflow, /workflow_safe_fallback/);
  assert.match(workflow, /safe_fallback_exit_/);
  assert.match(workflow, /previous_manifest_preserved/);
  assert.match(workflow, /Require newly published generation/);
  assert.match(workflow, /if \(!state\.published \|\| !state\.generationId \|\| state\.total <= 0 \|\| missing\.length\)/);
  assert.match(workflow, /process\.exit\(1\)/);
  assert.match(workflow, /Require validation and a new production generation/);
  assert.match(publishBlock, /needs: \[validate, collect\]/);
  assert.doesNotMatch(publishBlock.slice(0, 250), /continue-on-error: true/);
});

test("production probes registry, crawls live sources and requires all seven published markets", () => {
  assert.match(workflow, /Catalog source-scale daily/);
  assert.match(workflow, /timeout-minutes: 100/);
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_SOURCE: "1000"/);
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_MARKET: "3000"/);
  assert.match(workflow, /CATALOG_PUBLISH_MIN_PRODUCTIVE_SOURCES: "3"/);
  assert.match(workflow, /CATALOG_OFFER_RETENTION_MS: "259200000"/);
  assert.match(workflow, /CATALOG_COLLECTION_IMAGE_LIMIT: "30"/);
  assert.match(workflow, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER: "30"/);
  assert.match(workflow, /CATALOG_GALLERY_FAST_PATH: "false"/);
  assert.match(workflow, /npx tsx scripts\/catalog-probe-source-shard\.mjs/);
  assert.match(workflow, /npx tsx scripts\/catalog-rebuild-source-shard\.mjs/);
  assert.match(rebuild, /targetPerSource/);
  assert.match(rebuild, /catalog\/source-cursors/);
  assert.match(rebuild, /retained/);
  assert.match(rebuild, /probe_inactive/);
  assert.match(rebuild, /detailNeeded/);
  assert.match(workflow, /Publish verified offers with three-day retention/);
  assert.match(workflow, /Audit calculations, customs, utilization fee and galleries/);
  assert.match(workflow, /Catalog publication/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /Probe every registered source in this shard/);
  assert.match(workflow, /missing = markets\.filter/);
  assert.doesNotMatch(workflow, /CATALOG_REBUILD_TARGET: "250"/);
  assert.doesNotMatch(workflow, /catalog-rebuild-market-retry/);
});
