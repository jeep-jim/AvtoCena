import { publishCurrentCatalogReadModels } from "../apps/web/lib/catalog/storage.ts";
import { mutateDataJson, readDataJson } from "../apps/web/lib/data.ts";
import { withCatalogReadModelRepairLock } from "./lib/catalog-read-model-repair-lock.mjs";
import {verifyRepairLiveJapan} from './lib/catalog-repair-live-japan.mjs';

await withCatalogReadModelRepairLock(mutateDataJson, async (repairLease) => {

const requiredMarkets = ["korea", "china", "japan", "uae", "europe", "georgia"];
const allowedEmptyMarkets = new Set(
  String(process.env.CATALOG_ALLOW_EMPTY_MARKETS || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => requiredMarkets.includes(value)),
);
// Fail before rebuilding hundreds of thousands of rows. Keep local manifest
// completeness separate from the live AJES Japan route's independently checked total.
const manifest = await readDataJson('catalog/manifest.json', {generationId:'',markets:{}});
const liveJapan = await verifyRepairLiveJapan();
const externalAbsentMarkets = Object.prototype.hasOwnProperty.call(manifest.markets || {}, 'japan') ? [] : ['japan'];
const preflightMissing = requiredMarkets.filter(market => {
  if (Object.prototype.hasOwnProperty.call(manifest.markets || {}, market)) return !(Number(manifest.markets[market]?.count) > 0);
  return !allowedEmptyMarkets.has(market) && !externalAbsentMarkets.includes(market);
});
if (!manifest.generationId || preflightMissing.length) throw Error(`catalog_current_read_models_preflight_incomplete:${preflightMissing.join(',')}`);
console.log(JSON.stringify({event:'catalog_repair_live_japan_verified',...liveJapan}));
const result = await publishCurrentCatalogReadModels();
if (result.generationId !== manifest.generationId) throw Error('catalog_current_read_models_preflight_generation_changed');
const marketCounts = result.markets || {};
const hasMarket = (market) => Object.prototype.hasOwnProperty.call(marketCounts, market);
const allowedAbsentMarkets = requiredMarkets.filter((market) => !hasMarket(market) && allowedEmptyMarkets.has(market));
const missingMarkets = requiredMarkets.filter((market) => {
  if (hasMarket(market)) return Number(marketCounts[market] || 0) <= 0;
  return !allowedEmptyMarkets.has(market) && !externalAbsentMarkets.includes(market);
});
const expectedProjectionMarkets = requiredMarkets.length - allowedAbsentMarkets.length - externalAbsentMarkets.length;

console.log(JSON.stringify({
  event: "catalog_current_read_models_published",
  ...result,
  allowedEmptyMarkets: allowedAbsentMarkets,
  missingMarkets,
  expectedProjectionMarkets,
  liveJapan,
  externalAbsentMarkets,
}));
if (!result.generationId || !result.total || result.allProjectionCount !== result.total || result.projectionMarkets < expectedProjectionMarkets || result.offerShards < 16 || missingMarkets.length) {
  throw new Error("catalog_current_read_models_incomplete");
}

// Keep the compact unfiltered /cars overview on the exact same generation as
// the current facets/projection aliases. The builder independently re-checks
// the manifest before and after its read/write, so a concurrent generation
// change fails closed instead of serving mixed-generation cards.
const {buildCatalogOverviewReadModel} = await import("./catalog-build-overview-read-model.mjs");
await buildCatalogOverviewReadModel({repairLease});
console.log(JSON.stringify({
  event: "catalog_overview_refreshed_with_current_read_models",
  generationId: result.generationId,
}));

// A projection is not healthy when its cards cannot resolve to full offer
// records. Verify detail reads in this production storage context so a refresh
// cannot report success while /cars/offer/:id is unavailable.
await import("./catalog-verify-current-offers.mjs");
// Live-source acceptance is rechecked after the local write; no local count is
// inflated with AJES inventory and a source failure never becomes a zero market.
await verifyRepairLiveJapan(fetch, liveJapan.releaseSha);

});

// Verify the restored aliases against the unchanged active generation.
await import("./catalog-audit-current-readmodel-parity.mjs");
