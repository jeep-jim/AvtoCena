import fs from "node:fs/promises";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { credibleCatalogImages, isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { readAllOffersForMaintenance, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { getJsonStorage } = await import("../apps/web/lib/data.ts");

const market = String(process.env.CATALOG_REBUILD_MARKET || "").trim();
const targetPerSource = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET_PER_SOURCE || 1_000));
const minimumMarketTarget = Math.max(1_000, Number(process.env.CATALOG_REBUILD_TARGET_PER_MARKET || 1_000));
const minimumImages = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 1));
const preferredImages = Math.max(minimumImages, Number(process.env.CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER || 6));
const maxImages = Math.min(30, Math.max(preferredImages, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
const maxPagesPerSource = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_PAGES_PER_SOURCE || 180));
const maxEmptyPages = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_EMPTY_PAGES || 4));
const prepareConcurrency = Math.max(1, Math.min(30, Number(process.env.CATALOG_REBUILD_PREPARE_CONCURRENCY || 16)));
const sourceConcurrency = Math.max(1, Math.min(12, Number(process.env.CATALOG_REBUILD_SOURCE_CONCURRENCY || 6)));
const pagePrepareConcurrency = Math.max(1, Math.floor(prepareConcurrency / Math.max(1, sourceConcurrency)));
const checkpointEvery = Math.max(10, Number(process.env.CATALOG_REBUILD_CHECKPOINT_EVERY || 25));
const timeLimitMs = Math.max(60_000, Number(process.env.CATALOG_REBUILD_TIME_LIMIT_MS || 32 * 60 * 1_000));
const retentionMs = Math.max(60_000, Number(process.env.CATALOG_OFFER_RETENTION_MS || 3 * 24 * 60 * 60 * 1_000));
const shardIndex = Math.max(0, Number(process.env.CATALOG_REBUILD_SHARD_INDEX || 0));
const shardCount = Math.max(1, Number(process.env.CATALOG_REBUILD_SHARD_COUNT || 1));
const outputFile = process.env.CATALOG_REBUILD_OUTPUT || `catalog-rebuild-${market}-${shardIndex}.json`;
const startedAtMs = Date.now();
const deadlineAtMs = startedAtMs + timeLimitMs;
const COMMERCIAL_RE = /\b(?:truck|dump|tipper|bus|minibus|kei\s*truck|commercial|cargo|lorry|tractor|forklift|excavator|machinery|canter|fighter|ranger|dutro|forward|giga|elf|profia|8\s*tonne|8\s*ton)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;

const priorityPlan = {
  korea: ["encar_direct", "kcar_korea_open"],
  china: ["guazi_china_open", "che168_china_exact", "guazi_china_export", "autohome_used_china_open", "dongchedi_china_open", "autohome_new_china_open"],
  japan: ["carused_japan_open", "tcv_japan_open", "goonet_japan_exact", "goonet_japan", "beforward_japan", "jpcenter_japan_catalog_open", "jpauc_japan_past_open", "carvector_japan_stat_open"],
  uae: ["dubicars_uae_exact", "dubizzle_uae_open", "dubicars_clean", "beforward_uae"],
  europe: ["mobile_de_open", "autoscout_europe_open", "otomoto_europe_exact", "otomoto_pl_open", "autouncle_europe"],
  georgia: ["myauto_georgia_exact", "autopapa_georgia_open"],
  kyrgyzstan: ["mashina_kyrgyzstan_exact"],
};

if (!Object.prototype.hasOwnProperty.call(priorityPlan, market)) throw new Error(`unsupported_rebuild_market_${market || "missing"}`);

function stableShard(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % shardCount;
}

const adapters = new Map(catalogImportSources.map((source) => [source.sourceId, source]));
const registered = catalogImportSources
  .filter((source) => source.market === market || source.market === "multi")
  .map((source) => source.sourceId);
