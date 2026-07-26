import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { catalogImportSources } from "../apps/web/lib/catalog/importer";
import { scaleMarketSources } from "../apps/web/lib/catalog/scale-market-sources";
import {
  CATALOG_DAILY_TARGET_PER_SOURCE,
  CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET,
  CATALOG_RETENTION_MS,
  PUBLIC_CATALOG_MARKETS,
} from "../apps/web/lib/catalog/runtime-config";

const probeScript = fs.readFileSync(new URL("../scripts/catalog-probe-source-shard.mjs", import.meta.url), "utf8");
const rebuildScript = fs.readFileSync(new URL("../scripts/catalog-rebuild-source-shard.mjs", import.meta.url), "utf8");
const publishScript = fs.readFileSync(new URL("../scripts/catalog-publish-source-scale.mjs", import.meta.url), "utf8");
const validationScript = fs.readFileSync(new URL("../scripts/catalog-validate-source-scale.mjs", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");
const brandRail = fs.readFileSync(new URL("../apps/web/components/catalog/BrandLogoRail.tsx", import.meta.url), "utf8");
const offerQuality = fs.readFileSync(new URL("../apps/web/lib/catalog/offer-quality.ts", import.meta.url), "utf8");
const galleryWrapper = fs.readFileSync(new URL("../apps/web/lib/catalog/full-gallery-wrapper.ts", import.meta.url), "utf8");
const flatUi = fs.readFileSync(new URL("../apps/web/app/flat-ui.css", import.meta.url), "utf8");

test("source-scale catalog keeps 1000-offer quota per source and supports at least 1000 per market", () => {
  assert.equal(CATALOG_DAILY_TARGET_PER_SOURCE, 1_000);
  assert.equal(CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET, 30_000);
  assert.equal(CATALOG_RETENTION_MS, 3 * 24 * 60 * 60 * 1_000);
  assert.match(rebuildScript, /minimumMarketTarget/);
  assert.match(rebuildScript, /targetPerSource/);
  assert.match(publishScript, /targetPerMarket/);
  assert.match(publishScript, /marketsBelowTarget/);
  assert.match(validationScript, /marketTargetReached/);
  assert.doesNotMatch(publishScript, /selected\.length >= target\b/);
});

test("source-scale workflow does not cancel an in-flight atomic publication", () => {
  assert.match(workflow, /group: catalog-seven-market-recovery/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /max-parallel: 14/);
  assert.doesNotMatch(workflow, /group: catalog-source-scale-recovery/);
});

test("source-scale workflow uses four shards, retries probes and attempts up to 30 photos", () => {
  assert.match(workflow, /CATALOG_REBUILD_SHARD_COUNT: "4"/);
  assert.match(workflow, /shard: \[0, 1, 2, 3\]/);
  assert.match(workflow, /CATALOG_PROBE_ATTEMPTS: "2"/);
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_SOURCE: "1000"/);
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_MARKET: "1000"/);
  assert.match(workflow, /CATALOG_PUBLISH_TARGET_PER_MARKET: "1000"/);
  assert.match(workflow, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER: "6"/);
  assert.match(workflow, /CATALOG_MAX_IMAGES_PER_OFFER: "30"/);
  assert.match(rebuildScript, /requiredBeforeNetwork = minimumImages/);
  assert.match(rebuildScript, /Math\.min\(30/);
});

test("all seven markets are backed by registered production adapters", () => {
  const byMarket = new Map(PUBLIC_CATALOG_MARKETS.map((market) => [market, new Set<string>()]));
  for (const source of catalogImportSources) {
    if (source.market === "multi") continue;
    byMarket.get(source.market)?.add(source.sourceId);
  }
  for (const market of PUBLIC_CATALOG_MARKETS) {
    assert.ok((byMarket.get(market)?.size || 0) > 0, `${market} must have at least one registered source`);
  }
  assert.ok((byMarket.get("japan")?.size || 0) >= 10, "Japan must use the expanded source registry");
  assert.ok((byMarket.get("china")?.size || 0) >= 8, "China must use the expanded source registry");
  assert.ok((byMarket.get("europe")?.size || 0) >= 8, "Europe must use the expanded source registry");
});

test("probe and rebuild use the complete registered registry instead of a curated-only list", () => {
  assert.match(probeScript, /catalogImportSources\s*\.filter/);
  assert.match(probeScript, /registeredSourceCount/);
  assert.match(probeScript, /Probe — диагностика и приоритизация, а не фильтр/);
  assert.match(rebuildScript, /catalogImportSources\s*\.filter/);
  assert.match(rebuildScript, /plannedAll/);
  assert.match(rebuildScript, /orderedConfigured/);
});

test("rebuild persists a cursor for every source and advances across repeated runs", () => {
  assert.match(rebuildScript, /catalog\/source-cursors/);
  assert.match(rebuildScript, /readCursorState/);
  assert.match(rebuildScript, /saveCursorState/);
  assert.match(rebuildScript, /initialCursor/);
  assert.match(rebuildScript, /pagesVisited/);
});

test("requested high-volume public sources are registered", () => {
  const ids = new Set(scaleMarketSources.map((source) => source.sourceId));
  for (const sourceId of [
    "dubizzle_uae_open",
    "kcar_korea_open",
    "autopapa_georgia_open",
    "jpauc_japan_past_open",
    "carvector_japan_stat_open",
    "jpcenter_japan_catalog_open",
    "prestige_japan_auctions_open",
  ]) {
    assert.equal(ids.has(sourceId), true, `${sourceId} must be registered`);
  }
});

test("brand rail uses the existing catalog query instead of a missing route", () => {
  assert.match(brandRail, /href=\{`\/cars\?make=\$\{encodeURIComponent\(brand\)\}`\}/);
  assert.doesNotMatch(brandRail, /\/cars\/brand\//);
});

test("generic open sources only attach images bound to the listing card", () => {
  assert.match(galleryWrapper, /source\.sourceId\.endsWith\("_open"\)/);
  assert.match(galleryWrapper, /gallerySafetyMode/);
  assert.match(galleryWrapper, /listing_bound/);
  assert.match(galleryWrapper, /sourceNativeUrls\.length >= result\.length/);
  assert.match(galleryWrapper, /listingImages/);
  assert.match(galleryWrapper, /fastPath/);
});

test("catalog rejects implausible ordinary-car prices and power", () => {
  assert.match(offerQuality, /totalRub > 50_000_000/);
  assert.match(offerQuality, /performance \|\| commercial \? 1_500 : 650/);
  assert.match(offerQuality, /powerHp \/ engineCc > 0\.21/);
  assert.match(offerQuality, /hasPlausibleSourcePrice/);
});

test("dealer verification badge keeps absolute placement and company rows align at the top", () => {
  assert.doesNotMatch(flatUi, /\.dealer-verified-icon\{position:relative!important/);
  assert.match(flatUi, /align-items:flex-start!important/);
});
