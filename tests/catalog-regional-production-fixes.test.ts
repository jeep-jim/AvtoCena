import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const priceTrend = fs.readFileSync(new URL("../apps/web/components/catalog/PriceTrend.tsx", import.meta.url), "utf8");
const offerPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/offer/[id]/page.tsx", import.meta.url), "utf8");
const autoGeorgia = fs.readFileSync(new URL("../apps/web/lib/catalog/auto-georgia-source.ts", import.meta.url), "utf8");
const autoGeorgiaEnriched = fs.readFileSync(new URL("../apps/web/lib/catalog/auto-georgia-enriched-source.ts", import.meta.url), "utf8");
const openSources = fs.readFileSync(new URL("../apps/web/lib/catalog/open-market-sources.ts", import.meta.url), "utf8");
const scaleSources = fs.readFileSync(new URL("../apps/web/lib/catalog/scale-market-sources.ts", import.meta.url), "utf8");
const currentRegional = fs.readFileSync(new URL("../apps/web/lib/catalog/current-regional-market-sources.ts", import.meta.url), "utf8");
const rebuild = fs.readFileSync(new URL("../scripts/catalog-rebuild-source-shard.mjs", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");

test("detail page and catalog card share the same ruble fallback", () => {
  assert.match(priceTrend, /function visibleRubPrice/);
  assert.match(priceTrend, /sourcePriceRub/);
  assert.match(priceTrend, /sourcePrice \* effectiveRate/);
  assert.match(priceTrend, /totalRub: visibleRub \|\| null/);
  assert.match(offerPage, /PriceTrend offer=\{o\}/);
  assert.doesNotMatch(priceTrend, /sourceCurrency[^\n]*Цена/);
});

test("AUTO.GE identity is taken from the listing URL and polluted retention is rejected", () => {
  assert.match(autoGeorgia, /export function autoGeorgiaIdentityFromUrl/);
  assert.match(autoGeorgia, /if \(pathIdentity\.make && pathIdentity\.model\) return pathIdentity/);
  assert.match(rebuild, /function sourceIdentityMatchesUrl/);
  assert.match(rebuild, /auto_georgia_open/);
  assert.match(rebuild, /source_identity_url_mismatch/);
  assert.match(rebuild, /if \(!sourceIdentityMatchesUrl\(offer\)\) continue/);
});

test("regional cursors reset after parser upgrades", () => {
  assert.match(rebuild, /REGIONAL_CURSOR_VERSION = 2/);
  assert.match(rebuild, /cursorVersion/);
  assert.match(rebuild, /savedVersion !== expectedVersion/);
  assert.match(rebuild, /cursor: null/);
});

test("Georgia and Kyrgyzstan can crawl mass listings with exact detail photos", () => {
  assert.match(workflow, /CATALOG_PROBE_TIMEOUT_MS: "45000"/);
  assert.match(workflow, /CATALOG_REBUILD_DETAIL_LIMIT_PER_SOURCE: "1000"/);
  assert.match(workflow, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER: "30"/);
  assert.match(autoGeorgiaEnriched, /autoGeorgiaExactSource\.fetchPage\(cursor\)/);
  assert.doesNotMatch(autoGeorgiaEnriched, /fetchRav4Rows\(cursor\)/);
  assert.match(currentRegional, /protected pageSize\(\) \{ return 50; \}/);
  assert.match(scaleSources, /\\\/cars\\\/[A-Za-z0-9_-]+/);
});

test("Kyrgyz public sources recognize som prices and current routes", () => {
  assert.match(openSources, /KGS\|сом\|Som/);
  assert.match(openSources, /GEL\|₾/);
  assert.match(scaleSources, /market\.o\.kg\/ru\/bishkek\/avtomobili/);
  assert.match(scaleSources, /turbo\.kg/);
  assert.match(currentRegional, /https:\/\/www\.mashina\.kg\/search\//);
});
