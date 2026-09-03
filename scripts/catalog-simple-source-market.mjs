import fs from "node:fs/promises";
import crypto from "node:crypto";

process.env.CATALOG_RAW_LISTING_MODE = "1";
process.env.CATALOG_KNOWLEDGE_DISABLED = "1";
process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER ||= "5";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "30";
process.env.CATALOG_COLLECTION_IMAGE_LIMIT ||= "30";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { requiredCatalogSourceIds } = await import("../apps/web/lib/catalog/required-catalog-sources.ts");
const { catalogV2SourceIds } = await import("../apps/web/lib/catalog/catalog-v2-source-registry.ts");

const market = String(process.env.CATALOG_REBUILD_MARKET || "").trim();
const target = Math.max(1, Math.min(30_000, Number(process.env.CATALOG_REBUILD_TARGET_PER_MARKET || 30_000)));
const output = process.env.CATALOG_REBUILD_OUTPUT || `catalog-rebuild-${market}-0.json`;
const maxPagesPerSource = Math.max(1, Number(process.env.CATALOG_REBUILD_MAX_PAGES_PER_SOURCE || 10_000));
const maxNoProgressPages = Math.max(3, Number(process.env.CATALOG_REBUILD_MAX_EMPTY_PAGES || 50));
const sourceConcurrency = Math.max(1, Math.min(8, Number(process.env.CATALOG_REBUILD_SOURCE_CONCURRENCY || 4)));
const detailConcurrency = Math.max(1, Math.min(32, Number(process.env.CATALOG_IMAGE_FETCH_CONCURRENCY || 16)));
const timeLimitMs = Math.max(60_000, Number(process.env.CATALOG_REBUILD_TIME_LIMIT_MS || 10_800_000));
const requestTimeoutMs = Math.max(5_000, Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 30_000));
const jpaucPageTimeoutMs = Math.max(requestTimeoutMs, Number(process.env.CATALOG_JPAUC_PAGE_TIMEOUT_MS || 180_000));
const galleryTimeoutMs = Math.max(5_000, Number(process.env.CATALOG_GALLERY_TIMEOUT_MS || 30_000));
const minimumImages = Math.max(5, Math.min(30, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 5)));
const isolatedSourceIds = String(process.env.CATALOG_REBUILD_SOURCE_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
const currentYear = new Date().getFullYear();
const priorityYear = currentYear - 6;
const deadline = Date.now() + timeLimitMs;
const commercial = /\b(?:truck|dump|tipper|bus|minibus|commercial|cargo|lorry|tractor|forklift|excavator|machinery)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;
const evidenceOnlySourceIds = new Set(["carvector_japan_stat_open"]);

if (!market) throw new Error("catalog_market_missing");

const adapterById = new Map(catalogImportSources.map((source) => [source.sourceId, source]));
const requiredSourceIds = requiredCatalogSourceIds(market);
const plannedSourceIds = isolatedSourceIds.length
  ? isolatedSourceIds
  : [
      ...requiredSourceIds,
      ...catalogV2SourceIds(market).filter((sourceId) => !requiredSourceIds.includes(sourceId)),
    ];
const missingRequiredSourceIds = requiredSourceIds.filter((sourceId) => !adapterById.has(sourceId));
const missingIsolatedSourceIds = isolatedSourceIds.filter((sourceId) => !adapterById.has(sourceId));
const sources = [...new Set(plannedSourceIds)].map((sourceId) => adapterById.get(sourceId)).filter(Boolean);

const offers = new Map();
const sourceReports = [];
const errors = [
  ...missingRequiredSourceIds.map((sourceId) => ({ sourceId, stage: "adapter", error: "required_adapter_missing" })),
  ...missingIsolatedSourceIds.map((sourceId) => ({ sourceId, stage: "adapter", error: "isolated_adapter_missing" })),
];
let pages = 0;
let seen = 0;
let normalized = 0;
let details = 0;
let rejectedCore = 0;
let rejectedImages = 0;

function expired() { return Date.now() >= deadline; }
function clean(value) { return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); }),
  ]).finally(() => clearTimeout(timer));
}
function deepTitle(value, depth = 0) {
  if (value == null || depth > 8 || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) { const title = deepTitle(item, depth + 1); if (title) return title; }
    return "";
  }
  for (const key of ["title", "Title", "name", "Name", "heading", "vehicleName", "carName", "displayName", "modelName"]) {
    const title = clean(value[key]);
    if (title.length >= 2 && title.length <= 180) return title;
  }
  for (const child of Object.values(value)) { const title = deepTitle(child, depth + 1); if (title) return title; }
  return "";
}
function offerTitle(offer) {
  return clean(
    offer?.sourceTitle
      || offer?.operational?.sourceTitle
      || deepTitle(offer?.operational?.raw)
      || [offer?.make, offer?.model, offer?.trim].filter(Boolean).join(" "),
  ).slice(0, 180);
}
function modelParts(offer, title) {
  const make = clean(offer?.make);
  const model = clean(offer?.model);
  if (make && model) return { make, model };
  const tokens = title.split(/\s+/).filter(Boolean);
  if (!tokens.length) return { make: "Автомобиль", model: String(offer?.sourceOfferId || "") };
  return {
    make: make || tokens[0],
    model: model || tokens.slice(make ? 0 : 1).join(" ").slice(0, 120) || tokens[0],
  };
}
function validCore(offer) {
  const year = Number(offer?.year || 0);
  const title = offerTitle(offer);
  return Boolean(
    offer?.id
      && offer?.sourceId
      && offer?.sourceOfferId
      && title
      && year >= 2011
      && year <= currentYear + 1
      && Number(offer?.sourcePrice || 0) > 0
      && clean(offer?.sourceCurrency)
      && /^https?:\/\//i.test(clean(offer?.operational?.sourceUrl))
      && !commercial.test(title),
  );
}
function minimumImagesForOffer(offer, source) {
  if (evidenceOnlySourceIds.has(source?.sourceId)) return 0;
  const declared = Number(offer?.operational?.minimumImages || 0);
  if (source?.sourceId === "jpauc_japan_past_open" && declared === 3) return 3;
  return minimumImages;
}
function pageTimeoutForSource(source) {
  return source?.sourceId === "jpauc_japan_past_open" ? jpaucPageTimeoutMs : requestTimeoutMs;
}
function imageId(url) { return crypto.createHash("sha256").update(url).digest("hex").slice(0, 24); }
function normalizeImages(rows) {
  const result = [];
  const seenUrls = new Set();
  for (const image of credibleCatalogImages(Array.isArray(rows) ? rows : [])) {
    const url = clean(image?.url);
    if (!/^https?:\/\//i.test(url) || url.includes("/api/catalog/images/") || seenUrls.has(url)) continue;
    seenUrls.add(url);
    result.push({
      id: imageId(url),
      url,
      objectKey: "",
      checksum: "",
      size: 0,
      mimeType: clean(image?.mimeType) || "image/jpeg",
      ...(Number(image?.width) > 0 ? { width: Number(image.width) } : {}),
      ...(Number(image?.height) > 0 ? { height: Number(image.height) } : {}),
    });
    if (result.length >= 30) break;
  }
  return result;
}
async function pool(rows, limit, worker) {
  if (!rows.length) return;
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= rows.length) return;
      await worker(rows[current], current);
    }
  }));
}
function orderedOffers() {
  return [...offers.values()]
    .sort((left, right) => {
      const recentLeft = Number(left.year || 0) >= priorityYear ? 1 : 0;
      const recentRight = Number(right.year || 0) >= priorityYear ? 1 : 0;
      return recentRight - recentLeft
        || Number(right.year || 0) - Number(left.year || 0)
        || Number(right.images?.length || 0) - Number(left.images?.length || 0)
        || String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    })
    .slice(0, target);
}
async function checkpoint(reason = "collecting") {
  const rows = orderedOffers();
  const payload = {
    version: 6,
    mode: "source_only_exact_fields_title_year_price_gallery",
    market,
    generatedAt: new Date().toISOString(),
    count: rows.length,
    partial: rows.length < target,
    offers: rows,
    report: {
      market,
      target,
      priorityYear,
      minimumImages,
      isolatedSourceIds,
      imageStorage: "json_source_urls_only",
      fieldPolicy: "preserve_adapter_source_fields_no_generic_spec_normalization",
      requiredSourceIds,
      plannedSourceIds: sources.map((source) => source.sourceId),
      missingRequiredSourceIds,
      missingIsolatedSourceIds,
      pages,
      seen,
      normalized,
      details,
      rejectedCore,
      rejectedImages,
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
  if (!validCore(base)) { rejectedCore++; return null; }
  const requiredImages = minimumImagesForOffer(base, source);
  let gallery = normalizeImages(base.images);
  if (gallery.length < 30 && source.fetchImages && !expired()) {
    try {
      const extra = await withTimeout(Promise.resolve(source.fetchImages(base)), galleryTimeoutMs, "gallery_timeout");
      gallery = normalizeImages([...gallery, ...(Array.isArray(extra) ? extra : [])]);
      details++;
    } catch (error) {
      errors.push({ sourceId: source.sourceId, offerId: base.id, stage: "gallery", error: String(error?.message || error) });
    }
  }
  if (gallery.length < requiredImages) {
    rejectedImages++;
    errors.push({ sourceId: source.sourceId, offerId: base.id, stage: "gallery_quality", error: `images_${gallery.length}_below_${requiredImages}` });
    return null;
  }
  const title = offerTitle(base);
  const { make, model } = modelParts(base, title);
  const now = new Date().toISOString();
  // Source-only collection deliberately does not call normalizeVehicleOfferSpecs().
  // Source adapters own engine/power/trim/transmission/drive/body values. Missing
  // fields remain missing; generic text heuristics must not rewrite exact source data.
  return {
    ...base,
    sourceTitle: title,
    make,
    model,
    status: base.status || "active",
    images: gallery,
    totalRub: null,
    calculationSnapshot: undefined,
    calculationStatus: base.calculationStatus || "needs_data",
    updatedAt: now,
    firstSeenAt: base.firstSeenAt || now,
    operational: {
      ...(base.operational || {}),
      sourceTitle: title,
      rawListingImportedAt: now,
      galleryImageCount: gallery.length,
      galleryStoredAs: "json_urls",
      knowledgeEnriched: false,
      rawListingMode: true,
      sourceOnlyFieldsPreserved: true,
      collectionMinimumImages: requiredImages,
    },
  };
}
async function collectSource(source) {
  let cursor = null;
  let sourcePages = 0;
  let sourceSeen = 0;
  let sourceNormalized = 0;
  let sourceSaved = 0;
  let sourceEvidenceSeen = 0;
  let sourceEvidenceAccepted = 0;
  let noProgressPages = 0;
  let stopReason = "finished";
  const seenCursors = new Set();
  try {
    while (!expired() && offers.size < target && sourcePages < maxPagesPerSource && noProgressPages < maxNoProgressPages) {
      const cursorKey = JSON.stringify(cursor ?? "first");
      if (seenCursors.has(cursorKey)) { stopReason = "cursor_loop"; break; }
      seenCursors.add(cursorKey);
      const page = await withTimeout(Promise.resolve(source.fetchPage(cursor)), pageTimeoutForSource(source), "page_timeout");
      sourcePages++; pages++;
      const rawRows = Array.isArray(page?.items) ? page.items : [];
      sourceSeen += rawRows.length; seen += rawRows.length;
      const bases = [];
      for (const raw of rawRows) {
        if (typeof source.validateReadinessEvidence === "function") {
          sourceEvidenceSeen++;
          try {
            if (source.validateReadinessEvidence(raw) === true) sourceEvidenceAccepted++;
          } catch (error) {
            errors.push({ sourceId: source.sourceId, stage: "readiness_evidence", error: String(error?.message || error) });
          }
        }
        let base = null;
        try { base = source.normalizeOffer(raw); } catch (error) {
          errors.push({ sourceId: source.sourceId, stage: "normalize", error: String(error?.message || error) });
        }
        if (!base?.id || offers.has(base.id)) continue;
        normalized++; sourceNormalized++;
        if (validCore(base)) bases.push(base); else rejectedCore++;
      }
      bases.sort((left, right) => Number(right?.year || 0) - Number(left?.year || 0));
      const before = offers.size;
      await pool(bases, detailConcurrency, async (base) => {
        if (expired() || offers.size >= target || offers.has(base.id)) return;
        const offer = await prepare(base, source);
        if (offer && !offers.has(offer.id)) { offers.set(offer.id, offer); sourceSaved++; }
      });
      noProgressPages = offers.size === before ? noProgressPages + 1 : 0;
      await checkpoint("page_complete");
      console.log(JSON.stringify({
        market,
        sourceId: source.sourceId,
        required: requiredSourceIds.includes(source.sourceId),
        pages: sourcePages,
        seen: sourceSeen,
        normalized: sourceNormalized,
        saved: sourceSaved,
        total: offers.size,
        rejectedImages,
      }));
      cursor = page?.nextCursor || null;
      if (!cursor || page?.finished) break;
    }
    if (expired()) stopReason = "deadline";
    else if (offers.size >= target) stopReason = "market_target_reached";
    else if (sourcePages >= maxPagesPerSource) stopReason = "page_limit";
    else if (noProgressPages >= maxNoProgressPages) stopReason = "no_progress";
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
    saved: sourceSaved,
    readinessRole: String(source.readinessRole || ""),
    evidenceSeen: sourceEvidenceSeen,
    evidenceAccepted: sourceEvidenceAccepted,
    evidenceRejected: sourceEvidenceSeen - sourceEvidenceAccepted,
    stopReason,
  });
  await checkpoint("source_complete");
}

await checkpoint("started");
if (sources.length) await pool(sources, sourceConcurrency, collectSource);
await checkpoint(expired() ? "deadline" : offers.size >= target ? "market_target_reached" : "sources_exhausted");
console.log(JSON.stringify({
  market,
  count: orderedOffers().length,
  target,
  priorityYear,
  minimumImages,
  isolatedSourceIds,
  requiredSourceIds,
  activeSources: sources.map((source) => source.sourceId),
  missingRequiredSourceIds,
  missingIsolatedSourceIds,
  pages,
  seen,
  normalized,
  details,
  rejectedCore,
  rejectedImages,
  errors: errors.length,
}, null, 2));
