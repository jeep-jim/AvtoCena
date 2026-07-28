import fs from "node:fs/promises";
import path from "node:path";

const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { persistCatalogOffers, readAllOffersForMaintenance, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const inputDir = process.env.CATALOG_REBUILD_INPUT_DIR || "catalog-rebuild";
const reportFile = process.env.CATALOG_REBUILD_PUBLISH_REPORT || "catalog-source-scale-publish-report.json";
const targetPerSource = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET_PER_SOURCE || 1_000));
const targetPerMarket = Math.max(1_000, Number(process.env.CATALOG_PUBLISH_TARGET_PER_MARKET || 1_000));
const maximumPerMarket = Math.max(targetPerMarket, Number(process.env.CATALOG_PUBLISH_MAX_PER_MARKET || 30_000));
const minimumImagesPerOffer = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 1));
const preferredImagesPerOffer = Math.max(minimumImagesPerOffer, Number(process.env.CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER || 6));
const retentionMs = Math.max(60_000, Number(process.env.CATALOG_OFFER_RETENTION_MS || 14 * 24 * 60 * 60 * 1_000));
const prepareConcurrency = Math.max(1, Math.min(32, Number(process.env.CATALOG_PUBLISH_PREPARE_CONCURRENCY || 16)));
const configuredMarkets = String(process.env.CATALOG_REBUILD_MARKETS || "").split(",").map((value) => value.trim()).filter(Boolean);
const markets = configuredMarkets.length ? configuredMarkets : [...PUBLIC_CATALOG_MARKETS];
const COMMERCIAL_RE = /\b(?:truck|dump|tipper|bus|minibus|kei\s*truck|commercial|cargo|lorry|tractor|forklift|excavator|machinery|canter|fighter|ranger|dutro|forward|giga|elf|profia|8\s*tonne|8\s*ton)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;

function imageKey(image) {
  return String(image?.checksum || image?.id || image?.objectKey || image?.url || "");
}

function freshness(offer) {
  return Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0;
}

function qualityOrder(left, right) {
  const leftPreferred = Number(left?.images?.length || 0) >= preferredImagesPerOffer ? 1 : 0;
  const rightPreferred = Number(right?.images?.length || 0) >= preferredImagesPerOffer ? 1 : 0;
  return rightPreferred - leftPreferred
    || Number(right?.images?.length || 0) - Number(left?.images?.length || 0)
    || freshness(right) - freshness(left)
    || String(left?.id || "").localeCompare(String(right?.id || ""));
}

function uniqueImages(images) {
  const seen = new Set();
  const result = [];
  for (const image of Array.isArray(images) ? images : []) {
    const key = imageKey(image);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(image);
    if (result.length >= 30) break;
  }
  return result;
}

function hasExactCalculation(offer) {
  const customs = offer?.calculationSnapshot?.customs;
  const breakdown = offer?.calculationSnapshot?.breakdown;
  if (customs?.status !== "ready" || !Number.isFinite(Number(customs?.totalCustomsRub))) return false;
  if (!Array.isArray(breakdown) || !breakdown.some((line) => line?.id === "car") || !breakdown.some((line) => line?.id === "customs")) return false;
  const kind = String(offer?.powertrainKind || "");
  if (!["electric", "series_hybrid", "other_hybrid"].includes(kind)) return true;
  if (Number(offer?.utilizationPowerKw || 0) > 0) return true;
  const motor30Min = Number(offer?.power30MinKw || 0)
    || (Array.isArray(offer?.power30MinKwByMotor)
      ? offer.power30MinKwByMotor.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0)
      : 0);
  return kind === "other_hybrid" ? motor30Min > 0 && Number(offer?.icePowerKw || 0) > 0 : motor30Min > 0;
}

function isCommercial(offer) {
  return COMMERCIAL_RE.test(`${offer?.make || ""} ${offer?.model || ""} ${offer?.trim || ""} ${offer?.bodyType || ""}`)
    || /^(?:Hino|Mitsubishi Fuso)$/i.test(String(offer?.make || ""));
}

async function generationFilesForMarket(market) {
  let names = [];
  try { names = await fs.readdir(inputDir); } catch { return []; }
  return names
    .filter((name) => name === `catalog-rebuild-${market}.json` || (name.startsWith(`catalog-rebuild-${market}-`) && name.endsWith(".json")))
    .map((name) => path.join(inputDir, name))
    .sort();
}

