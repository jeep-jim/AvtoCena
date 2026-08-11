import { publishCurrentCatalogReadModels } from "../apps/web/lib/catalog/storage.ts";

const result = await publishCurrentCatalogReadModels();
const requiredMarkets = ["korea", "china", "japan", "uae", "europe", "georgia", "kyrgyzstan"];
const missingMarkets = requiredMarkets.filter((market) => Number(result.markets?.[market] || 0) <= 0);

console.log(JSON.stringify({ event: "catalog_current_read_models_published", ...result, missingMarkets }));
if (!result.generationId || !result.total || result.projectionMarkets < requiredMarkets.length || result.offerShards < 16 || missingMarkets.length) {
  throw new Error("catalog_current_read_models_incomplete");
}
