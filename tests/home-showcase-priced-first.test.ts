import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const storage = fs.readFileSync(new URL("../apps/web/lib/catalog/storage.ts", import.meta.url), "utf8");
const card = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogCard.tsx", import.meta.url), "utf8");

test("homepage prefers safe delivered-price projections before pending inventory", () => {
  assert.match(storage, /function selectHomepageShowcase\(rows: CatalogSearchProjection\[\], limit: number\)/);
  assert.match(storage, /const priced = rows\.filter\(\(row\) => Number\(row\.totalRub \|\| 0\) > 0\)/);
  assert.match(storage, /const pending = rows\.filter\(\(row\) => Number\(row\.totalRub \|\| 0\) <= 0/);
  assert.match(storage, /return selectHomepageShowcase\(rows, limit\)\.map\(publicOfferFromProjection\)/);
  assert.match(storage, /const diverse = selectHomepageShowcase\(candidates, limit\)/);
});

test("pending inventory is not rendered as a public card", () => {
  assert.match(card, /const visibleRub = catalogOfferVisibleRub\(normalizedOffer\)/);
  assert.match(card, /if \(!visibleRub\) return null/);
});
