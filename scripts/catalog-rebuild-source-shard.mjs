import fs from "node:fs/promises";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { credibleCatalogImages, isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { compareCatalogPublicPriority } = await import("../apps/web/lib/catalog/public-priority.ts");
const { classifyCatalogV2Offer } = await import("../apps/web/lib/catalog/catalog-v2-policy.ts");
const { catalogV2SourceIds } = await import("../apps/web/lib/catalog/catalog-v2-source-registry.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { enrichOfferWithKnowledgeCore } = await import("../apps/web/lib/catalog/knowledge-core.ts");
const {
  catalogPartitionInitialCursor,
  catalogPartitionNextCursor,
  catalogPartitionStorageSuffix,
  catalogRetainedOfferBelongsToPartition,
  catalogSourceAssignedToShard,
  catalogSourcePagePartition,
} = await import("../apps/web/lib/catalog/source-page-partition.ts");
const { readAllOffersForMaintenance, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { getJsonStorage, readChunkedDataJson } = await import("../apps/web/lib/data.ts");
const { replaceChunkedDataJson } = await import("../apps/web/lib/replace-chunked-data.ts");

const market = String(process.env.CATALOG_REBUILD_MARKET || "").trim();
const shardIndex = Math.max(0, Number(process.env.CATALOG_REBUILD_SHARD_INDEX || 0));
const shardCount = Math.max(1, Number(process.env.CATALOG_REBUILD_SHARD_COUNT || 1));
const targetPerSource = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET_PER_SOURCE || 100_000));
const minimumMarketTarget = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET_PER_MARKET || 100_000));
const minimumImages = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 1));
const preferredImages = Math.max(minimumImages, Number(process.env.CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER || 30));
const maximumImages = Math.min(30, Math.max(preferredImages, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
const networkImageLimit = Math.min(maximumImages, Math.max(minimumImages, Number(process.env.CATALOG_COLLECTION_IMAGE_LIMIT || maximumImages)));
const detailLimitPerSource = Math.max(1, Number(process.env.CATALOG_REBUILD_DETAIL_LIMIT_PER_SOURCE || 100_000));
const retentionMs = Math.max(60_000, Number(process.env.CATALOG_OFFER_RETENTION_MS || 259_200_000));
const maxPagesPerSource = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_PAGES_PER_SOURCE || 100_000));
const maxTotalPages = Math.max(maxPagesPerSource, Number(process.env.CATALOG_REBUILD_MAX_TOTAL_PAGES || 1_000_000));
const maxEmptyPages = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_EMPTY_PAGES || 1_000));
const maxSourceErrors = Math.max(2, Number(process.env.CATALOG_REBUILD_MAX_SOURCE_ERRORS || 8));
const sourceConcurrency = Math.max(1, Math.min(12, Number(process.env.CATALOG_REBUILD_SOURCE_CONCURRENCY || 8)));
const prepareConcurrency = Math.max(1, Math.min(30, Number(process.env.CATALOG_REBUILD_PREPARE_CONCURRENCY || 30)));
const timeLimitMs = Math.max(60_000, Number(process.env.CATALOG_REBUILD_TIME_LIMIT_MS || 6_300_000));
const priorityMaxTotalRub = Math.max(100_000, Number(process.env.CATALOG_PRIORITY_MAX_TOTAL_RUB || 6_000_000));
const priorityMaxPowerHp = Math.max(1, Number(process.env.CATALOG_PRIORITY_MAX_POWER_HP || 160));
const priorityMaxAgeYears = Math.max(0, Number(process.env.CATALOG_PRIORITY_MAX_AGE_YEARS || 6));
const priorityMinYear = new Date().getFullYear() - priorityMaxAgeYears;
const outputFile = process.env.CATALOG_REBUILD_OUTPUT || `catalog-rebuild-${market}-${shardIndex}.json`;
const ignoreProbe = process.env.CATALOG_REBUILD_IGNORE_PROBE === "1";
const resetCursor = process.env.CATALOG_REBUILD_RESET_CURSOR === "1";
const v2SourceSlotsOnly = process.env.CATALOG_V2_SOURCE_SLOTS_ONLY === "1";
const startedAt = Date.now();
const deadline = startedAt + timeLimitMs;
const commercial = /\b(?:truck|dump|tipper|bus|minibus|commercial|cargo|lorry|tractor|forklift|excavator|machinery|canter|fighter|dutro|forward|giga|elf|profia)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;

