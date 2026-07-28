import fs from "node:fs/promises";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { credibleCatalogImages, isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { enrichOfferWithVehicleKnowledge } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");
const { readAllOffersForMaintenance, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { getJsonStorage } = await import("../apps/web/lib/data.ts");

const market = String(process.env.CATALOG_REBUILD_MARKET || "").trim();
const shardIndex = Math.max(0, Number(process.env.CATALOG_REBUILD_SHARD_INDEX || 0));
const shardCount = Math.max(1, Number(process.env.CATALOG_REBUILD_SHARD_COUNT || 1));
const targetPerSource = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET_PER_SOURCE || 1000));
const minimumMarketTarget = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET_PER_MARKET || 1000));
const minimumImages = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 4));
const preferredImages = Math.max(minimumImages, Number(process.env.CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER || 6));
const maximumImages = Math.min(30, Math.max(preferredImages, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
const networkImageLimit = Math.min(maximumImages, Math.max(minimumImages, Number(process.env.CATALOG_COLLECTION_IMAGE_LIMIT || preferredImages)));
const retentionMs = Math.max(60_000, Number(process.env.CATALOG_OFFER_RETENTION_MS || 259_200_000));
const maxPagesPerSource = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_PAGES_PER_SOURCE || 300));
const maxTotalPages = Math.max(maxPagesPerSource, Number(process.env.CATALOG_REBUILD_MAX_TOTAL_PAGES || 5000));
const maxEmptyPages = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_EMPTY_PAGES || 12));
const sourceConcurrency = Math.max(1, Math.min(12, Number(process.env.CATALOG_REBUILD_SOURCE_CONCURRENCY || 6)));
const prepareConcurrency = Math.max(1, Math.min(30, Number(process.env.CATALOG_REBUILD_PREPARE_CONCURRENCY || 16)));
const timeLimitMs = Math.max(60_000, Number(process.env.CATALOG_REBUILD_TIME_LIMIT_MS || 3_600_000));
const outputFile = process.env.CATALOG_REBUILD_OUTPUT || `catalog-rebuild-${market}-${shardIndex}.json`;
const startedAt = Date.now();
const deadline = startedAt + timeLimitMs;
const commercial = /\b(?:truck|dump|tipper|bus|minibus|commercial|cargo|lorry|tractor|forklift|excavator|machinery|canter|fighter|dutro|forward|giga|elf|profia)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;

if (!market) throw new Error("catalog_market_missing");
process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER = String(minimumImages);
// Источнику достаточно быстро сохранить предпочтительные 6 фото. Уже накопленные галереи
// до 30 изображений не обрезаются и остаются доступными при публикации.
process.env.CATALOG_MAX_IMAGES_PER_OFFER = String(networkImageLimit);

function shardOf(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return Math.abs(hash >>> 0) % shardCount;
}
function key(image) { return String(image?.checksum || image?.id || image?.objectKey || image?.url || ""); }
function images(list) {
  const seen = new Set();
  const result = [];
  for (const image of credibleCatalogImages(Array.isArray(list) ? list : [])) {
    const id = key(image);
    if (!id || seen.has(id)) continue;
    seen.add(id); result.push(image);
    if (result.length >= maximumImages) break;
  }
  return result;
}
function firstSeen(offer) { return Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.firstSeenAt || offer?.updatedAt || "")) || 0; }
function currentTime(offer) { return Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0; }
function quality(a, b) {
  return (Number(b?.images?.length || 0) >= preferredImages ? 1 : 0) - (Number(a?.images?.length || 0) >= preferredImages ? 1 : 0)
    || Number(b?.images?.length || 0) - Number(a?.images?.length || 0)
    || currentTime(b) - currentTime(a);
}
function cursorPath(sourceId) { return `catalog/source-cursors/${market}/${String(sourceId).replace(/[^a-z0-9_-]/gi, "-")}.json`; }
function expired() { return Date.now() >= deadline; }
async function pool(rows, limit, worker) {
  if (!rows.length) return [];
  const output = new Array(rows.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (true) { const index = cursor++; if (index >= rows.length) return; output[index] = await worker(rows[index], index); }
  }));
  return output;
}

