const { getJsonStorage, readDataJson } = await import("../apps/web/lib/data.ts");
const storage: any = getJsonStorage();
if (!storage.listObjects) throw new Error(`list_objects_not_supported_${storage.driver}`);

function generationId(key: unknown) {
  return String(key || "").match(/^catalog\/generations\/(gen_(\d+)_[-a-z0-9]+)\//i)?.[1] || "";
}
function generationTs(id: string) { return Number(id.match(/^gen_(\d+)_/)?.[1] || 0); }

const manifest: any = await readDataJson("catalog/manifest.json", { generationId: "", markets: {} });
const live = String(manifest?.generationId || "");
const objects: any[] = await storage.listObjects("catalog/generations");
const grouped = new Map<string, any>();
for (const object of objects) {
  const id = generationId(object?.key);
  if (!id) continue;
  const row = grouped.get(id) || { generationId: id, bytes: 0, objects: 0, minModified: null, maxModified: null, sampleKeys: [] };
  row.bytes += Math.max(0, Number(object?.size || 0));
  row.objects += 1;
  const modified = String(object?.lastModified || object?.modifiedAt || object?.updatedAt || "");
  if (modified) {
    if (!row.minModified || modified < row.minModified) row.minModified = modified;
    if (!row.maxModified || modified > row.maxModified) row.maxModified = modified;
  }
  if (row.sampleKeys.length < 8) row.sampleKeys.push(String(object?.key || ""));
  grouped.set(id, row);
}
const generations = [...grouped.values()].sort((a,b) => generationTs(b.generationId) - generationTs(a.generationId));
const report = {
  checkedAt: new Date().toISOString(),
  driver: storage.driver,
  liveGeneration: live,
  liveMarkets: manifest?.markets || {},
  generationCount: generations.length,
  totalGenerationBytes: generations.reduce((sum,row) => sum + row.bytes, 0),
  latest: generations.slice(0, 8).map(row => ({ ...row, live: row.generationId === live, mib: Math.round(row.bytes / 1048576 * 10) / 10 })),
};
console.log(JSON.stringify(report, null, 2));
