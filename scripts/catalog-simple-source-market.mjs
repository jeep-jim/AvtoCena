import fs from "node:fs/promises";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { requiredCatalogSourceIds } = await import("../apps/web/lib/catalog/required-catalog-sources.ts");
const { catalogV2SourceIds } = await import("../apps/web/lib/catalog/catalog-v2-source-registry.ts");

const market = String(process.env.CATALOG_REBUILD_MARKET || "").trim();
const target = Math.max(1, Math.min(30_000, Number(process.env.CATALOG_REBUILD_TARGET_PER_MARKET || 30_000)));
const output = process.env.CATALOG_REBUILD_OUTPUT || `catalog-rebuild-${market}-0.json`;
const maxPagesPerSource = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_PAGES_PER_SOURCE || 10_000));
const maxEmptyPages = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_EMPTY_PAGES || 30));
const sourceConcurrency = Math.max(1, Math.min(8, Number(process.env.CATALOG_REBUILD_SOURCE_CONCURRENCY || 4)));
const detailConcurrency = Math.max(1, Math.min(20, Number(process.env.CATALOG_IMAGE_FETCH_CONCURRENCY || 12)));
const timeLimitMs = Math.max(60_000, Number(process.env.CATALOG_REBUILD_TIME_LIMIT_MS || 4_500_000));
const requestTimeoutMs = Math.max(5_000, Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 25_000));
const galleryTimeoutMs = Math.max(3_000, Number(process.env.CATALOG_GALLERY_TIMEOUT_MS || 12_000));
const deadline = Date.now() + timeLimitMs;
const currentYear = new Date().getFullYear();
const commercial = /\b(?:truck|dump|tipper|bus|minibus|commercial|cargo|lorry|tractor|forklift|excavator|machinery)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;

if (!market) throw new Error("catalog_market_missing");
process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER = "1";
process.env.CATALOG_MAX_IMAGES_PER_OFFER = "30";
process.env.CATALOG_KNOWLEDGE_DISABLED = "1";

const adapterById = new Map(catalogImportSources.map((source) => [source.sourceId, source]));
const requiredSourceIds = requiredCatalogSourceIds(market);
const missingRequiredSourceIds = requiredSourceIds.filter((sourceId) => !adapterById.has(sourceId));
if (missingRequiredSourceIds.length) {
  throw new Error(`catalog_required_sources_missing:${market}:${missingRequiredSourceIds.join(",")}`);
}

// Every approved source is always included first. Extra registered sources may add
// volume, but never replace or hide one of the mandatory owner-approved sites.
const plannedSourceIds = [
  ...requiredSourceIds,
  ...catalogV2SourceIds(market).filter((sourceId) => !requiredSourceIds.includes(sourceId)),
];
const sources = [...new Set(plannedSourceIds)]
  .map((sourceId) => adapterById.get(sourceId))
  .filter(Boolean);
if (!sources.length) throw new Error(`catalog_sources_missing:${market}`);

const offers = new Map();
const sourceReports = [];
const errors = [];
let pages = 0;
let seen = 0;
let normalized = 0;
let imageDetails = 0;
let rejectedCore = 0;
let savedWithoutImages = 0;

