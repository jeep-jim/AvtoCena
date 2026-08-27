import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// Static guards keep the compact landing optimization fail-closed and narrowly scoped.
const overview = fs.readFileSync(new URL("../apps/web/lib/catalog/overview.ts", import.meta.url), "utf8");
const carsPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/page.tsx", import.meta.url), "utf8");
const builder = fs.readFileSync(new URL("../scripts/catalog-build-overview-read-model.mjs", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-current-read-models.mjs", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-overview-read-model.yml", import.meta.url), "utf8");

test("overview alias is accepted only for the active manifest generation", () => {
  assert.match(overview, /publicPolicyVersion === 2/);
  assert.match(overview, /overview\.generationId === generationId/);
  assert.match(overview, /overview\.facets\?\.generationId === generationId/);
  assert.match(overview, /readDataJson<\{ generationId: string \}>\("catalog\/manifest\.json"/);
});

test("unfiltered catalog landing alone uses the compact overview with a fallback", () => {
  assert.match(carsPage, /const overviewEligible = !selectedMarket && !hasFilters && !customSort && requestedPage === 1/);
  assert.match(carsPage, /readCatalogOverview\(\)/);
  assert.match(carsPage, /readCatalogFacets\(\{ \.\.\.common, market: selectedMarket \|\| undefined \}\)/);
  assert.match(carsPage, /searchOffers\(\{ \.\.\.common, market: market\.id, page, pageSize \}\)/);
});

test("overview builder fails closed if the catalog generation changes", () => {
  assert.match(builder, /generation_changed_during_read/);
  assert.match(builder, /catalog_overview_facets_stale/);
  assert.match(builder, /catalog_overview_market_stale/);
  assert.match(builder, /generation_changed_after_write/);
});

test("every successful current read-model refresh rebuilds the compact overview", () => {
  const completenessGate = publisher.indexOf('throw new Error("catalog_current_read_models_incomplete")');
  const overviewRefresh = publisher.indexOf('await import("./catalog-build-overview-read-model.mjs")');
  assert.ok(completenessGate >= 0);
  assert.ok(overviewRefresh > completenessGate);
  assert.match(publisher, /catalog_overview_refreshed_with_current_read_models/);
});

test("overview workflow remains a guarded backstop and refreshes after publisher changes", () => {
  assert.match(workflow, /Catalog quality · enforce global model cap/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /"\.github\/workflows\/catalog-overview-read-model\.yml"/);
  assert.match(workflow, /"scripts\/catalog-build-overview-read-model\.mjs"/);
  assert.match(workflow, /"scripts\/catalog-publish-current-read-models\.mjs"/);
  assert.match(workflow, /github\.event_name == 'push'/);
});
