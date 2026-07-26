import fs from "node:fs/promises";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { credibleCatalogImages, isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { readAllOffersForMaintenance, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");

const market = String(process.env.CATALOG_REBUILD_MARKET || "").trim();
const targetPerSource = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET_PER_SOURCE || 1_000));
const minimumImages = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 1));
const preferredImages = Math.max(minimumImages, Number(process.env.CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER || 6));
const maxImages = Math.min(30, Math.max(preferredImages, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
const maxPagesPerSource = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_PAGES_PER_SOURCE || 250));
const maxEmptyPages = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_EMPTY_PAGES || 12));
const prepareConcurrency = Math.max(1, Math.min(20, Number(process.env.CATALOG_REBUILD_PREPARE_CONCURRENCY || 10)));
const sourceConcurrency = Math.max(1, Math.min(10, Number(process.env.CATALOG_REBUILD_SOURCE_CONCURRENCY || 4)));
const pagePrepareConcurrency = Math.max(1, Math.floor(prepareConcurrency / Math.max(1, sourceConcurrency)));
const checkpointEvery = Math.max(10, Number(process.env.CATALOG_REBUILD_CHECKPOINT_EVERY || 25));
const timeLimitMs = Math.max(60_000, Number(process.env.CATALOG_REBUILD_TIME_LIMIT_MS || 70 * 60 * 1_000));
const shardIndex = Math.max(0, Number(process.env.CATALOG_REBUILD_SHARD_INDEX || 0));
const shardCount = Math.max(1, Number(process.env.CATALOG_REBUILD_SHARD_COUNT || 1));
const outputFile = process.env.CATALOG_REBUILD_OUTPUT || `catalog-rebuild-${market}-${shardIndex}.json`;
const startedAtMs = Date.now();
const deadlineAtMs = startedAtMs + timeLimitMs;

const sourcePlan = {
  korea: ["encar_direct", "kcar_korea_open"],
  china: ["che168_china_exact", "che168_dealer_resilient", "guazi_china_export", "guazi_china_open", "dongchedi_china_open", "autohome_used_china_open", "autohome_new_china_open"],
  japan: ["goonet_japan_exact", "goonet_japan", "beforward_japan", "beforward_japan_open", "jpauc_japan_past_open", "carvector_japan_stat_open", "jpcenter_japan_catalog_open", "prestige_japan_auctions_open"],
  uae: ["dubizzle_uae_open", "dubicars_uae_exact", "dubicars_clean", "beforward_uae"],
  europe: ["mobile_de_open", "autoscout_europe_open", "autouncle_europe", "otomoto_europe_exact", "otomoto_pl_open", "beforward_uk", "beforward_belgium"],
  georgia: ["myauto_georgia_exact", "autopapa_georgia_open"],
  kyrgyzstan: ["mashina_kyrgyzstan_exact"],
};

if (!Object.prototype.hasOwnProperty.call(sourcePlan, market)) throw new Error(`unsupported_rebuild_market_${market || "missing"}`);

function stableShard(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % shardCount;
}

const adapters = new Map(catalogImportSources.map((source) => [source.sourceId, source]));
const connectedMarketSources = catalogImportSources
  .filter((source) => source.market === market || source.market === "multi")
  .map((source) => source.sourceId);
const configuredSources = String(process.env.CATALOG_REBUILD_SOURCE_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
const allSourceIds = configuredSources.length
  ? [...new Set(configuredSources)]
  : [...new Set([...sourcePlan[market], ...connectedMarketSources])];
const sourceIds = allSourceIds.filter((sourceId) => stableShard(sourceId) === shardIndex);
const target = targetPerSource * sourceIds.length;
const maxTotalPages = Math.max(maxPagesPerSource, Number(process.env.CATALOG_REBUILD_MAX_TOTAL_PAGES || maxPagesPerSource * Math.max(1, sourceIds.length)));
const seedScanLimit = Math.max(target, Number(process.env.CATALOG_REBUILD_SEED_SCAN_LIMIT || Math.max(5_000, target * 3)));
process.env.CATALOG_MAX_IMAGES_PER_OFFER = String(maxImages);

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedToken(value) {
  return text(value).toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}

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
  const source = text(value);
  const prefix = text(phrase);
  if (!source || !prefix) return source;
  const sourceLower = source.toLocaleLowerCase("en-US");
  const prefixLower = prefix.toLocaleLowerCase("en-US");
  if (sourceLower === prefixLower) return "";
  return sourceLower.startsWith(`${prefixLower} `) ? source.slice(prefix.length).trim() : source;
}

