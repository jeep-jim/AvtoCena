import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseAutoGeorgiaMoney } from "../apps/web/lib/catalog/auto-georgia-enriched-source";

const priority = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-market-sources.ts", import.meta.url), "utf8");
const fastGallery = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-fast-gallery-wrapper.ts", import.meta.url), "utf8");
const fullGallery = fs.readFileSync(new URL("../apps/web/lib/catalog/full-gallery-wrapper.ts", import.meta.url), "utf8");
const importer = fs.readFileSync(new URL("../apps/web/lib/catalog/importer.ts", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-v2-production.yml", import.meta.url), "utf8");
const probe = fs.readFileSync(new URL("../scripts/catalog-probe-source-shard.mjs", import.meta.url), "utf8");
const rebuild = fs.readFileSync(new URL("../scripts/catalog-rebuild-source-shard.mjs", import.meta.url), "utf8");

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

test("AUTO.GE prices keep decimal cents separate from thousands", () => {
  assert.equal(parseAutoGeorgiaMoney("6,400.00"), 6_400);
  assert.equal(parseAutoGeorgiaMoney("17,500.00"), 17_500);
  assert.equal(parseAutoGeorgiaMoney("28 700"), 28_700);
  assert.equal(parseAutoGeorgiaMoney("9.200,00"), 9_200);
});

test("commercial vehicles are excluded from priority passenger-car sources", () => {
  assert.match(priority, /COMMERCIAL_RE/);
  assert.match(priority, /Hino\|Mitsubishi Fuso/);
  assert.match(priority, /truck\|dump\|tipper\|bus/);
});

test("Catalog V2 probes every configured source slot, crawls live sites and retains inactive sites", () => {
  assert.match(workflow, /Catalog V2 production/);
  assert.match(workflow, /max-parallel: 20/);
  assert.match(workflow, /market: \[korea, china, japan, uae, europe, georgia, kyrgyzstan\]/);
  assert.match(workflow, /npx tsx scripts\/catalog-probe-source-shard\.mjs/);
  assert.match(workflow, /npx tsx scripts\/catalog-rebuild-source-shard\.mjs/);
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_SOURCE: "100000"/);
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_MARKET: "100000"/);
  assert.match(workflow, /CATALOG_REBUILD_SHARD_COUNT: "5"/);
  assert.match(workflow, /shard: \[0, 1, 2, 3, 4\]/);
  assert.match(workflow, /CATALOG_OFFER_RETENTION_MS: "259200000"/);
  assert.match(probe, /sourceIdsForRebuild = activeSourceIds\.join/);
  assert.match(probe, /sourceIdsForRebuild/);
  assert.match(rebuild, /targetPerSource/);
  assert.match(rebuild, /retentionSourceIds/);
  assert.match(rebuild, /liveSourceIds/);
  assert.match(rebuild, /catalog\/source-cursors/);
  assert.doesNotMatch(workflow, /CATALOG_REBUILD_TARGET: "250"/);
  assert.doesNotMatch(workflow, /catalog-rebuild-market-retry/);
});

test("priority galleries preserve listing photos and enrich detail progressively", () => {
  const listingCache = fastGallery.indexOf("cacheImageFromUrl");
  const detailedFetch = fastGallery.indexOf("source.fetchImages(offer)");
  assert.ok(listingCache >= 0 && detailedFetch > listingCache);
  assert.match(fastGallery, /CATALOG_GALLERY_FAST_PATH/);
  assert.match(fastGallery, /listingImages\.length >= minimum/);
  assert.match(fullGallery, /sourceGalleryUrls\(offer\)/);
  assert.match(fullGallery, /\[\.\.\.listingUrls, \.\.\.detailed\]/);
  assert.match(fullGallery, /gallerySafetyMode: "source_urls_only"/);
  assert.match(fullGallery, /return verified \? result : \[\]/);
  assert.match(importer, /priorityFastGallery/);
  assert.match(importer, /myAutoListSource/);
  assert.match(importer, /autoGeorgiaStrictSource/);
  assert.match(importer, /mashinaKyrgyzstanListSource/);
  assert.match(importer, /reliableBootstrapSources/);
  assert.match(workflow, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "1"/);
  assert.match(workflow, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER: "30"/);
  assert.match(workflow, /CATALOG_COLLECTION_IMAGE_LIMIT: "30"/);
  assert.match(workflow, /CATALOG_MAX_IMAGES_PER_OFFER: "30"/);
  assert.match(workflow, /CATALOG_GALLERY_FAST_PATH: "false"/);
  assert.match(workflow, /CATALOG_REBUILD_DETAIL_LIMIT_PER_SOURCE: "100000"/);
  assert.match(rebuild, /const detailNeeded = mandatoryPhotoMissing \|\| criticalSpecsMissing \|\| priorityGalleryMissing/);
  assert.match(rebuild, /reserveDetail/);
  assert.match(rebuild, /detailDeferredBySource/);
  assert.match(rebuild, /source\.fetchImages\(offer\)/);
});
