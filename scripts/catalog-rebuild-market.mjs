import fs from "node:fs/promises";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { credibleCatalogImages, isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { readAllOffersForMaintenance, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { CATALOG_DAILY_TARGET_PER_MARKET } = await import("../apps/web/lib/catalog/runtime-config.ts");

const market = String(process.env.CATALOG_REBUILD_MARKET || "").trim();
const target = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET || CATALOG_DAILY_TARGET_PER_MARKET));
const minimumImages = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 1));
const requestedImages = Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 12);
const maxImages = Math.min(30, Math.max(minimumImages, Number.isFinite(requestedImages) ? requestedImages : 12));
const maxPages = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_PAGES || 120));
const maxTotalPages = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_TOTAL_PAGES || 180));
const maxEmptyPages = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_EMPTY_PAGES || 8));
const seedScanLimit = Math.max(target, Number(process.env.CATALOG_REBUILD_SEED_SCAN_LIMIT || target * 4));
const prepareConcurrency = Math.max(1, Math.min(12, Number(process.env.CATALOG_REBUILD_PREPARE_CONCURRENCY || 4)));
const checkpointEvery = Math.max(10, Number(process.env.CATALOG_REBUILD_CHECKPOINT_EVERY || 50));
const timeLimitMs = Math.max(60_000, Number(process.env.CATALOG_REBUILD_TIME_LIMIT_MS || 45 * 60 * 1000));
const outputFile = process.env.CATALOG_REBUILD_OUTPUT || `catalog-rebuild-${market}.json`;
const startedAtMs = Date.now();
const deadlineAtMs = startedAtMs + timeLimitMs;

const sourcePlan = {
  korea: ["encar_direct"],
  china: ["che168_china_exact", "guazi_china_export"],
  japan: ["goonet_japan_exact", "beforward_japan", "beforward_public"],
  uae: ["dubicars_uae_exact", "beforward_uae"],
  europe: ["otomoto_europe_exact", "beforward_uk", "beforward_belgium"],
  georgia: ["myauto_georgia_exact"],
  kyrgyzstan: ["mashina_kyrgyzstan_exact"],
};

