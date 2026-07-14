process.env.CATALOG_ENCAR_DIRECT_PAGE_SIZE ||= "20";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "3";

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
