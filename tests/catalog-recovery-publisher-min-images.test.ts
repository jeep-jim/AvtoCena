import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const batchSource = fs.readFileSync(new URL("../scripts/catalog-live-recovery-publish-batch.mjs", import.meta.url), "utf8");
const cumulativeSource = fs.readFileSync(new URL("../scripts/catalog-live-recovery-publish.mjs", import.meta.url), "utf8");

test("batch recovery publisher enforces configured minimum images on target incoming and retained rows", () => {
  assert.match(batchSource, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER\s*\|\|\s*5/);
  assert.match(batchSource, /offer\.images\.length < minImagesPerOffer\) \{ reject\("images"\); continue; \}/);
  assert.match(batchSource, /offer\.images\.length < minImagesPerOffer\) continue;/);
  assert.match(batchSource, /recovery_batch_target_image_gate_failed/);
  assert.match(batchSource, /belowMinimum: rows\.filter\(\(offer\) => offer\.images\.length < minImagesPerOffer\)\.length/);
});

test("batch recovery publisher does not apply target image floor to untouched-market preservation", () => {
  assert.match(batchSource, /isCatalogYearAllowed\(offer\.year, other\) && offer\.images\.length > 0 && withinRetention/);
  assert.doesNotMatch(batchSource, /isCatalogYearAllowed\(offer\.year, other\) && offer\.images\.length >= minImagesPerOffer/);
});

test("both recovery publishers fail closed on impossible Korean sedan body types", () => {
  for (const source of [batchSource, cumulativeSource]) {
    assert.match(source, /function koreaKnownSedanIdentity\(offer\)/);
    assert.match(source, /G80/);
    assert.match(source, /Grandeur/);
    assert.match(source, /Ioniq/);
    assert.match(source, /K9/);
    assert.match(source, /K900/);
    assert.match(source, /Quoris/);
    assert.match(source, /function semanticBodyValid\(offer, currentMarket\)/);
    assert.match(source, /reject\("semantic_body"\)/);
    assert.match(source, /reject\("retained_semantic_body"\)/);
    assert.match(source, /semanticBodyValid\(offer, other\)/);
  }
});
