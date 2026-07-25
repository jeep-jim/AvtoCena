const { writeDataJson } = await import("../apps/web/lib/data.ts");
const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { persistCatalogOffers, readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");

const CONCURRENCY = Math.max(1, Math.min(24, Number(process.env.CATALOG_KNOWLEDGE_REINDEX_CONCURRENCY || 8)));
const REPORT_PATH = "catalog/vehicle-knowledge/catalog-reindex-report.json";
const startedAt = new Date().toISOString();
const offers = await readAllOffersForMaintenance();

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
    const result = await calculateOfferWithRussiaCustoms(source);
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

process.env.CATALOG_GROW_ONLY_MARKETS = "";
const manifest = await persistCatalogOffers(recalculated);
const publicOffers = recalculated.filter((offer) => isCrediblePublicOffer(offer));
const report = {
  startedAt,
  finishedAt: new Date().toISOString(),
  generationId: manifest.generationId,
  concurrency: CONCURRENCY,
  totalOffers: offers.length,
  publicOffers: publicOffers.length,
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
await writeDataJson(REPORT_PATH, report);
console.log(JSON.stringify(report, null, 2));

if (errors.length > Math.max(20, offers.length * 0.05)) process.exitCode = 1;
