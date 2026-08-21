import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const batchSource = fs.readFileSync(new URL("../scripts/catalog-live-recovery-publish-batch.mjs", import.meta.url), "utf8");
const singleSource = fs.readFileSync(new URL("../scripts/catalog-live-recovery-publish.mjs", import.meta.url), "utf8");
const japanWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-v6-prestige-up-to-30k.yml", import.meta.url), "utf8");

test("batch recovery publisher enforces configured minimum images on target incoming and retained rows", () => {
  assert.match(batchSource, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER\s*\|\|\s*5/);
  assert.match(batchSource, /offer\.images\.length < minImagesPerOffer\) \{ reject\("images"\); continue; \}/);
  assert.match(batchSource, /offer\.images\.length < minImagesPerOffer\) continue;/);
  assert.match(batchSource, /recovery_batch_target_image_gate_failed/);
  assert.match(batchSource, /belowMinimum: rows\.filter\(\(offer\) => offer\.images\.length < minImagesPerOffer\)\.length/);
});

test("single recovery publisher enforces the same target five-photo floor", () => {
  assert.match(singleSource, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER\s*\|\|\s*5/);
  assert.match(singleSource, /offer\.images\.length < minImagesPerOffer\) \{ reject\("images"\); continue; \}/);
  assert.match(singleSource, /offer\.images\.length < minImagesPerOffer\) continue;/);
  assert.match(singleSource, /recovery_target_image_gate_failed/);
});

test("single and batch recovery publishers preserve untouched markets from complete maintenance state", () => {
  for (const source of [singleSource, batchSource]) assert.match(source, /readAllOffersForMaintenance/);
  assert.match(singleSource, /const currentInternal = await readAllOffersForMaintenance\(\);/);
  assert.match(singleSource, /const preservedInternal = currentInternal\.filter/);
  assert.match(batchSource, /const preserveUntouchedExact = true/);
  assert.match(batchSource, /const maintenanceOffers = preserveUntouchedExact \? await readAllOffersForMaintenance\(\) : \[\];/);
});

test("single recovery publisher hashes untouched public projections before and after persistence", () => {
  assert.match(singleSource, /preservedPublicHashByMarket/);
  assert.match(singleSource, /postPersistPublicHashByMarket/);
  assert.match(singleSource, /preservationFailures/);
  assert.match(singleSource, /recovery_preserved_internal_gate_failed/);
  assert.match(singleSource, /recovery_duplicate_id_in_full_state/);
});

test("Japan keeps sold lots for 180 days and rejects a pre-write drop below 90 percent", () => {
  assert.match(japanWorkflow, /CATALOG_OFFER_RETENTION_MS: "15552000000"/);
  assert.match(japanWorkflow, /RECOVERY_PUBLISH_MIN_PREVIOUS_RATIO: "0\.90"/);
  assert.match(singleSource, /const minPreviousCount = minPreviousRatio > 0 && previousMarket\.length > 0/);
  assert.match(singleSource, /recovery_previous_count_gate_failed/);
  assert.ok(
    singleSource.indexOf("recovery_previous_count_gate_failed") <
      singleSource.indexOf("const currentInternal = await readAllOffersForMaintenance()"),
    "the relative count gate must run before any catalog persistence",
  );
});
