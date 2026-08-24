import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-current-read-models.yml", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-current-read-models.mjs", import.meta.url), "utf8");

test("current read-model workflow exposes failures hidden by tee", () => {
  assert.match(workflow, /set -o pipefail/);
});

test("only an explicitly absent allowlisted market may be empty", () => {
  assert.match(workflow, /CATALOG_ALLOW_EMPTY_MARKETS:\s*["']georgia["']/);
  assert.match(publisher, /CATALOG_ALLOW_EMPTY_MARKETS/);
  assert.match(publisher, /Object\.prototype\.hasOwnProperty\.call\(marketCounts, market\)/);
  assert.match(publisher, /allowedAbsentMarkets/);
  assert.match(publisher, /if \(hasMarket\(market\)\) return Number\(marketCounts\[market\] \|\| 0\) <= 0/);
  assert.match(publisher, /expectedProjectionMarkets = requiredMarkets\.length - allowedAbsentMarkets\.length/);
  assert.match(publisher, /result\.projectionMarkets < expectedProjectionMarkets/);
  assert.match(publisher, /missingMarkets\.length/);
});

const homeClient = fs.readFileSync(new URL("../apps/web/components/home/HomePageClient.tsx", import.meta.url), "utf8");

test("homepage never erases an admitted market while a compact read-model shard catches up", () => {
  assert.doesNotMatch(homeClient, /isCrediblePublicOffer\(raw/);
  assert.match(homeClient, /nextMarketItems\.length \? nextMarketItems : previousMarketItems/);
  assert.match(homeClient, /incomingCount > 0 \? incomingCount : previousCount/);
  assert.match(homeClient, /incomingTotal > 0 \? incomingTotal : previousCount/);
});

const storageSource = fs.readFileSync(new URL("../apps/web/lib/catalog/storage.ts", import.meta.url), "utf8");

test("homepage fast read-model path cannot turn an existing manifest market into a false zero", () => {
  assert.match(storageSource, /const projectionComplete = MARKETS\.every/);
  assert.match(storageSource, /manifest\.markets\?\.\[market\]\?\.count/);
  assert.match(storageSource, /projectionRows\.some\(\(row\) => row\.market === market && projectionCanRenderCard\(row\)\)/);
  assert.match(storageSource, /if \(projectionComplete\)/);
});


const homeRouteSource = fs.readFileSync(new URL("../apps/web/app/api/catalog/home/route.ts", import.meta.url), "utf8");
const offerPageSource = fs.readFileSync(new URL("../apps/web/app/(public)/cars/offer/[id]/page.tsx", import.meta.url), "utf8");
const visibleAuditSource = fs.readFileSync(new URL("../scripts/catalog-audit-visible-calculation-coverage.mjs", import.meta.url), "utf8");

test("homepage route actively backfills a manifest-present market when its showcase rows are missing", () => {
  assert.match(homeRouteSource, /const missingMarkets = Object\.entries\(result\.marketCounts/);
  assert.match(homeRouteSource, /searchOffers\(\{ market: market as any, page: 1, pageSize: 6/);
  assert.match(homeRouteSource, /catalog_home_market_recovery_failed/);
});

test("editable power is structurally full-width rather than sharing a spec-grid row", () => {
  assert.match(offerPageSource, /const nonEditableSpecs = specs\.filter/);
  assert.match(offerPageSource, /ac-offer-spec-stack/);
  assert.match(offerPageSource, /<EditablePowerTile currentHp=\{editablePowerHp\}[^>]* fullWidth \/>/);
  assert.doesNotMatch(offerPageSource, /spec\.label === "Мощность" \? <EditablePowerTile/);
});

test("visible calculation audit recognises compact power-scenario markers", () => {
  assert.match(visibleAuditSource, /\^power_scenario:/);
  assert.match(visibleAuditSource, /scenarioSource \|\| `power_scenario:/);
});