const priorityRank = new Map(priorityPlan[market].map((sourceId, index) => [sourceId, index]));
const plannedAll = [...new Set([...priorityPlan[market], ...registered])]
  .filter((sourceId) => adapters.has(sourceId))
  .sort((left, right) => (priorityRank.get(left) ?? 10_000) - (priorityRank.get(right) ?? 10_000) || left.localeCompare(right));
const plannedSourceIds = plannedAll.filter((sourceId) => stableShard(sourceId) === shardIndex);
const configuredSources = String(process.env.CATALOG_REBUILD_SOURCE_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value && !value.startsWith("__"));
const orderedConfigured = configuredSources.filter((sourceId) => plannedSourceIds.includes(sourceId));
const liveSourceIds = [...new Set([...orderedConfigured, ...plannedSourceIds])];
const retentionSourceIds = plannedSourceIds;
const sourceIds = [...new Set([...liveSourceIds, ...retentionSourceIds])];
const target = Math.max(Math.ceil(minimumMarketTarget / shardCount), targetPerSource * Math.max(1, sourceIds.length));
const maxTotalPages = Math.max(maxPagesPerSource, Number(process.env.CATALOG_REBUILD_MAX_TOTAL_PAGES || maxPagesPerSource * Math.max(1, liveSourceIds.length)));
const seedScanLimit = Math.max(target, Number(process.env.CATALOG_REBUILD_SEED_SCAN_LIMIT || Math.max(10_000, target * 2)));
process.env.CATALOG_MAX_IMAGES_PER_OFFER = String(maxImages);

function text(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function normalizedToken(value) { return text(value).toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, ""); }
function collapseRepeatedPhrases(value) {
  const tokens = text(value).split(/\s+/).filter(Boolean);
  let changed = true;
  while (changed) {
    changed = false;
    const maxPhrase = Math.min(12, Math.floor(tokens.length / 2));
    outer: for (let length = maxPhrase; length >= 1; length--) {
      for (let start = 0; start + length * 2 <= tokens.length; start++) {
        const left = tokens.slice(start, start + length).map(normalizedToken).join(" ");
        const right = tokens.slice(start + length, start + length * 2).map(normalizedToken).join(" ");
        if (!left || left !== right) continue;
        tokens.splice(start + length, length);
        changed = true;
        break outer;
      }
    }
  }
  return tokens.join(" ").trim();
}
function removeLeading(value, phrase) {
  const source = text(value); const prefix = text(phrase);
  if (!source || !prefix) return source;
  const lower = source.toLocaleLowerCase("en-US"); const prefixLower = prefix.toLocaleLowerCase("en-US");
  if (lower === prefixLower) return "";
  return lower.startsWith(`${prefixLower} `) ? source.slice(prefix.length).trim() : source;
}
function cleanOffer(offer) {
  const make = collapseRepeatedPhrases(offer.make);
  const model = collapseRepeatedPhrases(removeLeading(offer.model, make));
  const base = [make, model].filter(Boolean).join(" ");
  let trim = collapseRepeatedPhrases(offer.trim);
  trim = removeLeading(removeLeading(removeLeading(trim, base), make), model);
  return normalizeVehicleOfferSpecs({ ...offer, make, model, trim: trim || undefined });
}
function isCommercial(offer) {
  return COMMERCIAL_RE.test(`${offer?.make || ""} ${offer?.model || ""} ${offer?.trim || ""} ${offer?.bodyType || ""}`)
    || /^(?:Hino|Mitsubishi Fuso)$/i.test(String(offer?.make || ""));
}
function imageKey(image) { return String(image?.checksum || image?.id || image?.objectKey || image?.url || ""); }
function uniqueImages(images) {
  const result = []; const seen = new Set();
  for (const image of credibleCatalogImages(Array.isArray(images) ? images : [])) {
    const key = imageKey(image);
    if (!key || seen.has(key)) continue;
    seen.add(key); result.push(image);
    if (result.length >= maxImages) break;
  }
  return result;
}
function freshness(offer) { return Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0; }
function qualityOrder(left, right) {
  const lp = Number(left?.images?.length || 0) >= preferredImages ? 1 : 0;
  const rp = Number(right?.images?.length || 0) >= preferredImages ? 1 : 0;
  return rp - lp || Number(right?.images?.length || 0) - Number(left?.images?.length || 0) || freshness(right) - freshness(left);
}
function deadlineReached() { return Date.now() >= deadlineAtMs; }
function safeSourceId(value) { return String(value || "unknown").replace(/[^a-z0-9_-]+/gi, "-"); }
function cursorPath(sourceId) { return `catalog/source-cursors/${market}/${safeSourceId(sourceId)}.json`; }

