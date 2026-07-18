process.env.CATALOG_ENCAR_DIRECT_PAGE_SIZE ||= "64";
process.env.CATALOG_CHE168_GLOBAL_PAGE_SIZE ||= "64";
process.env.CATALOG_CHE168_GLOBAL_MAX_BRANDS ||= "64";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "3";
process.env.CATALOG_OFFER_RETENTION_MS ||= String(45 * 24 * 60 * 60 * 1000);
process.env.CATALOG_STALE_GRACE_MS ||= String(45 * 24 * 60 * 60 * 1000);
process.env.CATALOG_IMPORT_BUDGET_MS ||= String(48 * 60 * 1000);
process.env.CATALOG_SOURCE_BUDGET_MS ||= String(44 * 60 * 1000);
process.env.CATALOG_RESTART_UNDERFILLED_SCANS ||= "true";
process.env.CATALOG_PRESERVE_PREVIOUS_ON_FAILURE ||= "true";

const { alternateMarketSources } = await import("../apps/web/lib/catalog/alternate-market-sources.ts");
const { publicFallbackSources } = await import("../apps/web/lib/catalog/public-fallback-sources.ts");
const { reliableMarketSources } = await import("../apps/web/lib/catalog/reliable-market-sources.ts");
const { exactMarketSources } = await import("../apps/web/lib/catalog/exact-market-sources.ts");
const { catalogImportSources, importCatalog } = await import("../apps/web/lib/catalog/importer.ts");
const { mutateSourcePolicy } = await import("../apps/web/lib/catalog/policy.ts");
const { refreshLiveExchangeRates } = await import("../apps/web/lib/catalog/live-rates.ts");
const { isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");

const QUARANTINED_SOURCE_IDS = new Set(["japantransit_japan", "dubicars_uae", "autouncle_europe"]);
for (const source of [...exactMarketSources, ...reliableMarketSources, ...alternateMarketSources, ...publicFallbackSources]) {
  if (QUARANTINED_SOURCE_IDS.has(source.sourceId)) continue;
  const index = catalogImportSources.findIndex((candidate) => candidate.sourceId === source.sourceId);
  if (index >= 0) catalogImportSources[index] = source;
  else catalogImportSources.push(source);
}

const desiredPerMarket = Math.max(1, Number(process.env.CATALOG_DESIRED_PER_MARKET || 250));
const candidateMultiplier = Math.max(2, Number(process.env.CATALOG_CANDIDATE_MULTIPLIER || 4));
const minimumCandidates = Math.max(32, Number(process.env.CATALOG_MIN_CANDIDATES || 100));
const maximumCandidates = Math.max(minimumCandidates, Number(process.env.CATALOG_MAX_CANDIDATES || 1000));
const maxPages = Math.max(20, Number(process.env.CATALOG_IMPORT_MAX_PAGES || 80));
const maxImagesPerOffer = Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 3));

const marketPlans = [
  { market: "uae", sources: ["dubicars_uae_exact"] },
  { market: "europe", sources: ["otomoto_europe_exact", "autoscout_europe"] },
  { market: "china", sources: ["che168_dealer_exact", "che168_china_exact", "che168_global"] },
  { market: "korea", sources: ["encar_direct"] },
];

const requestedMarkets = new Set(String(process.env.CATALOG_FILL_MARKETS || marketPlans.map((plan) => plan.market).join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean));
const availableSourceIds = new Set(catalogImportSources.map((source) => source.sourceId));

function countPublicByMarket(offers) {
  return offers.filter((offer) => isCrediblePublicOffer(offer)).reduce((totals, offer) => {
    totals[offer.market] = (totals[offer.market] || 0) + 1;
    return totals;
  }, {});
}

async function currentCounts() {
  return countPublicByMarket(await readAllOffersForMaintenance());
}

const startedAt = new Date().toISOString();
const exchangeRates = await refreshLiveExchangeRates().catch((error) => ({
  updatedAt: new Date().toISOString(),
  rates: [],
  errors: [`refresh:${error?.message || "failed"}`],
}));
const marketReports = [];

