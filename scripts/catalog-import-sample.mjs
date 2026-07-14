import { importCatalog } from "../apps/web/lib/catalog/importer.ts";

importCatalog({
  sourceIds: ["encar_direct"],
  maxOffers: 20,
  maxDetails: 20,
  maxImagesPerOffer: 3,
  maxPages: 1,
  requireObjectStorage: true,
  failOnZeroSaved: true,
  reportPath: "catalog/imports/latest-sample.json",
}).then((report) => {
  console.log(JSON.stringify({
    imported: report.imported,
    updated: report.updated,
    skipped: report.skipped,
    imageFailures: report.imageFailures,
    publicOffers: report.publicOffers,
    generationId: report.generationId,
    reportPath: "catalog/imports/latest-sample.json",
  }, null, 2));
}).catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
