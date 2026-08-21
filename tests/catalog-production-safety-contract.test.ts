import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { isLikelyVehicleImage, rankedCatalogImageUrls } from "../apps/web/lib/catalog/image-quality";
import { shouldPreferKnowledgeVariantPower } from "../apps/web/lib/catalog/power-sanity";

const rebuild = fs.readFileSync(new URL("../scripts/catalog-rebuild-source-shard.mjs", import.meta.url), "utf8");
const importer = fs.readFileSync(new URL("../apps/web/lib/catalog/importer.ts", import.meta.url), "utf8");
const sourceBoundGallery = fs.readFileSync(new URL("../apps/web/lib/catalog/source-bound-open-market-gallery.ts", import.meta.url), "utf8");

test("explicit source thumbnails cannot become catalog images", () => {
  const lowRes = {
    url: "https://img.example.test/listing/ford-expedition/320x240/photo.jpg",
    objectKey: "",
    size: 0,
    mimeType: "image/jpeg",
  };
  const full = {
    url: "https://img.example.test/listing/ford-expedition/1280x853/photo.jpg",
    objectKey: "",
    size: 0,
    mimeType: "image/jpeg",
  };
  assert.equal(isLikelyVehicleImage(lowRes), false);
  assert.equal(isLikelyVehicleImage(full), true);
  assert.deepEqual(rankedCatalogImageUrls({ images: [lowRes, full] }), [full.url]);
});

test("generic open-market galleries are bound to exact listing rows instead of whole-page images", () => {
  assert.match(importer, /sourceBoundOpenMarketGallery/);
  assert.match(sourceBoundGallery, /rows\.find\(\(candidate: any\).*candidate\?\.id/);
  assert.match(sourceBoundGallery, /gallerySafetyMode: "exact_listing_row_only"/);
  assert.doesNotMatch(sourceBoundGallery, /collectMarkupImages/);
  assert.doesNotMatch(sourceBoundGallery, /originalFetchImages/);
});

test("retention uses last successful refresh rather than original listing publication date", () => {
  assert.match(rebuild, /function retentionTime\(offer\)/);
  assert.match(rebuild, /operational\?\.fullRebuildAt\s*\|\| offer\?\.updatedAt/);
  assert.match(rebuild, /retentionTime\(row\) < cutoff/);
  assert.match(rebuild, /retentionTime\(offer\) >= cutoff/);
  assert.doesNotMatch(rebuild, /firstSeen\(row\) < cutoff/);
});

test("unqualified or estimated power conflicts prefer an exact matched knowledge variant", () => {
  assert.equal(shouldPreferKnowledgeVariantPower({ sourcePowerHp: 100, variantPowerHp: 163, variantSourceType: "drom_catalog" }), true);
  assert.equal(shouldPreferKnowledgeVariantPower({ sourcePowerHp: 100, sourceConfidence: "estimated", variantPowerHp: 163, variantSourceType: "source_consensus" }), true);
  assert.equal(shouldPreferKnowledgeVariantPower({ sourcePowerHp: 100, sourceConfidence: "source_exact", variantPowerHp: 163, variantSourceType: "drom_catalog" }), false);
  assert.equal(shouldPreferKnowledgeVariantPower({ sourcePowerHp: 100, sourceConfidence: "source_exact", variantPowerHp: 163, variantSourceType: "official_registry" }), true);
  assert.equal(shouldPreferKnowledgeVariantPower({ sourcePowerHp: 160, sourceConfidence: "source_exact", variantPowerHp: 163, variantSourceType: "official_registry" }), false);
});
