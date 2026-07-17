const { getJsonStorage } = await import("../apps/web/lib/data.ts");

const defaults = [
  "encar_direct",
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