function expired() { return Date.now() >= deadline; }
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); }),
  ]).finally(() => clearTimeout(timer));
}
function imageKey(image) { return String(image?.checksum || image?.id || image?.objectKey || image?.url || ""); }
function images(rows) {
  const unique = new Map();
  for (const image of credibleCatalogImages(Array.isArray(rows) ? rows : [])) {
    const key = imageKey(image);
    if (key && !unique.has(key)) unique.set(key, image);
    if (unique.size >= 30) break;
  }
  return [...unique.values()];
}
function validCore(offer) {
  const year = Number(offer?.year || 0);
  return Boolean(
    offer?.id && offer?.sourceId && offer?.make && offer?.model
    && year >= 2011 && year <= currentYear + 1
    && Number(offer?.sourcePrice || 0) > 0
    && String(offer?.sourceCurrency || "").trim()
    && String(offer?.operational?.sourceUrl || "").trim()
    && !commercial.test(`${offer?.make || ""} ${offer?.model || ""} ${offer?.trim || ""} ${offer?.bodyType || ""}`)
  );
}
async function pool(rows, limit, worker) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= rows.length) return;
      await worker(rows[current], current);
    }
  }));
}
async function checkpoint(reason = "collecting") {
  const rows = [...offers.values()].slice(0, target);
  const payload = {
    version: 3,
    mode: "listing_first_2011_plus_no_knowledge",
    market,
    generatedAt: new Date().toISOString(),
    count: rows.length,
    partial: rows.length < target,
    offers: rows,
    report: {
      market,
      target,
      requiredSourceIds,
      plannedSourceIds: sources.map((source) => source.sourceId),
      pages,
      seen,
      normalized,
      rejectedCore,
      savedWithoutImages,
      imageDetails,
      sources: sourceReports,
      errors,
      stopReason: reason,
    },
  };
  const temporary = `${output}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(payload));
  await fs.rename(temporary, output);
}
async function prepare(base, source) {
  const offer = normalizeVehicleOfferSpecs(base);
  if (!validCore(offer)) {
    rejectedCore++;
    return null;
  }
  let gallery = images(offer.images);
  if (gallery.length < 30 && source.fetchImages && !expired()) {
    try {
      const extra = await withTimeout(Promise.resolve(source.fetchImages(offer)), galleryTimeoutMs, "gallery_timeout");
      gallery = images([...gallery, ...((extra) || [])]);
      imageDetails++;
    } catch (error) {
      errors.push({ sourceId: source.sourceId, offerId: offer.id, stage: "images", error: String(error?.message || error) });
    }
  }
  if (!gallery.length) savedWithoutImages++;
  const now = new Date().toISOString();
  return normalizeVehicleOfferSpecs({
    ...offer,
    status: "active",
    images: gallery.slice(0, 30),
    updatedAt: now,
    operational: {
      ...offer.operational,
      listingFirstImportedAt: now,
      galleryImageCount: gallery.length,
      knowledgeEnriched: false,
    },
  });
}
async function collectSource(source) {
  let cursor = null;
  let sourcePages = 0;
  let sourceSeen = 0;
  let sourceNormalized = 0;
  let sourcePassedCore = 0;
  let sourceSaved = 0;
  let emptyPages = 0;
  let stopReason = "finished";
  const seenCursors = new Set();
  try {
    while (!expired() && offers.size < target && sourcePages < maxPagesPerSource && emptyPages < maxEmptyPages) {
      const cursorKey = JSON.stringify(cursor ?? "first");
      if (seenCursors.has(cursorKey)) { stopReason = "cursor_loop"; break; }
      seenCursors.add(cursorKey);
      const page = await withTimeout(Promise.resolve(source.fetchPage(cursor)), requestTimeoutMs, "page_timeout");
      sourcePages++; pages++;
      const rawRows = Array.isArray(page?.items) ? page.items : [];
      sourceSeen += rawRows.length; seen += rawRows.length;
      const bases = [];
      for (const raw of rawRows) {
        let base = null;
        try { base = source.normalizeOffer(raw); } catch {}
        if (!base?.id || offers.has(base.id)) continue;
        normalized++;
        sourceNormalized++;
        if (validCore(base)) {
          bases.push(base);
          sourcePassedCore++;
        } else {
          rejectedCore++;
        }
      }
      const before = offers.size;
      await pool(bases, detailConcurrency, async (base) => {
        if (expired() || offers.size >= target || offers.has(base.id)) return;
        const offer = await prepare(base, source);
        if (offer && !offers.has(offer.id)) { offers.set(offer.id, offer); sourceSaved++; }
      });
      emptyPages = offers.size === before ? emptyPages + 1 : 0;
      await checkpoint("page_complete");
      console.log(JSON.stringify({ market, sourceId: source.sourceId, required: requiredSourceIds.includes(source.sourceId), sourcePages, seen: sourceSeen, normalized: sourceNormalized, passedCore: sourcePassedCore, saved: sourceSaved, total: offers.size }));
      cursor = page?.nextCursor || null;
      if (!cursor || page?.finished) break;
    }
    if (expired()) stopReason = "deadline";
    else if (offers.size >= target) stopReason = "market_target_reached";
    else if (sourcePages >= maxPagesPerSource) stopReason = "page_limit";
    else if (emptyPages >= maxEmptyPages) stopReason = "no_progress";
  } catch (error) {
    stopReason = String(error?.message || error).includes("timeout") ? "timeout" : "source_error";
    errors.push({ sourceId: source.sourceId, stage: "list", error: String(error?.message || error) });
  }
  sourceReports.push({
    sourceId: source.sourceId,
    required: requiredSourceIds.includes(source.sourceId),
    pages: sourcePages,
    seen: sourceSeen,
    normalized: sourceNormalized,
    passedCore: sourcePassedCore,
    saved: sourceSaved,
    stopReason,
  });
  await checkpoint("source_complete");
}

await checkpoint("started");
await pool(sources, sourceConcurrency, collectSource);
await checkpoint(expired() ? "deadline" : offers.size >= target ? "market_target_reached" : "sources_exhausted");
console.log(JSON.stringify({
  market,
  requiredSourceIds,
  activeSources: sources.map((source) => source.sourceId),
  count: offers.size,
  target,
  pages,
  seen,
  normalized,
  rejectedCore,
  savedWithoutImages,
  imageDetails,
  errors: errors.length,
}, null, 2));
