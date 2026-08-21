import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const fullGallery = fs.readFileSync(new URL("../apps/web/lib/catalog/full-gallery-wrapper.ts", import.meta.url), "utf8");
const fastGallery = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-fast-gallery-wrapper.ts", import.meta.url), "utf8");
const jpauc = fs.readFileSync(new URL("../apps/web/lib/catalog/jpauc-past-source.ts", import.meta.url), "utf8");

test("full gallery accepts two source photos but preserves the thirty-photo ceiling", () => {
  assert.match(fullGallery, /Math\.max\(2/);
  assert.match(fullGallery, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER \|\| 2/);
  assert.match(fullGallery, /Math\.min\(30/);
  assert.match(fullGallery, /gallerySafetyMode: "source_urls_only"/);
  assert.match(fullGallery, /promo\|promotion\|campaign\|advert/);
});

test("fast gallery does not binary-cache listing photos in source URL mode", () => {
  assert.match(fastGallery, /CATALOG_IMAGE_STORAGE_MODE/);
  assert.match(fastGallery, /source_urls_only/);
  assert.match(fastGallery, /sourceUrlImage/);
  assert.match(fastGallery, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER \|\| 30/);
  assert.match(fastGallery, /listingImages\.length >= preferred/);
  const sourceMode = fastGallery.indexOf("if (sourceUrlsOnly)");
  const binaryMode = fastGallery.indexOf("cacheImageFromUrl", sourceMode);
  assert.ok(sourceMode >= 0 && binaryMode > sourceMode, "binary cache must be confined to the non-source-URL branch");
});

test("JPAuc gallery is derived only from the exact listing-bound image URL", () => {
  assert.match(jpauc, /galleryIdentity: "listing_bound_variants"/);
  assert.match(jpauc, /photoVariants\(listingImage\)/);
  assert.match(jpauc, /shared image host does not prove lot identity/);
  assert.doesNotMatch(jpauc, /isSameLotImageHost/);
  assert.doesNotMatch(jpauc, /detail\.html\.matchAll/);
});
