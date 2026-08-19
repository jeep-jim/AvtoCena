import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const storage = fs.readFileSync(new URL("../apps/web/lib/catalog/storage.ts", import.meta.url), "utf8");

test("current offer shard is trusted only for the active manifest generation", () => {
  assert.match(storage, /Promise\.all\(\[readManifest\(\), readCurrentOfferShard\(id\)\]\)/);
  assert.match(storage, /current\.generationId === manifest\.generationId/);
  assert.match(storage, /return \(current\.items \|\| \[\]\)\.find\(\(item\) => item\.id === id && isPublicOffer\(item\)\) \|\| null/);
});

test("public read models require a valid engine price and reject peer-median outliers", () => {
  assert.match(storage, /catalogPublicPriority\(o\)\.eligible/);
  assert.match(storage, /findCatalogPriceOutliers\(identifiedOffers\)/);
  assert.match(storage, /rejectedPriceIds/);
  assert.match(storage, /previousAllProjection/);
});

test("current search projection is trusted only for the active manifest generation", () => {
  assert.match(storage, /readCurrentSearchProjection\(currentProjectionScope\)/);
  assert.match(storage, /const \[manifest, current\] = await Promise\.all/);
  assert.ok((storage.match(/current\.generationId === manifest\.generationId/g) || []).length >= 2);
});