async function readGenerationFiles(market) {
  const filenames = await generationFilesForMarket(market);
  const payloads = [];
  const offers = [];
  const errors = [];
  for (const filename of filenames) {
    try {
      const parsed = JSON.parse(await fs.readFile(filename, "utf8"));
      if (!Array.isArray(parsed?.offers)) throw new Error("generation_offers_missing");
      if (parsed.market && parsed.market !== market) throw new Error(`generation_market_mismatch_${parsed.market}`);
      payloads.push(parsed);
      offers.push(...parsed.offers);
    } catch (error) {
      errors.push({ filename, error: String(error?.message || error) });
    }
  }
  return { available: payloads.length > 0, filenames, payloads, offers, errors };
}

async function runWithConcurrency(items, concurrency, worker) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

async function auditCandidate(sourceOffer, market) {
  try {
    if (!sourceOffer?.id || sourceOffer?.market !== market || isCommercial(sourceOffer)) return { offer: null, reason: "commercial_or_identity" };
    let offer = normalizeVehicleOfferSpecs({ ...sourceOffer, status: "active", images: uniqueImages(sourceOffer.images) });
    if (!offer.make || !offer.model || !Number.isFinite(Number(offer.year))) return { offer: null, reason: "specs" };
    if (!offer.operational?.sourceUrl || !Number.isFinite(Number(offer.sourcePrice)) || Number(offer.sourcePrice) <= 0) return { offer: null, reason: "source" };
    if (offer.images.length < minimumImagesPerOffer) return { offer: null, reason: "images" };
    offer = normalizeVehicleOfferSpecs(await calculateOfferWithRussiaCustoms(offer));
    const calculationStatus = String(offer.calculationStatus || "");
    const calculationPending = calculationStatus === "needs_data" || calculationStatus.startsWith("needs_");
    if (!hasExactCalculation(offer) && !calculationPending) return { offer: null, reason: "calculation" };
    if (!isCrediblePublicOffer(offer)) return { offer: null, reason: "quality" };
    return { offer, reason: "ok" };
  } catch (error) {
    return { offer: null, reason: `exception:${String(error?.message || error)}` };
  }
}

let internalRows = [];
try { internalRows = await readAllOffersForMaintenance(); } catch { internalRows = []; }
const cutoff = Date.now() - retentionMs;
const allSelected = [];
const files = [];
const byMarket = {};
const byMarketAndSource = {};
const marketQuality = {};
const marketReports = {};

