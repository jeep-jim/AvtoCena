import fs from "node:fs/promises";

const { importCatalog } = await import("../apps/web/lib/catalog/importer.ts");
const { REQUIRED_CATALOG_SOURCES } = await import("../apps/web/lib/catalog/required-catalog-sources.ts");
const { CATALOG_DAILY_TARGET_PER_MARKET, CATALOG_DAILY_TARGET_TOTAL } = await import("../apps/web/lib/catalog/runtime-config.ts");

const SOURCE_IDS = Object.values(REQUIRED_CATALOG_SOURCES).flat().map((source) => source.sourceId);
const targetPerMarket = Math.max(1, Number(process.env.CATALOG_TARGET_PER_MARKET || CATALOG_DAILY_TARGET_PER_MARKET));
const maxImagesPerOffer = Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30));
const reportFile = process.env.CATALOG_DAILY_LOCAL_REPORT || "catalog-daily-report.json";
const retentionReportFile = "catalog-daily-retention-report.json";

console.log(`[daily-full] seven markets, target ${targetPerMarket} fresh offers per market`);
const importReport = await importCatalog({
  sourceIds: SOURCE_IDS,
  maxOffers: targetPerMarket,
  maxDetails: targetPerMarket,
  maxImagesPerOffer,
  maxPages: Math.max(250, targetPerMarket),
  requireObjectStorage: true,
  failOnZeroSaved: false,
  reportPath: "catalog/imports/daily-latest.json",
});

const previousSourceIds = process.env.CATALOG_DAILY_SOURCE_IDS;
const previousReport = process.env.CATALOG_DAILY_LOCAL_REPORT;
process.env.CATALOG_DAILY_SOURCE_IDS = "__retention_only__";
process.env.CATALOG_DAILY_LOCAL_REPORT = retentionReportFile;
try {
  await import("./catalog-daily-incremental.mjs");
} finally {
  if (previousSourceIds === undefined) delete process.env.CATALOG_DAILY_SOURCE_IDS;
  else process.env.CATALOG_DAILY_SOURCE_IDS = previousSourceIds;
  if (previousReport === undefined) delete process.env.CATALOG_DAILY_LOCAL_REPORT;
  else process.env.CATALOG_DAILY_LOCAL_REPORT = previousReport;
}

const retentionReport = JSON.parse(await fs.readFile(retentionReportFile, "utf8").catch(() => "{}"));
const finalReport = {
  ok: true,
  mode: "seven-markets-1000-daily",
  startedAt: importReport.startedAt,
  finishedAt: new Date().toISOString(),
  targetPerMarket,
  dailyCapacity: targetPerMarket * 7,
  retainedCapacityThreeDays: targetPerMarket * 7 * 3,
  configuredDailyTarget: CATALOG_DAILY_TARGET_TOTAL,
  requestedSourceIds: SOURCE_IDS,
  generationId: retentionReport.generationId || importReport.generationId,
  publicOffers: retentionReport.publicOffers ?? importReport.publicOffers,
  publicByMarket: retentionReport.publicByMarket || importReport.publicByMarket,
  imported: importReport.imported,
  updated: importReport.updated,
  expired: importReport.expired,
  rejectedByQuality: importReport.rejectedByQuality,
  reusedImageSets: importReport.reusedImageSets,
  imageFailures: importReport.imageFailures,
  sources: importReport.sources,
  retention: {
    days: retentionReport.retentionDays || 3,
    retainedGenerations: retentionReport.retainedGenerations || [],
    pruned: retentionReport.pruned || [],
    europeMileageRepair: retentionReport.europeMileageRepair || null,
  },
};
await fs.writeFile(reportFile, JSON.stringify(finalReport, null, 2), "utf8");
console.log(JSON.stringify(finalReport, null, 2));