function cleanOffer(offer) {
  const make = collapseRepeatedPhrases(offer.make);
  const model = collapseRepeatedPhrases(removeLeading(offer.model, make));
  const base = [make, model].filter(Boolean).join(" ");
  let trim = collapseRepeatedPhrases(offer.trim);
  trim = removeLeading(removeLeading(removeLeading(trim, base), make), model);
  return normalizeVehicleOfferSpecs({ ...offer, make, model, trim: trim || undefined });
}

function imageKey(image) {
  return String(image?.checksum || image?.id || image?.objectKey || image?.url || "");
}

function uniqueImages(images) {
  const result = [];
  const seen = new Set();
  for (const image of credibleCatalogImages(Array.isArray(images) ? images : [])) {
    const key = imageKey(image);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(image);
    if (result.length >= maxImages) break;
  }
  return result;
}

function freshness(offer) {
  return Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0;
}

function qualityOrder(left, right) {
  const leftPreferred = Number(left?.images?.length || 0) >= preferredImages ? 1 : 0;
  const rightPreferred = Number(right?.images?.length || 0) >= preferredImages ? 1 : 0;
  return rightPreferred - leftPreferred
    || Number(right?.images?.length || 0) - Number(left?.images?.length || 0)
    || freshness(right) - freshness(left);
}

function deadlineReached() {
  return Date.now() >= deadlineAtMs;
}

async function runWithConcurrency(items, concurrency, worker) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
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
const report = {
  version: 17,
  market,
  shardIndex,
  shardCount,
  targetPerSource,
  target,
  minimumImages,
  preferredImages,
  maxImages,
  maxPagesPerSource,
  maxTotalPages,
  maxEmptyPages,
  prepareConcurrency,
  pagePrepareConcurrency,
  sourceConcurrency,
  timeLimitMs,
  deadlineAt: new Date(deadlineAtMs).toISOString(),
  allSourceIds,
  sourceIds,
  connectedMarketSources,
  startedAt: new Date(startedAtMs).toISOString(),
  pages: 0,
  rounds: 0,
  seen: 0,
  seedSeen: 0,
  seedSaved: 0,
  saved: 0,
  rejected: 0,
  imageFailures: 0,
  sourceErrors: [],
  sources: [],
  checkpoints: 0,
  stopReason: "running",
  partial: true,
};

function sourceCount(sourceId) {
  return Number(sourceCounts.get(sourceId) || 0);
}

function sourceHasCapacity(sourceId) {
  return sourceCount(sourceId) < targetPerSource;
}

function addOffer(offer) {
  if (!offer?.id || offers.has(offer.id) || !sourceCounts.has(offer.sourceId) || !sourceHasCapacity(offer.sourceId)) return false;
  offers.set(offer.id, offer);
  sourceCounts.set(offer.sourceId, sourceCount(offer.sourceId) + 1);
  report.saved = offers.size;
  return true;
}

function recordError(row) {
  if (report.sourceErrors.length < 1_000) report.sourceErrors.push(row);
}

function payload(stopReason = report.stopReason, partial = true) {
  const generatedAt = new Date().toISOString();
  const rows = [...offers.values()].sort(qualityOrder);
  return {
    version: 17,
    market,
    shardIndex,
    shardCount,
    generatedAt,
    targetPerSource,
    target,
    count: rows.length,
    sourceIds,
    partial,
    stopReason,
    report: {
      ...report,
      saved: rows.length,
      publicBySource: Object.fromEntries(sourceCounts),
      partial,
      stopReason,
      lastCheckpointAt: generatedAt,
      targetReached: sourceIds.every((sourceId) => sourceCount(sourceId) >= targetPerSource),
    },
    offers: rows,
  };
}