for (const plan of marketPlans) {
  if (!requestedMarkets.has(plan.market)) continue;

  const beforeCounts = await currentCounts();
  const before = Number(beforeCounts[plan.market] || 0);
  const deficit = Math.max(0, desiredPerMarket - before);
  const sourceIds = plan.sources.filter((sourceId) => availableSourceIds.has(sourceId) && !QUARANTINED_SOURCE_IDS.has(sourceId));

  if (!deficit) {
    marketReports.push({ market: plan.market, before, after: before, deficit: 0, skipped: true, reason: "market_already_filled", sources: [] });
    console.log(`[catalog-fill] skip ${plan.market}: already has ${before}`);
    continue;
  }
  if (!sourceIds.length) {
    marketReports.push({ market: plan.market, before, after: before, deficit, skipped: true, reason: "no_available_sources", sources: [] });
    continue;
  }

  const candidateTarget = Math.min(maximumCandidates, Math.max(minimumCandidates, deficit * candidateMultiplier));
  process.env.CATALOG_TARGET_PER_MARKET = String(candidateTarget);
  process.env.CATALOG_TARGET_PUBLIC_OFFERS = String(candidateTarget * 5);

  const priority = new Map(sourceIds.map((sourceId, index) => [sourceId, index]));
  catalogImportSources.sort((left, right) => (priority.get(left.sourceId) ?? Number.MAX_SAFE_INTEGER) - (priority.get(right.sourceId) ?? Number.MAX_SAFE_INTEGER));

  for (const source of catalogImportSources.filter((candidate) => sourceIds.includes(candidate.sourceId))) {
    await mutateSourcePolicy(source, (policy) => ({
      ...policy,
      enabled: true,
      blockedUntil: undefined,
      consecutiveFailures: 0,
      maxPagesPerRun: Math.max(Number(policy.maxPagesPerRun || 0), maxPages),
      maxOffersPerRun: Math.max(Number(policy.maxOffersPerRun || 0), candidateTarget),
      maxDetailsPerRun: Math.max(Number(policy.maxDetailsPerRun || 0), candidateTarget),
      imagesEnabled: true,
    }));
  }

  console.log(`[catalog-fill] ${plan.market}: before=${before}, deficit=${deficit}, candidateTarget=${candidateTarget}, sources=${sourceIds.join(",")}`);
  const report = await importCatalog({
    sourceIds,
    maxOffers: candidateTarget,
    maxDetails: candidateTarget,
    maxImagesPerOffer,
    maxPages,
    requireObjectStorage: true,
    failOnZeroSaved: false,
    reportPath: `catalog/imports/latest-${plan.market}-fill.json`,
  }).catch((error) => ({
    imported: 0,
    updated: 0,
    sources: [],
    error: error?.message || String(error),
  }));

  const afterCounts = await currentCounts();
  const after = Number(afterCounts[plan.market] || 0);
  marketReports.push({
    market: plan.market,
    before,
    after,
    deficit,
    gained: Math.max(0, after - before),
    desired: desiredPerMarket,
    candidateTarget,
    reached: after >= desiredPerMarket,
    imported: Number(report.imported || 0),
    updated: Number(report.updated || 0),
    rejectedByQuality: Number(report.rejectedByQuality || 0),
    imageFailures: Number(report.imageFailures || 0),
    deadlineReached: Boolean(report.deadlineReached),
    error: report.error,
    sources: report.sources || [],
  });
}

const publicByMarket = await currentCounts();
const finishedAt = new Date().toISOString();
const summary = {
  startedAt,
  finishedAt,
  durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
  desiredPerMarket,
  publicByMarket,
  targetReachedByMarket: Object.fromEntries(["korea", "china", "japan", "uae", "europe"].map((market) => [market, Number(publicByMarket[market] || 0) >= desiredPerMarket])),
  missingByMarket: Object.fromEntries(["korea", "china", "japan", "uae", "europe"].map((market) => [market, Math.max(0, desiredPerMarket - Number(publicByMarket[market] || 0))])),
  markets: marketReports,
  exchangeRates: { updatedAt: exchangeRates.updatedAt, errors: exchangeRates.errors || [] },
};

if (process.env.CATALOG_IMPORT_REPORT_FILE) {
  const fs = await import("node:fs/promises");
  await fs.writeFile(process.env.CATALOG_IMPORT_REPORT_FILE, JSON.stringify(summary, null, 2));
}
console.log(JSON.stringify(summary, null, 2));
