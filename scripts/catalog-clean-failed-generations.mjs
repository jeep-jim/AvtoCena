import fs from "node:fs/promises";

const { getJsonStorage, readDataJson } = await import("../apps/web/lib/data.ts");

const reportFile = process.env.CATALOG_FAILED_GENERATION_CLEANUP_REPORT || "catalog-failed-generation-cleanup-report.json";
const maxDeletes = Math.max(1, Number(process.env.CATALOG_FAILED_GENERATION_MAX_DELETES || 100_000));
const keepGenerations = Math.max(1, Number(process.env.CATALOG_FAILED_GENERATION_KEEP || 2));
const deleteConcurrency = Math.max(1, Math.min(16, Number(process.env.YC_OBJECT_STORAGE_DELETE_CONCURRENCY || 8)));
const configuredProtectedGenerations = new Set(String(process.env.CATALOG_FAILED_GENERATION_PROTECT || "")
  .split(",").map((value) => value.trim()).filter(Boolean));
const storage = getJsonStorage();

if (!storage.listObjects || !storage.deletePrefix) {
  throw new Error(`failed_generation_cleanup_not_supported_${storage.driver}`);
}

function generationIdFromKey(key) {
  return String(key || "").match(/^catalog\/generations\/(gen_(\d+)_[-a-z0-9]+)\//i)?.[1] || "";
}

const startedAt = new Date().toISOString();
const [manifest, internalManifest] = await Promise.all([
  readDataJson("catalog/manifest.json", { generationId: "", markets: {} }),
  readDataJson("catalog/internal/manifest.json", { generationId: "", sources: {} }),
]);
const liveGeneration = String(manifest?.generationId || "");
if (!liveGeneration) throw new Error("failed_generation_cleanup_live_manifest_missing");

const [objects, internalObjects] = await Promise.all([
  storage.listObjects("catalog/generations"),
  storage.listObjects("catalog/internal/offers"),
]);
const generations = [...new Set(objects.map((item) => generationIdFromKey(item.key)).filter(Boolean))]
  .sort((left, right) => Number(right.match(/^gen_(\d+)_/)?.[1] || 0) - Number(left.match(/^gen_(\d+)_/)?.[1] || 0));
const protectedGenerations = new Set([liveGeneration, ...generations.slice(0, keepGenerations), ...configuredProtectedGenerations]);
const candidates = generations.filter((generationId) => !protectedGenerations.has(generationId));
const candidateObjects = objects.filter((item) => candidates.includes(generationIdFromKey(item.key)));
const protectedInternalPaths = new Set(Object.values(internalManifest?.sources || {})
  .flatMap((source) => Array.isArray(source?.chunks) ? source.chunks.map(String) : []));
const orphanInternalObjects = internalObjects.filter((item) => item?.key && !protectedInternalPaths.has(String(item.key)));
const plannedBytes = [...candidateObjects, ...orphanInternalObjects]
  .reduce((sum, item) => sum + Math.max(0, Number(item?.size || 0)), 0);

if (candidateObjects.length + orphanInternalObjects.length > maxDeletes) {
  throw new Error(`failed_generation_cleanup_limit_${candidateObjects.length + orphanInternalObjects.length}_exceeds_${maxDeletes}`);
}

const errors = [];
async function deleteListedObjects(items, errorField) {
  const batches = [];
  for (let index = 0; index < items.length; index += 1_000) batches.push(items.slice(index, index + 1_000));
  let cursor = 0;
  let deletedCount = 0;
  await Promise.all(Array.from({ length: Math.min(deleteConcurrency, Math.max(1, batches.length)) }, async () => {
    while (true) {
      const batch = batches[cursor++];
      if (!batch) return;
      try {
        if (!storage.deleteObjects) throw new Error("batch_delete_not_supported");
        const batchDeleted = await storage.deleteObjects(batch.map((object) => object.key));
        deletedCount += batchDeleted;
      } catch (error) {
        for (const object of batch) {
          try { await storage.deleteJson(object.key); deletedCount++; }
          catch (fallbackError) { errors.push({ [errorField]: object.key, error: String(fallbackError?.message || error?.message || error) }); }
        }
      }
    }
  }));
  return deletedCount;
}

const [deleted, deletedOrphanInternalObjects] = await Promise.all([
  deleteListedObjects(candidateObjects, "generationObject"),
  deleteListedObjects(orphanInternalObjects, "internalObject"),
]);

const report = {
  version: 1,
  startedAt,
  finishedAt: new Date().toISOString(),
  liveGeneration,
  currentInternalGeneration: String(internalManifest?.generationId || "") || null,
  deleteConcurrency,
  batchDelete: Boolean(storage.deleteObjects),
  reusedInitialObjectListing: true,
  discoveredGenerations: generations.length,
  protectedGenerations: [...protectedGenerations],
  removedGenerations: candidates,
  plannedObjects: candidateObjects.length + orphanInternalObjects.length,
  plannedBytes,
  deletedObjects: deleted + deletedOrphanInternalObjects,
  reclaimedBytes: errors.length ? null : plannedBytes,
  removedOrphanInternalObjects: deletedOrphanInternalObjects,
  preservedImages: true,
  preservedInternalCandidatePools: true,
  errors,
};
await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
