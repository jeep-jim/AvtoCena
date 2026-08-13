import crypto from "node:crypto";
import fs from "node:fs";
import { mutateDataJson } from "../apps/web/lib/data";
import { autoscoutEuropeCurrentSource } from "../apps/web/lib/catalog/autoscout-current-source";
import { normalizeVehicleOfferSpecs } from "../apps/web/lib/catalog/spec-normalization";
import { enrichOfferWithVehicleKnowledge } from "../apps/web/lib/catalog/vehicle-knowledge";
import { persistCatalogOffers, readAllOffersForMaintenance } from "../apps/web/lib/catalog/storage";
import type { CatalogImage, VehicleOffer } from "../apps/web/lib/catalog/types";

const PUBLIC_MARKETS = ["korea", "china", "japan", "uae", "europe", "georgia", "kyrgyzstan"] as const;
const TARGET_MARKET = "europe";
const TARGET_SOURCE = "autoscout_europe_open";
const REPORT_FILE = process.env.EUROPE_HQ_REPORT_FILE || "europe-autoscout-hq-refresh-report.json";
const MAX_TARGETS = Math.max(1, Number(process.env.EUROPE_HQ_MAX_TARGETS || 500));
const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.EUROPE_HQ_CONCURRENCY || 3)));
const operationId = `europe_hq_${crypto.randomUUID()}`;
const startedAt = new Date().toISOString();

function canonicalize(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}
function canonical(value: any) { return JSON.stringify(canonicalize(value)); }
function hash(value: any) { return crypto.createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex"); }
function sortedOffers(offers: VehicleOffer[]) { return [...offers].sort((a, b) => String(a.id).localeCompare(String(b.id))); }
function offerDigest(offers: VehicleOffer[]) { return hash(sortedOffers(offers)); }
function imageDigest(offers: VehicleOffer[]) { return hash(sortedOffers(offers).map((offer) => ({ id: offer.id, images: offer.images || [] }))); }
function marketSummary(offers: VehicleOffer[]) {
  return Object.fromEntries(PUBLIC_MARKETS.map((market) => {
    const rows = offers.filter((offer) => offer.market === market);
    return [market, { count: rows.length, digest: offerDigest(rows), imageDigest: imageDigest(rows), idsDigest: hash(rows.map((offer) => offer.id).sort()) }];
  }));
}
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function galleryNeutral(offer: VehicleOffer) {
  const clone: any = structuredClone(offer);
  delete clone.images;
  const operational = clone.operational || {};
  for (const key of ["exactDetail", "exactPhotos", "galleryVerified", "galleryImageCount", "gallerySafetyMode", "galleryStoredAs", "photoIdentityVerified", "photoResolutionVerified"]) delete operational[key];
  if (operational.raw && typeof operational.raw === "object") {
    for (const key of ["detailImages", "listingBoundImages", "photoIdentityVerified", "photoResolutionVerified", "detailIdentityVerified"]) delete operational.raw[key];
  }
  clone.operational = operational;
  return clone;
}

function validateAutoScoutGallery(offer: VehicleOffer, images: CatalogImage[]) {
  const sourceOfferId = String(offer.sourceOfferId || "").trim();
  if (Number(offer.year || 0) < 2020) throw new Error(`autoscout_year_guard:${offer.id}:${offer.year}`);
  if (!sourceOfferId) throw new Error(`autoscout_missing_source_offer_id:${offer.id}`);
  if (images.length < 5 || images.length > 30) throw new Error(`autoscout_gallery_count:${offer.id}:${images.length}`);
  for (const image of images) {
    const url = String(image.url || "");
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error(`autoscout_bad_image_url:${offer.id}`); }
    if (parsed.hostname.toLowerCase() !== "prod.pictures.autoscout24.net") throw new Error(`autoscout_foreign_image:${offer.id}:${parsed.hostname}`);
    if (!parsed.pathname.toLowerCase().startsWith(`/listing-images/${sourceOfferId.toLowerCase()}_`)) throw new Error(`autoscout_cross_listing_image:${offer.id}`);
    if (Number(image.width || 0) < 900 || Number(image.height || 0) < 600) throw new Error(`autoscout_low_resolution:${offer.id}:${image.width}x${image.height}`);
  }
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function fetchHq(original: VehicleOffer) {
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const offer = structuredClone(original);
    try {
      const images = await autoscoutEuropeCurrentSource.fetchImages(offer);
      validateAutoScoutGallery(offer, images);
      offer.images = images;
      return { ok: true as const, offer, attempts: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 3) await sleep(attempt * 1200);
    }
  }
  return { ok: false as const, offer: original, attempts: 3, error: lastError };
}

