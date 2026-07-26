import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");
const validator = fs.readFileSync(new URL("../scripts/catalog-validate-source-scale.mjs", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-source-scale.mjs", import.meta.url), "utf8");
const customsPricing = fs.readFileSync(new URL("../apps/web/lib/catalog/customs-pricing.ts", import.meta.url), "utf8");

test("workflow audits market output before writing the catalog", () => {
  const gate = workflow.indexOf("npx tsx scripts/catalog-validate-source-scale.mjs");
  const publish = workflow.indexOf("npx tsx scripts/catalog-publish-source-scale.mjs");
  assert.ok(gate >= 0, "publication audit must be executed");
  assert.ok(publish > gate, "publication audit must run before publisher");
  assert.match(workflow, /CATALOG_PUBLISH_MIN_FRESH_BY_MARKET/);
  const thresholdLine = workflow.match(/CATALOG_PUBLISH_MIN_FRESH_BY_MARKET:\s*'([^']+)'/)?.[1];
  assert.ok(thresholdLine, "fresh-market thresholds must be configured");
  const thresholds = JSON.parse(thresholdLine || "{}");
  assert.ok(Number(thresholds.japan) > 0, "Japan must have a positive fresh-offer target");
  assert.match(workflow, /Run production catalog smoke checks\n\s+if:[^\n]+\n\s+continue-on-error: true/);
});

test("publication audit distinguishes fresh listings and validates exact calculations", () => {
  assert.match(validator, /galleryRebuiltFrom/);
  assert.match(validator, /fresh_listing/);
  assert.match(validator, /per_market_advisory_gate/);
  assert.match(validator, /certified_utilization_power/);
  assert.match(validator, /price_breakdown/);
  assert.doesNotMatch(validator, /catalog_publication_gate_failed/);
});

test("publisher may retain current offers only after recalculation and full audit", () => {
  assert.match(publisher, /readMarketOffers/);
  assert.match(publisher, /readAllOffersForMaintenance/);
  assert.match(publisher, /calculateOfferWithRussiaCustoms/);
  assert.match(publisher, /hasExactCalculation/);
  assert.match(publisher, /isCrediblePublicOffer/);
  assert.match(publisher, /version: 21/);
  assert.match(publisher, /previousManifestPreserved/);
});

test("catalog pricing never substitutes peak power as certified utilization power", () => {
  assert.doesNotMatch(customsPricing, /estimated-utilization-preview/);
  assert.doesNotMatch(customsPricing, /withConservativeUtilizationPreview/);
  assert.match(customsPricing, /needs_utilization_power/);
  assert.match(customsPricing, /Пиковая мощность не подставляется/);
});
