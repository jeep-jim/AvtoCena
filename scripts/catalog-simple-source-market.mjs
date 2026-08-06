import fs from "node:fs/promises";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");

const market = String(process.env.CATALOG_REBUILD_MARKET || "").trim();
const target = Math.max(1, Math.min(30_000, Number(process.env.CATALOG_REBUILD_TARGET_PER_MARKET || 30_000)));
const output = process.env.CATALOG_REBUILD_OUTPUT || `catalog-rebuild-${market}-0.json`;
const maxPagesPerSource = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_PAGES_PER_SOURCE || 10_000));
const maxEmptyPages = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_EMPTY_PAGES || 30));
const sourceConcurrency = Math.max(1, Math.min(12, Number(process.env.CATALOG_REBUILD_SOURCE_CONCURRENCY || 8)));
const detailConcurrency = Math.max(1, Math.min(30, Number(process.env.CATALOG_IMAGE_FETCH_CONCURRENCY || 20)));
const timeLimitMs = Math.max(60_000, Number(process.env.CATALOG_REBUILD_TIME_LIMIT_MS || 4_800_000));
const deadline = Date.now() + timeLimitMs;
const currentYear = new Date().getFullYear();
const commercial = /\b(?:truck|dump|tipper|bus|minibus|commercial|cargo|lorry|tractor|forklift|excavator|machinery)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;

if (!market) throw new Error("catalog_market_missing");
process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER = "1";
process.env.CATALOG_MAX_IMAGES_PER_OFFER = "30";

const sources = catalogImportSources.filter((source) => source.market === market || source.market === "multi");
const offers = new Map();
const sourceReports = [];
const errors = [];
let pages = 0;
let seen = 0;
let normalized = 0;
let imageDetails = 0;

function expired() { return Date.now() >= deadline; }
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
    version: 1,
    mode: "listing_first_2011_plus",
    market,
    generatedAt: new Date().toISOString(),
    count: rows.length,
    partial: rows.length < target,
    offers: rows,
    report: { market, target, pages, seen, normalized, imageDetails, sources: sourceReports, errors, stopReason: reason },
  };
  const temporary = `${output}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(payload));
  await fs.rename(temporary, output);
}
async function prepare(base, source) {
  let offer = normalizeVehicleOfferSpecs(base);
  if (!validCore(offer)) return null;
  let gallery = images(offer.images);
  if (gallery.length < 30 && source.fetchImages && !expired()) {
    try {
      gallery = images([...gallery, ...((await source.fetchImages(offer)) || [])]);
      imageDetails++;
    } catch (error) {
      errors.push({ sourceId: source.sourceId, offerId: offer.id, stage: "images", error: String(error?.message || error) });
    }
  }
  if (!gallery.length) return null;
  const now = new Date().toISOString();
  return normalizeVehicleOfferSpecs({
    ...offer,
    status: "active",
    images: gallery.slice(0, 30),
    updatedAt: now,
    operational: { ...offer.operational, listingFirstImportedAt: now, galleryImageCount: gallery.length },
  });
}
async function collectSource(source) {
  let cursor = null;
  let sourcePages = 0;
  let sourceSeen = 0;
  let sourceSaved = 0;
  let emptyPages = 0;
  let stopReason = "finished";
  const seenCursors = new Set();
  try {
    while (!expired() && offers.size < target && sourcePages < maxPagesPerSource && emptyPages < maxEmptyPages) {
      const cursorKey = JSON.stringify(cursor ?? "first");
      if (seenCursors.has(cursorKey)) { stopReason = "cursor_loop"; break; }
      seenCursors.add(cursorKey);
      const page = await source.fetchPage(cursor);
      sourcePages++; pages++;
      const rawRows = Array.isArray(page?.items) ? page.items : [];
      sourceSeen += rawRows.length; seen += rawRows.length;
      const bases = [];
      for (const raw of rawRows) {
        let base = null;
        try { base = source.normalizeOffer(raw); } catch {}
        if (!base?.id || offers.has(base.id)) continue;
        normalized++;
        if (validCore(base)) bases.push(base);
      }
      const before = offers.size;
      await pool(bases, detailConcurrency, async (base) => {
        if (expired() || offers.size >= target || offers.has(base.id)) return;
        const offer = await prepare(base, source);
        if (offer && !offers.has(offer.id)) { offers.set(offer.id, offer); sourceSaved++; }
      });
      emptyPages = offers.size === before ? emptyPages + 1 : 0;
      if (pages % 10 === 0 || offers.size >= target) await checkpoint("collecting");
      cursor = page?.nextCursor || null;
      if (!cursor || page?.finished) break;
    }
    if (expired()) stopReason = "deadline";
    else if (offers.size >= target) stopReason = "market_target_reached";
    else if (sourcePages >= maxPagesPerSource) stopReason = "page_limit";
    else if (emptyPages >= maxEmptyPages) stopReason = "no_progress";
  } catch (error) {
    stopReason = "source_error";
    errors.push({ sourceId: source.sourceId, stage: "list", error: String(error?.message || error) });
  }
  sourceReports.push({ sourceId: source.sourceId, pages: sourcePages, seen: sourceSeen, saved: sourceSaved, stopReason });
}

await pool(sources, sourceConcurrency, collectSource);
await checkpoint(expired() ? "deadline" : offers.size >= target ? "market_target_reached" : "sources_exhausted");
console.log(JSON.stringify({ market, sources: sources.length, count: offers.size, target, pages, seen, normalized, imageDetails, errors: errors.length }, null, 2));
