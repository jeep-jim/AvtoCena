import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const script = fs.readFileSync("scripts/catalog-enforce-global-model-cap.mjs", "utf8");
const workflow = fs.readFileSync(".github/workflows/catalog-global-model-cap.yml", "utf8");

test("canonical catalog cleanup hard-caps every exact model at twenty", () => {
  assert.match(script, /const MAX_OFFERS_PER_MODEL = 20/);
  assert.match(script, /for \(const market of PUBLIC_CATALOG_MARKETS\)/);
  assert.match(script, /if \(count >= MAX_OFFERS_PER_MODEL\)/);
  assert.match(script, /process\.env\.CATALOG_GROW_ONLY_MARKETS = ""/);
  assert.match(script, /isCatalogYearAllowed\(offer\?\.year, market\)/);
  assert.match(script, /hasCredibleOfferContent/);
  assert.match(script, /catalog\/import-lock\.json/);
});

test("global cleanup follows every completed writer and audits all seven markets", () => {
  assert.match(workflow, /push:[\s\S]*branches: \[main\][\s\S]*catalog-global-model-cap\.yml/);
  assert.match(workflow, /Catalog live daily · working markets/);
  assert.match(workflow, /Catalog live recovery · UAE \+ Georgia direct/);
  assert.match(workflow, /Catalog Japan · publish verified Prestige aggregate/);
  assert.match(workflow, /Catalog Korea · K Car exterior gallery repair/);
  assert.doesNotMatch(workflow, /workflow_run\.conclusion != 'cancelled'/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /gh workflow run catalog-live-recovery-uae-georgia-direct\.yml --ref main/);
  assert.match(workflow, /github\.event_name == 'push'/);
  assert.match(workflow, /github\.event\.workflow_run\.name == 'Catalog live daily · working markets'/);
  assert.match(workflow, /github\.event\.workflow_run\.name == 'Catalog Korea · K Car exterior gallery repair'/);
  assert.match(workflow, /CATALOG_AUDIT_ASSERT_MARKETS: korea,china,japan,uae,europe,georgia,kyrgyzstan/);
  assert.match(workflow, /CATALOG_AUDIT_MAX_PER_MODEL: "20"/);
});
