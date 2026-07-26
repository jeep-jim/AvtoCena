import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const priority = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-market-sources.ts", import.meta.url), "utf8");
const fastGallery = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-fast-gallery-wrapper.ts", import.meta.url), "utf8");
const importer = fs.readFileSync(new URL("../apps/web/lib/catalog/importer.ts", import.meta.url), "utf8");
const probe = fs.readFileSync(new URL("../scripts/catalog-probe-source-shard.mjs", import.meta.url), "utf8");
const rebuild = fs.readFileSync(new URL("../scripts/catalog-rebuild-source-shard.mjs", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");

test("live high-volume sources use current listing and detail routes", () => {
  assert.ok(priority.includes('sourceId: "guazi_china_open"'));
  assert.ok(priority.includes("car-detail"));
  assert.ok(priority.includes('sourceId: "carused_japan_open"'));
  assert.ok(priority.includes("https://carused.jp/car-list?page=${page}"));
  assert.ok(priority.includes("car-list\\/detail"));
  assert.ok(priority.includes('sourceId: "tcv_japan_open"'));
  assert.ok(priority.includes("https://www.tc-v.com/used_car/all/all/"));
  assert.ok(priority.includes("?pn=${page - 1}"));
});

test("commercial vehicles are excluded from priority passenger-car sources", () => {
  assert.match(priority, /COMMERCIAL_RE/);
  assert.match(priority, /Hino\|Mitsubishi Fuso/);
  assert.match(priority, /truck\|dump\|tipper\|bus/);
});

test("fresh source pages are processed before three-day restored stock", () => {
  const sourceLoop = rebuild.indexOf("const sourceStates");
  const restoredRead = rebuild.indexOf("readAllOffersForMaintenance");
  assert.ok(sourceLoop >= 0 && restoredRead >= 0);
  assert.match(rebuild, /galleryRebuiltFrom: origin/);
  assert.match(rebuild, /freshBySource/);
  assert.match(rebuild, /retentionMs/);
  assert.match(rebuild, /retentionSourceIds/);
});

test("v21 probes only curated shard sources before network collection", () => {
  assert.match(probe, /const sourcePlan/);
  assert.match(probe, /sourceIdsForRebuild/);
  assert.match(probe, /__no_live_sources__/);
  assert.match(probe, /source\.fetchPage\(null\)/);
  assert.match(workflow, /Catalog source-scale v21/);
  assert.match(workflow, /Probe curated live sources/);
  assert.match(workflow, /CATALOG_REBUILD_SOURCE_IDS: \$\{\{ steps\.probe\.outputs\.source_ids \|\| '__no_live_sources__' \}\}/);
  assert.match(workflow, /CATALOG_PROBE_TIMEOUT_MS: "12000"/);
});

test("priority galleries cache listing photos before requesting detail pages", () => {
  const listingCache = fastGallery.indexOf("cacheImageFromUrl");
  const detailedFetch = fastGallery.indexOf("source.fetchImages(offer)");
  assert.ok(listingCache >= 0 && detailedFetch > listingCache);
  assert.match(fastGallery, /CATALOG_GALLERY_FAST_PATH/);
  assert.match(fastGallery, /listingImages\.length >= minimum/);
  assert.match(importer, /priorityFastGallery/);
  assert.match(workflow, /CATALOG_GALLERY_FAST_PATH: "true"/);
  assert.match(workflow, /CATALOG_OFFER_RETENTION_MS: "259200000"/);
});
