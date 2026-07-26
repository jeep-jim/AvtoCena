import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const probe = fs.readFileSync(new URL("../scripts/catalog-probe-source-shard.mjs", import.meta.url), "utf8");
const gallery = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-fast-gallery-wrapper.ts", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");

test("v20 admits only curated sources with usable live offers", () => {
  assert.match(probe, /const sourcePlan/);
  assert.match(probe, /isUsableOffer/);
  assert.match(probe, /source\.fetchPage\(null\)/);
  assert.match(probe, /sourceIdsForRebuild/);
  assert.doesNotMatch(probe, /connectedMarketSources/);
});

test("v20 caches listing photos before optional detail enrichment", () => {
  const cacheAt = gallery.indexOf("cacheImageFromUrl(url");
  const returnAt = gallery.indexOf("listingImages.length >= minimum");
  const detailAt = gallery.indexOf("source.fetchImages(offer)");
  assert.ok(cacheAt >= 0 && returnAt > cacheAt && detailAt > returnAt);
  assert.match(gallery, /CATALOG_GALLERY_FAST_PATH/);
  assert.match(gallery, /Math\.min\(30/);
});

test("v20 fails fast but preserves exact publication validation", () => {
  const probeAt = workflow.indexOf("Probe curated live sources");
  const rebuildAt = workflow.indexOf("Rebuild only sources that passed probe");
  const gateAt = workflow.indexOf("Require fresh offers, exact customs and valid galleries");
  const publishAt = workflow.indexOf("Publish verified fresh catalog");
  assert.ok(probeAt >= 0 && rebuildAt > probeAt && gateAt > rebuildAt && publishAt > gateAt);
  assert.match(workflow, /timeout-minutes: 55/);
  assert.match(workflow, /CATALOG_REBUILD_TIME_LIMIT_MS: "2400000"/);
});
