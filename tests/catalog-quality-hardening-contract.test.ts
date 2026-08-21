import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-market.mjs", import.meta.url), "utf8");
const retention = fs.readFileSync(new URL("../apps/web/lib/catalog/source-retention.ts", import.meta.url), "utf8");
const knowledge = fs.readFileSync(new URL("../apps/web/lib/catalog/vehicle-knowledge.ts", import.meta.url), "utf8");
const fastGallery = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-fast-gallery-wrapper.ts", import.meta.url), "utf8");

test("publisher uses source-aware bounded outage retention", () => {
  assert.match(publisher, /catalogSourceRefreshStates/);
  assert.match(publisher, /catalogRetentionDecision/);
  assert.match(publisher, /CATALOG_SOURCE_OUTAGE_RETENTION_MULTIPLIER/);
  assert.match(publisher, /outageProtectedCount/);
  assert.match(retention, /source_cycle_finished/);
  assert.match(retention, /freshSaved > 0/);
  assert.match(retention, /source_outage_grace/);
});

test("power conflicts fail safe or use a unique exact variant", () => {
  assert.match(knowledge, /variant_override/);
  assert.match(knowledge, /unresolved_model_conflict/);
  assert.match(knowledge, /documented/);
  assert.match(knowledge, /source_exact/);
  assert.match(knowledge, /vehicle-knowledge:/);
});

test("high-volume gallery keeps source URLs and continues toward thirty", () => {
  assert.match(fastGallery, /CATALOG_IMAGE_STORAGE_MODE/);
  assert.match(fastGallery, /source_urls_only/);
  assert.match(fastGallery, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER \|\| 30/);
});
