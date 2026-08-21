const { writeDataJson } = await import("../apps/web/lib/data.ts");
const { calculateOfferWithPreliminaryPowerPricing, calculateOfferWithRussiaCustoms, isPreliminaryPowerPendingCalculation } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { refreshLiveExchangeRates } = await import("../apps/web/lib/catalog/live-rates.ts");
const { resetCatalogRateCache } = await import("../apps/web/lib/catalog/rates.ts");
const { isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");
const { persistCatalogOffers, readAllOffersForMaintenance, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");

const CONCURRENCY = Math.max(1, Math.min(24, Number(process.env.CATALOG_KNOWLEDGE_REINDEX_CONCURRENCY || 8)));
const MIN_PUBLIC_RATIO = Math.min(1, Math.max(0.1, Number(process.env.CATALOG_REINDEX_MIN_PUBLIC_RATIO || 0.65)));
const MIN_PUBLIC_GUARD_COUNT = Math.max(1, Number(process.env.CATALOG_REINDEX_MIN_PUBLIC_GUARD_COUNT || 50));
const REPORT_PATH = "catalog/vehicle-knowledge/catalog-reindex-report.json";
const startedAt = new Date().toISOString();
const refreshedRates = await refreshLiveExchangeRates();
resetCatalogRateCache();
const [maintenanceOffers, currentPublicLists] = await Promise.all([
  readAllOffersForMaintenance(),
  Promise.all(PUBLIC_CATALOG_MARKETS.map((market) => readMarketOffers(market))),
]);
const japanRetentionMs = Math.max(60 * 60 * 1_000, Number(process.env.CATALOG_JAPAN_RETENTION_MS || 180 * 24 * 60 * 60 * 1_000));
const japanCutoff = Date.now() - japanRetentionMs;
const offers = maintenanceOffers.filter((offer) => {
  if (offer?.market !== "japan") return true;
  const timestamp = Date.parse(String(offer?.auctionDate || offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0;
  return timestamp >= japanCutoff;
});
const japanRetentionPruned = maintenanceOffers.length - offers.length;
const currentPublicOffers = currentPublicLists.flat().filter((offer) => isCrediblePublicOffer(offer));

async function mapWithConcurrency(items, worker, concurrency) {
  const result = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      result[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return result;
}

const errors = [];
let canonicalized = 0;
let powerFilled = 0;
let priceChanged = 0;
let ready = 0;
let estimated = 0;
let missingPower = 0;
let missingCustoms = 0;

const recalculated = await mapWithConcurrency(offers, async (source, index) => {
  try {
    if (source?.market === "japan") return {
      ...source,
      previousTotalRub: null,
      priceDeltaRub: null,
      priceChangedAt: undefined,
    };
    const result = isPreliminaryPowerPendingCalculation(source)
      ? await calculateOfferWithPreliminaryPowerPricing(source)
      : await calculateOfferWithRussiaCustoms(source);
    if (result.make !== source.make || result.model !== source.model) canonicalized++;
    if (!Number(source.powerHp || 0) && Number(result.powerHp || 0) > 0) powerFilled++;
    const previousTotal = Number(source.totalRub || 0);
    const nextTotal = Number(result.totalRub || 0);
    const changed = previousTotal > 0 && nextTotal > 0 && previousTotal !== nextTotal;
    if (changed) priceChanged++;
    if (result.calculationStatus === "ready") ready++;
    else if (result.calculationStatus === "estimated") estimated++;
    else if (result.calculationStatus === "needs_power_data") missingPower++;
    else if (result.calculationStatus === "needs_customs_data") missingCustoms++;
    if ((index + 1) % 250 === 0) console.log(`[vehicle-knowledge-reindex] ${index + 1}/${offers.length}`);
    return {
      ...result,
      previousTotalRub: changed ? previousTotal : result.previousTotalRub ?? source.previousTotalRub,
      priceDeltaRub: changed ? nextTotal - previousTotal : result.priceDeltaRub ?? source.priceDeltaRub,
      priceChangedAt: changed ? new Date().toISOString() : result.priceChangedAt ?? source.priceChangedAt,
    };
  } catch (error) {
    if (errors.length < 500) errors.push({
      offerId: source.id,
      sourceId: source.sourceId,
      message: String(error?.message || error),
    });
    return source;
  }
}, CONCURRENCY);

const publicOffers = recalculated.filter((offer) => isCrediblePublicOffer(offer));
const guardedMinimum = currentPublicOffers.length >= MIN_PUBLIC_GUARD_COUNT
  ? Math.floor(currentPublicOffers.length * MIN_PUBLIC_RATIO)
  : 0;
const guardTriggered = guardedMinimum > 0 && publicOffers.length < guardedMinimum;
const baseReport = {
  startedAt,
  finishedAt: new Date().toISOString(),
  concurrency: CONCURRENCY,
  totalOffers: offers.length,
  japanRetentionMs,
  japanRetentionPruned,
  officialRateDate: String((refreshedRates?.rates || []).find((rate) => rate?.currency === "EUR")?.rateDate || ""),
  previousPublicOffers: currentPublicOffers.length,
  publicOffers: publicOffers.length,
  guardedMinimum,
  guardTriggered,
  canonicalized,
  powerFilled,
  priceChanged,
  ready,
  estimated,
  missingPower,
  missingCustoms,
  errors: errors.length,
  errorSamples: errors,
};

if (guardTriggered) {
  await writeDataJson(REPORT_PATH, {
    ...baseReport,
    published: false,
    reason: `public_catalog_collapse_guard_${publicOffers.length}_below_${guardedMinimum}`,
  });
  throw new Error(`public_catalog_collapse_guard_${publicOffers.length}_below_${guardedMinimum}`);
}

process.env.CATALOG_GROW_ONLY_MARKETS = "";
const manifest = await persistCatalogOffers(recalculated);
const report = {
  ...baseReport,
  finishedAt: new Date().toISOString(),
  generationId: manifest.generationId,
  published: true,
};
await writeDataJson(REPORT_PATH, report);
console.log(JSON.stringify(report, null, 2));

if (errors.length > Math.max(20, offers.length * 0.05)) process.exitCode = 1;