async function runWithConcurrency(items, concurrency, worker) {
  if (!items.length) return [];
  const results = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (true) {
      const current = cursor++;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  }));
  return results;
}

const offers = new Map();
const sourceCounts = new Map(sourceIds.map((sourceId) => [sourceId, 0]));
const freshCounts = new Map(sourceIds.map((sourceId) => [sourceId, 0]));
const restoredCounts = new Map(sourceIds.map((sourceId) => [sourceId, 0]));
const rejectionReasons = {};
const report = {
  version: 22, market, shardIndex, shardCount, targetPerSource, minimumMarketTarget, target,
  minimumImages, preferredImages, maxImages, maxPagesPerSource, maxTotalPages, maxEmptyPages,
  prepareConcurrency, pagePrepareConcurrency, sourceConcurrency, timeLimitMs, retentionMs,
  deadlineAt: new Date(deadlineAtMs).toISOString(), registeredSourceCount: registered.length,
  plannedSourceIds, liveSourceIds, retentionSourceIds, sourceIds,
  startedAt: new Date(startedAtMs).toISOString(), pages: 0, rounds: 0, seen: 0, normalized: 0,
  seedSeen: 0, seedSaved: 0, saved: 0, rejected: 0, commercialRejected: 0,
  imageFailures: 0, calculationFailures: 0, sourceErrors: [], sources: [], checkpoints: 0,
  stopReason: "running", partial: true, rejectionReasons,
};
function sourceCount(sourceId) { return Number(sourceCounts.get(sourceId) || 0); }
function sourceHasCapacity(sourceId) { return sourceCount(sourceId) < targetPerSource; }
function reject(reason) { rejectionReasons[reason] = Number(rejectionReasons[reason] || 0) + 1; report.rejected++; }
function addOffer(offer, origin) {
  if (!offer?.id || offers.has(offer.id) || !sourceCounts.has(offer.sourceId) || !sourceHasCapacity(offer.sourceId)) return false;
  offers.set(offer.id, offer);
  sourceCounts.set(offer.sourceId, sourceCount(offer.sourceId) + 1);
  if (origin === "fresh_listing") freshCounts.set(offer.sourceId, Number(freshCounts.get(offer.sourceId) || 0) + 1);
  else restoredCounts.set(offer.sourceId, Number(restoredCounts.get(offer.sourceId) || 0) + 1);
  report.saved = offers.size;
  return true;
}
function recordError(row) { if (report.sourceErrors.length < 2_000) report.sourceErrors.push(row); }
function payload(stopReason = report.stopReason, partial = true) {
  const generatedAt = new Date().toISOString();
  const rows = [...offers.values()].sort(qualityOrder);
  return {
    version: 22, market, shardIndex, shardCount, generatedAt, targetPerSource, minimumMarketTarget,
    target, count: rows.length, sourceIds, liveSourceIds, retentionSourceIds, partial, stopReason,
    report: {
      ...report, saved: rows.length, publicBySource: Object.fromEntries(sourceCounts),
      freshBySource: Object.fromEntries(freshCounts), restoredBySource: Object.fromEntries(restoredCounts),
      partial, stopReason, lastCheckpointAt: generatedAt,
      marketMinimumShare: Number((rows.length / Math.ceil(minimumMarketTarget / shardCount)).toFixed(4)),
    },
    offers: rows,
  };
}
let writeChain = Promise.resolve();
function writeProgress(stopReason = report.stopReason, partial = true) {
  const snapshot = payload(stopReason, partial); const temporary = `${outputFile}.tmp`;
  writeChain = writeChain.catch(() => undefined).then(async () => {
    await fs.writeFile(temporary, JSON.stringify(snapshot, null, 2));
    await fs.rename(temporary, outputFile);
    report.checkpoints++;
  });
  return writeChain;
}
let lastCheckpointSize = 0;
async function checkpointIfNeeded(force = false) {
  if (!force && offers.size - lastCheckpointSize < checkpointEvery) return;
  lastCheckpointSize = offers.size;
  await writeProgress(deadlineReached() ? "deadline" : "running", true);
}

