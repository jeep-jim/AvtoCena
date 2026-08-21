const { readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");
const { catalogMinYearForMarket, hasCredibleCatalogIdentity } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { presentCatalogOffer } = await import("../apps/web/lib/catalog/presentation.ts");
const { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey, catalogExactModelKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");
const { catalogRequiredSpecificationRejectionReason } = await import("../apps/web/lib/catalog/public-priority.ts");

const output = String(process.env.CATALOG_AUDIT_OUTPUT || "catalog-live-postpersist-audit.json");
const assertMarkets = new Set(String(process.env.CATALOG_AUDIT_ASSERT_MARKETS || "").split(",").map((v) => v.trim()).filter(Boolean));
const maxOffersPerModelYear = Math.max(1, Number(process.env.CATALOG_AUDIT_MAX_PER_MODEL_YEAR || CATALOG_MAX_OFFERS_PER_MODEL_YEAR));
let minimums = {};
try { minimums = JSON.parse(process.env.CATALOG_AUDIT_MIN_COUNTS_JSON || "{}"); } catch { minimums = {}; }
const currentYear = new Date().getFullYear();
const nonVehicle = /\b(?:motorcycle|motorbike|scooter|forklift|excavator|bulldozer|tractor|crane|generator|boat|ship|machinery|spare\s+parts?|engine\s+only|truck|dump|tipper|lorry)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;
const displayPlaceholder = /^(?:unknown|undefined|null|none|n\/?a|other(?:s)?|andere|brand|make|model|марка(?:\s+уточняется)?|модель(?:\s+уточняется)?|уточняется|не\s+указано|неизвестно|기타|미상|其他|未知|その他)$/iu;
const internalSeries = /^(?:series|серия)\s*[-:#]?\s*\d+(?:\s|$)/iu;
function isElectric(offer) { return String(offer?.powertrainKind || "") === "electric" || /(?:electric|pure electric|bev|纯电|электро)/i.test(String(offer?.fuel || "")); }
function isHybrid(offer) { return ["series_hybrid", "other_hybrid"].includes(String(offer?.powertrainKind || "")) || /(?:hybrid|phev|hev|增程|混合动力|гибрид)/i.test(String(offer?.fuel || "")); }
function normalizedIdentity(value) { return String(value || "").normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
function renderedIdentityProblems(offer) {
  const presented = presentCatalogOffer(offer);
  const makeLabel = String(presented?.makeLabel || "").trim();
  const modelLabel = String(presented?.modelLabel || "").trim();
  const title = String(presented?.title || "").trim();
  const sourceSame = normalizedIdentity(offer?.make) !== "" && normalizedIdentity(offer?.make) === normalizedIdentity(offer?.model);
  const problems = [];
  if (!makeLabel || displayPlaceholder.test(makeLabel)) problems.push("display_make_missing");
  if (!modelLabel || displayPlaceholder.test(modelLabel)) problems.push("display_model_missing");
  if (internalSeries.test(modelLabel)) problems.push("display_internal_series");
  if (!sourceSame && makeLabel && modelLabel && normalizedIdentity(makeLabel) === normalizedIdentity(modelLabel)) problems.push("display_model_equals_make");
  if (!sourceSame && makeLabel && title && normalizedIdentity(title) === normalizedIdentity(makeLabel)) problems.push("display_title_make_only");
  return { problems, makeLabel, modelLabel, title };
}
function japanSoldIdentityOk(offer) {
  const raw = offer?.operational?.raw || {};
  const actualAuction = offer?.offerType === "auction" || offer?.catalogKind === "auction_result";
  return offer?.market !== "japan" || !actualAuction || (
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

const report = { version: 3, checkedAt: new Date().toISOString(), markets: {}, failures: [] };
for (const market of PUBLIC_CATALOG_MARKETS) {
  let rows = [];
  try { rows = await readMarketOffers(market); } catch (error) { report.failures.push(`${market}:read:${String(error?.message || error)}`); continue; }
  const modelYearCounts = new Map();
  const exactModelCounts = new Map();
  const renderedIdentityReasonCounts = {};
  const renderedIdentitySamples = [];
  let renderedIdentityFailureCount = 0;
  for (const offer of rows) {
    const yearKey = catalogModelYearQuotaKey(offer, market);
    const exactKey = catalogExactModelKey(offer, market);
    if (yearKey) modelYearCounts.set(yearKey, Number(modelYearCounts.get(yearKey) || 0) + 1);
    if (exactKey) exactModelCounts.set(exactKey, Number(exactModelCounts.get(exactKey) || 0) + 1);
    const rendered = renderedIdentityProblems(offer);
    if (rendered.problems.length) {
      renderedIdentityFailureCount += 1;
      for (const problem of rendered.problems) renderedIdentityReasonCounts[problem] = Number(renderedIdentityReasonCounts[problem] || 0) + 1;
      if (renderedIdentitySamples.length < 30) renderedIdentitySamples.push({
        id: offer?.id,
        sourceId: offer?.sourceId,
        make: offer?.make,
        model: offer?.model,
        makeLabel: rendered.makeLabel,
        modelLabel: rendered.modelLabel,
        title: rendered.title,
        problems: rendered.problems,
      });
    }
  }
  const stats = {
    count: rows.length,
    electricCount: rows.filter(isElectric).length,
    hybridCount: rows.filter(isHybrid).length,
    preliminaryCount: rows.filter((offer) => String(offer?.calculationStatus || "") === "preliminary_power_pending" || offer?.calculationSnapshot?.pricingConfidence === "preliminary").length,
    incompleteSpecificationCount: rows.filter((offer) => catalogRequiredSpecificationRejectionReason(offer)).length,
    incompleteSpecificationReasons: Object.fromEntries([...new Set(rows.map((offer) => catalogRequiredSpecificationRejectionReason(offer)).filter(Boolean))]
      .sort()
      .map((reason) => [reason, rows.filter((offer) => catalogRequiredSpecificationRejectionReason(offer) === reason).length])),
    exactCalculatedCount: rows.filter((offer) => String(offer?.calculationSnapshot?.customs?.status || "") === "ready" && Number(offer?.totalRub || 0) > 0).length,
    priorityAgeCount: rows.filter((offer) => Number(offer?.year || 0) >= currentYear - 6).length,
    olderThan15Count: rows.filter((offer) => Number(offer?.year || 0) < currentYear - 15).length,
    marketMinYear: catalogMinYearForMarket(market),
    belowMarketMinYearCount: rows.filter((offer) => Number(offer?.year || 0) < catalogMinYearForMarket(market)).length,
    invalidIdentityCount: rows.filter((offer) => !hasCredibleCatalogIdentity(offer)).length,
    renderedIdentityFailureCount,
    renderedIdentityReasonCounts,
    renderedIdentitySamples,
    distinctModels: exactModelCounts.size,
    distinctModelYears: modelYearCounts.size,
    distinctMakes: new Set(rows.map((offer) => String(offer?.make || "").trim().toLowerCase()).filter(Boolean)).size,
    maxPerExactModelAcrossYears: exactModelCounts.size ? Math.max(...exactModelCounts.values()) : 0,
    maxPerExactModelYear: modelYearCounts.size ? Math.max(...modelYearCounts.values()) : 0,
    nonVehicleCount: rows.filter((offer) => nonVehicle.test(`${offer?.make || ""} ${offer?.model || ""} ${offer?.trim || ""} ${offer?.bodyType || ""}`)).length,
    nonPositiveSourcePriceCount: rows.filter((offer) => !(Number(offer?.sourcePrice || 0) > 0) || !String(offer?.sourceCurrency || "").trim()).length,
    belowFiveImagesCount: rows.filter((offer) => !Array.isArray(offer?.images) || offer.images.length < 5).length,
    japanSoldIdentityFailureCount: market === "japan" ? rows.filter((offer) => !japanSoldIdentityOk(offer)).length : 0,
    sourceCounts: Object.fromEntries([...new Set(rows.map((offer) => String(offer?.sourceId || "unknown")))].sort().map((sourceId) => [sourceId, rows.filter((offer) => String(offer?.sourceId || "unknown") === sourceId).length])),
  };
  report.markets[market] = stats;
  const min = Number(minimums?.[market] || 0);
  if (min > 0 && stats.count < min) report.failures.push(`${market}:count_below_min:${stats.count}<${min}`);
  if (assertMarkets.has(market) && stats.count === 0) report.failures.push(`${market}:empty`);
  if (assertMarkets.has(market) && stats.invalidIdentityCount > 0) report.failures.push(`${market}:invalid_identity:${stats.invalidIdentityCount}`);
  if (assertMarkets.has(market) && stats.renderedIdentityFailureCount > 0) report.failures.push(`${market}:rendered_identity:${stats.renderedIdentityFailureCount}`);
  if (assertMarkets.has(market) && stats.maxPerExactModelYear > maxOffersPerModelYear) report.failures.push(`${market}:model_year_quota:${stats.maxPerExactModelYear}>${maxOffersPerModelYear}`);
  if (assertMarkets.has(market) && stats.belowMarketMinYearCount > 0) report.failures.push(`${market}:below_market_min_year:${stats.belowMarketMinYearCount}:min=${stats.marketMinYear}`);
  if (assertMarkets.has(market) && stats.nonVehicleCount > 0) report.failures.push(`${market}:non_vehicle:${stats.nonVehicleCount}`);
  if (assertMarkets.has(market) && stats.nonPositiveSourcePriceCount > 0) report.failures.push(`${market}:source_price:${stats.nonPositiveSourcePriceCount}`);
  if (assertMarkets.has(market) && stats.preliminaryCount > 0) report.failures.push(`${market}:preliminary_public_price:${stats.preliminaryCount}`);
  if (assertMarkets.has(market) && stats.incompleteSpecificationCount > 0) report.failures.push(`${market}:incomplete_specifications:${stats.incompleteSpecificationCount}`);
  if (market === "korea" && assertMarkets.has(market) && stats.belowFiveImagesCount > 0) report.failures.push(`korea:below_five_images:${stats.belowFiveImagesCount}`);
  if (market === "japan" && assertMarkets.has(market) && stats.belowFiveImagesCount > 0) report.failures.push(`japan:below_five_images:${stats.belowFiveImagesCount}`);
  if (market === "japan" && assertMarkets.has(market) && stats.japanSoldIdentityFailureCount > 0) report.failures.push(`japan:sold_identity:${stats.japanSoldIdentityFailureCount}`);
}

await (await import("node:fs/promises")).writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.failures.length) process.exitCode = 1;
