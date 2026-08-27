import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/catalog-republish-market-artifacts.yml", "utf8");

test("collected market artifacts can be republished without another source crawl", () => {
  assert.match(workflow, /\.github\/market-runs\/republish-artifacts/);
  assert.match(workflow, /permissions:\n  actions: read\n  contents: read/);
  assert.match(workflow, /run-id: \$\{\{ needs\.config\.outputs\.run_id \}\}/);
  assert.match(workflow, /pattern: catalog-v3-\$\{\{ needs\.config\.outputs\.market \}\}-\[0-4\]/);
  assert.match(workflow, /files\.length!==5\|\|total<=0/);
  assert.match(workflow, /npx tsx scripts\/catalog-publish-market\.mjs/);
  assert.match(workflow, /npx tsx scripts\/catalog-live-postpersist-audit\.mjs/);
  assert.doesNotMatch(workflow, /catalog-rebuild-source-shard\.mjs/);
  assert.match(workflow, /market === 'japan' \? '2592000000' : '259200000'/);
  assert.match(workflow, /timeout-minutes: 120/);
  assert.match(workflow, /CATALOG_PUBLISH_LOCK_TTL_MS: "1800000"/);
  assert.match(workflow, /CATALOG_PUBLISH_LOCK_HEARTBEAT_MS: "300000"/);
});
