import fs from "node:fs/promises";

const { getJsonStorage, readDataJson, writeDataJson } = await import("../apps/web/lib/data.ts");

const REPORT_FILE = process.env.CATALOG_STORAGE_CLEANUP_REPORT || "catalog-storage-cleanup-report.json";
const EMERGENCY = String(process.env.CATALOG_STORAGE_EMERGENCY || "false").toLowerCase() === "true";
const KEEP_GENERATIONS = Math.max(EMERGENCY ? 0 : 2, Number(process.env.CATALOG_STORAGE_KEEP_GENERATIONS || (EMERGENCY ? 0 : 2)));
// Current + internal manifests and the newest two generations are protected
// independently. A three-day grace kept many complete daily copies alive and
// prevented routine cleanup from ever catching up.
const MIN_GRACE_MS = EMERGENCY ? 0 : 6 * 60 * 60 * 1_000;
const GRACE_MS = Math.max(MIN_GRACE_MS, Number(process.env.CATALOG_STORAGE_CLEANUP_GRACE_MS || 4 * 24 * 60 * 60 * 1_000));
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

function objectBytes(objects) {
  return objects.reduce((sum, object) => sum + Math.max(0, Number(object?.size || 0)), 0);
}

function objectPrefixSummary(objects) {
  const summary = new Map();
  for (const object of objects) {
    const key = String(object?.key || "");
    const parts = key.split("/").filter(Boolean);
    const prefix = parts.length >= 2 ? parts.slice(0, Math.min(3, parts.length)).join("/") : key || "(unknown)";
    const current = summary.get(prefix) || { prefix, objects: 0, bytes: 0 };
    current.objects += 1;
    current.bytes += Math.max(0, Number(object?.size || 0));
    summary.set(prefix, current);
  }
  return [...summary.values()].sort((left, right) => right.bytes - left.bytes || right.objects - left.objects || left.prefix.localeCompare(right.prefix));
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

function collectOfferImageKeys(keys, offers) {
  for (const offer of Array.isArray(offers) ? offers : []) {
    for (const image of Array.isArray(offer?.images) ? offer.images : []) {
      const objectKey = String(image?.objectKey || "").trim();
      if (objectKey) keys.add(objectKey);
    }
  }
}

async function readLiveImageKeys(generationIds, internalManifest, includeInternal) {
  const keys = new Set();
  for (const generationId of generationIds) {
    if (!generationId) continue;
    const index = await readDataJson(`catalog/generations/${generationId}/indexes/images-by-id.json`, { imagesById: {} }).catch(() => ({ imagesById: {} }));
    for (const image of Object.values(index?.imagesById || {})) {
      const objectKey = String(image?.objectKey || "").trim();
      if (objectKey) keys.add(objectKey);
    }
  }
  if (!includeInternal) return keys;
  const internalChunks = [...new Set(Object.values(internalManifest?.sources || {}).flatMap((source) => Array.isArray(source?.chunks) ? source.chunks : []))];
  const internalLists = await mapWithConcurrency(internalChunks, Math.min(DELETE_CONCURRENCY, 16), (chunk) => readDataJson(String(chunk), []).catch(() => []));
  for (const offers of internalLists) collectOfferImageKeys(keys, offers);
  return keys;
}

const storage = getJsonStorage();
if (!storage.listObjects || !storage.deletePrefix || !storage.deleteJson) {
  throw new Error(`storage_cleanup_not_supported_${storage.driver}`);
}

const startedAt = new Date().toISOString();
const cutoff = Date.now() - GRACE_MS;
const [publicManifest, internalManifest, namespaceObjects, catalogObjects, generationObjects, internalObjects, imageObjects] = await Promise.all([
  readDataJson("catalog/manifest.json", { generationId: "", markets: {} }),
  readDataJson("catalog/internal/manifest.json", { generationId: "", sources: {} }),
  // This is read-only inventory of the complete configured Object Storage
  // namespace. Deletion remains strictly limited to the guarded catalog paths.
  storage.listObjects(""),
  // Inventory the complete catalog namespace. The cleanup used to report
  // green while only seeing generations/internal/images, leaving large legacy
  // branches invisible and making bucket growth impossible to explain.
  storage.listObjects("catalog"),
  storage.listObjects("catalog/generations"),
  storage.listObjects("catalog/internal/offers"),
  storage.listObjects("catalog/images"),
]);

const generationIds = [...new Set(generationObjects.map((object) => generationIdFromKey(object.key)).filter(Boolean))]
  .sort((left, right) => generationTimestamp(right) - generationTimestamp(left));
const publicGeneration = String(publicManifest?.generationId || "");
const internalGeneration = String(internalManifest?.generationId || "");
const protectedGenerations = new Set([
  publicGeneration,
  ...(!EMERGENCY && internalGeneration ? [internalGeneration] : []),
  ...(!EMERGENCY ? generationIds.slice(0, KEEP_GENERATIONS) : []),
].filter(Boolean));

if (!publicGeneration || !generationIds.length) {
  const report = {
    version: 4,
    startedAt,
    finishedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    emergency: EMERGENCY,
    blocked: true,
    reason: "healthy_current_generation_not_confirmed",
    currentPublicGeneration: publicGeneration || null,
    currentInternalGeneration: internalGeneration || null,
    discoveredGenerations: generationIds.length,
  };
  await fs.writeFile(REPORT_FILE, JSON.stringify(report, null, 2));
  await writeDataJson("catalog/storage-cleanup-report.json", report).catch(() => undefined);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  const candidateGenerations = generationIds.filter((generationId) => {
    const timestamp = generationTimestamp(generationId);
    const oldEnough = EMERGENCY || (timestamp > 0 && timestamp < cutoff);
    return oldEnough && !protectedGenerations.has(generationId);
  });
  const candidateSet = new Set(candidateGenerations);
  const generationDeleteObjects = generationObjects.filter((object) => candidateSet.has(generationIdFromKey(object.key)));
  const protectedInternalPaths = new Set(Object.values(internalManifest?.sources || {})
    .flatMap((source) => Array.isArray(source?.chunks) ? source.chunks.map(String) : []));
  const internalDeleteObjects = internalObjects.filter((object) => {
    const key = String(object?.key || "");
    if (!key || protectedInternalPaths.has(key)) return false;
    return EMERGENCY || candidateGenerations.some((generationId) => key.includes(`/${generationId}-chunk-`));
  });
  // Emergency capacity recovery may remove fresh orphans, but it must still
  // preserve every gallery referenced by the current internal candidate pool.
  const liveImageKeys = await readLiveImageKeys(protectedGenerations, internalManifest, true);
  const imageDeleteObjects = imageObjects.filter((object) => {
    const modifiedAt = objectAge(object.lastModified);
    const oldEnough = EMERGENCY || (modifiedAt > 0 && modifiedAt < cutoff);
    return object.key && !liveImageKeys.has(object.key) && oldEnough;
  });
  const allDeleteObjects = [...generationDeleteObjects, ...internalDeleteObjects, ...imageDeleteObjects];
  const plannedDeletes = allDeleteObjects.length;
  const plannedBytes = objectBytes(allDeleteObjects);
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
    version: 4,
    startedAt,
    finishedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    emergency: EMERGENCY,
    blocked,
    blockReason: blocked ? `planned_deletes_${plannedDeletes}_exceed_${MAX_DELETES}` : "",
    graceMs: GRACE_MS,
    keepGenerations: KEEP_GENERATIONS,
    maximumDeletes: MAX_DELETES,
    currentPublicGeneration: publicGeneration,
    currentInternalGeneration: internalGeneration || null,
    protectedGenerations: [...protectedGenerations],
    candidateGenerations,
    discovered: {
      catalogObjects: catalogObjects.length,
      generations: generationIds.length,
      generationObjects: generationObjects.length,
      internalObjects: internalObjects.length,
      imageObjects: imageObjects.length,
      liveImages: liveImageKeys.size,
      bytes: {
        generations: objectBytes(generationObjects),
        internal: objectBytes(internalObjects),
        images: objectBytes(imageObjects),
        total: objectBytes([...generationObjects, ...internalObjects, ...imageObjects]),
      },
    },
    catalogInventory: {
      objects: catalogObjects.length,
      bytes: objectBytes(catalogObjects),
      accountedBytes: objectBytes([...generationObjects, ...internalObjects, ...imageObjects]),
      unaccountedBytes: Math.max(0, objectBytes(catalogObjects) - objectBytes([...generationObjects, ...internalObjects, ...imageObjects])),
      prefixes: objectPrefixSummary(catalogObjects).slice(0, 100),
    },
    namespaceInventory: {
      objects: namespaceObjects.length,
      bytes: objectBytes(namespaceObjects),
      catalogBytes: objectBytes(catalogObjects),
      nonCatalogBytes: Math.max(0, objectBytes(namespaceObjects) - objectBytes(catalogObjects)),
      prefixes: objectPrefixSummary(namespaceObjects).slice(0, 100),
    },
    planned: {
      generationObjects: generationDeleteObjects.length,
      internalObjects: internalDeleteObjects.length,
      images: imageDeleteObjects.length,
      total: plannedDeletes,
      bytes: plannedBytes,
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
  await writeDataJson("catalog/storage-cleanup-report.json", report).catch(() => undefined);
  console.log(JSON.stringify(report, null, 2));
  if (blocked || errors.length) process.exitCode = 1;
}