async function publicMarketSnapshot(market: string) {
  const url = `https://avtocena.com/api/catalog/search?market=${encodeURIComponent(market)}&pageSize=50&page=1&sort=updatedAt&_hqcheck=${Date.now()}`;
  const response = await fetch(url, { headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`production_search_${market}_${response.status}`);
  const data: any = await response.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  return {
    total: Number(data?.total || items.length),
    sample: items.slice(0, 20).map((item: any) => ({ id: item.id, year: item.year, cardImageUrl: item.cardImageUrl || item.images?.[0]?.url || "", updatedAt: item.updatedAt })),
  };
}

async function fetchAllPublicEurope(maxPages = 12) {
  const all: any[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://avtocena.com/api/catalog/search?market=europe&pageSize=100&page=${page}&sort=updatedAt&_hqcheck=${Date.now()}-${page}`;
    const response = await fetch(url, { headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`production_europe_search_${response.status}`);
    const data: any = await response.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    all.push(...items);
    const total = Number(data?.total || all.length);
    if (!items.length || all.length >= total) break;
  }
  return all;
}

function isOldLowQuality(offer: VehicleOffer) {
  const sourceOfferId = String(offer.sourceOfferId || "").toLowerCase();
  const images = offer.images || [];
  if (images.length < 5) return true;
  return images.some((image) => {
    const url = String(image.url || "");
    return !url.toLowerCase().includes(`/listing-images/${sourceOfferId}_`) || Number(image.width || 0) < 900 || Number(image.height || 0) < 600;
  });
}

async function assertPersistenceNormalizationIsNeutral(offers: VehicleOffer[]) {
  const changed: Array<{ id: string; market: string; sourceId: string }> = [];
  await mapLimit(offers, 20, async (offer) => {
    const normalized = normalizeVehicleOfferSpecs(await enrichOfferWithVehicleKnowledge(structuredClone(offer)));
    if (canonical(galleryNeutral(normalized)) !== canonical(galleryNeutral(offer))) {
      if (changed.length < 25) changed.push({ id: offer.id, market: String(offer.market), sourceId: offer.sourceId });
    }
    return null;
  });
  if (changed.length) throw new Error(`persist_normalization_would_change_non_gallery_fields:${JSON.stringify(changed)}`);
}

async function main() {
  if (process.env.JSON_STORAGE_DRIVER !== "object") throw new Error("production_object_storage_required");
  await mutateDataJson<any>("catalog/import-lock.json", { lockedUntil: "" }, (current) => {
    if (current.lockedUntil && Date.parse(current.lockedUntil) > Date.now()) throw new Error(`catalog_import_locked:${current.operationId || "unknown"}`);
    return { operationId, kind: "europe_autoscout_hq_gallery", lockedUntil: new Date(Date.now() + 55 * 60_000).toISOString(), startedAt };
  });

  let persisted = false;
  let originalSnapshot: VehicleOffer[] = [];
  try {
    originalSnapshot = await readAllOffersForMaintenance();
    const beforeSummary = marketSummary(originalSnapshot);
    const productionBefore = Object.fromEntries(await Promise.all(PUBLIC_MARKETS.map(async (market) => [market, await publicMarketSnapshot(market)])));
    const targets = originalSnapshot
      .filter((offer) => offer.market === TARGET_MARKET && offer.sourceId === TARGET_SOURCE && offer.status === "active" && Number(offer.year || 0) >= 2020)
      .slice(0, MAX_TARGETS);
    if (!targets.length) throw new Error("no_active_autoscout_europe_targets");
    if (targets.length >= MAX_TARGETS) throw new Error(`target_limit_reached:${targets.length}:${MAX_TARGETS}`);

    await assertPersistenceNormalizationIsNeutral(originalSnapshot);

    const preflight = await mapLimit(targets.slice(0, Math.min(3, targets.length)), 1, async (offer) => fetchHq(offer));
    if (preflight.some((result) => !result.ok)) throw new Error(`autoscout_hq_preflight_failed:${JSON.stringify(preflight)}`);

    const refreshedResults = await mapLimit(targets, CONCURRENCY, async (offer) => fetchHq(offer));
    const failures = refreshedResults.filter((result) => !result.ok);
    if (failures.length) throw new Error(`autoscout_hq_refresh_incomplete:${failures.length}/${targets.length}:${JSON.stringify(failures.slice(0, 10))}`);

    const updatedById = new Map(originalSnapshot.map((offer) => [offer.id, offer] as const));
    for (const result of refreshedResults) if (result.ok) updatedById.set(result.offer.id, result.offer);
    const planned = [...updatedById.values()];

    const currentBeforePersist = await readAllOffersForMaintenance();
    if (offerDigest(currentBeforePersist) !== offerDigest(originalSnapshot)) throw new Error("catalog_changed_concurrently_before_persist");

    const nonTargetsBefore = originalSnapshot.filter((offer) => !(offer.market === TARGET_MARKET && offer.sourceId === TARGET_SOURCE && offer.status === "active" && Number(offer.year || 0) >= 2020));
    const nonTargetsPlanned = planned.filter((offer) => !(offer.market === TARGET_MARKET && offer.sourceId === TARGET_SOURCE && offer.status === "active" && Number(offer.year || 0) >= 2020));
    if (offerDigest(nonTargetsBefore) !== offerDigest(nonTargetsPlanned)) throw new Error("planned_non_target_change_detected");

    const targetCoreBefore = targets.map(galleryNeutral);
    const targetCoreAfter = refreshedResults.filter((r) => r.ok).map((r: any) => galleryNeutral(r.offer));
    if (hash(targetCoreBefore.sort((a: any, b: any) => a.id.localeCompare(b.id))) !== hash(targetCoreAfter.sort((a: any, b: any) => a.id.localeCompare(b.id)))) throw new Error("target_non_gallery_change_detected");

    await mutateDataJson<any>("catalog/import-lock.json", { lockedUntil: "" }, (lock) => lock.operationId === operationId
      ? { ...lock, lockedUntil: new Date(Date.now() + 55 * 60_000).toISOString(), heartbeatAt: new Date().toISOString() }
      : lock);
    await persistCatalogOffers(planned);
    persisted = true;

    const after = await readAllOffersForMaintenance();
    const nonTargetsAfter = after.filter((offer) => !(offer.market === TARGET_MARKET && offer.sourceId === TARGET_SOURCE && offer.status === "active" && Number(offer.year || 0) >= 2020));
    if (offerDigest(nonTargetsAfter) !== offerDigest(nonTargetsBefore)) {
      await persistCatalogOffers(originalSnapshot);
      persisted = false;
      throw new Error("postpersist_non_target_change_detected_rolled_back");
    }

    const afterTargetMap = new Map(after.filter((offer) => offer.market === TARGET_MARKET && offer.sourceId === TARGET_SOURCE).map((offer) => [offer.id, offer] as const));
    for (const original of targets) {
      const updated = afterTargetMap.get(original.id);
      if (!updated) {
        await persistCatalogOffers(originalSnapshot);
        persisted = false;
        throw new Error(`postpersist_target_missing_rolled_back:${original.id}`);
      }
      validateAutoScoutGallery(updated, updated.images || []);
      if (canonical(galleryNeutral(updated)) !== canonical(galleryNeutral(original))) {
        await persistCatalogOffers(originalSnapshot);
        persisted = false;
        throw new Error(`postpersist_target_core_changed_rolled_back:${original.id}`);
      }
    }

    const sampleTargets = targets.slice(0, Math.min(8, targets.length));
    let productionEurope: any[] = [];
    let productionVerified = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      if (attempt) await sleep(10000);
      productionEurope = await fetchAllPublicEurope();
      const byId = new Map(productionEurope.map((item: any) => [item.id, item]));
      productionVerified = sampleTargets.every((target) => {
        const item: any = byId.get(target.id);
        const imageUrl = String(item?.cardImageUrl || item?.images?.[0]?.url || "");
        return imageUrl.includes("prod.pictures.autoscout24.net/listing-images/") && imageUrl.toLowerCase().includes(String(target.sourceOfferId || "").toLowerCase());
      });
      if (productionVerified) break;
    }
    if (!productionVerified) {
      await persistCatalogOffers(originalSnapshot);
      persisted = false;
      throw new Error("production_europe_cards_did_not_converge_to_listing_bound_hq_rolled_back");
    }

    const productionAfter = Object.fromEntries(await Promise.all(PUBLIC_MARKETS.map(async (market) => [market, await publicMarketSnapshot(market)])));
    for (const market of PUBLIC_MARKETS.filter((market) => market !== TARGET_MARKET)) {
      if (canonical(productionBefore[market]) !== canonical(productionAfter[market])) {
        await persistCatalogOffers(originalSnapshot);
        persisted = false;
        throw new Error(`production_non_europe_changed_rolled_back:${market}`);
      }
    }

    const afterSummary = marketSummary(after);
    const report = {
      ok: true,
      operationId,
      startedAt,
      finishedAt: new Date().toISOString(),
      target: { market: TARGET_MARKET, sourceId: TARGET_SOURCE, minimumYear: 2020, minimumImages: 5, minimumResolution: "900x600", maxImages: 30 },
      safety: {
        importLockHeld: true,
        persistenceNormalizationNeutral: true,
        concurrentChangeCheck: true,
        nonTargetDigestUnchanged: offerDigest(nonTargetsBefore) === offerDigest(nonTargetsAfter),
        allMarketBefore: beforeSummary,
        allMarketAfter: afterSummary,
        productionNonEuropeFirstPageUnchanged: true,
      },
      refresh: {
        targets: targets.length,
        targetsNeedingUpgradeBefore: targets.filter(isOldLowQuality).length,
        refreshed: refreshedResults.length,
        failed: 0,
        retriesUsed: refreshedResults.filter((r: any) => r.attempts > 1).length,
      },
      production: {
        site: "https://avtocena.com",
        europeSampleVerified: sampleTargets.map((target) => {
          const item: any = productionEurope.find((row: any) => row.id === target.id);
          return { id: target.id, sourceOfferId: target.sourceOfferId, year: target.year, sourceUrl: target.operational?.sourceUrl, cardImageUrl: item?.cardImageUrl || item?.images?.[0]?.url || "", storedImages: afterTargetMap.get(target.id)?.images?.length || 0 };
        }),
        marketSnapshotsBefore: productionBefore,
        marketSnapshotsAfter: productionAfter,
      },
    };
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await mutateDataJson<any>("catalog/import-lock.json", { lockedUntil: "" }, (lock) => lock.operationId === operationId
      ? { operationId, kind: "europe_autoscout_hq_gallery", lockedUntil: "", finishedAt: new Date().toISOString(), persisted }
      : lock);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
