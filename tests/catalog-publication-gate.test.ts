import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const combinedWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-v2-production.yml", import.meta.url), "utf8");
const marketWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-v2-market-reusable.yml", import.meta.url), "utf8");
const koreaWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-v2-korea.yml", import.meta.url), "utf8");
const validator = fs.readFileSync(new URL("../scripts/catalog-validate-source-scale.mjs", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-source-scale.mjs", import.meta.url), "utf8");
const marketPublisher = fs.readFileSync(new URL("../scripts/catalog-publish-market.mjs", import.meta.url), "utf8");
const freshPublisher = fs.readFileSync(new URL("../scripts/catalog-publish-fresh.mjs", import.meta.url), "utf8");
const businessAudit = fs.readFileSync(new URL("../scripts/catalog-business-audit.mjs", import.meta.url), "utf8");
const customsPricing = fs.readFileSync(new URL("../apps/web/lib/catalog/customs-pricing.ts", import.meta.url), "utf8");

test("Catalog V2 publishes each market independently and preserves completed markets", () => {
  assert.match(combinedWorkflow, /all markets disabled/);
  assert.match(combinedWorkflow, /workflow_dispatch/);
  assert.doesNotMatch(combinedWorkflow, /^\s*schedule:/m);
  assert.doesNotMatch(combinedWorkflow, /^\s*push:/m);

  const download = marketWorkflow.indexOf("Download only ${{ inputs.display_name }} shards");
  const audit = marketWorkflow.indexOf("npx tsx scripts/catalog-validate-source-scale.mjs");
  const publish = marketWorkflow.indexOf("npx tsx scripts/catalog-publish-market.mjs");
  const enforce = marketWorkflow.indexOf("Require a non-empty market publication");
  assert.ok(download >= 0, "selected market shards must be downloaded");
  assert.ok(audit > download, "calculation and gallery audit must follow artifact download");
  assert.ok(publish > audit, "single-market publisher must run after audit");
  assert.ok(enforce > publish, "market gate must follow publication attempt");

  assert.match(marketWorkflow, /CATALOG_REBUILD_TARGET_PER_SOURCE: "100000"/);
  assert.match(marketWorkflow, /CATALOG_REBUILD_TARGET_PER_MARKET: "100000"/);
  assert.match(marketWorkflow, /CATALOG_PUBLISH_TARGET_PER_MARKET: "100000"/);
  assert.match(marketWorkflow, /CATALOG_PUBLISH_MAX_PER_MARKET: "100000"/);
  assert.match(marketWorkflow, /CATALOG_OFFER_RETENTION_MS: "259200000"/);
  assert.match(marketWorkflow, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "1"/);
  assert.match(marketWorkflow, /CATALOG_MAX_IMAGES_PER_OFFER: "30"/);
  assert.match(marketWorkflow, /group: catalog-live-daily-working-markets/);
  assert.match(marketWorkflow, /test "\$\{\{ needs\.publish\.result \}\}" = "success"/);

  assert.match(koreaWorkflow, /market: korea/);
  assert.match(koreaWorkflow, /workflow_dispatch/);
  assert.match(marketPublisher, /mode: "catalog_v2_independent_market"/);
  assert.match(marketPublisher, /for \(const otherMarket of PUBLIC_CATALOG_MARKETS\)/);
  assert.match(marketPublisher, /readMarketOffers\(otherMarket\)/);
  assert.match(marketPublisher, /preservedByMarket/);
  assert.match(marketPublisher, /persistCatalogOffers\(allOffers, \{/);
  assert.match(marketPublisher, /beforePublishValidate\(publishedOffers\)/);
  assert.match(marketPublisher, /catalog_public_regression_guard/);
  assert.match(marketPublisher, /catalog_v2_empty_market/);
  assert.match(marketPublisher, /hasAllowedCatalogSourceProvenance/);
  assert.match(marketPublisher, /hasAllowedCatalogSourceProvenance, isCatalogMarketSourceAllowed, isCrediblePublicOffer, isCatalogYearAllowed/);
  assert.match(marketPublisher, /!isCatalogMarketSourceAllowed\(offer\)/);
  assert.match(marketPublisher, /purgedForbiddenPublicByMarket/);
  assert.match(marketPublisher, /purgedForbiddenInternalByMarket/);
  assert.match(marketPublisher, /const forbiddenInternal = otherMarketInternal\.filter/);
  assert.match(marketPublisher, /const preservedInternal = otherMarketInternal\.filter/);
  assert.match(marketPublisher, /const preservedRows = rows\.filter/);
  assert.match(marketPublisher, /preservedPublicRowsByMarket\[otherMarket\] = preservedRows/);
});

test("business audit still checks profiles, knowledge, customs and utilization power", () => {
  assert.match(businessAudit, /requiredMarkets/);
  assert.match(businessAudit, /minimumKnowledgeRecords/);
  assert.match(businessAudit, /customsScenarios/);
  assert.match(businessAudit, /peakPowerGuardOk/);
  assert.match(businessAudit, /publicationSafe/);
});

test("fresh publisher keeps verified current offers but caps every market at the requested target", () => {
  assert.match(freshPublisher, /readMarketOffers/);
  assert.match(freshPublisher, /selected\.length >= target/);
  assert.match(freshPublisher, /isCrediblePublicOffer/);
  assert.match(freshPublisher, /minimumImagesPerOffer/);
  assert.match(freshPublisher, /persistCatalogOffers/);
  assert.match(freshPublisher, /generationId/);
});

test("production source-scale audit requires mandatory source participation and multi-source continuity", () => {
  assert.match(validator, /galleryRebuiltFrom/);
  assert.match(validator, /fresh_listing/);
  assert.match(validator, /per_market_volume_and_integrity_audit/);
  assert.match(validator, /marketTargetReached/);
  assert.match(validator, /catalogRequiredSpecificationRejectionReason/);
  assert.match(validator, /price_breakdown/);
  assert.match(validator, /requiredSourcesComplete/);
  assert.match(validator, /requiredSourcesAvailable/);
  assert.match(validator, /requiredSourcesAttempted/);
  assert.match(validator, /requiredSourcesHealthy/);
  assert.match(validator, /requiredSourceContinuity/);
  assert.match(validator, /requiredUnattemptedSourceIds/);
  assert.match(validator, /requiredUnhealthySourceIds/);
  assert.match(validator, /collectorLiveSourceIds/);
  assert.match(validator, /\|\| !row\.requiredSourcesAttempted/);
  assert.match(validator, /\|\| !row\.requiredSourceContinuity/);
  assert.match(validator, /\|\| !row\.sourceTargetReached/);
  assert.doesNotMatch(validator, /\|\| !row\.requiredSourcesHealthy/);
  assert.doesNotMatch(validator, /\|\| !row\.freshThresholdReached/);
  assert.match(validator, /blockingMarkets/);
  assert.match(publisher, /calculateOfferWithRussiaCustoms/);
  assert.match(publisher, /previousManifestPreserved/);
  assert.match(publisher, /readMarketOffers/);
  assert.match(publisher, /targetPerSource/);
  assert.match(publisher, /retentionMs/);
  assert.match(marketPublisher, /calculateOfferWithRussiaCustoms/);
  assert.match(marketPublisher, /retentionMs/);
});

test("catalog pricing never substitutes peak power as certified utilization power", () => {
  assert.doesNotMatch(customsPricing, /estimated-utilization-preview/);
  assert.doesNotMatch(customsPricing, /withConservativeUtilizationPreview/);
  assert.match(customsPricing, /needs_utilization_power/);
  assert.match(customsPricing, /Пиковая мощность не подставляется/);
});
