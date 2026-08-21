import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-v2-market-recovery-reusable.yml", import.meta.url), "utf8");
const cleanup = fs.readFileSync(new URL("../scripts/catalog-clean-failed-generations.mjs", import.meta.url), "utf8");
const capacityWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-emergency-capacity-cleanup.yml", import.meta.url), "utf8");
const market10kReusable = fs.readFileSync(new URL("../.github/workflows/catalog-v3-market-10k-reusable.yml", import.meta.url), "utf8");
const retiredScheduledWriters = [
  "catalog-live-daily-working-markets.yml",
  "catalog-live-recovery-uae-kyrgyzstan.yml",
  "catalog-live-recovery-georgia-yandex-v2.yml",
].map((file) => ({
  file,
  content: fs.readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8"),
}));
const marketFiles = [
  "korea",
  "japan",
  "china",
  "uae",
  "europe",
  "georgia",
  "kyrgyzstan",
].map((market) => ({
  market,
  content: fs.readFileSync(new URL(`../.github/workflows/catalog-v2-${market}.yml`, import.meta.url), "utf8"),
}));

test("market workflow preserves diagnostics and retries quota failures after safe cleanup", () => {
  assert.match(workflow, /catalog-clean-failed-generations\.mjs/);
  assert.match(workflow, /CATALOG_STORAGE_EMERGENCY: "true"/);
  assert.match(workflow, /CATALOG_STORAGE_CLEANUP_DRY_RUN: "false"/);
  assert.match(workflow, /quota|max size|storage.*full|object_storage_.*(?:409|413|507)/i);
  assert.match(workflow, /retention-days: 3/);
  assert.match(cleanup, /liveGeneration/);
  assert.match(cleanup, /!protectedGenerations\.has\(generationId\)/);
  assert.match(cleanup, /preservedImages: true/);
  assert.match(cleanup, /preservedInternalCandidatePools: true/);
  assert.match(cleanup, /protectedInternalPaths/);
  assert.match(cleanup, /orphanInternalObjects/);
  assert.match(cleanup, /protectedGenerations/);
  assert.match(cleanup, /reclaimedBytes/);
  assert.match(cleanup, /storage\.deleteObjects/);
  assert.match(cleanup, /deleteListedObjects\(candidateObjects/);
  assert.match(cleanup, /reusedInitialObjectListing: true/);
  assert.doesNotMatch(cleanup, /deletedCount \+= await/);
  assert.match(capacityWorkflow, /CATALOG_FAILED_GENERATION_MAX_DELETES: "300000"/);
  assert.match(capacityWorkflow, /CATALOG_FAILED_GENERATION_KEEP: "2"/);
  assert.match(capacityWorkflow, /gen_1786426826475_e390aa80/);
  assert.match(capacityWorkflow, /group: catalog-live-daily-working-markets/);
  assert.match(capacityWorkflow, /cancel-in-progress: true/);
});

test("market workflow never turns an empty or failed collection into a fake success", () => {
  assert.match(workflow, /Require at least one collected real offer/);
  assert.match(workflow, /totalCollected/);
  assert.match(workflow, /process\.exit\(1\)/);
  assert.match(workflow, /Require a non-empty market publication/);
});

test("independent market collection keeps the full production crawl budget", () => {
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_SOURCE: "100000"/);
  assert.match(workflow, /CATALOG_REBUILD_TARGET_PER_MARKET: "100000"/);
  assert.match(workflow, /CATALOG_PUBLISH_MAX_PER_MARKET: "100000"/);
  assert.match(workflow, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER: "30"/);
  assert.match(workflow, /CATALOG_MAX_IMAGES_PER_OFFER: "30"/);
  assert.match(workflow, /CATALOG_OFFER_RETENTION_MS: "259200000"/);
  assert.match(workflow, /shard: \[0, 1, 2, 3, 4\]/);
  assert.match(workflow, /max-parallel: 5/);
  assert.match(workflow, /timeout-minutes: 120/);
  assert.match(workflow, /CATALOG_REBUILD_MAX_EMPTY_PAGES: "1000"/);
  assert.match(workflow, /CATALOG_REBUILD_PREPARE_CONCURRENCY: "30"/);
  assert.match(workflow, /CATALOG_REBUILD_TIME_LIMIT_MS: "6300000"/);
  assert.match(workflow, /timeout --signal=TERM --kill-after=120s 6600s/);
});

test("six markets run daily while Japan runs weekly", () => {
  assert.equal(marketFiles.length, 7);
  for (const { market, content } of marketFiles) {
    assert.match(content, /workflow_dispatch:/, `${market} must support manual dispatch`);
    assert.match(content, /schedule:/, `${market} must have its own schedule`);
    if (market === "japan") assert.match(content, /cron: "17 5 \* \* 1"/, "Japan must run weekly");
    else assert.match(content, /cron: "17 \d{1,2} \* \* \*"/, `${market} must run daily`);
    assert.doesNotMatch(content, /\bneeds:/, `${market} must not depend on another market`);
    assert.match(content, new RegExp(`market: ${market}`));
    assert.match(content, /catalog-v(?:2-market-recovery|3-market-10k)-reusable\.yml/);
  }
  assert.match(market10kReusable, /group: catalog-v3-\$\{\{ inputs\.market \}\}/);
  assert.match(marketFiles.find(({ market }) => market === "japan")?.content || "", /retention_ms: "2592000000"/);
  assert.match(marketFiles.find(({ market }) => market === "japan")?.content || "", /target_per_market: "30000"/);
  assert.match(market10kReusable, /CATALOG_JAPAN_RETENTION_MS: "2592000000"/);
});

test("retired combined writers cannot collide with the independent schedules", () => {
  for (const { file, content } of retiredScheduledWriters) {
    assert.match(content, /workflow_dispatch:/, `${file} must remain manually recoverable`);
    assert.doesNotMatch(content, /^\s+schedule:/m, `${file} must not retain a duplicate schedule`);
    assert.doesNotMatch(content, /^\s+workflow_run:/m, `${file} must not auto-chain into a live writer`);
  }
});
