import fs from "node:fs/promises";
import path from "node:path";

const { isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { persistCatalogOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const inputDir = process.env.CATALOG_REBUILD_INPUT_DIR || "catalog-rebuild";
const targetPerSource = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET_PER_SOURCE || 1_000));
const maximumPerMarket = Math.max(targetPerSource, Number(process.env.CATALOG_PUBLISH_MAX_PER_MARKET || 30_000));
const minimumImagesPerOffer = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 1));
const preferredImagesPerOffer = Math.max(minimumImagesPerOffer, Number(process.env.CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER || 6));
const minimumSpecScore = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_SPEC_SCORE || 1));
const configuredMarkets = String(process.env.CATALOG_REBUILD_MARKETS || "").split(",").map((value) => value.trim()).filter(Boolean);
const markets = configuredMarkets.length ? configuredMarkets : [...PUBLIC_CATALOG_MARKETS];
const all = [];
const files = [];
const byMarket = {};
const byMarketAndSource = {};
const marketQuality = {};
const marketReports = {};

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
  const leftPreferred = Number(left?.images?.length || 0) >= preferredImagesPerOffer ? 1 : 0;
  const rightPreferred = Number(right?.images?.length || 0) >= preferredImagesPerOffer ? 1 : 0;
  return rightPreferred - leftPreferred
    || Number(right?.images?.length || 0) - Number(left?.images?.length || 0)
    || freshness(right) - freshness(left)
    || String(left?.id || "").localeCompare(String(right?.id || ""));
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

function auditCandidate(sourceOffer, market, selectedIds) {
  if (sourceOffer?.market !== market || selectedIds.has(sourceOffer?.id) || !isCrediblePublicOffer(sourceOffer) || !hasExactCalculation(sourceOffer)) return null;
  const localSeen = new Set();
  const images = [];
  for (const image of Array.isArray(sourceOffer.images) ? sourceOffer.images : []) {
    const key = imageKey(image);
    if (!key || localSeen.has(key)) continue;
    localSeen.add(key);
    images.push(image);
    if (images.length >= 30) break;
  }
  const offer = {
    ...sourceOffer,
    status: "active",
    images,
    operational: {
      ...sourceOffer.operational,
      seoEligible: Boolean(sourceOffer.operational?.sourceUrl && images.length >= minimumImagesPerOffer),
    },
  };
  if (images.length < minimumImagesPerOffer || specScore(offer) < minimumSpecScore || !isCrediblePublicOffer(offer) || !hasExactCalculation(offer)) return null;
  return offer;
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
      files.push(filename);
    } catch (error) {
      errors.push({ filename, error: String(error?.message || error) });
    }
  }
  return { available: payloads.length > 0, filenames, payloads, offers, errors };
}

