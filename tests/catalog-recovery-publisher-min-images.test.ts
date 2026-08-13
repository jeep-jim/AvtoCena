import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../scripts/catalog-live-recovery-publish-batch.mjs", import.meta.url), "utf8");

test("batch recovery publisher enforces configured minimum images on target incoming and retained rows", () => {
  assert.match(source, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER\s*\|\|\s*5/);
  assert.match(source, /offer\.images\.length < minImagesPerOffer\) \{ reject\("images"\); continue; \}/);
  assert.match(source, /offer\.images\.length < minImagesPerOffer\) continue;/);
  assert.match(source, /recovery_batch_target_image_gate_failed/);
  assert.match(source, /belowMinimum: rows\.filter\(\(offer\) => offer\.images\.length < minImagesPerOffer\)\.length/);
});

test("batch recovery publisher does not apply target image floor to untouched-market preservation", () => {
  assert.match(source, /isCatalogYearAllowed\(offer\.year, other\) && offer\.images\.length > 0 && withinRetention/);
  assert.doesNotMatch(source, /isCatalogYearAllowed\(offer\.year, other\) && offer\.images\.length >= minImagesPerOffer/);
});
