import fs from "node:fs/promises";
import path from "node:path";

const { isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { persistCatalogOffers, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { CATALOG_DAILY_TARGET_PER_MARKET, PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const inputDir = process.env.CATALOG_REBUILD_INPUT_DIR || "catalog-rebuild";
const target = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET || CATALOG_DAILY_TARGET_PER_MARKET));
const minimumImagesPerOffer = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 1));
const minimumSpecScore = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_SPEC_SCORE || 1));
const configuredMarkets = String(process.env.CATALOG_REBUILD_MARKETS || "").split(",").map((value) => value.trim()).filter(Boolean);
const markets = configuredMarkets.length ? configuredMarkets : [...PUBLIC_CATALOG_MARKETS];
const all = [];
const files = [];
const byMarket = {};
const reports = {};
const marketQuality = {};

function imageKey(image) {
  return String(image?.checksum || image?.id || image?.objectKey || image?.url || "");
}

function specScore(offer) {
  const mileage = Number(offer?.mileageKm);
  return Number.isFinite(mileage) && mileage >= 0 ? 1 : 0;
}

function freshness(offer) {
  return Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0;
}

function qualityOrder(left, right) {
  return freshness(right) - freshness(left)
    || Number(right?.images?.length || 0) - Number(left?.images?.length || 0)
    || String(left?.id || "").localeCompare(String(right?.id || ""));
}

function auditCandidate(sourceOffer, market, selectedIds, imageOwners) {
  if (sourceOffer?.market !== market || selectedIds.has(sourceOffer?.id) || !isCrediblePublicOffer(sourceOffer)) return null;
  const localSeen = new Set();
  const images = [];
  for (const image of Array.isArray(sourceOffer.images) ? sourceOffer.images : []) {
    const key = imageKey(image);
    if (!key || localSeen.has(key)) continue;
    localSeen.add(key);
    const owner = imageOwners.get(key);
    if (owner && owner !== sourceOffer.id) continue;
    images.push(image);
  }
  const offer = { ...sourceOffer, status: "active", images };
  if (images.length < minimumImagesPerOffer || specScore(offer) < minimumSpecScore || !isCrediblePublicOffer(offer)) return null;
  return offer;
}

async function readGenerationFile(filename, market) {
  try {
    const raw = await fs.readFile(filename, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.offers)) throw new Error("generation_offers_missing");
    if (parsed.market && parsed.market !== market) throw new Error(`generation_market_mismatch_${parsed.market}`);
    return {
      available: true,
      payload: parsed,
      offers: parsed.offers,
      error: "",
    };
  } catch (error) {
    return {
      available: false,
      payload: null,
      offers: [],
      error: String(error?.message || error),
    };
  }
}

