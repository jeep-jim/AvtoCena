import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");
const validator = fs.readFileSync(new URL("../scripts/catalog-validate-source-scale.mjs", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-source-scale.mjs", import.meta.url), "utf8");
const freshPublisher = fs.readFileSync(new URL("../scripts/catalog-publish-fresh.mjs", import.meta.url), "utf8");
const businessAudit = fs.readFileSync(new URL("../scripts/catalog-business-audit.mjs", import.meta.url), "utf8");
const customsPricing = fs.readFileSync(new URL("../apps/web/lib/catalog/customs-pricing.ts", import.meta.url), "utf8");

test("workflow requires seven complete markets and a calculation audit before publication", () => {
  const completeGate = workflow.indexOf("Require seven complete 250-offer artifacts");
  const audit = workflow.indexOf("npx tsx scripts/catalog-business-audit.mjs");
  const publish = workflow.indexOf("npx tsx scripts/catalog-publish-fresh.mjs");
  const finalGate = workflow.indexOf("Require published 7 × 250 manifest");
  assert.ok(completeGate >= 0, "all seven artifacts must be checked");
  assert.ok(audit > completeGate, "calculation audit must follow artifact validation");
  assert.ok(publish > audit, "publisher must run only after calculation audit");
  assert.ok(finalGate > publish, "published manifest must be verified after writing");
  assert.match(workflow, /steps\.business_audit\.outputs\.publication_safe == 'true'/);
  assert.match(workflow, /Number\(report\.total \|\| 0\) !== 1750/);
  assert.match(workflow, /Number\(report\.byMarket\?\.\[market\] \|\| 0\) !== 250/);
});

test("business audit checks profiles, knowledge, customs and utilization power", () => {
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

test("legacy source-scale audit still validates exact calculations for diagnostics", () => {
  assert.match(validator, /galleryRebuiltFrom/);
  assert.match(validator, /fresh_listing/);
  assert.match(validator, /per_market_volume_and_integrity_audit/);
  assert.match(validator, /marketTargetReached/);
  assert.match(validator, /certified_utilization_power/);
  assert.match(validator, /price_breakdown/);
  assert.match(publisher, /calculateOfferWithRussiaCustoms/);
  assert.match(publisher, /previousManifestPreserved/);
});

test("catalog pricing never substitutes peak power as certified utilization power", () => {
  assert.doesNotMatch(customsPricing, /estimated-utilization-preview/);
  assert.doesNotMatch(customsPricing, /withConservativeUtilizationPreview/);
  assert.match(customsPricing, /needs_utilization_power/);
  assert.match(customsPricing, /Пиковая мощность не подставляется/);
});
