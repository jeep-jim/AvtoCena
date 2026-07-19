import fs from "node:fs/promises";
import path from "node:path";

const { isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { persistCatalogOffers } = await import("../apps/web/lib/catalog/storage.ts");

const inputDir = process.env.CATALOG_REBUILD_INPUT_DIR || "catalog-rebuild";
const target = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET || 250));
const minimumImagesPerOffer = Math.max(4, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 4));
const minimumAverageImages = Math.max(minimumImagesPerOffer, Number(process.env.CATALOG_REBUILD_MIN_AVG_IMAGES || 7));
const richGalleryImages = Math.max(minimumImagesPerOffer, Number(process.env.CATALOG_REBUILD_RICH_GALLERY_IMAGES || 8));
const richGalleryRatio = Math.min(1, Math.max(0, Number(process.env.CATALOG_REBUILD_RICH_GALLERY_RATIO || 0.5)));
const minimumSpecScore = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_SPEC_SCORE || 5));
const markets = ["korea", "china", "japan", "uae", "europe"];
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
    Number(offer?.powerHp || offer?.powerKw || 0) > 0,
  ].filter(Boolean).length;
}

for (const market of markets) {
  const filename = path.join(inputDir, `catalog-rebuild-${market}.json`);
  const payload = JSON.parse(await fs.readFile(filename, "utf8"));
  const rows = Array.isArray(payload?.offers) ? payload.offers : [];
  const selected = [];
  let rejectedQuality = 0;
  let removedSharedImages = 0;

  for (const sourceOffer of rows) {
    if (selected.length >= target) break;
    if (sourceOffer?.market !== market || !isCrediblePublicOffer(sourceOffer)) {
      rejectedQuality++;
      continue;
    }

    const localSeen = new Set();
    const images = [];
    for (const image of Array.isArray(sourceOffer.images) ? sourceOffer.images : []) {
      const key = imageKey(image);
      if (!key || localSeen.has(key)) continue;
      localSeen.add(key);
      const owner = globalImageOwners.get(key);
      if (owner && owner !== sourceOffer.id) {
        removedSharedImages++;
        continue;
      }
      images.push(image);
    }

    const offer = { ...sourceOffer, images };
    if (images.length < minimumImagesPerOffer
      || specScore(offer) < minimumSpecScore
      || !isCrediblePublicOffer(offer)) {
      rejectedQuality++;
      continue;
    }

    selected.push(offer);
    for (const image of images) globalImageOwners.set(imageKey(image), offer.id);
  }

  if (selected.length < target) {
    throw new Error(`fresh_publish_under_target_after_audit_${market}_${selected.length}_of_${target}`);
  }

  const imageCounts = selected.map((offer) => offer.images.length);
  const averageImages = imageCounts.reduce((sum, count) => sum + count, 0) / selected.length;
  const richGalleries = imageCounts.filter((count) => count >= richGalleryImages).length;
  const requiredRichGalleries = Math.ceil(target * richGalleryRatio);
  if (averageImages < minimumAverageImages) {
    throw new Error(`fresh_publish_low_average_gallery_${market}_${averageImages.toFixed(2)}_required_${minimumAverageImages}`);
  }
  if (richGalleries < requiredRichGalleries) {
    throw new Error(`fresh_publish_too_many_short_galleries_${market}_${richGalleries}_required_${requiredRichGalleries}`);
  }

  all.push(...selected);
  files.push(filename);
  byMarket[market] = selected.length;
  reports[market] = payload.report || {};
  marketQuality[market] = {
    candidates: rows.length,
    published: selected.length,
    rejectedQuality,
    removedSharedImages,
    minimumImages: Math.min(...imageCounts),
    maximumImages: Math.max(...imageCounts),
    averageImages: Number(averageImages.toFixed(2)),
    richGalleries,
    requiredRichGalleries,
    minimumImagesPerOffer,
    minimumSpecScore,
  };
}

const unique = new Map();
for (const offer of all) {
  if (unique.has(offer.id)) throw new Error(`fresh_publish_duplicate_offer_id_${offer.id}`);
  unique.set(offer.id, offer);
}

for (const market of markets) {
  const count = [...unique.values()].filter((offer) => offer.market === market).length;
  if (count !== target) throw new Error(`fresh_publish_market_count_${market}_${count}_expected_${target}`);
}

process.env.CATALOG_GROW_ONLY_MARKETS = "";
const offers = [...unique.values()];
const manifest = await persistCatalogOffers(offers);
const publishedAt = new Date().toISOString();
const report = {
  publishedAt,
  generationId: manifest.generationId,
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
report.imageStats.average = offers.length
  ? Number((report.imageStats.total / offers.length).toFixed(2))
  : 0;

await fs.writeFile(
  process.env.CATALOG_REBUILD_PUBLISH_REPORT || "catalog-fresh-publish-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