for (const market of markets) {
  const generation = await readGenerationFiles(market);
  // В публикацию попадают только результаты текущего запуска. Даже сохранённые предложения
  // должны были пройти prepareCandidate заново: получить галерею, базу знаний, таможню и утиль.
  const freshRows = generation.offers
    .filter((offer) => String(offer?.operational?.galleryRebuiltFrom || "") === "fresh_listing")
    .sort(qualityOrder);
  const revalidatedRows = generation.offers
    .filter((offer) => String(offer?.operational?.galleryRebuiltFrom || "") !== "fresh_listing")
    .sort(qualityOrder);
  const selected = [];
  const selectedIds = new Set();
  const sourceCounts = new Map();
  let rejectedQuality = 0;
  let rejectedSourceQuota = 0;
  let freshPublished = 0;
  let revalidatedPublished = 0;

  for (const [origin, rows] of [["fresh", freshRows], ["revalidated", revalidatedRows]]) {
    for (const sourceOffer of rows) {
      if (selected.length >= maximumPerMarket) break;
      const sourceId = String(sourceOffer?.sourceId || "unknown");
      if (Number(sourceCounts.get(sourceId) || 0) >= targetPerSource) {
        rejectedSourceQuota++;
        continue;
      }
      const offer = auditCandidate(sourceOffer, market, selectedIds);
      if (!offer) {
        rejectedQuality++;
        continue;
      }
      selected.push(offer);
      selectedIds.add(offer.id);
      sourceCounts.set(sourceId, Number(sourceCounts.get(sourceId) || 0) + 1);
      if (origin === "fresh") freshPublished++;
      else revalidatedPublished++;
    }
    if (selected.length >= maximumPerMarket) break;
  }

  byMarket[market] = selected.length;
  byMarketAndSource[market] = Object.fromEntries([...sourceCounts.entries()].sort(([left], [right]) => left.localeCompare(right)));
  marketReports[market] = generation.payloads.map((payload) => payload.report || payload);

  if (!selected.length) {
    marketQuality[market] = {
      generationAvailable: generation.available,
      generationFiles: generation.filenames,
      generationErrors: generation.errors,
      freshCandidates: freshRows.length,
      revalidatedCandidates: revalidatedRows.length,
      targetPerSource,
      maximumPerMarket,
      published: 0,
      freshPublished: 0,
      revalidatedPublished: 0,
      rejectedQuality,
      rejectedSourceQuota,
      temporarilyUnavailable: true,
    };
    continue;
  }

  const imageCounts = selected.map((offer) => offer.images.length);
  const averageImages = imageCounts.reduce((sum, count) => sum + count, 0) / selected.length;
  const preferredCount = imageCounts.filter((count) => count >= preferredImagesPerOffer).length;
  all.push(...selected);
  marketQuality[market] = {
    generationAvailable: generation.available,
    generationFiles: generation.filenames,
    generationErrors: generation.errors,
    generationPartial: generation.payloads.some((payload) => Boolean(payload.partial || payload.report?.partial)),
    generationStopReasons: generation.payloads.map((payload) => payload.stopReason || payload.report?.stopReason || "completed"),
    freshCandidates: freshRows.length,
    revalidatedCandidates: revalidatedRows.length,
    targetPerSource,
    maximumPerMarket,
    published: selected.length,
    publishedSources: sourceCounts.size,
    bySource: byMarketAndSource[market],
    freshPublished,
    revalidatedPublished,
    rejectedQuality,
    rejectedSourceQuota,
    minimumImages: Math.min(...imageCounts),
    maximumImages: Math.max(...imageCounts),
    averageImages: Number(averageImages.toFixed(2)),
    preferredImagesPerOffer,
    preferredImagesShare: Number((preferredCount / selected.length).toFixed(4)),
    minimumImagesPerOffer,
    minimumSpecScore,
    temporarilyUnavailable: false,
  };
}

const unique = new Map();
for (const offer of all) {
  if (unique.has(offer.id)) continue;
  unique.set(offer.id, offer);
}

const offers = [...unique.values()];
if (!offers.length) throw new Error("source_scale_publish_no_verified_offers_any_market");
process.env.CATALOG_GROW_ONLY_MARKETS = "";
const manifest = await persistCatalogOffers(offers);
const publishedAt = new Date().toISOString();
const report = {
  version: 18,
  publishedAt,
  generationId: manifest.generationId,
  targetPerSource,
  maximumPerMarket,
  total: offers.length,
  byMarket,
  byMarketAndSource,
  files,
  missingGenerationMarkets: markets.filter((market) => !marketQuality[market]?.generationAvailable),
  partialGenerationMarkets: markets.filter((market) => marketQuality[market]?.generationPartial),
  marketQuality,
  imageStats: offers.reduce((stats, offer) => {
    const count = Array.isArray(offer.images) ? offer.images.length : 0;
    stats.min = Math.min(stats.min, count);
    stats.max = Math.max(stats.max, count);
    stats.total += count;
    stats.preferred += count >= preferredImagesPerOffer ? 1 : 0;
    return stats;
  }, { min: Number.POSITIVE_INFINITY, max: 0, total: 0, preferred: 0 }),
  marketReports,
};
if (!Number.isFinite(report.imageStats.min)) report.imageStats.min = 0;
report.imageStats.average = offers.length ? Number((report.imageStats.total / offers.length).toFixed(2)) : 0;
report.imageStats.preferredShare = offers.length ? Number((report.imageStats.preferred / offers.length).toFixed(4)) : 0;

await fs.writeFile(
  process.env.CATALOG_REBUILD_PUBLISH_REPORT || "catalog-source-scale-publish-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
