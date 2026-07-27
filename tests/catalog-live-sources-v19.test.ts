import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const priority = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-market-sources.ts", import.meta.url), "utf8");
const fastGallery = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-fast-gallery-wrapper.ts", import.meta.url), "utf8");
const fullGallery = fs.readFileSync(new URL("../apps/web/lib/catalog/full-gallery-wrapper.ts", import.meta.url), "utf8");
const importer = fs.readFileSync(new URL("../apps/web/lib/catalog/importer.ts", import.meta.url), "utf8");
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

test("stable production returns to one direct collector per market", () => {
  assert.match(workflow, /Catalog stable 7 × 250/);
  assert.match(workflow, /max-parallel: 7/);
  assert.match(workflow, /npx tsx scripts\/catalog-rebuild-market\.mjs/);
  assert.match(workflow, /CATALOG_REBUILD_TARGET: "250"/);
  assert.match(workflow, /sourceIds: encar_direct/);
  assert.match(workflow, /sourceIds: guazi_china_ru,guazi_china_export,che168_china_exact/);
  assert.match(workflow, /sourceIds: myauto_georgia_list,myauto_georgia_exact,autopapa_georgia_open/);
  assert.match(workflow, /sourceIds: mashina_kyrgyzstan_exact/);
  assert.doesNotMatch(workflow, /shard: \[0, 1, 2, 3\]/);
  assert.doesNotMatch(workflow, /catalog-probe-source-shard/);
});

test("priority galleries cache listing photos before requesting detail pages", () => {
  const listingCache = fastGallery.indexOf("cacheImageFromUrl");
  const detailedFetch = fastGallery.indexOf("source.fetchImages(offer)");
  assert.ok(listingCache >= 0 && detailedFetch > listingCache);
  assert.match(fastGallery, /CATALOG_GALLERY_FAST_PATH/);
  assert.match(fastGallery, /listingImages\.length >= minimum/);
  assert.match(fullGallery, /listingImages/);
  assert.match(fullGallery, /fastPath/);
  assert.match(importer, /priorityFastGallery/);
  assert.match(importer, /myAutoListSource/);
  assert.match(workflow, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "4"/);
  assert.match(workflow, /CATALOG_MAX_IMAGES_PER_OFFER: "30"/);
});
