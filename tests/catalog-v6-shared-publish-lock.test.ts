import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/catalog-v6-prestige-up-to-30k.yml", "utf8");
const verifiedPublish = fs.readFileSync(".github/workflows/catalog-japan-publish-verified-aggregate.yml", "utf8");
const chunk = fs.readFileSync("scripts/prestige-japan-strict-chunk.mjs", "utf8");
const merge = fs.readFileSync("scripts/prestige-japan-strict-merge.mjs", "utf8");
const salvage = fs.readFileSync("scripts/prestige-japan-aggregate-salvage.mjs", "utf8");
const partialMerge = fs.readFileSync("scripts/prestige-japan-partial-merge-for-live.mjs", "utf8");
const repairMerge = fs.readFileSync("scripts/prestige-japan-repair-merge.mjs", "utf8");
const readiness = fs.readFileSync(".github/workflows/catalog-v6-prestige-exact-readiness.yml", "utf8");
const strictLadder = fs.readFileSync(".github/workflows/catalog-v6-prestige-strict-ladder.yml", "utf8");

test("V6 production publish waits on the shared catalog writer and audits all seven markets", () => {
  assert.match(workflow, /publish:[\s\S]*concurrency:[\s\S]*group: catalog-live-daily-working-markets[\s\S]*cancel-in-progress: false/);
  assert.match(workflow, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR: "20"/);
  assert.match(workflow, /CATALOG_AUDIT_ASSERT_MARKETS: korea,china,japan,uae,europe,georgia,kyrgyzstan/);
  assert.match(workflow, /CATALOG_AUDIT_MAX_PER_MODEL_YEAR: "20"/);
  assert.match(workflow, /CATALOG_OFFER_RETENTION_MS: "2592000000"/);
  assert.match(workflow, /CATALOG_PUBLISH_LOCK_WAIT_MS: "7200000"/);
});

test("Prestige scheduled collection tolerates isolated shard transport failures without weakening row quality", () => {
  assert.match(workflow, /cron: "40 19 1,8,15,22 \* \*"/);
  assert.match(workflow, /PRESTIGE_PLAN_MAX_PARTITIONS: "90"/);
  assert.match(workflow, /PRESTIGE_PLAN_RAW_BUDGET: "18000"/);
  assert.match(workflow, /start_model_index=\$\(\( \(10#\$day_of_year % 40\) \* 3 \)\)/);
  assert.match(workflow, /group: catalog-v6-prestige-exact-sold-up-to-30k[\s\S]*cancel-in-progress: true/);
  assert.match(workflow, /chunks:[\s\S]*continue-on-error: true/);
  assert.match(workflow, /Collect exact sold-result partition without publishing[\s\S]*continue-on-error: true/);
  assert.match(workflow, /PRESTIGE_MIN_CHUNK_COVERAGE: "0\.95"/);
  assert.match(merge, /minimumChunkCoverage/);
  assert.match(merge, /inputCoverage/);
  assert.match(merge, /chunk_coverage_/);
});

test("Prestige strict chunk, merge and salvage require the current content-verified gallery contract", () => {
  const contract = "prestige_ajes_exact_detail_v2_cover_content_verified";
  for (const code of [chunk, merge, salvage, partialMerge, repairMerge, readiness, strictLadder]) {
    assert.ok(code.includes(contract));
    assert.equal(code.includes("prestige_ajes_exact_detail_v1"), false);
  }
  for (const code of [chunk, merge, salvage]) {
    assert.match(code, /galleryVerified !== true/);
    assert.match(code, /listingBoundImages !== true/);
    assert.match(code, /coverContentVerified !== true/);
  }
});

test("zero optional official chassis-power matches do not discard a verified Japan aggregate", () => {
  for (const code of [workflow, verifiedPublish]) {
    assert.match(code, /prestige-japan-official-chassis-enrich\.mjs/);
    assert.match(code, /test -s prestige-japan-exact-sold-official-power\.json/);
    assert.match(code, /officialPowerEnrichment/);
    assert.match(code, /enriched !== 0/);
    assert.match(code, /continuing fail-closed/);
  }
});

test("verified Japan publish reuses the completed 9292-card run with production quotas and shared writer lock", () => {
  assert.match(verifiedPublish, /PRESTIGE_SOURCE_RUN_ID: "31786381384"/);
  assert.match(verifiedPublish, /prestige-japan-exact-sold-up-to-30000/);
  assert.match(verifiedPublish, /PRESTIGE_AGGREGATE_MIN_COUNT: "5000"/);
  assert.match(verifiedPublish, /PRESTIGE_MIN_CHUNK_COVERAGE: "0\.95"/);
  assert.match(verifiedPublish, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR: "20"/);
  assert.match(verifiedPublish, /publish:[\s\S]*group: catalog-live-daily-working-markets/);
  assert.match(verifiedPublish, /CATALOG_AUDIT_ASSERT_MARKETS: korea,china,japan,uae,europe,georgia,kyrgyzstan/);
  assert.doesNotMatch(verifiedPublish, /CATALOG_MAX_OFFERS_PER_MODEL: "500"/);
  assert.doesNotMatch(verifiedPublish, /CATALOG_AUDIT_MAX_PER_MODEL: "500"/);
});
