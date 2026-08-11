const { readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");
const { catalogMinYearForMarket } = await import("../apps/web/lib/catalog/offer-quality.ts");

const output = String(process.env.CATALOG_AUDIT_OUTPUT || "catalog-live-postpersist-audit.json");
const assertMarkets = new Set(String(process.env.CATALOG_AUDIT_ASSERT_MARKETS || "").split(",").map((v) => v.trim()).filter(Boolean));
const maxOffersPerModel = Math.max(1, Number(process.env.CATALOG_AUDIT_MAX_PER_MODEL || 20));
let minimums = {};
try { minimums = JSON.parse(process.env.CATALOG_AUDIT_MIN_COUNTS_JSON || "{}"); } catch { minimums = {}; }
const currentYear = new Date().getFullYear();
const nonVehicle = /\b(?:motorcycle|motorbike|scooter|forklift|excavator|bulldozer|tractor|crane|generator|boat|ship|machinery|spare\s+parts?|engine\s+only|truck|dump|tipper|lorry)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;
function key(offer) {
  const make = String(offer?.make || "").trim().toLowerCase().replace(/\s+/g, " ");
  const model = String(offer?.model || "").trim().toLowerCase().replace(/\s+/g, " ");
  return make && model ? `${String(offer?.market || "")}|${make}|${model}` : "";
}
function isElectric(offer) { return String(offer?.powertrainKind || "") === "electric" || /(?:electric|pure electric|bev|纯电|электро)/i.test(String(offer?.fuel || "")); }
function isHybrid(offer) { return ["series_hybrid", "other_hybrid"].includes(String(offer?.powertrainKind || "")) || /(?:hybrid|phev|hev|增程|混合动力|гибрид)/i.test(String(offer?.fuel || "")); }
function japanSoldIdentityOk(offer) {
  const raw = offer?.operational?.raw || {};
  return offer?.market !== "japan" || (
    offer?.offerType === "auction"
    && offer?.catalogKind === "auction_result"
    && offer?.auctionResult === "sold"
    && offer?.auctionPriceKind === "published_result"
    && raw?.listingBoundImages === true
    && raw?.photoIdentityVerified === true
    && raw?.recoveryExactSourceUrl === true
    && raw?.recoveryExactPhotoIdentity === true
  );
}

const report = { version: 2, checkedAt: new Date().toISOString(), markets: {}, failures: [] };
for (const market of PUBLIC_CATALOG_MARKETS) {
  let rows = [];
  try { rows = await readMarketOffers(market); } catch (error) { report.failures.push(`${market}:read:${String(error?.message || error)}`); continue; }
  const modelCounts = new Map();
  for (const offer of rows) { const k = key(offer); if (k) modelCounts.set(k, Number(modelCounts.get(k) || 0) + 1); }
  const stats = {
    count: rows.length,
    electricCount: rows.filter(isElectric).length,
    hybridCount: rows.filter(isHybrid).length,
    preliminaryCount: rows.filter((offer) => String(offer?.calculationStatus || "") === "preliminary_power_pending" || offer?.calculationSnapshot?.pricingConfidence === "preliminary").length,
    exactCalculatedCount: rows.filter((offer) => String(offer?.calculationSnapshot?.customs?.status || "") === "ready" && Number(offer?.totalRub || 0) > 0).length,
    priorityAgeCount: rows.filter((offer) => Number(offer?.year || 0) >= currentYear - 6).length,
    olderThan15Count: rows.filter((offer) => Number(offer?.year || 0) < currentYear - 15).length,
    marketMinYear: catalogMinYearForMarket(market),
    belowMarketMinYearCount: rows.filter((offer) => Number(offer?.year || 0) < catalogMinYearForMarket(market)).length,
    distinctModels: modelCounts.size,
    distinctMakes: new Set(rows.map((offer) => String(offer?.make || "").trim().toLowerCase()).filter(Boolean)).size,
    maxPerExactModel: modelCounts.size ? Math.max(...modelCounts.values()) : 0,
    nonVehicleCount: rows.filter((offer) => nonVehicle.test(`${offer?.make || ""} ${offer?.model || ""} ${offer?.trim || ""} ${offer?.bodyType || ""}`)).length,
    nonPositiveSourcePriceCount: rows.filter((offer) => !(Number(offer?.sourcePrice || 0) > 0) || !String(offer?.sourceCurrency || "").trim()).length,
    belowFiveImagesCount: rows.filter((offer) => !Array.isArray(offer?.images) || offer.images.length < 5).length,
    japanSoldIdentityFailureCount: market === "japan" ? rows.filter((offer) => !japanSoldIdentityOk(offer)).length : 0,
    sourceCounts: Object.fromEntries([...new Set(rows.map((offer) => String(offer?.sourceId || "unknown")))].sort().map((sourceId) => [sourceId, rows.filter((offer) => String(offer?.sourceId || "unknown") === sourceId).length])),
  };
  report.markets[market] = stats;
  const min = Number(minimums?.[market] || 0);
  if (min > 0 && stats.count < min) report.failures.push(`${market}:count_below_min:${stats.count}<${min}`);
  if (assertMarkets.has(market) && stats.maxPerExactModel > maxOffersPerModel) report.failures.push(`${market}:model_quota:${stats.maxPerExactModel}>${maxOffersPerModel}`);
  if (assertMarkets.has(market) && stats.belowMarketMinYearCount > 0) report.failures.push(`${market}:below_market_min_year:${stats.belowMarketMinYearCount}:min=${stats.marketMinYear}`);
  if (assertMarkets.has(market) && stats.nonVehicleCount > 0) report.failures.push(`${market}:non_vehicle:${stats.nonVehicleCount}`);
  if (assertMarkets.has(market) && stats.nonPositiveSourcePriceCount > 0) report.failures.push(`${market}:source_price:${stats.nonPositiveSourcePriceCount}`);
  if (market === "japan" && assertMarkets.has(market) && stats.belowFiveImagesCount > 0) report.failures.push(`japan:below_five_images:${stats.belowFiveImagesCount}`);
  if (market === "japan" && assertMarkets.has(market) && stats.japanSoldIdentityFailureCount > 0) report.failures.push(`japan:sold_identity:${stats.japanSoldIdentityFailureCount}`);
}

await (await import("node:fs/promises")).writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.failures.length) process.exitCode = 1;
