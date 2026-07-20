import fs from "node:fs/promises";

const { getJsonStorage, readDataJson, writeDataJson } = await import("../apps/web/lib/data.ts");
const { importCatalog } = await import("../apps/web/lib/catalog/importer.ts");
const { offerPath, persistCatalogOffers, readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");

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

function decodeMarkup(value) {
  return String(value || "")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u0022/gi, '"')
    .replace(/\\\//g, "/")
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function mileageNumber(value) {
  const text = String(value ?? "").trim();
  if (!/[0-9]/.test(text)) return undefined;
  const number = Number(text.replace(/[^0-9]/g, ""));
  return Number.isFinite(number) && number > 0 && number <= 5_000_000 ? number : undefined;
}

function parseEuropeMileage(markup) {
  const decoded = decodeMarkup(markup);
  const plain = decoded
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\s\u00a0\u202f]+/g, " ")
    .trim();

  const structured = [
    decoded.match(/["']mileageFromOdometer["']\s*:\s*\{[\s\S]{0,500}?["'](?:value|amount)["']\s*:\s*["']?([0-9][0-9 .\u00a0\u202f]{0,14})/i)?.[1],
    decoded.match(/["'](?:mileageKm|mileage|odometer|kilometers|kilometres|przebieg)["']\s*:\s*["']?([0-9][0-9 .\u00a0\u202f]{0,14})/i)?.[1],
    decoded.match(/["'](?:key|code|name|label)["']\s*:\s*["'](?:mileageKm|mileage|mileageFromOdometer|odometer|kilometers|kilometres|przebieg|quilometragem)["'][\s\S]{0,360}?["'](?:value|amount|text)["']\s*:\s*["']?([0-9][0-9 .\u00a0\u202f]{0,14})/i)?.[1],
  ];
  for (const candidate of structured) {
    const mileage = mileageNumber(candidate);
    if (mileage !== undefined) return mileage;
  }

  const labels = [
    "Przebieg",
    "Mileage",
    "Quilómetros",
    "Quilometros",
    "Quilometragem",
    "Kilometerstand",
    "Laufleistung",
    "Kilométrage",
    "Chilometraggio",
    "Kilometers",
    "Kilometres",
  ].join("|");
  const labeled = plain.match(new RegExp(`(?:${labels})\\s*[:：]?\\s*([0-9][0-9 .\\u00a0\\u202f]{0,14})\\s*(?:km|км)\\b`, "i"))?.[1];
  const labeledMileage = mileageNumber(labeled);
  if (labeledMileage !== undefined) return labeledMileage;

  const values = [];
  for (const match of plain.matchAll(/\b([0-9][0-9 .\u00a0\u202f]{0,14})\s*(?:km|км)\b/gi)) {
    const context = plain.slice(Math.max(0, (match.index || 0) - 22), match.index || 0);
    if (/(?:l|kwh|g|mi)\s*\/\s*100\s*$/i.test(context) || /(?:km\/h|км\/ч)\s*$/i.test(context)) continue;
    const mileage = mileageNumber(match[1]);
    if (mileage !== undefined) values.push(mileage);
  }
  return values.length ? Math.max(...values) : undefined;
}

async function fetchMarkup(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 60_000));
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "accept-language": "pl-PL,pt-PT,de-DE,en;q=0.8",
        "cache-control": "no-cache",
        pragma: "no-cache",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: response.status, markup: "" };
    return { ok: true, status: response.status, markup: await response.text() };
  } catch (error) {
    return { ok: false, status: 0, markup: "", error: String(error?.message || error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function repairEuropeMileage() {
  const offers = await readAllOffersForMaintenance();
  const targets = offers.filter((offer) => offer?.market === "europe"
    && offer?.status === "active"
    && Number(offer?.mileageKm || 0) <= 0
    && String(offer?.operational?.sourceUrl || "").startsWith("http"));
  const concurrency = Math.max(1, Math.min(10, Number(process.env.CATALOG_EUROPE_MILEAGE_CONCURRENCY || 5)));
  let cursor = 0;
  let updated = 0;
  let failed = 0;
  const unresolved = [];
  const repairedAt = new Date().toISOString();

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, targets.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= targets.length) return;
      const offer = targets[index];
      const sourceUrl = String(offer.operational.sourceUrl || "");
      const result = await fetchMarkup(sourceUrl);
      const mileage = result.ok ? parseEuropeMileage(result.markup) : undefined;
      if (mileage !== undefined) {
        offer.mileageKm = mileage;
        offer.updatedAt = repairedAt;
        offer.operational = {
          ...offer.operational,
          mileageRepairedAt: repairedAt,
          raw: typeof offer.operational?.raw === "object" && offer.operational.raw
            ? { ...offer.operational.raw, mileageKm: mileage }
            : offer.operational?.raw,
        };
        updated++;
      } else {
        failed++;
        if (unresolved.length < 20) unresolved.push({ id: offer.id, sourceUrl, status: result.status, error: result.error });
      }
      if ((index + 1) % 10 === 0 || index + 1 === targets.length) {
        console.log(`[europe-mileage] ${Math.min(index + 1, targets.length)}/${targets.length}; updated=${updated}; unresolved=${failed}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }));

  if (updated > 0) {
    const previousGrowOnly = process.env.CATALOG_GROW_ONLY_MARKETS;
    process.env.CATALOG_GROW_ONLY_MARKETS = "";
    try { await persistCatalogOffers(offers); }
    finally {
      if (previousGrowOnly === undefined) delete process.env.CATALOG_GROW_ONLY_MARKETS;
      else process.env.CATALOG_GROW_ONLY_MARKETS = previousGrowOnly;
    }
  }

  const remaining = offers.filter((offer) => offer?.market === "europe" && offer?.status === "active" && Number(offer?.mileageKm || 0) <= 0).length;
  const report = { attempted: targets.length, updated, unresolved: failed, remaining, samples: unresolved };
  console.log(JSON.stringify({ europeMileageRepair: report }, null, 2));
  if (targets.length > 0 && updated === 0) throw new Error(`europe_mileage_repair_saved_zero_of_${targets.length}`);
  return report;
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
const europeMileageRepair = await repairEuropeMileage();

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
  europeMileageRepair,
  retentionDays: RETENTION_MS / 86_400_000,
  retainedGenerations: retained.map((entry) => entry.generationId),
  pruned,
  sources: importReport.sources,
};
await fs.writeFile(REPORT_FILE, JSON.stringify(finalReport, null, 2), "utf8");
console.log(JSON.stringify(finalReport, null, 2));
