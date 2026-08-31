import { publishCurrentCatalogReadModels } from "../apps/web/lib/catalog/storage.ts";

const result = await publishCurrentCatalogReadModels();
const requiredMarkets = ["korea", "china", "japan", "uae", "europe", "georgia", "kyrgyzstan"];
const allowedEmptyMarkets = new Set(
  String(process.env.CATALOG_ALLOW_EMPTY_MARKETS || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => requiredMarkets.includes(value)),
);
const marketCounts = result.markets || {};
const hasMarket = (market) => Object.prototype.hasOwnProperty.call(marketCounts, market);
const allowedAbsentMarkets = requiredMarkets.filter((market) => !hasMarket(market) && allowedEmptyMarkets.has(market));
const missingMarkets = requiredMarkets.filter((market) => {
  if (hasMarket(market)) return Number(marketCounts[market] || 0) <= 0;
  return !allowedEmptyMarkets.has(market);
});
const expectedProjectionMarkets = requiredMarkets.length - allowedAbsentMarkets.length;

console.log(JSON.stringify({
  event: "catalog_current_read_models_published",
  ...result,
  allowedEmptyMarkets: allowedAbsentMarkets,
  missingMarkets,
  expectedProjectionMarkets,
}));
if (!result.generationId || !result.total || result.allProjectionCount !== result.total || result.projectionMarkets < expectedProjectionMarkets || result.offerShards < 16 || missingMarkets.length) {
  throw new Error("catalog_current_read_models_incomplete");
}

// Keep the compact unfiltered /cars overview on the exact same generation as
// the current facets/projection aliases. The builder independently re-checks
// the manifest before and after its read/write, so a concurrent generation
// change fails closed instead of serving mixed-generation cards.
await import("./catalog-build-overview-read-model.mjs");
console.log(JSON.stringify({
  event: "catalog_overview_refreshed_with_current_read_models",
  generationId: result.generationId,
}));

// A projection is not healthy when its cards cannot resolve to full offer
// records. Verify detail reads in this production storage context so a refresh
// cannot report success while /cars/offer/:id is unavailable.
await import("./catalog-verify-current-offers.mjs");