if (!Object.prototype.hasOwnProperty.call(sourcePlan, market)) throw new Error(`unsupported_rebuild_market_${market || "missing"}`);
const configuredSources = String(process.env.CATALOG_REBUILD_SOURCE_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
const adapters = new Map(catalogImportSources.map((source) => [source.sourceId, source]));
const connectedMarketSources = catalogImportSources
  .filter((source) => source.market === market || source.market === "multi")
  .map((source) => source.sourceId);
const sourceIds = configuredSources.length
  ? configuredSources
  : [...new Set([...sourcePlan[market], ...connectedMarketSources])];
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
const report = {
  market,
  target,
  minimumImages,
  maxImages,
  maxPages,
  maxTotalPages,
  maxEmptyPages,
  prepareConcurrency,
  timeLimitMs,
  deadlineAt: new Date(deadlineAtMs).toISOString(),
  sourceIds,
  connectedMarketSources,
  startedAt: new Date(startedAtMs).toISOString(),
  pages: 0,
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

function recordError(row) {
  if (report.sourceErrors.length < 500) report.sourceErrors.push(row);
}

function payload(stopReason = report.stopReason, partial = true) {
  const generatedAt = new Date().toISOString();
  const rows = [...offers.values()].slice(0, target);
  return {
    version: 7,
    market,
    generatedAt,
    target,
    count: rows.length,
    sourceIds,
    partial,
    stopReason,
    report: {
      ...report,
      saved: rows.length,
      partial,
      stopReason,
      lastCheckpointAt: generatedAt,
      targetReached: rows.length >= target,
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
  if (!offer || offer.market !== market || !offer.id) return null;

  let images = uniqueImages(offer.images || []);
  if (images.length < minimumImages && source?.fetchImages && !deadlineReached()) {
    try {
      const fetchedImages = await source.fetchImages(offer);
      images = uniqueImages([...images, ...(Array.isArray(fetchedImages) ? fetchedImages : [])]);
    } catch (error) {
      recordError({ sourceId: offer.sourceId, offerId: offer.id, origin, stage: "exact_listing_gallery", error: String(error?.message || error) });
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
      galleryRebuiltFrom: origin,
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

const [internalRows, publicRows] = await Promise.all([
  readAllOffersForMaintenance(),
  readMarketOffers(market),
]);
const restoredMap = new Map();
for (const offer of [...publicRows, ...internalRows]
  .filter((offer) => offer && offer.market === market && ["active", "stale"].includes(String(offer.status || "")))
  .sort((left, right) => freshness(right) - freshness(left) || Number(right.images?.length || 0) - Number(left.images?.length || 0))) {
  if (!restoredMap.has(offer.id)) restoredMap.set(offer.id, offer);
  if (restoredMap.size >= seedScanLimit) break;
}

const restoredSeeds = [...restoredMap.values()];
for (let index = 0; index < restoredSeeds.length && offers.size < target && !deadlineReached(); index += prepareConcurrency) {
  const batch = restoredSeeds.slice(index, index + prepareConcurrency);
  report.seedSeen += batch.length;
  const preparedRows = await runWithConcurrency(batch, prepareConcurrency, (seed) => prepareCandidate(seed, adapters.get(seed.sourceId), "restored_listing"));
  for (const prepared of preparedRows) {
    if (!prepared || offers.has(prepared.id) || offers.size >= target) continue;
    offers.set(prepared.id, prepared);
    report.seedSaved++;
    report.saved = offers.size;
    if (offers.size % 25 === 0) console.log(`[seed:${market}] ${offers.size}/${target}; photos=${prepared.images.length}`);
  }
  await checkpointIfNeeded();
}

for (const sourceId of sourceIds) {
  if (offers.size >= target || deadlineReached() || report.pages >= maxTotalPages) break;
  const source = adapters.get(sourceId);
  if (!source) {
    recordError({ sourceId, stage: "registry", error: `catalog_source_not_found_${sourceId}` });
    continue;
  }
  let cursor = null;
  let pages = 0;
  let errors = 0;
  let emptyPages = 0;
  const seenCursors = new Set();
  const sourceStart = offers.size;
  let sourceStopReason = "finished";

  while (offers.size < target && pages < maxPages && report.pages < maxTotalPages && !deadlineReached()) {
    const cursorKey = String(cursor ?? "first");
    if (seenCursors.has(cursorKey)) {
      sourceStopReason = "cursor_loop";
      break;
    }
    seenCursors.add(cursorKey);

    let fetched;
    try {
      fetched = await source.fetchPage(cursor);
      errors = 0;
    } catch (error) {
      errors++;
      recordError({ sourceId, cursor, stage: "list", error: String(error?.message || error) });
      if (errors >= 3 || deadlineReached()) {
        sourceStopReason = errors >= 3 ? "source_errors" : "deadline";
        break;
      }
      const numeric = Number(cursor || 1);
      cursor = Number.isFinite(numeric) ? String(numeric + 1) : null;
      if (!cursor) {
        sourceStopReason = "source_error_without_cursor";
        break;
      }
      continue;
    }

    pages++;
    report.pages++;
    const rows = Array.isArray(fetched?.items) ? fetched.items : [];
    report.seen += rows.length;
    const batchIds = new Set();
    const normalizedRows = [];
    for (const raw of rows) {
      let base = null;
      try { base = source.normalizeOffer(raw); } catch { base = null; }
      if (!base || base.market !== market || !base.id || offers.has(base.id) || batchIds.has(base.id)) continue;
      batchIds.add(base.id);
      normalizedRows.push(base);
    }

    const beforePage = offers.size;
    const preparedRows = await runWithConcurrency(normalizedRows, prepareConcurrency, (base) => prepareCandidate(base, source, "fresh_listing"));
    for (const prepared of preparedRows) {
      if (!prepared || offers.has(prepared.id) || offers.size >= target) {
        if (!prepared) report.rejected++;
        continue;
      }
      offers.set(prepared.id, prepared);
      report.saved = offers.size;
      if (offers.size % 25 === 0) console.log(`[fresh:${market}] ${offers.size}/${target}; ${sourceId}; photos=${prepared.images.length}`);
    }

    emptyPages = offers.size === beforePage ? emptyPages + 1 : 0;
    await checkpointIfNeeded();
    if (emptyPages >= maxEmptyPages) {
      sourceStopReason = "no_progress";
      break;
    }

    cursor = fetched?.nextCursor || null;
    if ((fetched?.finished && !cursor) || !cursor) {
      sourceStopReason = "source_finished";
      break;
    }
  }

  if (deadlineReached()) sourceStopReason = "deadline";
  else if (report.pages >= maxTotalPages) sourceStopReason = "total_page_limit";
  else if (pages >= maxPages) sourceStopReason = "source_page_limit";
  report.sources.push({ sourceId, pages, saved: offers.size - sourceStart, emptyPages, stopReason: sourceStopReason });
  await checkpointIfNeeded(true);
}

report.finishedAt = new Date().toISOString();
report.saved = offers.size;
report.targetReached = offers.size >= target;
report.stopReason = report.targetReached
  ? "target_reached"
  : deadlineReached()
    ? "deadline"
    : report.pages >= maxTotalPages
      ? "total_page_limit"
      : "sources_exhausted";
report.partial = !report.targetReached;
report.publicBySource = [...offers.values()].reduce((totals, offer) => {
  totals[offer.sourceId] = (totals[offer.sourceId] || 0) + 1;
  return totals;
}, {});
report.imageStats = [...offers.values()].reduce((stats, offer) => {
  const count = Array.isArray(offer.images) ? offer.images.length : 0;
  stats.min = Math.min(stats.min, count);
  stats.max = Math.max(stats.max, count);
  stats.total += count;
  return stats;
}, { min: Number.POSITIVE_INFINITY, max: 0, total: 0 });
if (!Number.isFinite(report.imageStats.min)) report.imageStats.min = 0;
report.imageStats.average = offers.size ? Number((report.imageStats.total / offers.size).toFixed(2)) : 0;
report.durationMs = Date.now() - startedAtMs;

await writeProgress(report.stopReason, report.partial);
console.log(JSON.stringify(payload(report.stopReason, report.partial).report, null, 2));