const adapters = new Map(catalogImportSources.map((source) => [source.sourceId, source]));
const registered = catalogImportSources
  .filter((source) => source.market === market || source.market === "multi")
  .map((source) => source.sourceId)
  .filter((sourceId) => adapters.has(sourceId));
const configured = String(process.env.CATALOG_REBUILD_SOURCE_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value && !value.startsWith("__") && adapters.has(value));
const retentionSourceIds = [...new Set(registered)].filter((id) => shardOf(id) === shardIndex).sort();
const liveSourceIds = [...new Set(configured)].filter((id) => retentionSourceIds.includes(id));
const sourceIds = retentionSourceIds;
const retained = new Map(sourceIds.map((id) => [id, new Map()]));
const fresh = new Map(sourceIds.map((id) => [id, new Map()]));
const errors = [];
const sourceReports = [];
const rejections = {};
let pages = 0;
let seen = 0;
let normalized = 0;
let knowledgeEnriched = 0;

function reject(reason) { rejections[reason] = Number(rejections[reason] || 0) + 1; }
function addError(row) { if (errors.length < 2000) errors.push(row); }
function mergedRows() {
  const output = [];
  for (const sourceId of sourceIds) {
    const live = [...fresh.get(sourceId).values()].sort(quality);
    const old = [...retained.get(sourceId).values()].filter((offer) => !fresh.get(sourceId).has(offer.id)).sort(quality);
    output.push(...[...live, ...old].slice(0, targetPerSource));
  }
  return output.sort(quality);
}
function counts(map) { return Object.fromEntries(sourceIds.map((id) => [id, map.get(id).size])); }
function report(stopReason = "running") {
  const offers = mergedRows();
  return {
    version: 27, market, shardIndex, shardCount, generatedAt: new Date().toISOString(), targetPerSource,
    minimumMarketTarget, count: offers.length, sourceIds, liveSourceIds, retentionSourceIds,
    partial: offers.length < Math.ceil(minimumMarketTarget / shardCount), stopReason,
    report: {
      version: 27, market, shardIndex, shardCount, targetPerSource, minimumImages, preferredImages, maximumImages, networkImageLimit,
      retentionMs, pages, seen, normalized, knowledgeEnriched, saved: offers.length, liveSourceIds, retentionSourceIds,
      publicBySource: Object.fromEntries(sourceIds.map((id) => [id, offers.filter((offer) => offer.sourceId === id).length])),
      freshBySource: counts(fresh), restoredBySource: counts(retained), sourceErrors: errors, sources: sourceReports,
      rejectionReasons: rejections, startedAt: new Date(startedAt).toISOString(), durationMs: Date.now() - startedAt, stopReason,
    },
    offers,
  };
}
async function checkpoint(stopReason = "running") {
  const temporary = `${outputFile}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(report(stopReason), null, 2));
  await fs.rename(temporary, outputFile);
}

let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
  if (shuttingDown) return;
  shuttingDown = true;
  checkpoint(`signal_${signal.toLowerCase()}`).finally(() => process.exit(0));
});

// Load the verified three-day catalogue before touching the network. Slow sites can no longer
// consume the deadline and prevent retention from being included in the publication artifact.
let publicRows = [];
let internalRows = [];
try { publicRows = await readMarketOffers(market); } catch (error) { addError({ stage: "retention_public", error: String(error?.message || error) }); }
try { internalRows = await readAllOffersForMaintenance(); } catch (error) { addError({ stage: "retention_internal", error: String(error?.message || error) }); }
const cutoff = Date.now() - retentionMs;
for (const row of [...publicRows, ...internalRows].sort(quality)) {
  const sourceId = String(row?.sourceId || "");
  const bucket = retained.get(sourceId);
  if (!bucket || !row?.id || bucket.has(row.id) || bucket.size >= targetPerSource || firstSeen(row) < cutoff) continue;
  const offer = normalizeVehicleOfferSpecs({ ...row, status: "active", images: images(row.images) });
  if (offer.images.length >= minimumImages && isCrediblePublicOffer(offer)) bucket.set(offer.id, offer);
}
await checkpoint("retention_loaded");

async function prepare(base, source) {
  if (expired()) return null;
  let offer = normalizeVehicleOfferSpecs({ ...base });
  if (!offer?.id || offer.market !== market || !sourceIds.includes(String(offer.sourceId || ""))) { reject("identity"); return null; }
  if (commercial.test(`${offer.make || ""} ${offer.model || ""} ${offer.trim || ""} ${offer.bodyType || ""}`)) { reject("commercial"); return null; }
  let gallery = images(offer.images);
  if ((gallery.length < minimumImages || !Number(offer.sourcePrice || 0) || !Number(offer.powerHp || 0)) && source?.fetchImages && !expired()) {
    try { gallery = images([...gallery, ...((await source.fetchImages(offer)) || [])]); }
    catch (error) { addError({ sourceId: offer.sourceId, offerId: offer.id, stage: "gallery", error: String(error?.message || error) }); }
  }
  if (!Number(offer.sourcePrice || 0) || !offer.sourceCurrency || !offer.operational?.sourceUrl) { reject("source_data"); return null; }
  if (gallery.length < minimumImages) { reject("images"); return null; }
  const now = new Date().toISOString();
  offer = normalizeVehicleOfferSpecs({
    ...offer, status: "active", images: gallery, updatedAt: now,
    operational: { ...offer.operational, fullRebuildAt: now, galleryVerified: true, galleryImageCount: gallery.length,
      gallerySourceImageCount: gallery.length, galleryPreferredCount: preferredImages,
      galleryPreferredReached: gallery.length >= preferredImages, galleryRebuiltFrom: "fresh_listing", seoEligible: true },
  });
  try {
    const enriched = await enrichOfferWithVehicleKnowledge(offer);
    if (!Number(offer.powerHp || 0) && Number(enriched?.powerHp || 0)) knowledgeEnriched++;
    offer = normalizeVehicleOfferSpecs(await calculateOfferWithRussiaCustoms(enriched));
  } catch (error) {
    addError({ sourceId: offer.sourceId, offerId: offer.id, stage: "calculation", error: String(error?.message || error) });
    reject("calculation"); return null;
  }
  if (!isCrediblePublicOffer(offer)) { reject("quality"); return null; }
  return offer;
}

const storage = getJsonStorage();
const states = await pool(liveSourceIds, sourceConcurrency, async (sourceId) => {
  let saved = { cursor: null, cycle: 0, pagesVisited: 0 };
  try { saved = await storage.readJson(cursorPath(sourceId), saved); } catch (error) { addError({ sourceId, stage: "cursor_read", error: String(error?.message || error) }); }
  return { sourceId, source: adapters.get(sourceId), cursor: saved.cursor || null, initialCursor: saved.cursor || null,
    cycle: Number(saved.cycle || 0), pagesVisited: Number(saved.pagesVisited || 0), pages: 0, errors: 0, empty: 0, done: false, stopReason: "running", seenCursors: new Set() };
});
const pagePrepareConcurrency = Math.max(1, Math.floor(prepareConcurrency / Math.max(1, Math.min(sourceConcurrency, liveSourceIds.length || 1))));

async function fetchOne(state) {
  const bucket = fresh.get(state.sourceId);
  if (state.done || expired() || pages >= maxTotalPages || bucket.size >= targetPerSource) return;
  if (state.pages >= maxPagesPerSource) { state.done = true; state.stopReason = "source_page_limit"; return; }
  const cursorKey = JSON.stringify(state.cursor ?? "first");
  if (state.seenCursors.has(cursorKey)) { state.done = true; state.stopReason = "cursor_loop"; return; }
  state.seenCursors.add(cursorKey);
  let fetched;
  try { fetched = await state.source.fetchPage(state.cursor); state.errors = 0; }
  catch (error) {
    state.seenCursors.delete(cursorKey); state.errors++;
    addError({ sourceId: state.sourceId, cursor: state.cursor, stage: "list", error: String(error?.message || error) });
    if (state.errors >= 2) { state.done = true; state.stopReason = "source_errors"; }
    return;
  }
  state.pages++; pages++;
  const rows = Array.isArray(fetched?.items) ? fetched.items : [];
  seen += rows.length;
  const bases = [];
  const batch = new Set();
  for (const raw of rows) {
    let base = null;
    try { base = state.source.normalizeOffer(raw); } catch { base = null; }
    if (!base?.id || base.market !== market || base.sourceId !== state.sourceId || bucket.has(base.id) || batch.has(base.id)) continue;
    batch.add(base.id); bases.push(base); normalized++;
    if (bases.length >= targetPerSource - bucket.size) break;
  }
  const before = bucket.size;
  for (const offer of await pool(bases, pagePrepareConcurrency, (base) => prepare(base, state.source))) {
    if (offer && bucket.size < targetPerSource) bucket.set(offer.id, offer);
  }
  state.empty = bucket.size === before ? state.empty + 1 : 0;
  const nextCursor = fetched?.nextCursor || null;
  const finished = Boolean((fetched?.finished && !nextCursor) || !nextCursor);
  try {
    await storage.writeJson(cursorPath(state.sourceId), { version: 1, market, sourceId: state.sourceId,
      cursor: finished ? null : nextCursor, cycle: state.cycle + (finished ? 1 : 0), pagesVisited: state.pagesVisited + 1, updatedAt: new Date().toISOString() });
  } catch (error) { addError({ sourceId: state.sourceId, stage: "cursor_write", error: String(error?.message || error) }); }
  state.cursor = nextCursor; state.pagesVisited++;
  if (bucket.size >= targetPerSource) { state.done = true; state.stopReason = "source_target_reached"; }
  else if (finished) { state.done = true; state.stopReason = "source_cycle_finished"; }
  else if (state.empty >= maxEmptyPages) { state.done = true; state.stopReason = "no_progress"; }
}

let rounds = 0;
let lastSaved = mergedRows().length;
while (!expired() && pages < maxTotalPages) {
  const active = states.filter((state) => !state.done && fresh.get(state.sourceId).size < targetPerSource);
  if (!active.length) break;
  rounds++;
  await pool(active, sourceConcurrency, fetchOne);
  const savedNow = mergedRows().length;
  if (savedNow !== lastSaved || rounds % 2 === 0) {
    lastSaved = savedNow;
    await checkpoint("collecting");
  }
}
for (const state of states) {
  if (!state.done) state.stopReason = expired() ? "deadline" : pages >= maxTotalPages ? "total_page_limit" : "stopped";
  sourceReports.push({ sourceId: state.sourceId, mode: "live", target: targetPerSource, freshSaved: fresh.get(state.sourceId).size,
    restoredSaved: retained.get(state.sourceId).size, pages: state.pages, errors: state.errors, emptyPages: state.empty,
    initialCursor: state.initialCursor, nextCursor: state.cursor, cycle: state.cycle, pagesVisited: state.pagesVisited, stopReason: state.stopReason });
}
for (const sourceId of retentionSourceIds.filter((id) => !liveSourceIds.includes(id))) {
  sourceReports.push({ sourceId, mode: "retention_only", target: targetPerSource, freshSaved: 0,
    restoredSaved: retained.get(sourceId).size, pages: 0, errors: 0, emptyPages: 0, stopReason: "probe_inactive" });
}
const stopReason = expired() ? "deadline" : pages >= maxTotalPages ? "total_page_limit" : liveSourceIds.length ? "sources_exhausted" : "no_active_sources";
await checkpoint(stopReason);
console.log(JSON.stringify(report(stopReason).report, null, 2));
