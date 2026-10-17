const { getJsonStorage } = await import("../apps/web/lib/data.ts");
const { REQUIRED_CATALOG_SOURCES } = await import("../apps/web/lib/catalog/required-catalog-sources.ts");

const defaults = Object.values(REQUIRED_CATALOG_SOURCES).flat().map((source) => source.sourceId);
const sourceIds = String(process.env.CATALOG_IMPORT_SOURCES || defaults.join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const storage = getJsonStorage();
for (const sourceId of sourceIds) {
  await storage.deleteJson?.(`catalog/scans/${sourceId}.json`);
  await storage.deleteJson?.(`catalog/health/${sourceId}.json`);
  await storage.deleteJson?.(`catalog/sources/${sourceId}.json`);
}
await storage.deleteJson?.("catalog/import-lock.json");
console.log(JSON.stringify({ resetSourceCursors: sourceIds }, null, 2));
