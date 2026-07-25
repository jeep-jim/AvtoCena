import fs from "node:fs/promises";
import path from "node:path";

const { isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { persistCatalogOffers, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { CATALOG_DAILY_TARGET_PER_MARKET, PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const inputDir = process.env.CATALOG_REBUILD_INPUT_DIR || "catalog-rebuild";
const target = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET || CATALOG_DAILY_TARGET_PER_MARKET));
const minimumPerMarket = Math.max(1, Math.min(target, Number(process.env.CATALOG_REBUILD_MIN_PUBLISH_PER_MARKET || 1)));
const minimumImagesPerOffer = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 1));
const minimumSpecScore = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_SPEC_SCORE || 4));
const configuredMarkets = String(process.env.CATALOG_REBUILD_MARKETS || "").split(",").map((value) => value.trim()).filter(Boolean);
const markets = configuredMarkets.length ? configuredMarkets : [...PUBLIC_CATALOG_MARKETS];
const all = [];
const files = [];
const byMarket = {};
const reports = {};
const marketQuality = {};
const globalImageOwners = new Map();

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function imageKey(image) {
  return String(image?.checksum || image?.id || image?.objectKey || image?.url || "");
}

function specScore(offer) {
  const fuel = clean(offer?.fuel);
  const electric = /electric|bev|электро|纯电|전기/i.test(fuel);
  return [
    Number(offer?.mileageKm) >= 0,
    Boolean(fuel),
    Boolean(clean(offer?.transmission)),
    Boolean(clean(offer?.drive)),
    Boolean(clean(offer?.bodyType)),
    electric || Number(offer?.engineCc || 0) > 0,
    Number(offer?.powerHp || 0) > 0,
  ].filter(Boolean).length;
}

function freshness(offer) {
  return Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0;
}

function auditCandidate(sourceOffer, market, selectedIds, globalImageOwners) {
  if (sourceOffer?.market !== market || selectedIds.has(sourceOffer?.id) || !isCrediblePublicOffer(sourceOffer)) return null;
  const localSeen = new Set();
  const images = [];
  for (const image of Array.isArray(sourceOffer.images) ? sourceOffer.images : []) {
    const key = imageKey(image);
    if (!key || localSeen.has(key)) continue;
    localSeen.add(key);
    const owner = globalImageOwners.get(key);
    if (owner && owner !== sourceOffer.id) continue;
    images.push(image);
  }
  const offer = { ...sourceOffer, status: "active", images };
  if (images.length < minimumImagesPerOffer || specScore(offer) < minimumSpecScore || !isCrediblePublicOffer(offer)) return null;
  return offer;
}

for (const market of markets) {
  const filename = path.join(inputDir, `catalog-rebuild-${market}.json`);
  const payload = JSON.parse(await fs.readFile(filename, "utf8"));
  const freshRows = Array.isArray(payload?.offers) ? payload.offers : [];
  const retainedRows = (await readMarketOffers(market))
    .filter((offer) => ["active", "stale"].includes(String(offer?.status || "")))
    .sort((left, right) => freshness(right) - freshness(left));
  const selected = [];
  const selectedIds = new Set();
  let rejectedQuality = 0;
  let freshPublished = 0;
  let retainedPublished = 0;

  for (const [origin, rows] of [["fresh", freshRows], ["retained", retainedRows]]) {
    for (const sourceOffer of rows) {
      if (selected.length >= target) break;
      const offer = auditCandidate(sourceOffer, market, selectedIds, globalImageOwners);
      if (!offer) {
        rejectedQuality++;
        continue;
      }
      selected.push(offer);
      selectedIds.add(offer.id);
      for (const image of offer.images) globalImageOwners.set(imageKey(image), offer.id);
      if (origin === "fresh") freshPublished++;
      else retainedPublished++;
    }
    if (selected.length >= target) break;
  }

  if (selected.length < minimumPerMarket) {
    throw new Error(`fresh_publish_no_verified_offers_${market}_${selected.length}`);
  }

  const imageCounts = selected.map((offer) => offer.images.length);
  const averageImages = imageCounts.reduce((sum, count) => sum + count, 0) / selected.length;
  all.push(...selected);
  files.push(filename);
  byMarket[market] = selected.length;
  reports[market] = payload.report || {};
  marketQuality[market] = {
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
  };
}

const unique = new Map();
for (const offer of all) {
  if (unique.has(offer.id)) throw new Error(`fresh_publish_duplicate_offer_id_${offer.id}`);
  unique.set(offer.id, offer);
}

process.env.CATALOG_GROW_ONLY_MARKETS = "";
const offers = [...unique.values()];
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
