import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { carusedExactListingUrls, carusedListingGalleryUrls, carusedSourceImageUrl } from "../apps/web/lib/catalog/carused-gallery";

const reusable = fs.readFileSync(new URL("../.github/workflows/catalog-v3-market-10k-reusable.yml", import.meta.url), "utf8");
const visibleAudit = fs.readFileSync(new URL("../scripts/catalog-audit-visible-calculation-coverage.mjs", import.meta.url), "utf8");
const catalogCard = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogCard.tsx", import.meta.url), "utf8");
const sitemapIndex = fs.readFileSync(new URL("../apps/web/app/(public)/cars/models-sitemap.xml/route.ts", import.meta.url), "utf8");
const sitemapShard = fs.readFileSync(new URL("../apps/web/app/(public)/cars/models-sitemap/[id]/route.ts", import.meta.url), "utf8");
const fastGallery = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-fast-gallery-wrapper.ts", import.meta.url), "utf8");
const fullGallery = fs.readFileSync(new URL("../apps/web/lib/catalog/full-gallery-wrapper.ts", import.meta.url), "utf8");

test("V3 keeps the two-photo general admission contract while source-specific gates may be stricter", () => {
  assert.match(reusable, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "2"/);
  assert.doesNotMatch(reusable, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "5"/);
});

test("pending source-priced inventory stays internal until delivered RUB total is ready", () => {
  assert.match(catalogCard, /if \(!visibleRub\) return null/);
  assert.match(catalogCard, /totalRub: visibleRub \|\| null/);
  assert.match(catalogCard, /<CatalogPrice offer=\{displayOffer\}/);
});

test("visible calculation release gate rejects all incomplete public inventory", () => {
  assert.match(visibleAudit, /unsafePendingVisiblePrices/);
  assert.match(visibleAudit, /unpricedPublicCards/);
  assert.match(visibleAudit, /catalogOfferVisibleRub\(offer\)/);
  assert.match(visibleAudit, /noUnsafePendingVisiblePrices/);
  assert.match(visibleAudit, /noUnpricedPublicCards/);
  assert.match(visibleAudit, /&& unpricedPublicCards\.length === 0/);
  assert.match(visibleAudit, /&& invalidSpecifications\.length === 0/);
  assert.match(visibleAudit, /&& preliminary === 0/);
  assert.match(visibleAudit, /&& needsData === 0/);
});

test("model sitemap shards stay comfortably below production gateway response limits", () => {
  assert.match(sitemapIndex, /const MODELS_PER_SITEMAP = 5_000/);
  assert.match(sitemapShard, /const MODELS_PER_SITEMAP = 5_000/);
});

test("Carused exact detail gallery beats a misleading list thumbnail and keeps up to 30 source-resolution photos", () => {
  // This mirrors production YGF03597: the old list parser put 5585471 first,
  // while the exact detail page's deep 45-photo vehicle gallery is 5585470.
  const misleadingListPrimary = "https://d1og64tg0ubvon.cloudfront.net/refno-cars/2026/0611/5585471/001.jpg?w=133&amp;ts=1781661830";
  const realListHint = "https://d1og64tg0ubvon.cloudfront.net/refno-cars/2026/0611/5585470/001.jpg?w=133&amp;ts=1781662733";
  assert.equal(
    carusedSourceImageUrl(misleadingListPrimary),
    "https://d1og64tg0ubvon.cloudfront.net/refno-cars/2026/0611/5585471/001.jpg?ts=1781661830",
  );
  assert.equal(carusedExactListingUrls([misleadingListPrimary, realListHint]).length, 1);

  const realDetailGallery = Array.from({ length: 45 }, (_, index) => {
    const frame = String(index + 1).padStart(3, "0");
    return `https://d1og64tg0ubvon.cloudfront.net/refno-cars/2026/0611/5585470/${frame}.jpg?w=133&amp;ts=1781662733`;
  });
  const recommendationNoise = [misleadingListPrimary,
    "https://d1og64tg0ubvon.cloudfront.net/refno-cars/2026/0601/4767566/001.jpg?w=133",
    "https://d1og64tg0ubvon.cloudfront.net/refno-cars/2026/0601/4767566/002.jpg?w=133"];
  const markup = `<main>${realDetailGallery.map((url) => `<img src="${url}">`).join("")}</main><aside>${recommendationNoise.map((url) => `<img src="${url}">`).join("")}</aside>`;
  const gallery = carusedListingGalleryUrls(markup, misleadingListPrimary, 30);
  assert.equal(gallery.length, 30);
  assert.equal(gallery[0].includes("/5585470/001.jpg"), true);
  assert.equal(gallery[29].includes("/5585470/030.jpg"), true);
  assert.equal(gallery.every((url) => url.includes("/5585470/") && !url.includes("w=133")), true);
  assert.match(fastGallery, /exactCarusedGallery/);
  assert.match(fastGallery, /carusedImages\.length >= minimum/);
  assert.match(fullGallery, /isCarused && detailed\.length >= minimum/);
});