let writeChain = Promise.resolve();
function writeProgress(stopReason = report.stopReason, partial = true) {
  const snapshot = payload(stopReason, partial);
  const temporary = `${outputFile}.tmp`;
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
  if (!offer || offer.market !== market || !offer.id || !sourceCounts.has(offer.sourceId) || !sourceHasCapacity(offer.sourceId)) return null;

  let images = uniqueImages(offer.images || []);
  // Всегда пытаемся получить полную галерею, пока не набрано хотя бы шесть фото.
  // Одно реальное фото остаётся допустимым исключением, но предложения с 6+ фото сортируются выше.
  if (images.length < preferredImages && source?.fetchImages && !deadlineReached()) {
    try {
      const fetchedImages = await source.fetchImages(offer);
      images = uniqueImages([...images, ...(Array.isArray(fetchedImages) ? fetchedImages : [])]);
    } catch (error) {
      recordError({ sourceId: offer.sourceId, offerId: offer.id, origin, stage: "listing_gallery", error: String(error?.message || error) });
    }
  }
  if (images.length < minimumImages) {
    report.imageFailures++;
    return null;
  }

  offer = cleanOffer({
    ...offer,
    status: "active",
    images,
    operational: {
      ...offer.operational,
      fullRebuildAt: new Date().toISOString(),
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
    recordError({ sourceId: offer.sourceId, offerId: offer.id, origin, stage: "calculation", error: String(error?.message || error) });
    if (!Number(offer.totalRub || 0)) return null;
  }
  return isCrediblePublicOffer(offer) ? offer : null;
}

let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    report.stopReason = `signal_${signal.toLowerCase()}`;
    writeProgress(report.stopReason, true).finally(() => process.exit(0));
  });
}

if (!sourceIds.length) {
  report.stopReason = "empty_shard";
  report.partial = false;
  report.finishedAt = new Date().toISOString();
  await writeProgress(report.stopReason, false);
  console.log(JSON.stringify(payload(report.stopReason, false).report, null, 2));
  process.exit(0);
}

// Восстанавливаем только предложения источников текущего шарда и не позволяем одному
// источнику заполнить квоту другого.
const [internalRows, publicRows] = await Promise.all([
  readAllOffersForMaintenance(),
  readMarketOffers(market),
]);
const restoredMap = new Map();
for (const offer of [...publicRows, ...internalRows]
  .filter((offer) => offer && offer.market === market && sourceCounts.has(offer.sourceId) && ["active", "stale"].includes(String(offer.status || "")))
  .sort(qualityOrder)) {
  if (!restoredMap.has(offer.id)) restoredMap.set(offer.id, offer);
  if (restoredMap.size >= seedScanLimit) break;
}

const restoredSeeds = [...restoredMap.values()];
for (let index = 0; index < restoredSeeds.length && !deadlineReached(); index += prepareConcurrency) {
  const batch = restoredSeeds.slice(index, index + prepareConcurrency).filter((seed) => sourceHasCapacity(seed.sourceId));
  if (!batch.length) continue;
  report.seedSeen += batch.length;
  const preparedRows = await runWithConcurrency(batch, prepareConcurrency, (seed) => prepareCandidate(seed, adapters.get(seed.sourceId), "restored_listing"));
  for (const prepared of preparedRows) {
    if (!prepared || !addOffer(prepared)) continue;
    report.seedSaved++;
  }
  await checkpointIfNeeded();
}

const sourceStates = sourceIds.map((sourceId) => {
  const source = adapters.get(sourceId);
  if (!source) recordError({ sourceId, stage: "registry", error: `catalog_source_not_found_${sourceId}` });
  return {
    sourceId,
    source,
    cursor: null,
    pages: 0,
    errors: 0,
    emptyPages: 0,
    savedFresh: 0,
    done: !source || !sourceHasCapacity(sourceId),
    stopReason: !source ? "source_not_found" : !sourceHasCapacity(sourceId) ? "source_target_restored" : "running",
    seenCursors: new Set(),
  };
});

