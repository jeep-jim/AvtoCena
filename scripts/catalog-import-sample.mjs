process.env.CATALOG_ENCAR_DIRECT_PAGE_SIZE ||= "48";
process.env.CATALOG_CHE168_GLOBAL_PAGE_SIZE ||= "48";
process.env.CATALOG_CHE168_GLOBAL_MAX_BRANDS ||= "24";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "6";
process.env.CATALOG_TARGET_PUBLIC_OFFERS ||= "2500";
process.env.CATALOG_TARGET_PER_MARKET ||= "500";
process.env.CATALOG_OFFER_RETENTION_MS ||= String(3 * 24 * 60 * 60 * 1000);
process.env.CATALOG_STALE_GRACE_MS ||= String(3 * 24 * 60 * 60 * 1000);

const { PUBLIC_CATALOG_SOURCE_IDS } = await import("../apps/web/lib/catalog/public-market-sources.ts");

// Useful fallback for a focused Encar verification without changing the all-market production default.
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
const sources = encarOnly ? encarSample.sourceIds : configuredSources.length ? configuredSources : PUBLIC_CATALOG_SOURCE_IDS;

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
const { importCatalog } = await import("../apps/web/lib/catalog/importer.ts");

const requestedOffers = Number(process.env.CATALOG_IMPORT_MAX_OFFERS || 0);
const requestedDetails = Number(process.env.CATALOG_IMPORT_MAX_DETAILS || 0);
const requestedPages = Number(process.env.CATALOG_IMPORT_MAX_PAGES || 0);
const requestedImages = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 0);
const targetPublicOffers = Number(process.env.CATALOG_TARGET_PUBLIC_OFFERS || 2500);
const targetPerMarket = Number(process.env.CATALOG_TARGET_PER_MARKET || 500);

// The target is accumulated over rolling scans. Keeping each run bounded lets every source
// advance its saved cursor and refresh roughly one full 500-car market inside a day.
const maxOffers = encarOnly ? encarSample.maxOffers : Math.max(64, requestedOffers || 64);
const maxDetails = encarOnly ? encarSample.maxDetails : Math.max(maxOffers, requestedDetails || maxOffers);
const maxPages = encarOnly ? encarSample.maxPages : Math.max(8, requestedPages || 8);
const maxImagesPerOffer = encarOnly ? encarSample.maxImagesPerOffer : Math.max(6, requestedImages || 6);

importCatalog({
  sourceIds: sources,
  maxOffers,
  maxDetails,
  maxImagesPerOffer,
  maxPages,
  requireObjectStorage: true,
  failOnZeroSaved: true,
  reportPath: "catalog/imports/latest-public-markets.json",
}).then(async (report) => {
  const marketIds = ["korea", "china", "japan", "uae", "europe"];
  const publicByMarket = report.publicByMarket || {};
  const missingByMarket = Object.fromEntries(marketIds.map((market) => [market, Math.max(0, targetPerMarket - Number(publicByMarket[market] || 0))]));
  const targetReachedByMarket = marketIds.every((market) => Number(publicByMarket[market] || 0) >= targetPerMarket);
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
    targetPublicOffers,
    targetPerMarket,
    targetReached: report.targetReached,
    targetReachedByMarket,
    missingByMarket,
    generationId: report.generationId,
    sources: report.sources,
    reportPath: "catalog/imports/latest-public-markets.json",
  };
  if (process.env.CATALOG_IMPORT_REPORT_FILE) {
    const fs = await import("node:fs/promises");
    await fs.writeFile(process.env.CATALOG_IMPORT_REPORT_FILE, JSON.stringify(summary, null, 2));
  }
  console.log(JSON.stringify(summary, null, 2));
}).catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