for (const market of markets) {
  const generation = await readGenerationFiles(market);
  let publicRows = [];
  try { publicRows = await readMarketOffers(market); } catch { publicRows = []; }
  const retainedRows = [...publicRows, ...internalRows]
    .filter((offer) => offer?.market === market && ["active", "stale"].includes(String(offer?.status || "")) && freshness(offer) >= cutoff)
    .sort(qualityOrder);
  const freshRows = generation.offers
    .filter((offer) => String(offer?.operational?.galleryRebuiltFrom || "") === "fresh_listing")
    .sort(qualityOrder);
  const rebuiltRows = generation.offers
    .filter((offer) => String(offer?.operational?.galleryRebuiltFrom || "") !== "fresh_listing")
    .sort(qualityOrder);

  const origins = [["fresh", freshRows], ["rebuilt", rebuiltRows], ["retained", retainedRows]];
  const selected = [];
  const selectedIds = new Set();
  const imageOwners = new Map();
  const sourceCounts = new Map();
  const rejectionReasons = {};
  const originCounts = { fresh: 0, rebuilt: 0, retained: 0 };

  for (const [origin, rows] of origins) {
    const uniqueRows = [];
    const queued = new Set();
    for (const row of rows) {
      if (!row?.id || selectedIds.has(row.id) || queued.has(row.id)) continue;
      queued.add(row.id);
      uniqueRows.push(row);
    }
    for (let start = 0; start < uniqueRows.length && selected.length < maximumPerMarket; start += prepareConcurrency) {
      const batch = uniqueRows.slice(start, start + prepareConcurrency);
      const audited = await runWithConcurrency(batch, prepareConcurrency, (row) => auditCandidate(row, market));
      for (const result of audited) {
        if (!result?.offer) {
          const reason = result?.reason || "unknown";
          rejectionReasons[reason] = Number(rejectionReasons[reason] || 0) + 1;
          continue;
        }
        const offer = result.offer;
        if (selectedIds.has(offer.id)) continue;
        const sourceId = String(offer.sourceId || "unknown");
        if (Number(sourceCounts.get(sourceId) || 0) >= targetPerSource) {
          rejectionReasons.source_quota = Number(rejectionReasons.source_quota || 0) + 1;
          continue;
        }
        const ownedImages = offer.images.filter((image) => {
          const key = imageKey(image);
          const owner = imageOwners.get(key);
          return !owner || owner === offer.id;
        });
        if (ownedImages.length < minimumImagesPerOffer) {
          rejectionReasons.duplicate_images = Number(rejectionReasons.duplicate_images || 0) + 1;
          continue;
        }
        offer.images = ownedImages;
        selected.push(offer);
        selectedIds.add(offer.id);
        sourceCounts.set(sourceId, Number(sourceCounts.get(sourceId) || 0) + 1);
        for (const image of ownedImages) imageOwners.set(imageKey(image), offer.id);
        originCounts[origin]++;
        if (selected.length >= maximumPerMarket) break;
      }
    }
  }

  files.push(...generation.filenames);
  allSelected.push(...selected);
  byMarket[market] = selected.length;
  byMarketAndSource[market] = Object.fromEntries([...sourceCounts.entries()].sort(([left], [right]) => left.localeCompare(right)));
  marketReports[market] = generation.payloads.map((payload) => payload.report || payload);
  const imageCounts = selected.map((offer) => offer.images.length);
  marketQuality[market] = {
    target: targetPerMarket,
    targetReached: selected.length >= targetPerMarket,
    shortage: Math.max(0, targetPerMarket - selected.length),
    generationAvailable: generation.available,
    generationFiles: generation.filenames,
    generationErrors: generation.errors,
    generationPartial: generation.payloads.some((payload) => Boolean(payload.partial || payload.report?.partial)),
    generationStopReasons: generation.payloads.map((payload) => payload.stopReason || payload.report?.stopReason || "unknown"),
    freshCandidates: freshRows.length,
    rebuiltCandidates: rebuiltRows.length,
    retainedCandidates: retainedRows.length,
    published: selected.length,
    byOrigin: originCounts,
    publishedSources: sourceCounts.size,
    bySource: byMarketAndSource[market],
    rejectionReasons,
    minimumImages: imageCounts.length ? Math.min(...imageCounts) : 0,
    maximumImages: imageCounts.length ? Math.max(...imageCounts) : 0,
    averageImages: imageCounts.length ? Number((imageCounts.reduce((sum, count) => sum + count, 0) / imageCounts.length).toFixed(2)) : 0,
    preferredImagesShare: imageCounts.length ? Number((imageCounts.filter((count) => count >= preferredImagesPerOffer).length / imageCounts.length).toFixed(4)) : 0,
    retainedPreviousMarket: originCounts.retained > 0,
    temporarilyUnavailable: selected.length === 0,
  };
}

const unique = new Map();
for (const offer of allSelected) if (!unique.has(offer.id)) unique.set(offer.id, offer);
const offers = [...unique.values()];
const publishedAt = new Date().toISOString();
const emptyMarkets = markets.filter((market) => Number(byMarket[market] || 0) === 0);
let manifest = null;
let publicationError = "";

if (offers.length) {
  try {
    // Если один рынок полностью недоступен, его предыдущая проверенная версия не должна
    // исчезнуть из общего manifest из-за сбоя остальных источников.
    process.env.CATALOG_GROW_ONLY_MARKETS = emptyMarkets.join(",");
    manifest = await persistCatalogOffers(offers);
  } catch (error) {
    publicationError = String(error?.message || error);
  }
} else {
  publicationError = "no_verified_offers_keep_previous_manifest";
}

const marketsBelowTarget = markets.filter((market) => Number(byMarket[market] || 0) < targetPerMarket);
const report = {
  version: 22,
  mode: "atomic_all_markets_with_verified_accumulation",
  publishedAt,
  published: Boolean(manifest),
  publicationError,
  generationId: manifest?.generationId || null,
  previousManifestPreserved: !manifest,
  retentionMs,
  targetPerSource,
  targetPerMarket,
  maximumPerMarket,
  total: offers.length,
  byMarket,
  byMarketAndSource,
  volumeTargetReached: marketsBelowTarget.length === 0,
  marketsBelowTarget,
  emptyMarketsPreserved: emptyMarkets,
  files,
  missingGenerationMarkets: markets.filter((market) => !marketQuality[market]?.generationAvailable),
  partialGenerationMarkets: markets.filter((market) => marketQuality[market]?.generationPartial),
  marketQuality,
  marketReports,
};

await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
