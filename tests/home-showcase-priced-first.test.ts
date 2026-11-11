import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const storage = fs.readFileSync(new URL("../apps/web/lib/catalog/storage.ts", import.meta.url), "utf8");
const card = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogCard.tsx", import.meta.url), "utf8");

test("homepage prefers safe delivered-price projections before pending inventory", () => {
  assert.match(storage, /function selectHomepageShowcase\(rows: CatalogSearchProjection\[\], limit: number, now=new Date\(\)\)/);
  assert.match(storage, /selectCatalogShowcaseDiversity\(rows\.filter\(row=>projectionCanRenderCardAt\(row,now\)\)\.sort\(compareCatalogDisplayOrder\),limit\)/);
  assert.match(storage, /return selectHomepageShowcase\(rows, limit\)\.map\(publicOfferFromProjection\)/);
  assert.match(storage, /const diverse = selectHomepageShowcase\(candidates, limit\)/);
});

test("unqualified pending inventory is not rendered as a public card", () => {
  assert.match(card, /const visibleRub = retro \? 0 : savedCalculationPreviewRub\(savedPreview\) \|\| catalogOfferVisibleRub\(normalizedOffer\)/);
  assert.match(card, /if \(!retro && !visibleRub && !selectionRequired && !sellerPricing && !isPriceOnRequestDubicarsOffer\(normalizedOffer\)\) return null/);
});
