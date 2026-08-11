import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/catalog-v6-prestige-up-to-30k.yml", "utf8");

test("Prestige V6 remains source-only and cannot write the live catalog", () => {
  assert.doesNotMatch(workflow, /^\s{2}publish:/m);
  assert.doesNotMatch(workflow, /catalog-live-recovery-publish\.mjs/);
  assert.doesNotMatch(workflow, /JSON_STORAGE_DRIVER/);
  assert.doesNotMatch(workflow, /YC_OBJECT_STORAGE_/);
  assert.match(workflow, /Collect exact sold-result partition without publishing/);
  assert.match(workflow, /prestige-japan-exact-sold-up-to-30000\.json/);
});
