process.env.CATALOG_ENCAR_DIRECT_PAGE_SIZE ||= "64";
process.env.CATALOG_CHE168_GLOBAL_PAGE_SIZE ||= "64";
process.env.CATALOG_CHE168_GLOBAL_MAX_BRANDS ||= "48";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "10";
process.env.CATALOG_TARGET_PUBLIC_OFFERS ||= "1250";
process.env.CATALOG_TARGET_PER_MARKET ||= "250";
process.env.CATALOG_OFFER_RETENTION_MS ||= String(45 * 24 * 60 * 60 * 1000);
process.env.CATALOG_STALE_GRACE_MS ||= String(45 * 24 * 60 * 60 * 1000);
process.env.CATALOG_IMPORT_BUDGET_MS ||= String(3 * 60 * 60 * 1000);
process.env.CATALOG_SOURCE_BUDGET_MS ||= String(30 * 60 * 1000);
process.env.CATALOG_RESTART_UNDERFILLED_SCANS ||= "true";
process.env.CATALOG_PRESERVE_PREVIOUS_ON_FAILURE ||= "true";

const { alternateMarketSources } = await import("../apps/web/lib/catalog/alternate-market-sources.ts");
const { publicFallbackSources } = await import("../apps/web/lib/catalog/public-fallback-sources.ts");
const { reliableMarketSources } = await import("../apps/web/lib/catalog/reliable-market-sources.ts");
const { exactMarketSources, EXACT_MARKET_SOURCE_IDS } = await import("../apps/web/lib/catalog/exact-market-sources.ts");
const { jpaucJapanSource } = await import("../apps/web/lib/catalog/jpauc-source.ts");
const { catalogImportSources, importCatalog } = await import("../apps/web/lib/catalog/importer.ts");
const { mutateSourcePolicy } = await import("../apps/web/lib/catalog/policy.ts");
const { refreshLiveExchangeRates } = await import("../apps/web/lib/catalog/live-rates.ts");

const QUARANTINED_SOURCE_IDS = new Set(["japantransit_japan"]);
for (const source of [jpaucJapanSource, ...exactMarketSources, ...reliableMarketSources, ...alternateMarketSources, ...publicFallbackSources]) {
  if (QUARANTINED_SOURCE_IDS.has(source.sourceId)) continue;
  if (!catalogImportSources.some((candidate) => candidate.sourceId === source.sourceId)) catalogImportSources.push(source);
}

const preferred = [
  "encar_direct",
  "che168_dealer_exact",
  "che168_china_exact",
  "che168_global",
  "jpauc_japan",
  "goonet_japan_exact",
  "dubicars_uae_exact",
  "dubicars_uae",
  "otomoto_europe_exact",
  "autoscout_europe",
  "autouncle_europe",
];
const configured = String(process.env.CATALOG_IMPORT_SOURCES || "").split(",").map((value) => value.trim()).filter(Boolean);
const available = new Set(catalogImportSources.map((source) => source.sourceId));
const sources = [...new Set((configured.length ? configured : preferred).filter((sourceId) => available.has(sourceId) && !QUARANTINED_SOURCE_IDS.has(sourceId)))];

if (["1", "true", "yes"].includes(String(process.env.CATALOG_IMPORT_RESET || "").toLowerCase())) {
  const { getJsonStorage } = await import("../apps/web/lib/data.ts");
  const storage = getJsonStorage();
  const sourcePaths = sources.flatMap((sourceId) => [`catalog/scans/${sourceId}.json`, `catalog/health/${sourceId}.json`, `catalog/sources/${sourceId}.json`]);
  for (const path of ["catalog/internal/manifest.json", "catalog/manifest.json", "catalog/import-lock.json", ...sourcePaths]) await storage.deleteJson?.(path);
}