if (!market) throw new Error("catalog_market_missing");
process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER = String(minimumImages);
process.env.CATALOG_MAX_IMAGES_PER_OFFER = String(networkImageLimit);

function cleanSourceId(sourceId) { return String(sourceId).replace(/[^a-z0-9_-]/gi, "-"); }
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
function isMassMarketPriority(offer) { return classifyCatalogV2Offer(offer).tier === "priority"; }
function quality(a, b) {
  return compareCatalogPublicPriority(a, b)
    || currentTime(b) - currentTime(a);
}
function partitionFor(sourceId) { return catalogSourcePagePartition(sourceId, shardIndex, shardCount); }
function cursorPath(sourceId) { return `catalog/source-cursors/${market}/${cleanSourceId(sourceId)}${catalogPartitionStorageSuffix(partitionFor(sourceId))}.json`; }
function candidatePath(sourceId) { return `catalog/source-candidates/${market}/${cleanSourceId(sourceId)}${catalogPartitionStorageSuffix(partitionFor(sourceId))}.json`; }
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
const requestedSources = v2SourceSlotsOnly
  ? catalogV2SourceIds(market)
  : String(process.env.CATALOG_REBUILD_SOURCE_IDS || "").split(",").map((value) => value.trim());
const configured = requestedSources
  .filter((value) => value && !value.startsWith("__") && adapters.has(value));
const retentionSourceIds = [...new Set(v2SourceSlotsOnly ? configured : registered)]
  .filter((id) => catalogSourceAssignedToShard(id, shardIndex, shardCount))
  .sort();
const liveSourceIds = ignoreProbe
  ? [...retentionSourceIds]
  : [...new Set(configured)].filter((id) => retentionSourceIds.includes(id));
const sourceIds = retentionSourceIds;
const retained = new Map(sourceIds.map((id) => [id, new Map()]));
const fresh = new Map(sourceIds.map((id) => [id, new Map()]));
const detailReservations = new Map(sourceIds.map((id) => [id, 0]));
const detailSuccessBySource = new Map(sourceIds.map((id) => [id, 0]));
const detailDeferredBySource = new Map(sourceIds.map((id) => [id, 0]));
const errors = [];
const sourceReports = [];
const rejections = {};
let pages = 0;
let seen = 0;
let normalized = 0;
let knowledgeEnriched = 0;
let detailEnriched = 0;
let detailDeferred = 0;
let calculationPending = 0;
let galleriesAccumulated = 0;
let candidatePoolsLoaded = 0;
let candidatePoolsPersisted = 0;

