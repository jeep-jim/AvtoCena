process.env.CATALOG_ENCAR_DIRECT_PAGE_SIZE ||= "20";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "3";

if (["1", "true", "yes"].includes(String(process.env.CATALOG_IMPORT_RESET || "").toLowerCase())) {
  const { getJsonStorage } = await import("../apps/web/lib/data.ts");
  const storage = getJsonStorage();
  for (const path of [
    "catalog/internal/manifest.json",
    "catalog/manifest.json",
    "catalog/scans/encar_direct.json",
    "catalog/health/encar_direct.json",
    "catalog/sources/encar_direct.json",
    "catalog/import-lock.json",
  ]) {
    await storage.deleteJson?.(path);
  }
}

await import("../apps/web/lib/catalog/encar-resilience.ts");
const { importCatalog } = await import("../apps/web/lib/catalog/importer.ts");

importCatalog({
  sourceIds: ["encar_direct"],
  maxOffers: 20,
  maxDetails: 20,
  maxImagesPerOffer: 3,
  maxPages: 1,
  requireObjectStorage: true,
  failOnZeroSaved: true,
  reportPath: "catalog/imports/latest-sample.json",
}).then(async (report) => {
  const summary = {
    imported: report.imported,
    updated: report.updated,
    skipped: report.skipped,
    imageFailures: report.imageFailures,
    publicOffers: report.publicOffers,
    generationId: report.generationId,
    reportPath: "catalog/imports/latest-sample.json",
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
