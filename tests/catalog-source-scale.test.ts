import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { scaleMarketSources } from "../apps/web/lib/catalog/scale-market-sources";
import {
  CATALOG_DAILY_TARGET_PER_SOURCE,
  CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET,
  CATALOG_RETENTION_MS,
} from "../apps/web/lib/catalog/runtime-config";

const rebuildScript = fs.readFileSync(new URL("../scripts/catalog-rebuild-source-shard.mjs", import.meta.url), "utf8");
const publishScript = fs.readFileSync(new URL("../scripts/catalog-publish-source-scale.mjs", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");

test("source-scale catalog keeps 1000-offer quota per source and three-day retention", () => {
  assert.equal(CATALOG_DAILY_TARGET_PER_SOURCE, 1_000);
  assert.equal(CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET, 30_000);
  assert.equal(CATALOG_RETENTION_MS, 3 * 24 * 60 * 60 * 1_000);
  assert.match(rebuildScript, /targetPerSource/);
  assert.match(publishScript, /sourceCounts/);
  assert.doesNotMatch(publishScript, /selected\.length >= target\b/);
});

test("source-scale workflow uses two shards per market and attempts up to 30 photos", () => {
  assert.match(workflow, /CATALOG_REBUILD_SHARD_COUNT: "2"/);
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_SOURCE: "1000"/);
  assert.match(workflow, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER: "6"/);
  assert.match(workflow, /CATALOG_MAX_IMAGES_PER_OFFER: "30"/);
  assert.match(rebuildScript, /images\.length < preferredImages/);
  assert.match(rebuildScript, /Math\.min\(30/);
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
