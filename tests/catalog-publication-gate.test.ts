import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");
const validator = fs.readFileSync(new URL("../scripts/catalog-validate-source-scale.mjs", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-source-scale.mjs", import.meta.url), "utf8");
const customsPricing = fs.readFileSync(new URL("../apps/web/lib/catalog/customs-pricing.ts", import.meta.url), "utf8");


test("workflow validates fresh market output before writing the catalog", () => {
  const gate = workflow.indexOf("npx tsx scripts/catalog-validate-source-scale.mjs");
  const publish = workflow.indexOf("npx tsx scripts/catalog-publish-source-scale.mjs");
  assert.ok(gate >= 0, "publication gate must be executed");
  assert.ok(publish > gate, "publication gate must run before publisher");
  assert.match(workflow, /CATALOG_PUBLISH_MIN_FRESH_BY_MARKET/);
  assert.match(workflow, /japan\\?":250|"japan":250/);
  assert.doesNotMatch(workflow, /Run production catalog smoke checks\n\s+continue-on-error: true/);
});

test("publication gate distinguishes fresh listings from restored listings", () => {
  assert.match(validator, /galleryRebuiltFrom/);
  assert.match(validator, /fresh_listing/);
  assert.match(validator, /catalog_publication_gate_failed/);
  assert.match(validator, /certified_utilization_power/);
  assert.match(validator, /price_breakdown/);
});

test("publisher cannot read unvalidated offers directly from object storage", () => {
  assert.doesNotMatch(publisher, /readMarketOffers/);
  assert.match(publisher, /hasExactCalculation/);
  assert.match(publisher, /revalidatedRows/);
  assert.match(publisher, /version: 18/);
});

test("catalog pricing never substitutes peak power as certified utilization power", () => {
  assert.doesNotMatch(customsPricing, /estimated-utilization-preview/);
  assert.doesNotMatch(customsPricing, /withConservativeUtilizationPreview/);
  assert.match(customsPricing, /needs_utilization_power/);
  assert.match(customsPricing, /Пиковая мощность не подставляется/);
});
