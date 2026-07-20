import fs from "node:fs/promises";

const { getJsonStorage, readDataJson, writeDataJson } = await import("../apps/web/lib/data.ts");
const { importCatalog } = await import("../apps/web/lib/catalog/importer.ts");
const { offerPath } = await import("../apps/web/lib/catalog/storage.ts");

const HISTORY_PATH = "catalog/history/daily-generations.json";
const RETENTION_MS = Math.max(86_400_000, Number(process.env.CATALOG_GENERATION_RETENTION_MS || 3 * 86_400_000));
const REPORT_FILE = process.env.CATALOG_DAILY_LOCAL_REPORT || "catalog-daily-report.json";
const DEFAULT_SOURCE_IDS = [
  "encar_direct",
  "guazi_china_export",
  "che168_china_exact",
  "goonet_japan_exact",
  "beforward_japan",
  "dubicars_uae_exact",
  "beforward_uae",
  "otomoto_europe_exact",
  "beforward_uk",
  "beforward_belgium",
];
const requestedSourceIds = String(process.env.CATALOG_DAILY_SOURCE_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const SOURCE_IDS = requestedSourceIds.length ? requestedSourceIds : DEFAULT_SOURCE_IDS;

function cleanShard(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
}

function budgetBucket(value) {
  const number = Number(value || 0);
  return number > 0 ? String(Math.ceil(number / 500_000) * 500_000) : "unknown";
}

function snapshot(publicManifest, internalManifest) {
  if (!publicManifest?.generationId) return null;
  return {
    generationId: String(publicManifest.generationId),
    updatedAt: String(publicManifest.updatedAt || new Date().toISOString()),
    publicManifest,
    internalManifest: internalManifest?.generationId === publicManifest.generationId ? internalManifest : null,
  };
}

function mergeHistory(rows, entries) {
  const byGeneration = new Map();
  for (const row of [...(Array.isArray(rows) ? rows : []), ...entries]) {
    if (!row?.generationId) continue;
    const current = byGeneration.get(String(row.generationId));
    if (!current || Date.parse(String(row.updatedAt || "")) >= Date.parse(String(current.updatedAt || ""))) {
      byGeneration.set(String(row.generationId), row);
    }
  }
  return [...byGeneration.values()].sort((left, right) => Date.parse(String(left.updatedAt || "")) - Date.parse(String(right.updatedAt || "")));
}

async function deleteJson(storage, path) {
  try { await storage.deleteJson?.(path); } catch (error) { console.warn(`[retention] could not delete ${path}: ${String(error?.message || error)}`); }
}

async function deleteGeneration(storage, entry) {
  const generationId = String(entry?.generationId || "");
  const manifest = entry?.publicManifest;
  if (!generationId || !manifest?.markets) return { generationId, deleted: false, reason: "manifest_snapshot_missing" };

  const offers = [];
  for (const [market, meta] of Object.entries(manifest.markets || {})) {
    for (const chunk of Array.isArray(meta?.chunks) ? meta.chunks : []) {
      const path = offerPath(generationId, market, chunk);
      const rows = await readDataJson(path, []);
      if (Array.isArray(rows)) offers.push(...rows);
      await deleteJson(storage, path);
    }
  }

  const staticIndexes = [
    "indexes/offers-by-id.json",
    "indexes/images-by-id.json",
    "indexes/facets.json",
    "indexes/order-updatedAt.json",
  ];
  for (const path of staticIndexes) await deleteJson(storage, `catalog/generations/${generationId}/${path}`);

  const shards = new Map();
  const add = (name, value) => {
    const key = cleanShard(value);
    shards.set(`${name}/${key}`, true);
  };
  for (const offer of offers) {
    const make = String(offer?.make || "").trim();
    const model = String(offer?.model || "").trim();
    add("market", offer?.market);
    add("make", make);
    add("model", `${make}:${model}`);
    add("year", offer?.year);
    add("budget", budgetBucket(offer?.totalRub));
    add("fuel", offer?.fuel);
    add("body", offer?.bodyType);
    add("transmission", offer?.transmission);
    add("drive", offer?.drive);
    add("hasPrice", offer?.totalRub ? "yes" : "no");
  }
  for (const shard of shards.keys()) await deleteJson(storage, `catalog/generations/${generationId}/indexes/${shard}.json`);

  const internalManifest = entry?.internalManifest;
  if (internalManifest?.sources) {
    for (const source of Object.values(internalManifest.sources)) {
      for (const path of Array.isArray(source?.chunks) ? source.chunks : []) await deleteJson(storage, path);
    }
  }

  return { generationId, deleted: true, offers: offers.length };
}

const storage = getJsonStorage();
const beforePublic = await readDataJson("catalog/manifest.json", null);
const beforeInternal = await readDataJson("catalog/internal/manifest.json", null);
const historyBefore = await readDataJson(HISTORY_PATH, []);
const beforeSnapshot = snapshot(beforePublic, beforeInternal);
if (beforeSnapshot) await writeDataJson(HISTORY_PATH, mergeHistory(historyBefore, [beforeSnapshot]));

console.log(`[daily] sources: ${SOURCE_IDS.join(", ")}`);
const importReport = await importCatalog({
  sourceIds: SOURCE_IDS,
  maxOffers: 250,
  maxDetails: 250,
  maxImagesPerOffer: 30,
  maxPages: 250,
  requireObjectStorage: true,
  failOnZeroSaved: false,
  reportPath: "catalog/imports/daily-latest.json",
});

const afterPublic = await readDataJson("catalog/manifest.json", null);
const afterInternal = await readDataJson("catalog/internal/manifest.json", null);
const afterSnapshot = snapshot(afterPublic, afterInternal);
const mergedHistory = mergeHistory(await readDataJson(HISTORY_PATH, []), [beforeSnapshot, afterSnapshot].filter(Boolean));
const cutoff = Date.now() - RETENTION_MS;
const currentGeneration = String(afterPublic?.generationId || "");
const retained = [];
const pruned = [];

for (const entry of mergedHistory) {
  const updatedAt = Date.parse(String(entry?.updatedAt || ""));
  const keep = entry.generationId === currentGeneration || !Number.isFinite(updatedAt) || updatedAt >= cutoff;
  if (keep) retained.push(entry);
  else pruned.push(await deleteGeneration(storage, entry));
}

await writeDataJson(HISTORY_PATH, retained);
const finalReport = {
  ok: true,
  startedAt: importReport.startedAt,
  finishedAt: new Date().toISOString(),
  generationId: currentGeneration,
  requestedSourceIds: SOURCE_IDS,
  publicOffers: importReport.publicOffers,
  publicByMarket: importReport.publicByMarket,
  imported: importReport.imported,
  updated: importReport.updated,
  reusedImageSets: importReport.reusedImageSets,
  imageFailures: importReport.imageFailures,
  retentionDays: RETENTION_MS / 86_400_000,
  retainedGenerations: retained.map((entry) => entry.generationId),
  pruned,
  sources: importReport.sources,
};
await fs.writeFile(REPORT_FILE, JSON.stringify(finalReport, null, 2), "utf8");
console.log(JSON.stringify(finalReport, null, 2));
