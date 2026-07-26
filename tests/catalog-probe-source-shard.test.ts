import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const probe = fs.readFileSync(new URL("../scripts/catalog-probe-source-shard.mjs", import.meta.url), "utf8");
const rebuild = fs.readFileSync(new URL("../scripts/catalog-rebuild-source-shard.mjs", import.meta.url), "utf8");
const validator = fs.readFileSync(new URL("../scripts/catalog-validate-source-scale.mjs", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-source-scale.mjs", import.meta.url), "utf8");
const gallery = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-fast-gallery-wrapper.ts", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");

test("probe passes only verified curated sources to live collection", () => {
  assert.match(probe, /const sourcePlan/);
  assert.match(probe, /isUsableOffer/);
  assert.match(probe, /Number\(offer\.sourcePrice \|\| 0\) > 0/);
  assert.match(probe, /source\.fetchPage\(null\)/);
  assert.match(probe, /activeSourceIds/);
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

test("inactive live sources still allow three-day verified retention", () => {
  assert.match(rebuild, /explicitNoLiveSources/);
  assert.match(rebuild, /retentionSourceIds/);
  assert.match(rebuild, /probe_inactive_retention_used/);
  assert.match(rebuild, /origin === "fresh_listing" \? preferredImages : minimumImages/);
  assert.doesNotMatch(rebuild, /connectedMarketSources/);
});

test("volume shortages are diagnostics and not a global publication crash", () => {
  assert.match(validator, /per_market_advisory_gate/);
  assert.match(validator, /warnings/);
  assert.match(validator, /publishableMarkets/);
  assert.doesNotMatch(validator, /throw new Error\(`catalog_publication_gate_failed/);
});

test("publisher retains verified current markets and keeps previous manifest on fatal storage failure", () => {
  assert.match(publisher, /readMarketOffers/);
  assert.match(publisher, /readAllOffersForMaintenance/);
  assert.match(publisher, /atomic_all_markets_with_verified_retention/);
  assert.match(publisher, /previousManifestPreserved/);
  assert.match(publisher, /no_verified_offers_keep_previous_manifest/);
  assert.match(publisher, /calculateOfferWithRussiaCustoms/);
});

test("workflow records degradation instead of failing every market", () => {
  assert.match(workflow, /Catalog source-scale v21/);
  assert.match(workflow, /timeout-minutes: 40/);
  assert.match(workflow, /CATALOG_REBUILD_TIME_LIMIT_MS: "1500000"/);
  assert.match(workflow, /Ensure diagnostic envelopes exist/);
  assert.match(workflow, /Publish verified markets and retain the previous healthy base/);
  assert.doesNotMatch(workflow, /Mark failed rebuild process/);
  assert.match(workflow, /cancel-in-progress: false/);
});