async function prepareCandidate(input, source, origin) {
  if (deadlineReached()) return null;
  let offer = cleanOffer({ ...input });
  if (!offer || offer.market !== market || !offer.id || !sourceCounts.has(offer.sourceId) || !sourceHasCapacity(offer.sourceId)) { reject("identity"); return null; }
  if (isCommercial(offer)) { report.commercialRejected++; reject("commercial"); return null; }
  if (!Number.isFinite(Number(offer.sourcePrice)) || Number(offer.sourcePrice) <= 0 || !offer.sourceCurrency || !offer.operational?.sourceUrl) { reject("source_data"); return null; }

  let images = uniqueImages(offer.images || []);
  // Объёмный проход требует одну реальную фотографию. Шесть — предпочтение, а не причина
  // выбрасывать исправную карточку. Адаптер продолжает забирать до 30 фото, когда они доступны.
  const requiredBeforeNetwork = minimumImages;
  if (images.length < requiredBeforeNetwork && source?.fetchImages && !deadlineReached()) {
    try {
      const fetched = await source.fetchImages(offer);
      images = uniqueImages([...images, ...(Array.isArray(fetched) ? fetched : [])]);
    } catch (error) {
      recordError({ sourceId: offer.sourceId, offerId: offer.id, origin, stage: "gallery", error: String(error?.message || error) });
    }
  }
  if (images.length < minimumImages) { report.imageFailures++; reject("images"); return null; }

  const now = new Date().toISOString();
  offer = cleanOffer({
    ...offer,
    status: "active",
    images,
    updatedAt: now,
    operational: {
      ...offer.operational,
      fullRebuildAt: now,
      galleryVerified: true,
      galleryImageCount: images.length,
      gallerySourceImageCount: images.length,
      galleryPreferredCount: preferredImages,
      galleryPreferredReached: images.length >= preferredImages,
      galleryRebuiltFrom: origin,
      seoEligible: Boolean(offer.operational?.sourceUrl && images.length >= minimumImages),
    },
  });
  try {
    offer = cleanOffer(await calculateOfferWithRussiaCustoms(offer));
  } catch (error) {
    report.calculationFailures++;
    recordError({ sourceId: offer.sourceId, offerId: offer.id, origin, stage: "calculation", error: String(error?.message || error) });
    reject("calculation");
    return null;
  }
  if (!isCrediblePublicOffer(offer)) { reject("quality"); return null; }
  return offer;
}

let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
  if (shuttingDown) return;
  shuttingDown = true;
  report.stopReason = `signal_${signal.toLowerCase()}`;
  writeProgress(report.stopReason, true).finally(() => process.exit(0));
});

if (!sourceIds.length) {
  report.stopReason = "empty_shard";
  report.partial = true;
  report.finishedAt = new Date().toISOString();
  await writeProgress(report.stopReason, true);
  console.log(JSON.stringify(payload(report.stopReason, true).report, null, 2));
  process.exit(0);
}

