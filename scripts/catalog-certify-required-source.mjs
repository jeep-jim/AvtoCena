import fs from "node:fs/promises";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { REQUIRED_CATALOG_SOURCES } = await import("../apps/web/lib/catalog/required-catalog-sources.ts");

const market = String(process.env.CATALOG_CERTIFY_MARKET || "").trim();
const sourceId = String(process.env.CATALOG_CERTIFY_SOURCE_ID || "").trim();
const output = process.env.CATALOG_CERTIFY_OUTPUT || `catalog-certify-${market}-${sourceId}.json`;
const pageLimit = Math.max(1, Math.min(5, Number(process.env.CATALOG_CERTIFY_PAGE_LIMIT || 3)));
const rowsPerPage = Math.max(1, Math.min(100, Number(process.env.CATALOG_CERTIFY_ROWS_PER_PAGE || 50)));
const requestTimeoutMs = Math.max(5_000, Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 30_000));
const galleryTimeoutMs = Math.max(5_000, Number(process.env.CATALOG_GALLERY_TIMEOUT_MS || 30_000));

process.env.CATALOG_KNOWLEDGE_DISABLED = "1";
process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER = "1";
process.env.CATALOG_MAX_IMAGES_PER_OFFER = "30";
process.env.CATALOG_COLLECTION_IMAGE_LIMIT = "30";

if (!market || !sourceId) throw new Error("catalog_certify_source_missing");
const required = REQUIRED_CATALOG_SOURCES[market]?.find((source) => source.sourceId === sourceId);
if (!required) throw new Error(`catalog_certify_source_not_required:${market}:${sourceId}`);

const source = catalogImportSources.find((adapter) => adapter.sourceId === sourceId);
if (!source) throw new Error(`catalog_certify_adapter_missing:${sourceId}`);

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function clean(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function rawTitle(value, depth = 0) {
  if (value == null || depth > 8 || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = rawTitle(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  const row = value;
  for (const key of ["title", "Title", "name", "Name", "heading", "vehicleName", "carName", "modelName", "displayName"]) {
    const candidate = clean(row[key]);
    if (candidate.length >= 2 && candidate.length <= 180) return candidate;
  }
  for (const child of Object.values(row)) {
    const found = rawTitle(child, depth + 1);
    if (found) return found;
  }
  return "";
}

function sourceTitle(offer) {
  return clean(
    offer?.sourceTitle
    || offer?.operational?.sourceTitle
    || rawTitle(offer?.operational?.raw)
    || [offer?.make, offer?.model, offer?.trim].filter(Boolean).join(" ")
  ).slice(0, 180);
}

function coreCandidate(offer) {
  const year = Number(offer?.year || 0);
  return Boolean(
    offer?.id
    && offer?.sourceId === sourceId
    && offer?.market === market
    && sourceTitle(offer)
    && year >= 2011
    && Number(offer?.sourcePrice || 0) > 0
    && String(offer?.sourceCurrency || "").trim()
    && String(offer?.operational?.sourceUrl || "").startsWith("http")
  );
}

let cursor = null;
let pages = 0;
let fetched = 0;
let candidate = null;
const errors = [];

for (; pages < pageLimit && !candidate; pages++) {
  try {
    const page = await withTimeout(Promise.resolve(source.fetchPage(cursor)), requestTimeoutMs, "list_timeout");
    const rows = Array.isArray(page?.items) ? page.items.slice(0, rowsPerPage) : [];
    fetched += rows.length;
    for (const row of rows) {
      try {
        const normalized = source.normalizeOffer(row);
        if (coreCandidate(normalized)) {
          candidate = normalizeVehicleOfferSpecs(normalized);
          candidate.sourceTitle = sourceTitle(candidate);
          candidate.operational = { ...(candidate.operational || {}), sourceTitle: candidate.sourceTitle };
          break;
        }
      } catch (error) {
        errors.push({ stage: "normalize", error: String(error?.message || error) });
      }
    }
    cursor = page?.nextCursor || null;
    if (!cursor || page?.finished) break;
  } catch (error) {
    errors.push({ stage: "list", error: String(error?.message || error) });
    break;
  }
}

if (!candidate) {
  const report = {
    version: 2,
    mode: "raw_listing_only",
    market,
    sourceId,
    canonicalUrl: required.canonicalUrl,
    passed: false,
    reason: fetched ? "no_valid_candidate" : "no_rows",
    pages,
    fetched,
    errors,
  };
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

let gallery = [];
try {
  gallery = await withTimeout(Promise.resolve(source.fetchImages?.(candidate) || []), galleryTimeoutMs, "gallery_timeout");
} catch (error) {
  errors.push({ stage: "gallery", error: String(error?.message || error) });
}

candidate = normalizeVehicleOfferSpecs({
  ...candidate,
  sourceTitle: sourceTitle(candidate),
  status: "active",
  images: credibleCatalogImages(Array.isArray(gallery) ? gallery : []).slice(0, 30),
});

const imageUrls = [...new Set((candidate.images || []).map((image) => String(image?.url || "")).filter(Boolean))];
const checks = {
  stableId: Boolean(candidate.id && candidate.sourceOfferId),
  sourceUrl: /^https?:\/\//i.test(String(candidate.operational?.sourceUrl || "")),
  sourceTitle: sourceTitle(candidate).length >= 2,
  year: Number(candidate.year || 0) >= 2011,
  sourcePrice: Number(candidate.sourcePrice || 0) > 0 && Boolean(candidate.sourceCurrency),
  galleryCount: imageUrls.length >= 1 && imageUrls.length <= 30,
  externalImageUrls: imageUrls.length >= 1 && imageUrls.every((url) => /^https?:\/\//i.test(url) && !url.includes("/api/catalog/images/")),
  noStoredImageObjects: (candidate.images || []).every((image) => !String(image?.objectKey || "") && !String(image?.checksum || "")),
};

const passed = Object.values(checks).every(Boolean);
const report = {
  version: 2,
  mode: "raw_listing_only",
  checkedAt: new Date().toISOString(),
  market,
  sourceId,
  canonicalUrl: required.canonicalUrl,
  passed,
  pages,
  fetched,
  checks,
  card: {
    id: candidate.id,
    sourceOfferId: candidate.sourceOfferId,
    sourceUrl: candidate.operational?.sourceUrl,
    sourceTitle: sourceTitle(candidate),
    year: candidate.year,
    sourcePrice: candidate.sourcePrice,
    sourceCurrency: candidate.sourceCurrency,
    powerHp: candidate.powerHp,
    imageCount: imageUrls.length,
    imageUrls,
  },
  errors,
};

await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!passed) process.exit(1);
