import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-v2-market-reusable.yml", import.meta.url), "utf8");

test("market workflow preserves diagnostics and retries quota failures after safe cleanup", () => {
  assert.match(workflow, /catalog-clean-object-storage\.mjs/);
  assert.match(workflow, /CATALOG_STORAGE_EMERGENCY: "true"/);
  assert.match(workflow, /CATALOG_STORAGE_CLEANUP_DRY_RUN: "false"/);
  assert.match(workflow, /quota|max size|storage.*full|object_storage_.*(?:409|413|507)/i);
  assert.match(workflow, /retention-days: 3/);
});

test("market workflow never turns an empty or failed collection into a fake success", () => {
  assert.match(workflow, /Require at least one collected real offer/);
  assert.match(workflow, /totalCollected/);
  assert.match(workflow, /process\.exit\(1\)/);
  assert.match(workflow, /Require a non-empty market publication/);
});
