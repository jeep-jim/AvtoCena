process.env.CATALOG_ENCAR_DIRECT_PAGE_SIZE ||= "48";
process.env.CATALOG_CHE168_GLOBAL_PAGE_SIZE ||= "48";
process.env.CATALOG_CHE168_GLOBAL_MAX_BRANDS ||= "24";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "10";
process.env.CATALOG_TARGET_PUBLIC_OFFERS ||= "1250";
process.env.CATALOG_TARGET_PER_MARKET ||= "250";
process.env.CATALOG_OFFER_RETENTION_MS ||= String(3 * 24 * 60 * 60 * 1000);
process.env.CATALOG_STALE_GRACE_MS ||= String(3 * 24 * 60 * 60 * 1000);
process.env.CATALOG_IMPORT_BUDGET_MS ||= String(42 * 60 * 1000);
process.env.CATALOG_SOURCE_BUDGET_MS ||= String(8 * 60 * 1000);

const {
  alternateMarketSources,
  PRODUCTION_CATALOG_SOURCE_IDS,
} = await import("../apps/web/lib/catalog/alternate-market-sources.ts");
const { catalogImportSources, importCatalog } = await import("../apps/web/lib/catalog/importer.ts");
const { mutateSourcePolicy } = await import("../apps/web/lib/catalog/policy.ts");

for (const source of alternateMarketSources) {
  if (!catalogImportSources.some((candidate) => candidate.sourceId === source.sourceId)) {
    catalogImportSources.push(source);
  }
}

const encarSample = {
  sourceIds: ["encar_direct"],
  maxOffers: 20,
  maxDetails: 20,
  maxImagesPerOffer: 3,
  maxPages: 1,
};

const encarOnly = ["1", "true", "yes"].includes(String(process.env.CATALOG_IMPORT_ENCAR_ONLY || "").toLowerCase());
const configuredSources = String(process.env.CATALOG_IMPORT_SOURCES || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

// Main sources first, slower fallbacks last. The importer stops processing fallbacks
// for a market after the daily target has already been filled by an earlier source.
const preferredProductionOrder = [
  "encar_direct",
  "sbt_japan",
  "sbt_china",
  "sbt_uae",
  "sbt_uk",
  "che168_global",
];
const knownProductionSources = new Set(PRODUCTION_CATALOG_SOURCE_IDS);
const defaultSources = [
  ...preferredProductionOrder.filter((sourceId) => knownProductionSources.has(sourceId)),
  ...PRODUCTION_CATALOG_SOURCE_IDS.filter((sourceId) => !preferredProductionOrder.includes(sourceId)),
];
const sources = encarOnly
  ? encarSample.sourceIds
  : configuredSources.length
    ? configuredSources
    : [...new Set(defaultSources)];

if (["1", "true", "yes"].includes(String(process.env.CATALOG_IMPORT_RESET || "").toLowerCase())) {
  const { getJsonStorage } = await import("../apps/web/lib/data.ts");
  const storage = getJsonStorage();
  const sourcePaths = sources.flatMap((sourceId) => [
    `catalog/scans/${sourceId}.json`,
    `catalog/health/${sourceId}.json`,
    `catalog/sources/${sourceId}.json`,
  ]);
  for (const path of [
    "catalog/internal/manifest.json",
    "catalog/manifest.json",
    "catalog/import-lock.json",
    ...sourcePaths,
  ]) {
    await storage.deleteJson?.(path);
  }
}

await import("../apps/web/lib/catalog/encar-resilience.ts");

const requestedOffers = Number(process.env.CATALOG_IMPORT_MAX_OFFERS || 0);
const requestedDetails = Number(process.env.CATALOG_IMPORT_MAX_DETAILS || 0);
const requestedPages = Number(process.env.CATALOG_IMPORT_MAX_PAGES || 0);
const requestedImages = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 0);
const targetPublicOffers = Number(process.env.CATALOG_TARGET_PUBLIC_OFFERS || 1250);
const targetPerMarket = Number(process.env.CATALOG_TARGET_PER_MARKET || 250);

const maxOffers = encarOnly ? encarSample.maxOffers : Math.max(32, requestedOffers || 250);
const maxDetails = encarOnly ? encarSample.maxDetails : Math.max(maxOffers, requestedDetails || maxOffers);
const maxPages = encarOnly ? encarSample.maxPages : Math.max(4, requestedPages || 12);
const maxImagesPerOffer = encarOnly ? encarSample.maxImagesPerOffer : Math.max(10, requestedImages || 10);

for (const source of catalogImportSources.filter((candidate) => sources.includes(candidate.sourceId))) {
  await mutateSourcePolicy(source, (policy) => ({
    ...policy,
    enabled: true,
    blockedUntil: undefined,
    consecutiveFailures: 0,
    maxPagesPerRun: Math.max(Number(policy.maxPagesPerRun || 0), maxPages),
    maxOffersPerRun: Math.max(Number(policy.maxOffersPerRun || 0), maxOffers),
    maxDetailsPerRun: Math.max(Number(policy.maxDetailsPerRun || 0), maxDetails),
  }));
}

const startedAt = Date.now();
const report = await importCatalog({
  sourceIds: sources,
  maxOffers,
  maxDetails,
  maxImagesPerOffer,
  maxPages,
  requireObjectStorage: true,
  failOnZeroSaved: true,
  reportPath: "catalog/imports/latest-public-markets.json",
});

const marketIds = ["korea", "china", "japan", "uae", "europe"];
const publicByMarket = report.publicByMarket || {};
const refreshedByMarket = report.refreshedByMarket || {};
const missingByMarket = Object.fromEntries(
  marketIds.map((market) => [market, Math.max(0, targetPerMarket - Number(refreshedByMarket[market] || 0))]),
);
const targetReachedByMarket = marketIds.every((market) => Number(refreshedByMarket[market] || 0) >= targetPerMarket);
const summary = {
  imported: report.imported,
  updated: report.updated,
  expired: report.expired,
  skipped: report.skipped,
  imageFailures: report.imageFailures,
  underfilledImages: report.underfilledImages,
  reusedImageSets: report.reusedImageSets,
  publicOffers: report.publicOffers,
  publicByMarket,
  refreshedByMarket,
  targetPublicOffers,
  targetPerMarket,
  targetReached: report.targetReached,
  targetReachedByMarket,
  missingByMarket,
  generationId: report.generationId,
  sources: report.sources,
  durationMs: Date.now() - startedAt,
  reportPath: "catalog/imports/latest-public-markets.json",
};

if (process.env.CATALOG_IMPORT_REPORT_FILE) {
  const fs = await import("node:fs/promises");
  await fs.writeFile(process.env.CATALOG_IMPORT_REPORT_FILE, JSON.stringify(summary, null, 2));
}
console.log(JSON.stringify(summary, null, 2));

if (!report.sources?.some((source) => source.ok)) {
  console.error("catalog_import_all_sources_failed");
  process.exitCode = 1;
}
