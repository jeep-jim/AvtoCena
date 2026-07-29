import fs from "node:fs/promises";

const { getJsonStorage, readDataJson, writeDataJson } = await import("../apps/web/lib/data.ts");

const REPORT_FILE = process.env.CATALOG_STORAGE_CLEANUP_REPORT || "catalog-storage-cleanup-report.json";
const KEEP_GENERATIONS = Math.max(2, Number(process.env.CATALOG_STORAGE_KEEP_GENERATIONS || 2));
const GRACE_MS = Math.max(3 * 24 * 60 * 60 * 1_000, Number(process.env.CATALOG_STORAGE_CLEANUP_GRACE_MS || 4 * 24 * 60 * 60 * 1_000));
const MAX_DELETES = Math.max(1_000, Number(process.env.CATALOG_STORAGE_CLEANUP_MAX_DELETES || 100_000));
const DELETE_CONCURRENCY = Math.max(1, Math.min(32, Number(process.env.CATALOG_STORAGE_DELETE_CONCURRENCY || 12)));
const DRY_RUN = String(process.env.CATALOG_STORAGE_CLEANUP_DRY_RUN || "true").toLowerCase() !== "false";

function generationIdFromKey(key) {
  return String(key || "").match(/^catalog\/generations\/(gen_(\d+)_[-a-z0-9]+)\//i)?.[1] || "";
}

function generationTimestamp(generationId) {
  const value = Number(String(generationId || "").match(/^gen_(\d+)_/)?.[1] || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function objectAge(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function mapWithConcurrency(items, concurrency, worker) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function readLiveImageKeys(generationIds) {
  const keys = new Set();
  for (const generationId of generationIds) {
    if (!generationId) continue;
    const index = await readDataJson(`catalog/generations/${generationId}/indexes/images-by-id.json`, { imagesById: {} }).catch(() => ({ imagesById: {} }));
    for (const image of Object.values(index?.imagesById || {})) {
      const objectKey = String(image?.objectKey || "").trim();
      if (objectKey) keys.add(objectKey);
    }
  }
  return keys;
}

const storage = getJsonStorage();
if (!storage.listObjects || !storage.deletePrefix || !storage.deleteJson) {
  throw new Error(`storage_cleanup_not_supported_${storage.driver}`);
}

const startedAt = new Date().toISOString();
const cutoff = Date.now() - GRACE_MS;
const [publicManifest, internalManifest, generationObjects, internalObjects, imageObjects] = await Promise.all([
  readDataJson("catalog/manifest.json", { generationId: "", markets: {} }),
  readDataJson("catalog/internal/manifest.json", { generationId: "", sources: {} }),
  storage.listObjects("catalog/generations"),
  storage.listObjects("catalog/internal/offers"),
  storage.listObjects("catalog/images"),
]);

const generationIds = [...new Set(generationObjects.map((object) => generationIdFromKey(object.key)).filter(Boolean))]
  .sort((left, right) => generationTimestamp(right) - generationTimestamp(left));
const protectedGenerations = new Set([
  String(publicManifest?.generationId || ""),
  String(internalManifest?.generationId || ""),
  ...generationIds.slice(0, KEEP_GENERATIONS),
].filter(Boolean));

if (!publicManifest?.generationId || !generationIds.length) {
  const report = {
    version: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    blocked: true,
    reason: "healthy_current_generation_not_confirmed",
    currentPublicGeneration: publicManifest?.generationId || null,
    currentInternalGeneration: internalManifest?.generationId || null,
    discoveredGenerations: generationIds.length,
  };
  await fs.writeFile(REPORT_FILE, JSON.stringify(report, null, 2));
  await writeDataJson("catalog/storage-cleanup-report.json", report).catch(() => undefined);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  const candidateGenerations = generationIds.filter((generationId) => {
    const timestamp = generationTimestamp(generationId);
    return timestamp > 0 && timestamp < cutoff && !protectedGenerations.has(generationId);
  });
  const candidateSet = new Set(candidateGenerations);
  const generationDeleteObjects = generationObjects.filter((object) => candidateSet.has(generationIdFromKey(object.key)));
  const internalDeleteObjects = internalObjects.filter((object) => {
    const key = String(object.key || "");
    return candidateGenerations.some((generationId) => key.includes(`/${generationId}-chunk-`));
  });
  const liveImageKeys = await readLiveImageKeys(protectedGenerations);
  const imageDeleteObjects = imageObjects.filter((object) => {
    const modifiedAt = objectAge(object.lastModified);
    return object.key && !liveImageKeys.has(object.key) && modifiedAt > 0 && modifiedAt < cutoff;
  });
  const plannedDeletes = generationDeleteObjects.length + internalDeleteObjects.length + imageDeleteObjects.length;
  const blocked = plannedDeletes > MAX_DELETES;
  const errors = [];
  let deletedGenerationObjects = 0;
  let deletedInternalObjects = 0;
  let deletedImages = 0;

  if (!DRY_RUN && !blocked) {
    for (const generationId of candidateGenerations) {
      try {
        deletedGenerationObjects += await storage.deletePrefix(`catalog/generations/${generationId}`);
      } catch (error) {
        errors.push({ stage: "generation", generationId, error: String(error?.message || error) });
      }
    }
    const internalResults = await mapWithConcurrency(internalDeleteObjects, DELETE_CONCURRENCY, async (object) => {
      try { await storage.deleteJson(object.key); return 1; }
      catch (error) { errors.push({ stage: "internal", key: object.key, error: String(error?.message || error) }); return 0; }
    });
    deletedInternalObjects = internalResults.reduce((sum, value) => sum + Number(value || 0), 0);
    const imageResults = await mapWithConcurrency(imageDeleteObjects, DELETE_CONCURRENCY, async (object) => {
      try { await storage.deleteJson(object.key); return 1; }
      catch (error) { errors.push({ stage: "image", key: object.key, error: String(error?.message || error) }); return 0; }
    });
    deletedImages = imageResults.reduce((sum, value) => sum + Number(value || 0), 0);
  }

  const report = {
    version: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    blocked,
    blockReason: blocked ? `planned_deletes_${plannedDeletes}_exceed_${MAX_DELETES}` : "",
    graceMs: GRACE_MS,
    keepGenerations: KEEP_GENERATIONS,
    maximumDeletes: MAX_DELETES,
    currentPublicGeneration: publicManifest.generationId,
    currentInternalGeneration: internalManifest?.generationId || null,
    protectedGenerations: [...protectedGenerations],
    candidateGenerations,
    discovered: {
      generations: generationIds.length,
      generationObjects: generationObjects.length,
      internalObjects: internalObjects.length,
      imageObjects: imageObjects.length,
      liveImages: liveImageKeys.size,
    },
    planned: {
      generationObjects: generationDeleteObjects.length,
      internalObjects: internalDeleteObjects.length,
      images: imageDeleteObjects.length,
      total: plannedDeletes,
    },
    deleted: {
      generationObjects: deletedGenerationObjects,
      internalObjects: deletedInternalObjects,
      images: deletedImages,
      total: deletedGenerationObjects + deletedInternalObjects + deletedImages,
    },
    errors: errors.slice(0, 500),
  };
  await fs.writeFile(REPORT_FILE, JSON.stringify(report, null, 2));
  await writeDataJson("catalog/storage-cleanup-report.json", report);
  console.log(JSON.stringify(report, null, 2));
  if (blocked || errors.length) process.exitCode = 1;
}
