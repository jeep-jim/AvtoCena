import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const probe = fs.readFileSync(new URL("../scripts/catalog-probe-source-shard.mjs", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");

test("probe passes only verified curated sources to rebuild", () => {
  assert.match(probe, /const sourcePlan/);
  assert.match(probe, /isUsableOffer/);
  assert.match(probe, /Number\(offer\.sourcePrice \|\| 0\) > 0/);
  assert.match(probe, /activeSourceIds/);
  assert.match(probe, /sourceIdsForRebuild/);
  assert.doesNotMatch(probe, /connectedMarketSources/);
});

test("workflow cannot spend another multi-hour pass on dead sources", () => {
  assert.match(workflow, /timeout-minutes: 55/);
  assert.match(workflow, /CATALOG_REBUILD_TIME_LIMIT_MS: "2400000"/);
  assert.match(workflow, /CATALOG_REBUILD_MAX_EMPTY_PAGES: "3"/);
  assert.match(workflow, /CATALOG_SOURCE_TIMEOUT_MS: "12000"/);
  assert.match(workflow, /Probe curated live sources/);
});
