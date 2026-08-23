import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const reusable = fs.readFileSync(new URL("../.github/workflows/catalog-v3-market-10k-reusable.yml", import.meta.url), "utf8");
const visibleAudit = fs.readFileSync(new URL("../scripts/catalog-audit-visible-calculation-coverage.mjs", import.meta.url), "utf8");
const catalogCard = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogCard.tsx", import.meta.url), "utf8");
const sitemapIndex = fs.readFileSync(new URL("../apps/web/app/(public)/cars/models-sitemap.xml/route.ts", import.meta.url), "utf8");
const sitemapShard = fs.readFileSync(new URL("../apps/web/app/(public)/cars/models-sitemap/[id]/route.ts", import.meta.url), "utf8");

test("V3 keeps the two-photo general admission contract while source-specific gates may be stricter", () => {
  assert.match(reusable, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "2"/);
  assert.doesNotMatch(reusable, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "5"/);
});

test("pending source-priced inventory renders without inventing a delivered RUB total", () => {
  assert.doesNotMatch(catalogCard, /if \(!visibleRub\) return null/);
  assert.match(catalogCard, /totalRub: visibleRub \|\| null/);
  assert.match(catalogCard, /<CatalogPrice offer=\{displayOffer\}/);
});

test("visible calculation release gate checks unsafe exposed price instead of deleting incomplete inventory", () => {
  assert.match(visibleAudit, /unsafePendingVisiblePrices/);
  assert.match(visibleAudit, /catalogOfferVisibleRub\(offer\)/);
  assert.match(visibleAudit, /noUnsafePendingVisiblePrices/);
  assert.match(visibleAudit, /pass: invalidReady\.length === 0 && allIdentitiesResolved && unsafePendingVisiblePrices\.length === 0/);
  assert.doesNotMatch(visibleAudit, /pass: invalidReady\.length === 0 && invalidSpecifications\.length === 0 && preliminary === 0 && needsData === 0/);
});

test("model sitemap shards stay comfortably below production gateway response limits", () => {
  assert.match(sitemapIndex, /const MODELS_PER_SITEMAP = 5_000/);
  assert.match(sitemapShard, /const MODELS_PER_SITEMAP = 5_000/);
});