async function processSourcePage(state) {
  if (state.done || !state.source || !sourceHasCapacity(state.sourceId) || deadlineReached() || report.pages >= maxTotalPages) return;
  if (state.pages >= maxPagesPerSource) {
    state.done = true;
    state.stopReason = "source_page_limit";
    return;
  }

  const cursorKey = String(state.cursor ?? "first");
  if (state.seenCursors.has(cursorKey)) {
    state.done = true;
    state.stopReason = "cursor_loop";
    return;
  }
  state.seenCursors.add(cursorKey);

  let fetched;
  try {
    fetched = await state.source.fetchPage(state.cursor);
    state.errors = 0;
  } catch (error) {
    state.errors++;
    state.seenCursors.delete(cursorKey);
    recordError({ sourceId: state.sourceId, cursor: state.cursor, stage: "list", error: String(error?.message || error) });
    if (state.errors >= 4 || deadlineReached()) {
      state.done = true;
      state.stopReason = state.errors >= 4 ? "source_errors" : "deadline";
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
    if (normalizedRows.length >= remaining) break;
  }

  const beforeSource = sourceCount(state.sourceId);
  const preparedRows = await runWithConcurrency(normalizedRows, pagePrepareConcurrency, (base) => prepareCandidate(base, state.source, "fresh_listing"));
  for (const prepared of preparedRows) {
    if (!prepared) {
      report.rejected++;
      continue;
    }
    if (addOffer(prepared)) state.savedFresh++;
  }

  const afterSource = sourceCount(state.sourceId);
  state.emptyPages = afterSource === beforeSource ? state.emptyPages + 1 : 0;
  if (!sourceHasCapacity(state.sourceId)) {
    state.done = true;
    state.stopReason = "source_target_reached";
    return;
  }
  if (state.emptyPages >= maxEmptyPages) {
    state.done = true;
    state.stopReason = "no_progress";
    return;
  }

  state.cursor = fetched?.nextCursor || null;
  if ((fetched?.finished && !state.cursor) || !state.cursor) {
    state.done = true;
    state.stopReason = "source_finished";
  }
}

while (!deadlineReached() && report.pages < maxTotalPages) {
  const active = sourceStates.filter((state) => !state.done && sourceHasCapacity(state.sourceId) && state.pages < maxPagesPerSource);
  if (!active.length) break;
  report.rounds++;
  await runWithConcurrency(active, sourceConcurrency, processSourcePage);
  await checkpointIfNeeded();
  if (report.rounds % 4 === 0) {
    console.log(`[round:${market}:${shardIndex}] rounds=${report.rounds}; pages=${report.pages}; offers=${offers.size}/${target}; active=${active.length}; bySource=${JSON.stringify(Object.fromEntries(sourceCounts))}`);
    await checkpointIfNeeded(true);
  }
}

for (const state of sourceStates) {
  if (!state.done) {
    if (deadlineReached()) state.stopReason = "deadline";
    else if (report.pages >= maxTotalPages) state.stopReason = "total_page_limit";
    else if (state.pages >= maxPagesPerSource) state.stopReason = "source_page_limit";
    else state.stopReason = "stopped";
  }
  report.sources.push({
    sourceId: state.sourceId,
    target: targetPerSource,
    totalSaved: sourceCount(state.sourceId),
    freshSaved: state.savedFresh,
    restoredSaved: Math.max(0, sourceCount(state.sourceId) - state.savedFresh),
    pages: state.pages,
    emptyPages: state.emptyPages,
    errors: state.errors,
    stopReason: state.stopReason,
  });
}

report.finishedAt = new Date().toISOString();
report.saved = offers.size;
report.targetReached = sourceIds.every((sourceId) => sourceCount(sourceId) >= targetPerSource);
report.stopReason = report.targetReached
  ? "all_source_targets_reached"
  : deadlineReached()
    ? "deadline"
    : report.pages >= maxTotalPages
      ? "total_page_limit"
      : "sources_exhausted";
report.partial = !report.targetReached;
report.publicBySource = Object.fromEntries(sourceCounts);
report.imageStats = [...offers.values()].reduce((stats, offer) => {
  const count = Array.isArray(offer.images) ? offer.images.length : 0;
  stats.min = Math.min(stats.min, count);
  stats.max = Math.max(stats.max, count);
  stats.total += count;
  stats.preferred += count >= preferredImages ? 1 : 0;
  return stats;
}, { min: Number.POSITIVE_INFINITY, max: 0, total: 0, preferred: 0 });
if (!Number.isFinite(report.imageStats.min)) report.imageStats.min = 0;
report.imageStats.average = offers.size ? Number((report.imageStats.total / offers.size).toFixed(2)) : 0;
report.imageStats.preferredShare = offers.size ? Number((report.imageStats.preferred / offers.size).toFixed(4)) : 0;
report.durationMs = Date.now() - startedAtMs;

await writeProgress(report.stopReason, report.partial);
console.log(JSON.stringify(payload(report.stopReason, report.partial).report, null, 2));
