const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { persistCatalogOffers, readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");

const markets = new Set(String(process.env.CATALOG_GALLERY_MARKETS || "korea,china,japan,uae,europe")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean));
const sourceIds = new Set(String(process.env.CATALOG_GALLERY_SOURCE_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean));
const reportedOfferIds = [
  "d4353979acb720365324de54",
  "81937e0dbd5b509f183597a4",
  "6915dc63976acf885d99f13b",
];
const offerIds = new Set([
  ...reportedOfferIds,
  ...String(process.env.CATALOG_GALLERY_OFFER_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
]);
const maxOffers = Math.max(1, Number(process.env.CATALOG_GALLERY_MAX_OFFERS || 250));
const maxPerMarket = Math.max(1, Number(process.env.CATALOG_GALLERY_MAX_PER_MARKET || maxOffers));
const minImages = Math.max(1, Number(process.env.CATALOG_GALLERY_MIN_IMAGES || 10));
const maxImages = Math.max(minImages, 120, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 120));
const force = ["1", "true", "yes", "on"].includes(String(process.env.CATALOG_GALLERY_FORCE || "false").toLowerCase());
const persistEvery = Math.max(1, Number(process.env.CATALOG_GALLERY_PERSIST_EVERY || 25));

function identity(image) {
  return String(image?.id || image?.checksum || image?.objectKey || image?.url || "");
}

function mergeImages(fresh, previous) {
  const result = [];
  const seen = new Set();
  for (const image of [...fresh, ...previous]) {
    const key = identity(image);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(image);
    if (result.length >= maxImages) break;
  }
  return result;
}

const allOffers = await readAllOffersForMaintenance();
const adapters = new Map(catalogImportSources.map((source) => [source.sourceId, source]));
const perMarket = new Map();
const candidates = allOffers
  .filter((offer) => offer.status === "active")
  .filter((offer) => offerIds.has(offer.id) || markets.has(String(offer.market)))
  .filter((offer) => offerIds.has(offer.id) || !sourceIds.size || sourceIds.has(String(offer.sourceId)))
  .filter((offer) => adapters.has(offer.sourceId))
  .filter((offer) => offerIds.has(offer.id) || force || (offer.images?.length || 0) < minImages)
  .sort((a, b) => Number(offerIds.has(b.id)) - Number(offerIds.has(a.id))
    || (a.images?.length || 0) - (b.images?.length || 0)
    || Date.parse(String(b.operational?.sourcePublishedAt || b.updatedAt || "")) - Date.parse(String(a.operational?.sourcePublishedAt || a.updatedAt || "")))
  .filter((offer) => {
    if (offerIds.has(offer.id)) return true;
    const count = perMarket.get(offer.market) || 0;
    if (count >= maxPerMarket) return false;
    perMarket.set(offer.market, count + 1);
    return true;
  })
  .slice(0, Math.max(maxOffers, offerIds.size));

const byId = new Map(allOffers.map((offer) => [offer.id, offer]));
const report = {
  startedAt: new Date().toISOString(),
  markets: [...markets],
  priorityOfferIds: [...offerIds],
  selected: candidates.length,
  refreshed: 0,
  expanded: 0,
  replaced: 0,
  unchanged: 0,
  failed: 0,
  rows: [],
};

for (let index = 0; index < candidates.length; index++) {
  const offer = candidates[index];
  const source = adapters.get(offer.sourceId);
  const before = Array.isArray(offer.images) ? offer.images.length : 0;
  const previousLimit = process.env.CATALOG_MAX_IMAGES_PER_OFFER;
  process.env.CATALOG_MAX_IMAGES_PER_OFFER = String(maxImages);
  try {
    const fetched = await source.fetchImages(offer);
    const fresh = Array.isArray(fetched) ? fetched : [];
    // Two or more source-native images are enough to replace a polluted cached set.
    const replaced = fresh.length >= 2;
    const merged = replaced
      ? mergeImages(fresh, [])
      : mergeImages(fresh, Array.isArray(offer.images) ? offer.images : []);
    offer.images = merged;
    offer.operational = {
      ...offer.operational,
      galleryRefreshedAt: new Date().toISOString(),
      galleryImageCount: merged.length,
      galleryReplaced: replaced,
    };
    byId.set(offer.id, offer);
    report.refreshed++;
    if (replaced) report.replaced++;
    if (merged.length > before) report.expanded++;
    else report.unchanged++;
    report.rows.push({ id: offer.id, sourceId: offer.sourceId, market: offer.market, before, after: merged.length, replaced, ok: true });
    console.log(`[gallery] ${index + 1}/${candidates.length} ${offer.market}/${offer.sourceId}/${offer.id}: ${before} -> ${merged.length}${replaced ? " replaced" : " merged"}`);
  } catch (error) {
    report.failed++;
    report.rows.push({ id: offer.id, sourceId: offer.sourceId, market: offer.market, before, after: before, ok: false, error: String(error?.message || error) });
    console.error(`[gallery] ${index + 1}/${candidates.length} ${offer.market}/${offer.sourceId}/${offer.id}: ${String(error?.message || error)}`);
  } finally {
    if (previousLimit === undefined) delete process.env.CATALOG_MAX_IMAGES_PER_OFFER;
    else process.env.CATALOG_MAX_IMAGES_PER_OFFER = previousLimit;
  }

  if ((index + 1) % persistEvery === 0) {
    await persistCatalogOffers([...byId.values()]);
    console.log(`[gallery] checkpoint persisted after ${index + 1} offers`);
  }
}

if (candidates.length) await persistCatalogOffers([...byId.values()]);
report.finishedAt = new Date().toISOString();
await (await import("node:fs/promises")).writeFile(
  process.env.CATALOG_GALLERY_REPORT_FILE || "catalog-gallery-refresh-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
