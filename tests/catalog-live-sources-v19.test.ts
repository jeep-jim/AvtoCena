import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const priority = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-market-sources.ts", import.meta.url), "utf8");
const rebuild = fs.readFileSync(new URL("../scripts/catalog-rebuild-source-shard.mjs", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");

test("live high-volume sources use current listing and detail routes", () => {
  assert.match(priority, /guazi\.com\/car-detail/);
  assert.match(priority, /\/car-detail\\\/c\\d\+/);
  assert.match(priority, /carused\.jp\/car-list\?page=/);
  assert.match(priority, /car-list\\\/detail/);
  assert.match(priority, /tc-v\.com\/used_car\/all\/all/);
  assert.match(priority, /\?pn=\$\{page - 1\}/);
});

test("commercial vehicles are excluded from priority passenger-car sources", () => {
  assert.match(priority, /COMMERCIAL_RE/);
  assert.match(priority, /Hino\|Mitsubishi Fuso/);
  assert.match(priority, /truck\|dump\|tipper\|bus/);
});

test("fresh source pages are processed before three-day restored stock", () => {
  const sourceLoop = rebuild.indexOf("const sourceStates");
  const restoredRead = rebuild.indexOf("const [internalRows, publicRows]");
  assert.ok(sourceLoop >= 0 && restoredRead > sourceLoop);
  assert.match(rebuild, /galleryRebuiltFrom: origin/);
  assert.match(rebuild, /freshBySource/);
  assert.match(rebuild, /retentionMs/);
});

test("v19 workflow is triggered by priority parser changes", () => {
  assert.match(workflow, /Catalog source-scale v19/);
  assert.match(workflow, /priority-market-sources\.ts/);
  assert.match(workflow, /CATALOG_OFFER_RETENTION_MS: "259200000"/);
});