for (const market of markets) {
  const filename = path.join(inputDir, `catalog-rebuild-${market}.json`);
  const generation = await readGenerationFile(filename, market);
  const freshRows = [...generation.offers].sort(qualityOrder);
  const retainedRows = (await readMarketOffers(market))
    .filter((offer) => ["active", "stale"].includes(String(offer?.status || "")))
    .sort(qualityOrder);
  const selected = [];
  const selectedIds = new Set();
  // Images must be unique inside a market. The same source can legitimately expose a car
  // in two regional feeds, so cross-market image ownership must not reduce other markets.
  const imageOwners = new Map();
  let rejectedQuality = 0;
  let freshPublished = 0;
  let retainedPublished = 0;

  for (const [origin, rows] of [["fresh", freshRows], ["retained", retainedRows]]) {
    for (const sourceOffer of rows) {
      if (selected.length >= target) break;
      const offer = auditCandidate(sourceOffer, market, selectedIds, imageOwners);
      if (!offer) {
        rejectedQuality++;
        continue;
      }
      selected.push(offer);
      selectedIds.add(offer.id);
      for (const image of offer.images) imageOwners.set(imageKey(image), offer.id);
      if (origin === "fresh") freshPublished++;
      else retainedPublished++;
    }
    if (selected.length >= target) break;
  }

  if (generation.available) files.push(filename);
  reports[market] = generation.payload?.report || {
    market,
    partial: true,
    stopReason: generation.error ? "generation_unavailable" : "generation_empty",
    inputError: generation.error,
  };
  byMarket[market] = selected.length;

  if (!selected.length) {
    marketQuality[market] = {
      generationAvailable: generation.available,
      generationError: generation.error,
      generationPartial: Boolean(generation.payload?.partial || generation.payload?.report?.partial),
      generationStopReason: generation.payload?.stopReason || generation.payload?.report?.stopReason || "generation_unavailable",
      freshCandidates: freshRows.length,
      retainedCandidates: retainedRows.length,
      desiredTarget: target,
      published: 0,
      freshPublished: 0,
      retainedPublished: 0,
      rejectedQuality,
      targetReached: false,
      temporarilyUnavailable: true,
      retainedPreviousMarket: retainedRows.length > 0,
    };
    continue;
  }

  const imageCounts = selected.map((offer) => offer.images.length);
  const averageImages = imageCounts.reduce((sum, count) => sum + count, 0) / selected.length;
  all.push(...selected);
  marketQuality[market] = {
    generationAvailable: generation.available,
    generationError: generation.error,
    generationPartial: Boolean(generation.payload?.partial || generation.payload?.report?.partial),
    generationStopReason: generation.payload?.stopReason || generation.payload?.report?.stopReason || "completed",
    freshCandidates: freshRows.length,
    retainedCandidates: retainedRows.length,
    desiredTarget: target,
    published: selected.length,
    freshPublished,
    retainedPublished,
    rejectedQuality,
    minimumImages: Math.min(...imageCounts),
    maximumImages: Math.max(...imageCounts),
    averageImages: Number(averageImages.toFixed(2)),
    minimumImagesPerOffer,
    minimumSpecScore,
    targetReached: selected.length >= target,
    temporarilyUnavailable: false,
    retainedPreviousMarket: !generation.available || retainedPublished > 0,
  };
}

const unique = new Map();
for (const offer of all) {
  if (unique.has(offer.id)) throw new Error(`fresh_publish_duplicate_offer_id_${offer.id}`);
  unique.set(offer.id, offer);
}

const offers = [...unique.values()];
if (!offers.length) throw new Error("fresh_publish_no_verified_offers_any_market");
// Retention has already been applied and audited above. Storage-level grow-only merging would
// reinsert unverified placeholders and allow markets to exceed their 1000-offer capacity.
process.env.CATALOG_GROW_ONLY_MARKETS = "";
const manifest = await persistCatalogOffers(offers);
const publishedAt = new Date().toISOString();
const report = {
  publishedAt,
  generationId: manifest.generationId,
  desiredPerMarket: target,
  capacityTotal: target * markets.length,
  total: offers.length,
  byMarket,
  files,
  missingGenerationMarkets: markets.filter((market) => !marketQuality[market]?.generationAvailable),
  partialGenerationMarkets: markets.filter((market) => marketQuality[market]?.generationPartial),
  marketQuality,
  imageStats: offers.reduce((stats, offer) => {
    const count = Array.isArray(offer.images) ? offer.images.length : 0;
    stats.min = Math.min(stats.min, count);
    stats.max = Math.max(stats.max, count);
    stats.total += count;
    return stats;
  }, { min: Number.POSITIVE_INFINITY, max: 0, total: 0 }),
  marketReports: reports,
};
if (!Number.isFinite(report.imageStats.min)) report.imageStats.min = 0;
report.imageStats.average = offers.length ? Number((report.imageStats.total / offers.length).toFixed(2)) : 0;

await fs.writeFile(
  process.env.CATALOG_REBUILD_PUBLISH_REPORT || "catalog-fresh-publish-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
