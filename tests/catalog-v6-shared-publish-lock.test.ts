import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/catalog-v6-prestige-up-to-30k.yml", "utf8");
const chunk = fs.readFileSync("scripts/prestige-japan-strict-chunk.mjs", "utf8");
const merge = fs.readFileSync("scripts/prestige-japan-strict-merge.mjs", "utf8");

test("V6 production publish waits on the shared catalog writer and audits all seven markets", () => {
  assert.match(workflow, /publish:[\s\S]*concurrency:[\s\S]*group: catalog-live-daily-working-markets[\s\S]*cancel-in-progress: false/);
  assert.match(workflow, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR: "20"/);
  assert.match(workflow, /CATALOG_AUDIT_ASSERT_MARKETS: korea,china,japan,uae,europe,georgia,kyrgyzstan/);
  assert.match(workflow, /CATALOG_AUDIT_MAX_PER_MODEL_YEAR: "20"/);
  assert.match(workflow, /CATALOG_OFFER_RETENTION_MS: "259200000"/);
  assert.match(workflow, /CATALOG_PUBLISH_LOCK_WAIT_MS: "7200000"/);
});

test("Prestige daily tolerates isolated shard transport failures without weakening row quality", () => {
  assert.match(workflow, /push:[\s\S]*branches:[\s\S]*- main/);
  assert.match(workflow, /chunks:[\s\S]*continue-on-error: true/);
  assert.match(workflow, /PRESTIGE_MIN_CHUNK_COVERAGE: "0\.95"/);
  assert.match(merge, /minimumChunkCoverage/);
  assert.match(merge, /inputCoverage/);
  assert.match(merge, /chunk_coverage_/);
});

test("Prestige strict chunk and merge require the current content-verified gallery contract", () => {
  const contract = "prestige_ajes_exact_detail_v2_cover_content_verified";
  for (const code of [chunk, merge]) {
    assert.ok(code.includes(contract));
    assert.match(code, /op\.galleryVerified !== true/);
    assert.match(code, /raw\.listingBoundImages !== true/);
    assert.match(code, /raw\.coverContentVerified !== true/);
    assert.equal(code.includes("prestige_ajes_exact_detail_v1"), false);
  }
});