const storage = getJsonStorage();
async function readCursorState(sourceId) {
  try {
    return await storage.readJson(cursorPath(sourceId), { version: 1, market, sourceId, cursor: null, cycle: 0, pagesVisited: 0 });
  } catch (error) {
    recordError({ sourceId, stage: "cursor_read", error: String(error?.message || error) });
    return { version: 1, market, sourceId, cursor: null, cycle: 0, pagesVisited: 0 };
  }
}
async function saveCursorState(state, nextCursor, finished = false) {
  const next = {
    version: 1,
    market,
    sourceId: state.sourceId,
    cursor: finished ? null : nextCursor,
    cycle: Number(state.cycle || 0) + (finished ? 1 : 0),
    pagesVisited: Number(state.pagesVisited || 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  try { await storage.writeJson(cursorPath(state.sourceId), next); }
  catch (error) { recordError({ sourceId: state.sourceId, stage: "cursor_write", error: String(error?.message || error) }); }
  state.cycle = next.cycle;
  state.pagesVisited = next.pagesVisited;
}

const sourceStates = await runWithConcurrency(liveSourceIds, sourceConcurrency, async (sourceId) => {
  const saved = await readCursorState(sourceId);
  return {
    sourceId,
    source: adapters.get(sourceId),
    cursor: saved?.cursor || null,
    initialCursor: saved?.cursor || null,
    cycle: Number(saved?.cycle || 0),
    pagesVisited: Number(saved?.pagesVisited || 0),
    pages: 0,
    errors: 0,
    emptyPages: 0,
    savedFresh: 0,
    done: false,
    stopReason: "running",
    seenCursors: new Set(),
  };
});

async function processSourcePage(state) {
  if (state.done || !state.source || !sourceHasCapacity(state.sourceId) || deadlineReached() || report.pages >= maxTotalPages) return;
  if (state.pages >= maxPagesPerSource) { state.done = true; state.stopReason = "source_page_limit"; return; }
  const cursorKey = JSON.stringify(state.cursor ?? "first");
  if (state.seenCursors.has(cursorKey)) { state.done = true; state.stopReason = "cursor_loop"; return; }
  state.seenCursors.add(cursorKey);

  let fetched;
  try {
    fetched = await state.source.fetchPage(state.cursor);
    state.errors = 0;
  } catch (error) {
    state.errors++;
    state.seenCursors.delete(cursorKey);
    recordError({ sourceId: state.sourceId, cursor: state.cursor, stage: "list", error: String(error?.message || error) });
    if (state.errors >= 2 || deadlineReached()) {
      state.done = true;
      state.stopReason = state.errors >= 2 ? "source_errors" : "deadline";
    }
    return;
  }

  state.pages++;
  report.pages++;
  const rows = Array.isArray(fetched?.items) ? fetched.items : [];
  report.seen += rows.length;
  const remaining = Math.max(0, targetPerSource - sourceCount(state.sourceId));
  const batchIds = new Set();
  const normalizedRows = [];
  for (const raw of rows) {
    let base = null;
    try { base = state.source.normalizeOffer(raw); } catch { base = null; }
    if (!base || base.market !== market || base.sourceId !== state.sourceId || !base.id || offers.has(base.id) || batchIds.has(base.id)) continue;
    batchIds.add(base.id);
    normalizedRows.push(base);
    report.normalized++;
    if (normalizedRows.length >= remaining) break;
  }

  const before = sourceCount(state.sourceId);
  const preparedRows = await runWithConcurrency(normalizedRows, pagePrepareConcurrency, (base) => prepareCandidate(base, state.source, "fresh_listing"));
  for (const prepared of preparedRows) if (prepared && addOffer(prepared, "fresh_listing")) state.savedFresh++;
  const after = sourceCount(state.sourceId);
  state.emptyPages = after === before ? state.emptyPages + 1 : 0;

  const nextCursor = fetched?.nextCursor || null;
  const finished = Boolean((fetched?.finished && !nextCursor) || !nextCursor);
  await saveCursorState(state, nextCursor, finished);
  state.cursor = nextCursor;

  if (!sourceHasCapacity(state.sourceId)) { state.done = true; state.stopReason = "source_target_reached"; return; }
  if (finished) { state.done = true; state.stopReason = "source_cycle_finished"; return; }
  if (state.emptyPages >= maxEmptyPages) { state.done = true; state.stopReason = "no_progress"; }
}

while (!deadlineReached() && report.pages < maxTotalPages) {
  const active = sourceStates.filter((state) => !state.done && sourceHasCapacity(state.sourceId) && state.pages < maxPagesPerSource);
  if (!active.length) break;
  report.rounds++;
  await runWithConcurrency(active, sourceConcurrency, processSourcePage);
  await checkpointIfNeeded();
  if (report.rounds % 4 === 0) await checkpointIfNeeded(true);
}

let internalRows = [];
let publicRows = [];
try { internalRows = await readAllOffersForMaintenance(); } catch (error) { recordError({ stage: "retention_internal", error: String(error?.message || error) }); }
try { publicRows = await readMarketOffers(market); } catch (error) { recordError({ stage: "retention_public", error: String(error?.message || error) }); }
const cutoff = Date.now() - retentionMs;
const restoredMap = new Map();
for (const offer of [...publicRows, ...internalRows]
  .filter((offer) => offer && offer.market === market && sourceCounts.has(offer.sourceId) && ["active", "stale"].includes(String(offer.status || "")) && freshness(offer) >= cutoff)
  .sort(qualityOrder)) {
  if (!restoredMap.has(offer.id) && !offers.has(offer.id)) restoredMap.set(offer.id, offer);
  if (restoredMap.size >= seedScanLimit) break;
}
const restoredSeeds = [...restoredMap.values()];
for (let index = 0; index < restoredSeeds.length && !deadlineReached(); index += prepareConcurrency) {
  const batch = restoredSeeds.slice(index, index + prepareConcurrency).filter((seed) => sourceHasCapacity(seed.sourceId));
  if (!batch.length) continue;
  report.seedSeen += batch.length;
  const preparedRows = await runWithConcurrency(batch, prepareConcurrency, (seed) => prepareCandidate(seed, adapters.get(seed.sourceId), "revalidated_listing"));
  for (const prepared of preparedRows) {
    if (!prepared || !addOffer(prepared, "revalidated_listing")) continue;
    report.seedSaved++;
  }
  await checkpointIfNeeded();
}

for (const state of sourceStates) {
  if (!state.done) state.stopReason = deadlineReached() ? "deadline" : report.pages >= maxTotalPages ? "total_page_limit" : state.pages >= maxPagesPerSource ? "source_page_limit" : "stopped";
  report.sources.push({
    sourceId: state.sourceId,
    mode: "live",
    target: targetPerSource,
    totalSaved: sourceCount(state.sourceId),
    freshSaved: Number(freshCounts.get(state.sourceId) || 0),
    restoredSaved: Number(restoredCounts.get(state.sourceId) || 0),
    initialCursor: state.initialCursor,
    nextCursor: state.cursor,
    cycle: state.cycle,
    pagesVisited: state.pagesVisited,
    pages: state.pages,
    emptyPages: state.emptyPages,
    errors: state.errors,
    stopReason: state.stopReason,
  });
}
for (const sourceId of retentionSourceIds.filter((sourceId) => !liveSourceIds.includes(sourceId))) {
  report.sources.push({ sourceId, mode: "retention_only", target: targetPerSource, totalSaved: sourceCount(sourceId), freshSaved: 0, restoredSaved: Number(restoredCounts.get(sourceId) || 0), pages: 0, stopReason: "retention_only" });
}

report.finishedAt = new Date().toISOString();
report.saved = offers.size;
report.marketShardMinimum = Math.ceil(minimumMarketTarget / shardCount);
report.marketShardMinimumReached = offers.size >= report.marketShardMinimum;
report.stopReason = deadlineReached() ? "deadline" : report.pages >= maxTotalPages ? "total_page_limit" : "sources_exhausted";
report.partial = !report.marketShardMinimumReached;
report.publicBySource = Object.fromEntries(sourceCounts);
report.freshBySource = Object.fromEntries(freshCounts);
report.restoredBySource = Object.fromEntries(restoredCounts);
report.durationMs = Date.now() - startedAtMs;
await writeProgress(report.stopReason, report.partial);
console.log(JSON.stringify(payload(report.stopReason, report.partial).report, null, 2));
