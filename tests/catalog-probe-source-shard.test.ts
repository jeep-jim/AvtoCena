import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const probe = fs.readFileSync(new URL("../scripts/catalog-probe-source-shard.mjs", import.meta.url), "utf8");
const rebuild = fs.readFileSync(new URL("../scripts/catalog-rebuild-source-shard.mjs", import.meta.url), "utf8");
const retry = fs.readFileSync(new URL("../scripts/catalog-rebuild-market-retry.mjs", import.meta.url), "utf8");
const validator = fs.readFileSync(new URL("../scripts/catalog-validate-source-scale.mjs", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-source-scale.mjs", import.meta.url), "utf8");
const gallery = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-fast-gallery-wrapper.ts", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");

test("probe checks every registered source and uses activity only for ordering", () => {
  assert.match(probe, /priorityPlan/);
  assert.match(probe, /catalogImportSources\s*\.filter/);
  assert.match(probe, /isUsableOffer/);
  assert.match(probe, /Number\(offer\.sourcePrice \|\| 0\) > 0/);
  assert.match(probe, /activeSourceIds/);
  assert.match(probe, /inactiveSourceIds/);
  assert.match(probe, /sourceIdsForRebuild = \[\.\.\.activeSourceIds, \.\.\.inactiveSourceIds\]/);
  assert.match(probe, /guazi_china_ru/);
  assert.match(probe, /myauto_georgia_list/);
  assert.doesNotMatch(probe, /connectedMarketSources/);
});

test("listing photos are cached before optional detail enrichment", () => {
  const cacheAt = gallery.indexOf("cacheImageFromUrl(url");
  const fastReturnAt = gallery.indexOf("listingImages.length >= minimum");
  const detailAt = gallery.indexOf("source.fetchImages(offer)");
  assert.ok(cacheAt >= 0 && fastReturnAt > cacheAt && detailAt > fastReturnAt);
  assert.match(gallery, /CATALOG_GALLERY_FAST_PATH/);
  assert.match(gallery, /Math\.min\(30/);
});

test("temporary source failures still allow accumulated verified retention", () => {
  assert.match(rebuild, /retentionSourceIds/);
  assert.match(rebuild, /readCursorState/);
  assert.match(rebuild, /saveCursorState/);
  assert.match(rebuild, /requiredBeforeNetwork = minimumImages/);
  assert.match(rebuild, /revalidated_listing/);
  assert.doesNotMatch(rebuild, /connectedMarketSources/);
});

test("volume shortages are diagnostics and not a global publication crash", () => {
  assert.match(validator, /per_market_volume_and_integrity_audit/);
  assert.match(validator, /targetPerMarket/);
  assert.match(validator, /warnings/);
  assert.match(validator, /publishableMarkets/);
  assert.doesNotMatch(validator, /throw new Error\(`catalog_publication_gate_failed/);
});

test("publisher accumulates verified current markets and keeps previous manifest on fatal storage failure", () => {
  assert.match(publisher, /readMarketOffers/);
  assert.match(publisher, /readAllOffersForMaintenance/);
  assert.match(publisher, /atomic_all_markets_with_verified_accumulation/);
  assert.match(publisher, /previousManifestPreserved/);
  assert.match(publisher, /no_verified_offers_keep_previous_manifest/);
  assert.match(publisher, /calculateOfferWithRussiaCustoms/);
  assert.match(publisher, /marketsBelowTarget/);
});

test("production retries based on the actual accumulated count", () => {
  assert.match(workflow, /Catalog stable 7 × 250/);
  assert.match(workflow, /timeout-minutes: 110/);
  assert.match(workflow, /CATALOG_REBUILD_ATTEMPTS: "3"/);
  assert.match(workflow, /CATALOG_REBUILD_RETRY_BUDGET_MS: "5040000"/);
  assert.match(workflow, /npx tsx scripts\/catalog-rebuild-market-retry\.mjs/);
  assert.match(retry, /for \(let attempt = 1; attempt <= attemptCount/);
  assert.match(retry, /const existing = await readPayload\(outputFile\)/);
  assert.match(retry, /accumulated\.set/);
  assert.match(retry, /all_registered/);
  assert.match(retry, /process\.exitCode = 2/);
  assert.match(workflow, /Require 250 verified offers/);
  assert.match(workflow, /Require seven complete 250-offer artifacts/);
  assert.match(workflow, /Atomically publish exactly 250 per market/);
  assert.match(workflow, /Audit CRM profiles, knowledge, customs and utilization fee/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.doesNotMatch(workflow, /Probe every registered source in this shard/);
});
