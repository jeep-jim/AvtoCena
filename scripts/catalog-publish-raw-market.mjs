import fs from "node:fs/promises";
import path from "node:path";

process.env.CATALOG_RAW_LISTING_MODE = "1";
process.env.CATALOG_KNOWLEDGE_DISABLED = "1";
process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER ||= "5";

const { isCrediblePublicOffer, credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { persistCatalogOffers, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const inputDir = process.env.CATALOG_REBUILD_INPUT_DIR || "catalog-v4-input";
const reportFile = process.env.CATALOG_REBUILD_PUBLISH_REPORT || "catalog-raw-market-publish-report.json";
const market = String(process.env.CATALOG_REBUILD_MARKETS || "").split(",")[0]?.trim();
const maximumPerMarket = Math.max(1, Math.min(30_000, Number(process.env.CATALOG_PUBLISH_MAX_PER_MARKET || 30_000)));
const retentionMs = Math.max(60_000, Number(process.env.CATALOG_OFFER_RETENTION_MS || 3 * 24 * 60 * 60 * 1_000));
const currentYear = new Date().getFullYear();
const priorityYear = currentYear - 6;

if (!PUBLIC_CATALOG_MARKETS.includes(market)) throw new Error(`catalog_market_invalid:${market || "missing"}`);

function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function title(offer) {
  return clean(offer?.sourceTitle || offer?.operational?.sourceTitle || [offer?.make, offer?.model, offer?.trim].filter(Boolean).join(" "));
}
function freshness(offer) {
  return Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0;
}
function imageKey(image) { return String(image?.url || image?.id || image?.objectKey || ""); }
function uniqueImages(images) {
  const result = [];
  const seen = new Set();
  for (const image of credibleCatalogImages(Array.isArray(images) ? images : [])) {
    const key = imageKey(image);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ ...image, objectKey: "", checksum: "", size: 0 });
    if (result.length >= 30) break;
  }
  return result;
}
function normalizeRaw(offer) {
  return normalizeVehicleOfferSpecs({
    ...offer,
    sourceTitle: title(offer),
    status: "active",
    images: uniqueImages(offer?.images),
    totalRub: null,
    calculationSnapshot: undefined,
    calculationStatus: "needs_knowledge",
    operational: {
      ...(offer?.operational || {}),
      sourceTitle: title(offer),
      rawListingMode: true,
      knowledgeEnriched: false,
      galleryStoredAs: "json_urls",
    },
  });
}
function order(left, right) {
  const recentLeft = Number(left?.year || 0) >= priorityYear ? 1 : 0;
  const recentRight = Number(right?.year || 0) >= priorityYear ? 1 : 0;
  return recentRight - recentLeft
    || Number(right?.year || 0) - Number(left?.year || 0)
    || Number(right?.images?.length || 0) - Number(left?.images?.length || 0)
    || freshness(right) - freshness(left)
    || String(left?.id || "").localeCompare(String(right?.id || ""));
}
function validRetained(offer, cutoff) {
  return isCrediblePublicOffer(offer) && freshness(offer) >= cutoff;
}
function mergeById(rows) {
  const result = new Map();
  for (const row of rows) {
    const offer = normalizeRaw(row);
    if (!offer?.id) continue;
    const existing = result.get(offer.id);
    if (!existing || freshness(offer) >= freshness(existing)) result.set(offer.id, offer);
  }
  return result;
}

let filenames = [];
try {
  filenames = (await fs.readdir(inputDir))
    .filter((name) => name.startsWith(`catalog-rebuild-${market}`) && name.endsWith(".json"));
} catch {}

const rawOffers = [];
const readErrors = [];
for (const filename of filenames.sort()) {
  try {
    const payload = JSON.parse(await fs.readFile(path.join(inputDir, filename), "utf8"));
    if (Array.isArray(payload?.offers)) rawOffers.push(...payload.offers);
  } catch (error) {
    readErrors.push({ filename, error: String(error?.message || error) });
  }
}

const rejected = {};
const incomingById = new Map();
for (const row of rawOffers) {
  try {
    const offer = normalizeRaw(row);
    if (!offer?.id || offer.market !== market) {
      rejected.identity = Number(rejected.identity || 0) + 1;
      continue;
    }
    if (!isCrediblePublicOffer(offer)) {
      rejected.quality = Number(rejected.quality || 0) + 1;
      continue;
    }
    const existing = incomingById.get(offer.id);
    if (!existing || freshness(offer) >= freshness(existing)) incomingById.set(offer.id, offer);
  } catch {
    rejected.exception = Number(rejected.exception || 0) + 1;
  }
}

const cutoff = Date.now() - retentionMs;
let currentExisting = [];
try { currentExisting = await readMarketOffers(market); } catch (error) {
  readErrors.push({ market, stage: "read_current_market", error: String(error?.message || error) });
}

const retainedCurrent = currentExisting
  .map(normalizeRaw)
  .filter((offer) => validRetained(offer, cutoff));
const accumulatedCurrent = mergeById([...retainedCurrent, ...incomingById.values()]);
const selected = [...accumulatedCurrent.values()].sort(order).slice(0, maximumPerMarket);

const combined = [...selected];
const preservedByMarket = {};
for (const otherMarket of PUBLIC_CATALOG_MARKETS) {
  if (otherMarket === market) continue;
  let rows = [];
  try { rows = await readMarketOffers(otherMarket); } catch (error) {
    readErrors.push({ market: otherMarket, stage: "read_other_market", error: String(error?.message || error) });
  }
  const preserved = rows
    .map(normalizeRaw)
    .filter((offer) => validRetained(offer, cutoff))
    .sort(order)
    .slice(0, maximumPerMarket);
  preservedByMarket[otherMarket] = preserved.length;
  combined.push(...preserved);
}

let manifest = null;
let publicationError = "";
if (selected.length > 0) {
  try {
    process.env.CATALOG_GROW_ONLY_MARKETS = "";
    manifest = await persistCatalogOffers([...mergeById(combined).values()]);
  } catch (error) {
    publicationError = String(error?.message || error);
  }
} else {
  publicationError = `raw_market_empty:${market}`;
}

const byMarket = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((marketId) => [
  marketId,
  marketId === market ? selected.length : Number(preservedByMarket[marketId] || 0),
]));
const report = {
  version: 3,
  mode: "raw_listing_accumulative_independent_market",
  market,
  target: maximumPerMarket,
  priorityYear,
  inputFiles: filenames,
  inputCount: rawOffers.length,
  incomingValidCount: incomingById.size,
  retainedCurrentCount: retainedCurrent.length,
  selectedCount: selected.length,
  recentCount: selected.filter((offer) => Number(offer.year || 0) >= priorityYear).length,
  byMarket,
  rejected,
  readErrors,
  published: Boolean(manifest),
  publicationError,
  generationId: manifest?.generationId || null,
  publishedAt: new Date().toISOString(),
};

await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