function reject(reason) { rejections[reason] = Number(rejections[reason] || 0) + 1; }
function addError(row) { if (errors.length < 5000) errors.push(row); }
function reserveDetail(sourceId) {
  const used = Number(detailReservations.get(sourceId) || 0);
  if (used >= detailLimitPerSource) return false;
  detailReservations.set(sourceId, used + 1);
  return true;
}
function mergedRows() {
  const output = [];
  for (const sourceId of sourceIds) {
    const live = [...fresh.get(sourceId).values()].sort(quality);
    const old = [...retained.get(sourceId).values()].filter((offer) => !fresh.get(sourceId).has(offer.id)).sort(quality);
    output.push(...[...live, ...old].sort(quality).slice(0, targetPerSource));
  }
  return output.sort(quality);
}
function counts(map) { return Object.fromEntries(sourceIds.map((id) => [id, map.get(id).size])); }
function numericCounts(map) { return Object.fromEntries(sourceIds.map((id) => [id, Number(map.get(id) || 0)])); }
function candidateClassification(offers) {
  const reasons = {};
  let publishEligible = 0;
  for (const offer of offers) {
    const classification = classifyCatalogV2Offer(offer);
    if (classification.eligible) publishEligible++;
    else reasons[classification.reason] = Number(reasons[classification.reason] || 0) + 1;
  }
  return { publishEligible, reasons };
}
function report(stopReason = "running") {
  const offers = mergedRows();
  const classification = candidateClassification(offers);
  const priorityOffers = offers.filter(isMassMarketPriority).length;
  const imageCounts = offers.map((offer) => Number(offer?.images?.length || 0));
  return {
    version: 42, market, shardIndex, shardCount, generatedAt: new Date().toISOString(), targetPerSource,
    minimumMarketTarget, count: offers.length, sourceIds, liveSourceIds, retentionSourceIds,
    partial: offers.length < Math.ceil(minimumMarketTarget / shardCount), stopReason,
    report: {
      version: 42, market, shardIndex, shardCount, targetPerSource, minimumImages, preferredImages, maximumImages, networkImageLimit,
      detailLimitPerSource, maxPagesPerSource, maxTotalPages, maxEmptyPages, maxSourceErrors,
      detailReservationsBySource: numericCounts(detailReservations), detailSuccessBySource: numericCounts(detailSuccessBySource),
      detailDeferredBySource: numericCounts(detailDeferredBySource), detailDeferred, calculationPending, galleriesAccumulated,
      priorityMaxTotalRub, priorityMaxPowerHp, priorityMinYear, priorityOffers,
      candidateCount: offers.length, publishEligibleCount: classification.publishEligible,
      candidateRejectionReasons: classification.reasons, candidatePoolsLoaded, candidatePoolsPersisted,
      retentionMs, pages, seen, normalized, knowledgeEnriched, detailEnriched, saved: offers.length, liveSourceIds, retentionSourceIds,
      imageStats: {
        minimum: imageCounts.length ? Math.min(...imageCounts) : 0,
        maximum: imageCounts.length ? Math.max(...imageCounts) : 0,
        average: imageCounts.length ? Number((imageCounts.reduce((sum, count) => sum + count, 0) / imageCounts.length).toFixed(2)) : 0,
        preferredShare: imageCounts.length ? Number((imageCounts.filter((count) => count >= preferredImages).length / imageCounts.length).toFixed(4)) : 0,
      },
      publicBySource: Object.fromEntries(sourceIds.map((id) => [id, offers.filter((offer) => offer.sourceId === id && classifyCatalogV2Offer(offer).eligible).length])),
      candidatesBySource: Object.fromEntries(sourceIds.map((id) => [id, offers.filter((offer) => offer.sourceId === id).length])),
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
async function persistCandidatePools() {
  const cutoff = Date.now() - retentionMs;
  for (const sourceId of sourceIds) {
    const byId = new Map();
    for (const offer of retained.get(sourceId).values()) {
      if (offer?.id && firstSeen(offer) >= cutoff) byId.set(offer.id, offer);
    }
    for (const offer of fresh.get(sourceId).values()) {
      if (offer?.id && firstSeen(offer) >= cutoff) byId.set(offer.id, offer);
    }
    const rows = [...byId.values()].sort(quality).slice(0, targetPerSource);
    try {
      await replaceChunkedDataJson(candidatePath(sourceId), rows, 500);
      candidatePoolsPersisted += rows.length;
    } catch (error) {
      addError({ sourceId, stage: "candidate_pool_write", error: String(error?.message || error) });
    }
  }
}

let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
  if (shuttingDown) return;
  shuttingDown = true;
  persistCandidatePools()
    .then(() => checkpoint(`signal_${signal.toLowerCase()}`))
    .finally(() => process.exit(0));
});

const storage = getJsonStorage();
const cutoff = Date.now() - retentionMs;
for (const sourceId of sourceIds) {
  try {
    const rows = await readChunkedDataJson(candidatePath(sourceId), []);
    const bucket = retained.get(sourceId);
    for (const row of rows.sort(quality)) {
      if (!row?.id || bucket.has(row.id) || bucket.size >= targetPerSource || firstSeen(row) < cutoff) continue;
      const offer = normalizeVehicleOfferSpecs({ ...row, status: "active", images: images(row.images) });
      if (offer.images.length >= minimumImages && isCrediblePublicOffer(offer)) {
        bucket.set(offer.id, offer);
        candidatePoolsLoaded++;
      }
    }
  } catch (error) {
    addError({ sourceId, stage: "candidate_pool_read", error: String(error?.message || error) });
  }
}

let publicRows = [];
let internalRows = [];
try { publicRows = await readMarketOffers(market); } catch (error) { addError({ stage: "retention_public", error: String(error?.message || error) }); }
try { internalRows = await readAllOffersForMaintenance(); } catch (error) { addError({ stage: "retention_internal", error: String(error?.message || error) }); }
for (const row of [...publicRows, ...internalRows].sort(quality)) {
  const sourceId = String(row?.sourceId || "");
  const bucket = retained.get(sourceId);
  if (!bucket || !row?.id || !catalogRetainedOfferBelongsToPartition(row.id, partitionFor(sourceId))
    || bucket.has(row.id) || bucket.size >= targetPerSource || firstSeen(row) < cutoff) continue;
  const offer = normalizeVehicleOfferSpecs({ ...row, status: "active", images: images(row.images) });
  if (offer.images.length >= minimumImages && isCrediblePublicOffer(offer)) bucket.set(offer.id, offer);
}
await checkpoint("retention_loaded");

async function calculateSafely(offer, stage) {
  try {
    return normalizeVehicleOfferSpecs(await calculateOfferWithRussiaCustoms(offer));
  } catch (error) {
    addError({ sourceId: offer.sourceId, offerId: offer.id, stage, error: String(error?.message || error) });
    calculationPending++;
    return normalizeVehicleOfferSpecs({ ...offer, totalRub: null, calculationStatus: "needs_data" });
  }
}

async function prepare(base, source) {
  if (expired()) return null;
  const sourceId = String(base?.sourceId || "");
  const previous = retained.get(sourceId)?.get(base?.id);
  const accumulatedImages = images([...(previous?.images || []), ...(base?.images || [])]);
  if (previous && accumulatedImages.length > Number(base?.images?.length || 0)) galleriesAccumulated++;
  let offer = normalizeVehicleOfferSpecs({
    ...(previous || {}),
    ...base,
    firstSeenAt: previous?.firstSeenAt || base?.firstSeenAt,
    images: accumulatedImages,
    operational: {
      ...(previous?.operational || {}),
      ...(base?.operational || {}),
      raw: { ...(previous?.operational?.raw || {}), ...(base?.operational?.raw || {}) },
    },
  });
  if (!offer?.id || offer.market !== market || !sourceIds.includes(String(offer.sourceId || ""))) { reject("identity"); return null; }
  if (commercial.test(`${offer.make || ""} ${offer.model || ""} ${offer.trim || ""} ${offer.bodyType || ""}`)) { reject("commercial"); return null; }

  const powerBeforeKnowledge = Number(offer.powerHp || 0);
  try {
    offer = normalizeVehicleOfferSpecs(await enrichOfferWithKnowledgeCore(offer));
    if (!powerBeforeKnowledge && Number(offer.powerHp || 0)) knowledgeEnriched++;
  } catch (error) {
    addError({ sourceId: offer.sourceId, offerId: offer.id, stage: "knowledge", error: String(error?.message || error) });
  }

  if (!Number(offer.sourcePrice || 0) || !offer.sourceCurrency || !offer.operational?.sourceUrl) { reject("source_data"); return null; }
  let gallery = images(offer.images);

  offer = await calculateSafely(offer, "calculation_before_detail");
  const powertrainKind = String(offer.powertrainKind || "");
  const combustionSpecsMissing = !["electric", "series_hybrid"].includes(powertrainKind) && !Number(offer.engineCc || 0);
  const criticalSpecsMissing = !Number(offer.powerHp || 0) || combustionSpecsMissing || !String(offer.fuel || "").trim();
  const mandatoryPhotoMissing = gallery.length < minimumImages;
  const priorityGalleryMissing = gallery.length < preferredImages && isMassMarketPriority(offer);
  const detailNeeded = mandatoryPhotoMissing || criticalSpecsMissing || priorityGalleryMissing;
  let detailDeferredForOffer = false;

  if (detailNeeded && source?.fetchImages && !expired()) {
    if (reserveDetail(String(offer.sourceId))) {
      try {
        const detailedImages = (await source.fetchImages(offer)) || [];
        offer = normalizeVehicleOfferSpecs(offer);
        gallery = images([...gallery, ...detailedImages]);
        detailEnriched++;
        detailSuccessBySource.set(String(offer.sourceId), Number(detailSuccessBySource.get(String(offer.sourceId)) || 0) + 1);
      } catch (error) {
        addError({ sourceId: offer.sourceId, offerId: offer.id, stage: "gallery_detail", error: String(error?.message || error) });
      }
    } else {
      detailDeferred++;
      detailDeferredForOffer = true;
      detailDeferredBySource.set(String(offer.sourceId), Number(detailDeferredBySource.get(String(offer.sourceId)) || 0) + 1);
    }
  }

  if (gallery.length < minimumImages) { reject(detailDeferredForOffer ? "images_detail_budget" : "images"); return null; }
  const now = new Date().toISOString();
  offer = normalizeVehicleOfferSpecs({
    ...offer, status: "active", images: gallery, updatedAt: now,
    operational: { ...offer.operational, fullRebuildAt: now, galleryVerified: true, galleryImageCount: gallery.length,
      gallerySourceImageCount: Math.max(gallery.length, Number(offer.operational?.gallerySourceImageCount || 0)), galleryPreferredCount: preferredImages,
      galleryPreferredReached: gallery.length >= preferredImages, galleryEnrichmentStatus: gallery.length >= preferredImages ? "preferred" : detailDeferredForOffer ? "deferred" : "partial",
      galleryRebuiltFrom: previous ? "retention_plus_fresh_listing" : "fresh_listing", seoEligible: true },
  });
  offer = await calculateSafely(offer, "calculation_after_detail");
  if (!isCrediblePublicOffer(offer)) { reject("quality"); return null; }
  return offer;
}

const states = await pool(liveSourceIds, sourceConcurrency, async (sourceId) => {
  const partition = partitionFor(sourceId);
  let saved = { cursor: null, cycle: 0, pagesVisited: 0 };
  try { saved = await storage.readJson(cursorPath(sourceId), saved); } catch (error) { addError({ sourceId, stage: "cursor_read", error: String(error?.message || error) }); }
  const partitionStart = catalogPartitionInitialCursor(partition);
  const initialCursor = resetCursor ? partitionStart : saved.cursor || partitionStart;
  return { sourceId, source: adapters.get(sourceId), cursor: initialCursor, initialCursor,
    partition, cycle: Number(saved.cycle || 0), pagesVisited: Number(saved.pagesVisited || 0), pages: 0, errors: 0, empty: 0, done: false, stopReason: "running", seenCursors: new Set() };
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
    if (state.errors >= maxSourceErrors) { state.done = true; state.stopReason = "source_errors"; }
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
  bases.sort(quality);
  const before = bucket.size;
  for (const offer of await pool(bases, pagePrepareConcurrency, (base) => prepare(base, state.source))) {
    if (offer && bucket.size < targetPerSource) bucket.set(offer.id, offer);
  }
  state.empty = bucket.size === before ? state.empty + 1 : 0;
  const nextCursor = catalogPartitionNextCursor(state.cursor, fetched?.nextCursor || null, state.partition);
  const finished = Boolean((fetched?.finished && !nextCursor) || !nextCursor);
  try {
    await storage.writeJson(cursorPath(state.sourceId), { version: 2, market, sourceId: state.sourceId,
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
    detailReserved: Number(detailReservations.get(state.sourceId) || 0), detailSucceeded: Number(detailSuccessBySource.get(state.sourceId) || 0),
    detailDeferred: Number(detailDeferredBySource.get(state.sourceId) || 0), partition: state.partition,
    initialCursor: state.initialCursor, nextCursor: state.cursor,
    cycle: state.cycle, pagesVisited: state.pagesVisited, stopReason: state.stopReason });
}
for (const sourceId of retentionSourceIds.filter((id) => !liveSourceIds.includes(id))) {
  sourceReports.push({ sourceId, mode: "retention_only", target: targetPerSource, freshSaved: 0,
    restoredSaved: retained.get(sourceId).size, pages: 0, errors: 0, emptyPages: 0, detailReserved: 0, detailSucceeded: 0, detailDeferred: 0,
    stopReason: "probe_inactive" });
}
const stopReason = expired() ? "deadline" : pages >= maxTotalPages ? "total_page_limit" : liveSourceIds.length ? "sources_exhausted" : "no_active_sources";
await persistCandidatePools();
await checkpoint(stopReason);
console.log(JSON.stringify(report(stopReason).report, null, 2));
