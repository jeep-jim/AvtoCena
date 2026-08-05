import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-v2-market-recovery-reusable.yml", import.meta.url), "utf8");
const smoke9 = fs.readFileSync(new URL("../.github/workflows/catalog-v2-smoke9-reusable.yml", import.meta.url), "utf8");
const rollout = fs.readFileSync(new URL("../.github/workflows/catalog-v2-smoke9-rollout.yml", import.meta.url), "utf8");
const cleanup = fs.readFileSync(new URL("../scripts/catalog-clean-failed-generations.mjs", import.meta.url), "utf8");

test("market workflow preserves diagnostics and retries quota failures after safe cleanup", () => {
  assert.match(workflow, /catalog-clean-failed-generations\.mjs/);
  assert.match(workflow, /CATALOG_STORAGE_EMERGENCY: "true"/);
  assert.match(workflow, /CATALOG_STORAGE_CLEANUP_DRY_RUN: "false"/);
  assert.match(workflow, /quota|max size|storage.*full|object_storage_.*(?:409|413|507)/i);
  assert.match(workflow, /retention-days: 3/);
  assert.match(cleanup, /liveGeneration/);
  assert.match(cleanup, /generationId !== liveGeneration/);
  assert.match(cleanup, /preservedImages: true/);
  assert.match(cleanup, /preservedInternalCandidatePools: true/);
});

test("market workflow never turns an empty or failed collection into a fake success", () => {
  assert.match(workflow, /Require at least one collected real offer/);
  assert.match(workflow, /totalCollected/);
  assert.match(workflow, /process\.exit\(1\)/);
  assert.match(workflow, /Require a non-empty market publication/);
});

test("independent market collection keeps the full production crawl budget", () => {
  assert.match(workflow, /shard: \[0, 1, 2, 3, 4\]/);
  assert.match(workflow, /max-parallel: 5/);
  assert.match(workflow, /timeout-minutes: 120/);
  assert.match(workflow, /CATALOG_REBUILD_MAX_EMPTY_PAGES: "1000"/);
  assert.match(workflow, /CATALOG_REBUILD_PREPARE_CONCURRENCY: "30"/);
  assert.match(workflow, /CATALOG_REBUILD_TIME_LIMIT_MS: "6300000"/);
  assert.match(workflow, /timeout --signal=TERM --kill-after=120s 6600s/);
  assert.doesNotMatch(workflow, /1200s npx tsx scripts\/catalog-rebuild-source-shard\.mjs/);
});

test("smoke9 publishes exactly nine real cards and preserves project constraints", () => {
  assert.match(smoke9, /CATALOG_REBUILD_TARGET_PER_SOURCE: "9"/);
  assert.match(smoke9, /CATALOG_REBUILD_TARGET_PER_MARKET: "9"/);
  assert.match(smoke9, /CATALOG_PUBLISH_TARGET_PER_MARKET: "9"/);
  assert.match(smoke9, /CATALOG_PUBLISH_MAX_PER_MARKET: "9"/);
  assert.match(smoke9, /count !== 9/);
  assert.match(smoke9, /CATALOG_MAX_IMAGES_PER_OFFER: "30"/);
  assert.match(smoke9, /CATALOG_OFFER_RETENTION_MS: "259200000"/);
  assert.match(smoke9, /catalog-clean-failed-generations\.mjs/);
});

test("smoke9 rollout is strictly sequential across all seven markets", () => {
  assert.match(rollout, /japan:\n    needs: korea/);
  assert.match(rollout, /china:\n    needs: japan/);
  assert.match(rollout, /uae:\n    needs: china/);
  assert.match(rollout, /europe:\n    needs: uae/);
  assert.match(rollout, /georgia:\n    needs: europe/);
  assert.match(rollout, /kyrgyzstan:\n    needs: georgia/);
});