const maxOffers = Math.max(32, Number(process.env.CATALOG_IMPORT_MAX_OFFERS || 250));
const maxDetails = Math.max(maxOffers, Number(process.env.CATALOG_IMPORT_MAX_DETAILS || maxOffers));
const maxPages = Math.max(4, Number(process.env.CATALOG_IMPORT_MAX_PAGES || 30));
const maxImagesPerOffer = Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10));
const targetPerMarket = Math.max(1, Number(process.env.CATALOG_TARGET_PER_MARKET || 250));
const targetPublicOffers = Math.max(targetPerMarket * 5, Number(process.env.CATALOG_TARGET_PUBLIC_OFFERS || 1250));
const smokeOptions = {
  sourceIds: ["encar_direct"],
  maxOffers: 20,
  maxDetails: 20,
  maxImagesPerOffer: 3,
  maxPages: 1,
};
const smokeMode = ["1", "true", "yes"].includes(String(process.env.CATALOG_IMPORT_SMOKE || "").toLowerCase());

for (const source of catalogImportSources.filter((candidate) => (smokeMode ? smokeOptions.sourceIds : sources).includes(candidate.sourceId))) {
  await mutateSourcePolicy(source, (policy) => ({
    ...policy,
    enabled: true,
    blockedUntil: undefined,
    consecutiveFailures: 0,
    maxPagesPerRun: Math.max(Number(policy.maxPagesPerRun || 0), smokeMode ? smokeOptions.maxPages : maxPages),
    maxOffersPerRun: Math.max(Number(policy.maxOffersPerRun || 0), smokeMode ? smokeOptions.maxOffers : maxOffers),
    maxDetailsPerRun: Math.max(Number(policy.maxDetailsPerRun || 0), smokeMode ? smokeOptions.maxDetails : maxDetails),
    imagesEnabled: true,
  }));
}

const startedAt = Date.now();
const exchangeRates = await refreshLiveExchangeRates().catch((error) => ({ updatedAt: new Date().toISOString(), rates: [], errors: [`refresh:${error?.message || "failed"}`] }));
console.log(`[catalog] verified source pool: ${sources.join(", ")}`);
console.log(`[catalog] exact adapters: ${EXACT_MARKET_SOURCE_IDS.join(", ")}`);
console.log(`[catalog] exchange rates refreshed: ${exchangeRates.rates?.length || 0}; errors=${exchangeRates.errors?.length || 0}`);

const report = await importCatalog({
  ...(smokeMode ? smokeOptions : { sourceIds: sources, maxOffers, maxDetails, maxImagesPerOffer, maxPages }),
  requireObjectStorage: true,
  failOnZeroSaved: true,
  reportPath: "catalog/imports/latest-public-markets.json",
});

const marketIds = ["korea", "china", "japan", "uae", "europe"];
const publicByMarket = report.publicByMarket || {};
const refreshedByMarket = report.refreshedByMarket || {};
const missingByMarket = Object.fromEntries(marketIds.map((market) => [market, Math.max(0, targetPerMarket - Number(publicByMarket[market] || 0))]));
const summary = {
  imported: report.imported,
  updated: report.updated,
  expired: report.expired,
  skipped: report.skipped,
  rejectedByQuality: report.rejectedByQuality,
  preservedPrevious: report.preservedPrevious,
  imageFailures: report.imageFailures,
  underfilledImages: report.underfilledImages,
  reusedImageSets: report.reusedImageSets,
  publicOffers: report.publicOffers,
  publicByMarket,
  refreshedByMarket,
  targetPublicOffers,
  targetPerMarket,
  targetReached: marketIds.every((market) => Number(publicByMarket[market] || 0) >= targetPerMarket),
  targetReachedByMarket: marketIds.every((market) => Number(publicByMarket[market] || 0) >= targetPerMarket),
  missingByMarket,
  generationId: report.generationId,
  sources: report.sources,
  exchangeRates: { updatedAt: exchangeRates.updatedAt, rates: exchangeRates.rates, errors: exchangeRates.errors },
  durationMs: Date.now() - startedAt,
  reportPath: "catalog/imports/latest-public-markets.json",
};

if (process.env.CATALOG_IMPORT_REPORT_FILE) {
  const fs = await import("node:fs/promises");
  await fs.writeFile(process.env.CATALOG_IMPORT_REPORT_FILE, JSON.stringify(summary, null, 2));
}
console.log(JSON.stringify(summary, null, 2));
if (!report.sources?.some((source) => source.ok)) process.exitCode = 1;
