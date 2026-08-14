import crypto from "node:crypto";
import fs from "node:fs/promises";
import { mutateDataJson } from "../apps/web/lib/data.ts";
import { catalogImportSources } from "../apps/web/lib/catalog/importer.ts";
import { credibleCatalogImages } from "../apps/web/lib/catalog/offer-quality.ts";
import { normalizeVehicleOfferSpecs } from "../apps/web/lib/catalog/spec-normalization.ts";
import { persistCatalogOffers, readAllOffersForMaintenance } from "../apps/web/lib/catalog/storage.ts";
import { enrichOfferWithVehicleKnowledge } from "../apps/web/lib/catalog/vehicle-knowledge.ts";

const TARGET_MARKET = "europe";
const SOURCE_ID = "autoscout_europe_open";
const PUBLIC_MARKETS = ["korea", "china", "japan", "uae", "europe", "georgia", "kyrgyzstan"];
const PRESERVED_MARKETS = PUBLIC_MARKETS.filter((market) => market !== TARGET_MARKET);
const EXACT_GALLERY_MODE = "autoscout_exact_detail_next_gallery_v2";
const maxOffers = Math.max(1, Number(process.env.CATALOG_EUROPE_HQ_MAX_OFFERS || 4000));
const concurrency = Math.min(8, Math.max(1, Number(process.env.CATALOG_EUROPE_HQ_CONCURRENCY || 4)));
const minImages = Math.max(5, Number(process.env.CATALOG_EUROPE_HQ_MIN_IMAGES || 5));
const maxImages = Math.min(30, Math.max(minImages, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
const reportFile = process.env.CATALOG_EUROPE_HQ_REPORT_FILE || "catalog-europe-hq-refresh-report.json";

function assertProductionStorage() {
  if (process.env.JSON_STORAGE_DRIVER !== "object") throw new Error("europe_hq_requires_object_storage");
  for (const name of ["YC_OBJECT_STORAGE_BUCKET", "YC_OBJECT_STORAGE_ACCESS_KEY_ID", "YC_OBJECT_STORAGE_SECRET_ACCESS_KEY"]) {
    if (!process.env[name]) throw new Error(`europe_hq_missing_${name}`);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function stableJson(value) { return JSON.stringify(canonical(value)); }
function sha(value) { return crypto.createHash("sha256").update(stableJson(value)).digest("hex"); }
function marketSnapshot(offers, market) {
  return offers.filter((offer) => String(offer.market) === market).sort((a, b) => String(a.id).localeCompare(String(b.id))).map(canonical);
}
function marketHashes(offers) {
  return Object.fromEntries(PUBLIC_MARKETS.map((market) => [market, { count: marketSnapshot(offers, market).length, sha256: sha(marketSnapshot(offers, market)) }]));
}
function sourceOfferId(offer) { return String(offer.sourceOfferId || "").trim(); }
function isListingBoundHqImage(image, offer) {
  const id = sourceOfferId(offer);
  const url = String(image?.url || "");
  if (!id || !url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== "prod.pictures.autoscout24.net") return false;
    if (!parsed.pathname.toLowerCase().startsWith(`/listing-images/${id}_`.toLowerCase())) return false;
  } catch { return false; }
  const width = Number(image?.width || 0);
  const height = Number(image?.height || 0);
  return width >= 900 && height >= 600;
}
function exactGalleryVerified(offer, images) {
  const operational = offer.operational || {};
  const raw = operational.raw && typeof operational.raw === "object" ? operational.raw : {};
  return operational.gallerySafetyMode === EXACT_GALLERY_MODE
    && operational.exactDetail === true
    && operational.exactPhotos === true
    && operational.photoIdentityVerified === true
    && operational.photoResolutionVerified === true
    && raw.listingBoundImages === true
    && raw.detailIdentityVerified === true
    && images.length >= minImages
    && images.every((image) => isListingBoundHqImage(image, offer));
}

assertProductionStorage();
const source = catalogImportSources.find((item) => item.sourceId === SOURCE_ID);
if (!source) throw new Error(`europe_hq_missing_source_${SOURCE_ID}`);

const operationId = `europe_hq_${crypto.randomUUID()}`;
const startedAt = new Date().toISOString();
const lockTtlMs = 15 * 60 * 1000;
let lockLost = false;

await mutateDataJson("catalog/import-lock.json", { lockedUntil: "" }, (current) => {
  if (current.lockedUntil && Date.parse(current.lockedUntil) > Date.now()) throw new Error("catalog_import_locked");
  return { operationId, lockedUntil: new Date(Date.now() + lockTtlMs).toISOString(), startedAt, kind: "europe_autoscout_hq_refresh" };
});
const refreshLock = async () => {
  await mutateDataJson("catalog/import-lock.json", { lockedUntil: "" }, (lock) => {
    if (lock.operationId !== operationId) {
      lockLost = true;
      return lock;
    }
    return { ...lock, lockedUntil: new Date(Date.now() + lockTtlMs).toISOString(), heartbeatAt: new Date().toISOString() };
  });
  if (lockLost) throw new Error("catalog_import_lock_lost");
};

const report = {
  operationId, startedAt, sourceId: SOURCE_ID, targetMarket: TARGET_MARKET, preservedMarkets: PRESERVED_MARKETS,
  baseline: {}, selected: 0, refreshed: 0, failed: 0, alreadyHq: 0, preservedPreflight: false, preservedPostflight: false,
  rows: [], productionSamples: [],
};

try {
  const baseline = await readAllOffersForMaintenance();
  report.baseline = marketHashes(baseline);
  if (!baseline.length) throw new Error("europe_hq_empty_catalog");

  // persistCatalogOffers normalizes/enriches every supplied offer. Prove before any write
  // that the six non-Europe markets are already a fixed point under that exact transform.
  const unsafe = [];
  let checked = 0;
  for (const offer of baseline) {
    if (!PRESERVED_MARKETS.includes(String(offer.market))) continue;
    const transformed = normalizeVehicleOfferSpecs(await enrichOfferWithVehicleKnowledge(structuredClone(offer)));
    if (stableJson(transformed) !== stableJson(offer)) {
      unsafe.push({ id: offer.id, market: offer.market, sourceId: offer.sourceId });
      if (unsafe.length >= 20) break;
    }
    checked++;
    if (checked % 250 === 0) await refreshLock();
  }
  if (unsafe.length) throw new Error(`non_europe_persist_transform_would_change:${JSON.stringify(unsafe)}`);
  report.preservedPreflight = true;

  const allEurope = baseline.filter((offer) => String(offer.market) === TARGET_MARKET && offer.status === "active");
  const invalidAge = allEurope.filter((offer) => Number(offer.year || 0) < 2020);
  if (invalidAge.length) throw new Error(`europe_age_guard_failed:${JSON.stringify(invalidAge.slice(0, 20).map((offer) => ({ id: offer.id, year: offer.year })))}`);

  const candidates = allEurope.filter((offer) => offer.sourceId === SOURCE_ID).slice(0, maxOffers);
  if (!candidates.length) throw new Error("europe_hq_no_autoscout_candidates");
  report.selected = candidates.length;
  const byId = new Map(baseline.map((offer) => [offer.id, offer]));
  let cursor = 0;

  const previousLimit = process.env.CATALOG_MAX_IMAGES_PER_OFFER;
  process.env.CATALOG_MAX_IMAGES_PER_OFFER = String(maxImages);
  try {
    const workers = Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= candidates.length) return;
        const original = candidates[index];
        const previous = credibleCatalogImages(Array.isArray(original.images) ? original.images : []);
        if (exactGalleryVerified(original, previous)) {
          report.alreadyHq++;
          report.rows.push({ id: original.id, sourceOfferId: original.sourceOfferId, before: previous.length, after: previous.length, alreadyHq: true, ok: true });
          continue;
        }
        const working = structuredClone(original);
        try {
          const fresh = credibleCatalogImages(await source.fetchImages(working));
          if (!exactGalleryVerified(working, fresh)) throw new Error(`autoscout_exact_hq_verification_failed:${working.id}:${fresh.length}`);
          const updated = {
            ...original,
            images: fresh.slice(0, maxImages),
            operational: {
              ...(original.operational || {}),
              ...(working.operational || {}),
              galleryRefreshedAt: new Date().toISOString(),
              galleryImageCount: fresh.length,
              gallerySourceImageCount: fresh.length,
              galleryReplaced: true,
            },
          };
          byId.set(updated.id, updated);
          report.refreshed++;
          report.rows.push({ id: updated.id, sourceOfferId: updated.sourceOfferId, before: previous.length, after: updated.images.length, ok: true });
        } catch (error) {
          report.failed++;
          report.rows.push({ id: original.id, sourceOfferId: original.sourceOfferId, before: previous.length, after: previous.length, ok: false, error: String(error?.message || error) });
        }
        if ((index + 1) % 20 === 0) {
          await refreshLock();
          console.log(`[europe-hq] ${index + 1}/${candidates.length}; refreshed=${report.refreshed}; failed=${report.failed}; already=${report.alreadyHq}`);
        }
      }
    });
    await Promise.all(workers);
  } finally {
    if (previousLimit === undefined) delete process.env.CATALOG_MAX_IMAGES_PER_OFFER;
    else process.env.CATALOG_MAX_IMAGES_PER_OFFER = previousLimit;
  }

  await refreshLock();
  if (report.refreshed <= 0 && report.alreadyHq <= 0) throw new Error("europe_hq_zero_verified_galleries");

  // Disable grow-only restoration for this one complete-snapshot publication. It can
  // otherwise reactivate historical Korea rows even when the supplied snapshot is unchanged.
  const previousGrowOnly = process.env.CATALOG_GROW_ONLY_MARKETS;
  process.env.CATALOG_GROW_ONLY_MARKETS = "";
  try {
    await persistCatalogOffers([...byId.values()]);
  } finally {
    if (previousGrowOnly === undefined) delete process.env.CATALOG_GROW_ONLY_MARKETS;
    else process.env.CATALOG_GROW_ONLY_MARKETS = previousGrowOnly;
  }

  const after = await readAllOffersForMaintenance();
  const afterHashes = marketHashes(after);
  report.after = afterHashes;
  const changedPreserved = PRESERVED_MARKETS.filter((market) => report.baseline[market].sha256 !== afterHashes[market].sha256 || report.baseline[market].count !== afterHashes[market].count);
  if (changedPreserved.length) throw new Error(`non_europe_changed_after_publish:${JSON.stringify(changedPreserved.map((market) => ({ market, before: report.baseline[market], after: afterHashes[market] })))}`);
  report.preservedPostflight = true;

  const updatedIds = new Set(report.rows.filter((row) => row.ok && !row.alreadyHq).map((row) => row.id));
  const verifiedAfter = after.filter((offer) => updatedIds.has(offer.id));
  const invalidAfter = verifiedAfter.filter((offer) => !exactGalleryVerified(offer, credibleCatalogImages(offer.images || [])));
  if (invalidAfter.length) throw new Error(`europe_hq_postpersist_verification_failed:${JSON.stringify(invalidAfter.slice(0, 20).map((offer) => offer.id))}`);

  report.productionSamples = verifiedAfter.slice(0, 20).map((offer) => ({
    id: offer.id,
    sourceOfferId: offer.sourceOfferId,
    sourceUrl: offer.operational?.sourceUrl,
    year: offer.year,
    imageCount: offer.images?.length || 0,
    firstImage: offer.images?.[0]?.url || "",
    width: offer.images?.[0]?.width,
    height: offer.images?.[0]?.height,
    gallerySafetyMode: offer.operational?.gallerySafetyMode,
  }));
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.parse(report.finishedAt) - Date.parse(startedAt);
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = String(error?.message || error);
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
  throw error;
} finally {
  await mutateDataJson("catalog/import-lock.json", { lockedUntil: "" }, (lock) => lock.operationId === operationId
    ? { operationId, lockedUntil: "", finishedAt: new Date().toISOString(), kind: "europe_autoscout_hq_refresh" }
    : lock);
}
