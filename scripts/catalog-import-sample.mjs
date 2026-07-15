process.env.CATALOG_ENCAR_DIRECT_PAGE_SIZE ||= "24";
process.env.CATALOG_CHE168_GLOBAL_PAGE_SIZE ||= "24";
process.env.CATALOG_CHE168_GLOBAL_MAX_BRANDS ||= "12";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "6";
process.env.CATALOG_TARGET_PUBLIC_OFFERS ||= "224";
process.env.CATALOG_OFFER_RETENTION_MS ||= String(2 * 24 * 60 * 60 * 1000);
process.env.CATALOG_STALE_GRACE_MS ||= String(2 * 24 * 60 * 60 * 1000);

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
const targetPublicOffers = Number(process.env.CATALOG_TARGET_PUBLIC_OFFERS || 224);
const minimumPerSource = Math.max(1, Math.ceil(targetPublicOffers / Math.max(1, sources.length)));

const maxOffers = encarOnly ? encarSample.maxOffers : Math.max(minimumPerSource, requestedOffers || minimumPerSource);
const maxDetails = encarOnly ? encarSample.maxDetails : Math.max(maxOffers, requestedDetails || maxOffers);
const maxPages = encarOnly ? encarSample.maxPages : Math.max(4, requestedPages || 4);
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
  const summary = {
    imported: report.imported,
    updated: report.updated,
    expired: report.expired,
    skipped: report.skipped,
    imageFailures: report.imageFailures,
    underfilledImages: report.underfilledImages,
    reusedImageSets: report.reusedImageSets,
    publicOffers: report.publicOffers,
    publicByMarket: report.publicByMarket,
    targetPublicOffers: report.targetPublicOffers,
    targetReached: report.targetReached,
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
