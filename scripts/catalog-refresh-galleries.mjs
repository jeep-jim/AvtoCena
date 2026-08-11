const { catalogImportSources, needsSourceOrderedGalleryRefresh } = await import("../apps/web/lib/catalog/importer.ts");
const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { persistCatalogOffers, readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");

const markets = new Set(String(process.env.CATALOG_GALLERY_MARKETS || "korea,china,japan,uae,europe")
  .split(",").map((value) => value.trim()).filter(Boolean));
const sourceIds = new Set(String(process.env.CATALOG_GALLERY_SOURCE_IDS || "")
  .split(",").map((value) => value.trim()).filter(Boolean));
const offerIds = new Set([
  ...String(process.env.CATALOG_GALLERY_OFFER_IDS || "").split(",").map((value) => value.trim()).filter(Boolean),
]);
const maxOffers = Math.max(1, Number(process.env.CATALOG_GALLERY_MAX_OFFERS || 250));
const maxPerMarket = Math.max(1, Number(process.env.CATALOG_GALLERY_MAX_PER_MARKET || maxOffers));
const minImages = Math.max(1, Number(process.env.CATALOG_GALLERY_MIN_IMAGES || 10));
const maxImages = Math.min(120, Math.max(minImages, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 120)));
const force = ["1", "true", "yes", "on"].includes(String(process.env.CATALOG_GALLERY_FORCE || "false").toLowerCase());
const persistEvery = Math.max(1, Number(process.env.CATALOG_GALLERY_PERSIST_EVERY || 25));
const concurrency = Math.min(20, Math.max(1, Number(process.env.CATALOG_GALLERY_CONCURRENCY || 1)));
const retireConfirmedUnavailable = ["1", "true", "yes", "on"].includes(String(process.env.CATALOG_GALLERY_RETIRE_CONFIRMED_UNAVAILABLE || "false").toLowerCase());

function identity(image) { return String(image?.id || image?.checksum || image?.objectKey || image?.url || ""); }
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
  return credibleCatalogImages(result);
}

const allOffers = await readAllOffersForMaintenance();
const adapters = new Map(catalogImportSources.map((source) => [source.sourceId, source]));
const perMarket = new Map();
const candidates = allOffers
  .filter((offer) => offer.status === "active")
  .filter((offer) => offerIds.has(offer.id) || markets.has(String(offer.market)))
  .filter((offer) => offerIds.has(offer.id) || !sourceIds.size || sourceIds.has(String(offer.sourceId)))
  .filter((offer) => adapters.has(offer.sourceId))
  .filter((offer) => offerIds.has(offer.id) || force || needsSourceOrderedGalleryRefresh(offer) || (offer.images?.length || 0) < minImages)
  .sort((a, b) => Number(offerIds.has(b.id)) - Number(offerIds.has(a.id))
    || Number(needsSourceOrderedGalleryRefresh(b)) - Number(needsSourceOrderedGalleryRefresh(a))
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
const report = { startedAt: new Date().toISOString(), markets: [...markets], priorityOfferIds: [...offerIds], selected: candidates.length, refreshed: 0, expanded: 0, replaced: 0, unchanged: 0, retired: 0, failed: 0, rows: [] };
async function refreshCandidate(index) {
  const offer = candidates[index];
  const source = adapters.get(offer.sourceId);
  const previous = credibleCatalogImages(Array.isArray(offer.images) ? offer.images : []);
  const before = previous.length;
  try {
    const fetched = await source.fetchImages(offer);
    const fresh = credibleCatalogImages(Array.isArray(fetched) ? fetched : []);
    // Never shrink or clear a working gallery. A complete fresh gallery replaces the
    // old one; a partial response is only merged into the existing correct photos.
    const forceReplace = offer.operational?.galleryForceReplace === true;
    const replaced = forceReplace || fresh.length >= Math.max(4, before);
    const merged = replaced ? mergeImages(fresh, []) : mergeImages(fresh, previous);
    offer.images = forceReplace ? merged : merged.length >= before ? merged : previous;
    offer.operational = {
      ...offer.operational,
      galleryVerified: fresh.length >= 2 || Boolean(offer.operational?.galleryVerified),
      galleryRefreshedAt: new Date().toISOString(),
      gallerySourceImageCount: fresh.length,
      galleryImageCount: offer.images.length,
      galleryReplaced: replaced,
      galleryForceReplace: false,
    };
    byId.set(offer.id, offer);
    report.refreshed++;
    if (replaced) report.replaced++;
    if (offer.images.length > before) report.expanded++;
    else report.unchanged++;
    report.rows.push({ id: offer.id, sourceId: offer.sourceId, market: offer.market, before, fetched: fresh.length, after: offer.images.length, replaced, ok: true });
    console.log(`[gallery] ${index + 1}/${candidates.length} ${offer.market}/${offer.sourceId}/${offer.id}: ${before} -> ${offer.images.length} (fetched ${fresh.length})`);
  } catch (error) {
    const message = String(error?.message || error);
    if (retireConfirmedUnavailable && /^kcar_exact_detail_sold_[A-Za-z0-9_-]+$/.test(message)) {
      offer.status = "sold";
      offer.updatedAt = new Date().toISOString();
      byId.set(offer.id, offer);
      report.retired++;
      report.rows.push({ id: offer.id, sourceId: offer.sourceId, market: offer.market, before, after: before, retired: true, ok: true, reason: message });
      console.log(`[gallery] ${index + 1}/${candidates.length} ${offer.market}/${offer.sourceId}/${offer.id}: retired confirmed sold listing`);
      return;
    }
    report.failed++;
    report.rows.push({ id: offer.id, sourceId: offer.sourceId, market: offer.market, before, after: before, ok: false, error: message });
    console.error(`[gallery] ${index + 1}/${candidates.length} ${offer.market}/${offer.sourceId}/${offer.id}: ${message}`);
  }
}

const previousLimit = process.env.CATALOG_MAX_IMAGES_PER_OFFER;
process.env.CATALOG_MAX_IMAGES_PER_OFFER = String(maxImages);
try {
  // Persist one complete chunk at a time. This keeps recovery checkpoints while
  // allowing slow, independent source-detail requests inside the chunk to run
  // concurrently instead of making a 500-card repair take close to an hour.
  for (let start = 0; start < candidates.length; start += persistEvery) {
    const end = Math.min(candidates.length, start + persistEvery);
    let cursor = start;
    const workers = Array.from({ length: Math.min(concurrency, end - start) }, async () => {
      while (cursor < end) {
        const index = cursor++;
        await refreshCandidate(index);
      }
    });
    await Promise.all(workers);
    await persistCatalogOffers([...byId.values()]);
    console.log(`[gallery] checkpoint persisted after ${end} offers (concurrency ${concurrency})`);
  }
} finally {
  if (previousLimit === undefined) delete process.env.CATALOG_MAX_IMAGES_PER_OFFER;
  else process.env.CATALOG_MAX_IMAGES_PER_OFFER = previousLimit;
}
report.finishedAt = new Date().toISOString();
await (await import("node:fs/promises")).writeFile(process.env.CATALOG_GALLERY_REPORT_FILE || "catalog-gallery-refresh-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
