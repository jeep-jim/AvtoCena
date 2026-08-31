import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-current-read-models.yml", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("../scripts/catalog-publish-current-read-models.mjs", import.meta.url), "utf8");
const postDeployWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-postdeploy-parity.yml", import.meta.url), "utf8");
const parityAudit = fs.readFileSync(new URL("../scripts/catalog-audit-current-readmodel-parity.mjs", import.meta.url), "utf8");

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

test("homepage distinguishes an incomplete read model from a complete market filtered by current safety policy", () => {
  assert.match(storageSource, /const projectionComplete = MARKETS\.every/);
  assert.match(storageSource, /manifest\.markets\?\.\[market\]\?\.count/);
  assert.match(storageSource, /rawProjectionRows\.some\(\(row\) => row\.market === market\)/);
  assert.match(storageSource, /const projectionRows = rawProjectionRows\.filter\(projectionCanRenderCard\)/);
  assert.match(storageSource, /marketCounts\[market\] = rows\.length/);
  assert.match(storageSource, /if \(projectionComplete\)/);
});

test("current read-model republisher preserves every immutable public row", () => {
  const start = storageSource.indexOf("export async function publishCurrentCatalogReadModels");
  const end = storageSource.indexOf("\nexport async function getOffer", start);
  assert.ok(start >= 0 && end > start);
  const implementation = storageSource.slice(start, end);
  assert.doesNotMatch(implementation, /\.filter\(isPublicOffer\)/);
  assert.match(implementation, /catalog_current_readmodel_manifest_count_mismatch/);
  assert.match(implementation, /writeCurrentCatalogReadModels\(manifest\.generationId, storedOffers, true\)/);
});

test("post-deploy gate checks all seven live markets instead of treating Korea as the catalog smoke test", () => {
  assert.match(postDeployWorkflow, /workflows:\s*\n\s*- "Deploy to Yandex Cloud"/);
  assert.match(postDeployWorkflow, /for market in korea china japan uae europe georgia kyrgyzstan/);
  assert.match(postDeployWorkflow, /api\/catalog\/search\?market=\$market&pageSize=\$sample_size/);
  assert.match(postDeployWorkflow, /if \[\[ "\$market" == japan \]\]; then sample_size=5; fi/);
  assert.match(postDeployWorkflow, /jq -e '\.total > 0 and \(\.items \| length\) > 0'/);
  assert.match(postDeployWorkflow, /cars\?market=\$market/);
  assert.match(postDeployWorkflow, /context:\"deploy\/yandex\"/);
  assert.match(postDeployWorkflow, /seven-market catalog parity failed/);
});

test("post-deploy gate fails when one-hop read models diverge from the immutable manifest", () => {
  assert.match(parityAudit, /catalog\/manifest\.json/);
  assert.match(parityAudit, /catalog\/public\/projection\/all\.json/);
  assert.match(parityAudit, /catalog\/public\/projection\/\$\{market\}\.json/);
  assert.match(parityAudit, /catalog_current_readmodel_manifest_mismatch/);
  assert.match(parityAudit, /projectionGenerationId !== generationId/);
  assert.match(parityAudit, /items\.length !== expected/);
  assert.match(postDeployWorkflow, /catalog-audit-current-readmodel-parity\.mjs/);
  assert.match(postDeployWorkflow, /catalog-current-readmodel-parity-\$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
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

test("visible calculation audit uses the current public specification contract", () => {
  assert.match(visibleAuditSource, /specificationRejection = catalogRequiredSpecificationRejectionReason\(offer\)/);
  assert.match(visibleAuditSource, /if \(specificationRejection\) return \{/);
  assert.doesNotMatch(visibleAuditSource, /scenario\?\.requiresConfirmation === true \|\| \/\^power_scenario:\//);
});
