process.env.CATALOG_ENCAR_DIRECT_PAGE_SIZE ||= "12";
process.env.CATALOG_CHE168_GLOBAL_PAGE_SIZE ||= "12";
process.env.CATALOG_CHE168_GLOBAL_MAX_BRANDS ||= "2";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "2";

const { PUBLIC_CATALOG_SOURCE_IDS } = await import("../apps/web/lib/catalog/public-market-sources.ts");
const configuredSources = String(process.env.CATALOG_IMPORT_SOURCES || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const sources = configuredSources.length ? configuredSources : PUBLIC_CATALOG_SOURCE_IDS;

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

const maxOffers = Number(process.env.CATALOG_IMPORT_MAX_OFFERS || 6);
const maxDetails = Number(process.env.CATALOG_IMPORT_MAX_DETAILS || maxOffers);
const maxPages = Number(process.env.CATALOG_IMPORT_MAX_PAGES || 1);
const maxImagesPerOffer = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 2);

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
    skipped: report.skipped,
    imageFailures: report.imageFailures,
    publicOffers: report.publicOffers,
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
