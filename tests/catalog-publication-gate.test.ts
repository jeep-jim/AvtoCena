import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");
const validator = fs.readFileSync(new URL("../scripts/catalog-validate-source-scale.mjs", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-source-scale.mjs", import.meta.url), "utf8");
const freshPublisher = fs.readFileSync(new URL("../scripts/catalog-publish-fresh.mjs", import.meta.url), "utf8");
const businessAudit = fs.readFileSync(new URL("../scripts/catalog-business-audit.mjs", import.meta.url), "utf8");
const customsPricing = fs.readFileSync(new URL("../apps/web/lib/catalog/customs-pricing.ts", import.meta.url), "utf8");

test("workflow audits available shards, attempts atomic publication and always writes health", () => {
  const download = workflow.indexOf("Download available source shards");
  const audit = workflow.indexOf("npx tsx scripts/catalog-validate-source-scale.mjs");
  const publish = workflow.indexOf("npx tsx scripts/catalog-publish-source-scale.mjs");
  const health = workflow.indexOf("Write catalog health summary");
  assert.ok(download >= 0, "available source shards must be downloaded");
  assert.ok(audit > download, "calculation and gallery audit must follow artifact download");
  assert.ok(publish > audit, "publisher must run after the source-scale audit");
  assert.ok(health > publish, "health report must follow the publication attempt");
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_SOURCE: "1000"/);
  assert.match(workflow, /CATALOG_PUBLISH_TARGET_PER_MARKET: "3000"/);
  assert.match(workflow, /CATALOG_PUBLISH_MIN_PRODUCTIVE_SOURCES: "3"/);
  assert.match(workflow, /CATALOG_OFFER_RETENTION_MS: "259200000"/);
  assert.match(workflow, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "1"/);
  assert.match(workflow, /health_report_previous_manifest_preserved/);
  assert.match(workflow, /previousManifestPreserved: true/);
  assert.match(workflow, /state = report\.published \? 'published_new_generation' : 'previous_manifest_preserved'/);
  assert.match(workflow, /missing = markets\.filter/);
  assert.match(workflow, /Catalog workflow completed/);
  assert.doesNotMatch(workflow, /throw new Error\(`catalog_storage_or_publication_failure_/);
  assert.doesNotMatch(workflow, /Require published 7 × 250 manifest/);
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

test("production source-scale audit validates exact calculations and preserves a healthy manifest", () => {
  assert.match(validator, /galleryRebuiltFrom/);
  assert.match(validator, /fresh_listing/);
  assert.match(validator, /per_market_volume_and_integrity_audit/);
  assert.match(validator, /marketTargetReached/);
  assert.match(validator, /certified_utilization_power/);
  assert.match(validator, /price_breakdown/);
  assert.match(publisher, /calculateOfferWithRussiaCustoms/);
  assert.match(publisher, /previousManifestPreserved/);
  assert.match(publisher, /readMarketOffers/);
  assert.match(publisher, /targetPerSource/);
  assert.match(publisher, /retentionMs/);
});

test("catalog pricing never substitutes peak power as certified utilization power", () => {
  assert.doesNotMatch(customsPricing, /estimated-utilization-preview/);
  assert.doesNotMatch(customsPricing, /withConservativeUtilizationPreview/);
  assert.match(customsPricing, /needs_utilization_power/);
  assert.match(customsPricing, /Пиковая мощность не подставляется/);
});
