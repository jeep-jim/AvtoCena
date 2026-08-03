import fs from "node:fs/promises";

const { getJsonStorage, readDataJson } = await import("../apps/web/lib/data.ts");

const reportFile = process.env.CATALOG_FAILED_GENERATION_CLEANUP_REPORT || "catalog-failed-generation-cleanup-report.json";
const maxDeletes = Math.max(1, Number(process.env.CATALOG_FAILED_GENERATION_MAX_DELETES || 100_000));
const storage = getJsonStorage();

if (!storage.listObjects || !storage.deletePrefix) {
  throw new Error(`failed_generation_cleanup_not_supported_${storage.driver}`);
}

function generationIdFromKey(key) {
  return String(key || "").match(/^catalog\/generations\/(gen_(\d+)_[-a-z0-9]+)\//i)?.[1] || "";
}

const startedAt = new Date().toISOString();
const manifest = await readDataJson("catalog/manifest.json", { generationId: "", markets: {} });
const liveGeneration = String(manifest?.generationId || "");
if (!liveGeneration) throw new Error("failed_generation_cleanup_live_manifest_missing");

const objects = await storage.listObjects("catalog/generations");
const generations = [...new Set(objects.map((item) => generationIdFromKey(item.key)).filter(Boolean))];
const candidates = generations.filter((generationId) => generationId !== liveGeneration);
const candidateObjects = objects.filter((item) => candidates.includes(generationIdFromKey(item.key)));

if (candidateObjects.length > maxDeletes) {
  throw new Error(`failed_generation_cleanup_limit_${candidateObjects.length}_exceeds_${maxDeletes}`);
}

const errors = [];
let deleted = 0;
for (const generationId of candidates) {
  try {
    deleted += await storage.deletePrefix(`catalog/generations/${generationId}`);
  } catch (error) {
    errors.push({ generationId, error: String(error?.message || error) });
  }
}

const report = {
  version: 1,
  startedAt,
  finishedAt: new Date().toISOString(),
  liveGeneration,
  discoveredGenerations: generations.length,
  removedGenerations: candidates,
  plannedObjects: candidateObjects.length,
  deletedObjects: deleted,
  preservedImages: true,
  preservedInternalCandidatePools: true,
  errors,
};
await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
