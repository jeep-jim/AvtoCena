import fs from "node:fs/promises";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");
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
process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER = "5";
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

function coreCandidate(offer) {
  const year = Number(offer?.year || 0);
  return Boolean(
    offer?.id
    && offer?.sourceId === sourceId
    && offer?.market === market
    && offer?.make
    && offer?.model
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
    version: 1,
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
  status: "active",
  images: credibleCatalogImages(Array.isArray(gallery) ? gallery : []).slice(0, 30),
});

let calculated = candidate;
try {
  calculated = normalizeVehicleOfferSpecs(await calculateOfferWithRussiaCustoms(candidate));
} catch (error) {
  errors.push({ stage: "calculation", error: String(error?.message || error) });
}

const imageUrls = [...new Set((calculated.images || []).map((image) => String(image?.url || "")).filter(Boolean))];
const checks = {
  stableId: Boolean(calculated.id && calculated.sourceOfferId),
  sourceUrl: /^https?:\/\//i.test(String(calculated.operational?.sourceUrl || "")),
  makeModel: Boolean(calculated.make && calculated.model),
  year: Number(calculated.year || 0) >= 2011,
  sourcePrice: Number(calculated.sourcePrice || 0) > 0 && Boolean(calculated.sourceCurrency),
  mileage: calculated.mileageKm !== undefined && calculated.mileageKm !== null && Number(calculated.mileageKm) >= 0,
  powerOrEngine: Number(calculated.powerHp || 0) > 0 || Number(calculated.engineCc || 0) > 0 || Number(calculated.power30MinKw || 0) > 0,
  galleryCount: imageUrls.length >= 5 && imageUrls.length <= 30,
  externalImageUrls: imageUrls.length >= 5 && imageUrls.every((url) => /^https?:\/\//i.test(url) && !url.includes("/api/catalog/images/")),
  noStoredImageObjects: (calculated.images || []).every((image) => !String(image?.objectKey || "") && !String(image?.checksum || "")),
  calculatedPrice: Number(calculated.totalRub || 0) > 0 && !String(calculated.calculationStatus || "").startsWith("needs_") && calculated.calculationStatus !== "needs_data",
};

const passed = Object.values(checks).every(Boolean);
const report = {
  version: 1,
  checkedAt: new Date().toISOString(),
  market,
  sourceId,
  canonicalUrl: required.canonicalUrl,
  passed,
  pages,
  fetched,
  checks,
  card: {
    id: calculated.id,
    sourceOfferId: calculated.sourceOfferId,
    sourceUrl: calculated.operational?.sourceUrl,
    make: calculated.make,
    model: calculated.model,
    trim: calculated.trim,
    year: calculated.year,
    mileageKm: calculated.mileageKm,
    sourcePrice: calculated.sourcePrice,
    sourceCurrency: calculated.sourceCurrency,
    powerHp: calculated.powerHp,
    power30MinKw: calculated.power30MinKw,
    engineCc: calculated.engineCc,
    fuel: calculated.fuel,
    transmission: calculated.transmission,
    drive: calculated.drive,
    imageCount: imageUrls.length,
    imageUrls,
    totalRub: calculated.totalRub,
    calculationStatus: calculated.calculationStatus,
  },
  errors,
};

await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!passed) process.exit(1);
