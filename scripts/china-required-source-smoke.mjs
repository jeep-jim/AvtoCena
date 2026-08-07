import fs from "node:fs/promises";

process.env.CATALOG_RAW_LISTING_MODE = "1";
process.env.CATALOG_KNOWLEDGE_DISABLED = "1";
process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER = "3";
process.env.CATALOG_MAX_IMAGES_PER_OFFER = "30";
process.env.CATALOG_COLLECTION_IMAGE_LIMIT = "30";
process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS ||= "30000";
process.env.CATALOG_GALLERY_TIMEOUT_MS ||= "30000";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");

const sourceId = String(process.env.CATALOG_SMOKE_SOURCE_ID || "").trim();
const output = process.env.CATALOG_SMOKE_OUTPUT || `china-smoke-${sourceId}.json`;
const source = catalogImportSources.find((entry) => entry.sourceId === sourceId);
if (!source) throw new Error(`source_missing:${sourceId}`);

function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function validCore(offer) {
  return Boolean(
    offer?.sourceOfferId
    && Number(offer?.year || 0) >= 2011
    && Number(offer?.sourcePrice || 0) > 0
    && clean(offer?.sourceCurrency)
    && /^https?:\/\//i.test(clean(offer?.operational?.sourceUrl))
  );
}

let cursor = null;
let fetched = 0;
let pages = 0;
let candidate = null;
const pageReports = [];
const errors = [];

for (let pageNo = 1; pageNo <= 3 && !candidate; pageNo++) {
  try {
    const page = await source.fetchPage(cursor);
    pages++;
    const rows = Array.isArray(page?.items) ? page.items : [];
    fetched += rows.length;
    let normalized = 0;
    for (const raw of rows) {
      try {
        const offer = source.normalizeOffer(raw);
        if (!offer) continue;
        normalized++;
        if (validCore(offer)) { candidate = offer; break; }
      } catch (error) {
        errors.push({ stage: "normalize", error: String(error?.message || error) });
      }
    }
    pageReports.push({ page: pageNo, rows: rows.length, normalized, health: page?.health || null, nextCursor: page?.nextCursor || null });
    cursor = page?.nextCursor || null;
    if (!cursor || page?.finished) break;
  } catch (error) {
    errors.push({ stage: "list", page: pageNo, error: String(error?.message || error) });
    break;
  }
}

let images = [];
if (candidate) {
  try {
    images = credibleCatalogImages(await source.fetchImages(candidate)).slice(0, 30);
  } catch (error) {
    errors.push({ stage: "detail", error: String(error?.message || error) });
  }
}

const imageUrls = [...new Set(images.map((image) => clean(image?.url)).filter((url) => /^https?:\/\//i.test(url)))];
const report = {
  version: 1,
  checkedAt: new Date().toISOString(),
  sourceId,
  pages,
  fetched,
  pageReports,
  passed: Boolean(candidate && imageUrls.length >= 3),
  card: candidate ? {
    sourceOfferId: candidate.sourceOfferId,
    sourceUrl: candidate.operational?.sourceUrl,
    sourceTitle: candidate.sourceTitle || candidate.operational?.sourceTitle || [candidate.make, candidate.model, candidate.trim].filter(Boolean).join(" "),
    make: candidate.make,
    model: candidate.model,
    year: candidate.year,
    sourcePrice: candidate.sourcePrice,
    sourceCurrency: candidate.sourceCurrency,
    powerHp: candidate.powerHp || null,
    imageCount: imageUrls.length,
    imageUrls,
  } : null,
  errors,
};

await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
