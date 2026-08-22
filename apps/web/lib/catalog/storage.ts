import crypto from "node:crypto";
import sharp from "sharp";
import { getJsonStorage, readDataJson, StorageConflictError } from "../data";
import { publishAiProductFeed } from "../ai-discovery";
import type { CatalogImage, CatalogMarket, CatalogSearchParams, PublicVehicleOffer, VehicleOffer } from "./types";
import { hasCredibleOfferContent, isCatalogYearAllowed } from "./offer-quality";
import { rankedCatalogImageUrls } from "./image-quality";
import { catalogOfferVisibleRub, isJapanAuctionOffer, japanAuctionSoldIdentityVerified } from "./public-priority";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import { CATALOG_CHUNK_SIZE, PUBLIC_CATALOG_MARKETS } from "./runtime-config";
import { enforceCatalogModelYearQuota, selectCatalogShowcaseDiversity } from "./inventory-quota";
import { resolveVehicleModelQuery } from "./vehicle-knowledge";
import { enrichOfferWithKnowledgeCore } from "./knowledge-core";
import { applyEncyclopediaDisplayIdentityBatch } from "./display-identity";
import { catalogPublicPriority, findCatalogPriceOutliers } from "./public-priority";
import { deduplicatePublicCatalogOffers } from "./public-offer-deduplication";
import { isSupportedPublicCatalogIdentity, publicCatalogIdentityRejectionReason } from "./public-identity-policy";

const MARKETS: CatalogMarket[] = [...PUBLIC_CATALOG_MARKETS];
const IMAGE_MAX_BYTES = Number(process.env.CATALOG_IMAGE_MAX_BYTES || 8_000_000);
const IMAGE_MAX_WIDTH = Math.max(640, Number(process.env.CATALOG_IMAGE_MAX_WIDTH || 1600));
const IMAGE_MAX_HEIGHT = Math.max(480, Number(process.env.CATALOG_IMAGE_MAX_HEIGHT || 1200));
const IMAGE_WEBP_QUALITY = Math.max(55, Math.min(90, Number(process.env.CATALOG_IMAGE_WEBP_QUALITY || 78)));
const IMAGE_OPTIMIZATION_DISABLED = String(process.env.CATALOG_IMAGE_OPTIMIZATION_DISABLED || "false").toLowerCase() === "true";
const IMAGE_SOURCE_CACHE_VERSION = 1;
const IMAGE_SOURCE_CACHE_SHARD_LIMIT = Math.max(100, Math.min(500, Number(process.env.CATALOG_IMAGE_SOURCE_CACHE_SHARD_LIMIT || 450)));
const IMAGE_SOURCE_HOST_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.CATALOG_IMAGE_HOST_CONCURRENCY || 3)));
const IMAGE_SOURCE_HOST_RPM = Math.max(30, Math.min(600, Number(process.env.CATALOG_IMAGE_HOST_RPM || 180)));
const INTERNAL_MANIFEST_PATH = "catalog/internal/manifest.json";
const JAPAN_ARCHIVE_MANIFEST_PATH = "catalog/japan-auction-history/manifest.json";
const JAPAN_ARCHIVE_RETENTION_DAYS = 30;
const ALLOWED_IMAGE_HOSTS = [
  /^(.+\.)?encar\.com$/i,
  /^(.+\.)?kcar\.com$/i,
  /^(.+\.)?kcarcdn\.com$/i,
  /^(.+\.)?kcarglobal\.com$/i,
  /^(.+\.)?autowini\.com$/i,
  /^(.+\.)?kbchachacha\.com$/i,
  /^(.+\.)?bobaedream\.co\.kr$/i,
  /^(.+\.)?che168\.com$/i,
  /^(.+\.)?autohome\.com\.cn$/i,
  /^(.+\.)?autoimg\.cn$/i,
  /^(.+\.)?dongchedi\.com$/i,
  /^(.+\.)?byteimg\.com$/i,
  /^(.+\.)?guazi\.com$/i,
  /^(.+\.)?guazistatic-global\.com$/i,
  /^(.+\.)?xin\.com$/i,
  /^(.+\.)?taoche\.com$/i,
  /^(.+\.)?58che\.com$/i,
  /^(.+\.)?58cdn\.com\.cn$/i,
  /^(.+\.)?ganji\.com$/i,
  /^(.+\.)?yiche\.com$/i,
  /^(.+\.)?bitauto\.com$/i,
  /^(.+\.)?xcar\.com\.cn$/i,
  /^(.+\.)?cn2che\.com$/i,
  /^(.+\.)?273\.cn$/i,
  /^(.+\.)?autocango\.com$/i,
  /^(.+\.)?beforward\.jp$/i,
  /^(.+\.)?bf\.jp$/i,
  /^(.+\.)?goo-net\.com$/i,
  /^(.+\.)?goo-net-exchange\.com$/i,
  /^(.+\.)?jpauc\.com$/i,
  /^(.+\.)?carvector\.com$/i,
  /^(.+\.)?jp\.center$/i,
  /^(.+\.)?prestigemotorsport\.com\.au$/i,
  /^(.+\.)?sbtjapan\.com$/i,
  /^(.+\.)?tc-v\.com$/i,
  /^(.+\.)?carfromjapan\.com$/i,
  /^(.+\.)?japan-partner\.com$/i,
  /^(.+\.)?carused\.jp$/i,
  /^(.+\.)?cardealpage\.com$/i,
  /^(.+\.)?picknbuy24\.com$/i,
  /^(.+\.)?autocomjapan\.com$/i,
  /^(.+\.)?everycar\.jp$/i,
  /^(.+\.)?autorec\.co\.jp$/i,
  /^(.+\.)?nikkyo\.com$/i,
  /^(.+\.)?providecars\.com$/i,
  /^(.+\.)?dvmjapan\.com$/i,
  /^(.+\.)?jvsglobal\.net$/i,
  /^(.+\.)?buymycar\.co\.jp$/i,
  /^(.+\.)?japanesecartrade\.com$/i,
  /^(.+\.)?royal-trading\.jp$/i,
  /^(.+\.)?japantransit\.ru$/i,
  /^(.+\.)?dubicars\.com$/i,
  /^(.+\.)?dubizzle\.com$/i,
  /^(.+\.)?dubizzlecdn\.com$/i,
  /^(.+\.)?dubicdn\.com$/i,
  /^(.+\.)?yallamotor\.com$/i,
  /^(.+\.)?carswitch\.com$/i,
  /^(.+\.)?myauto\.ge$/i,
  /^(.+\.)?my\.ge$/i,
  /^(.+\.)?autopapa\.ge$/i,
  /^(.+\.)?auto\.ge$/i,
  /^(.+\.)?ss\.ge$/i,
  /^(.+\.)?mymarket\.ge$/i,
  /^(.+\.)?mashina\.kg$/i,
  /^(.+\.)?elcat\.kg$/i,
  /^(.+\.)?lalafo\.kg$/i,
  /^(.+\.)?bazar\.kg$/i,
  /^(.+\.)?turbo\.kg$/i,
  /^(.+\.)?o\.kg$/i,
  /^(.+\.)?autouncle\.(?:de|com|dk|se|no|fr|it|es|nl|be|at|ch)$/i,
  /^(.+\.)?autoscout24\.(?:com|de|fr|it|nl|be|at|ch|es|pl)$/i,
  /^(.+\.)?mobile\.de$/i,
  /^(.+\.)?otomoto\.pl$/i,
  /^(.+\.)?olxcdn\.com$/i,
  /^(.+\.)?lacentrale\.fr$/i,
  /^(.+\.)?leboncoin\.fr$/i,
  /^(.+\.)?subito\.it$/i,
  /^(.+\.)?coches\.net$/i,
  /^(.+\.)?standvirtual\.com$/i,
  /^(.+\.)?marktplaats\.nl$/i,
  /^(.+\.)?gaspedaal\.nl$/i,
  /^(.+\.)?bilbasen\.dk$/i,
  /^(.+\.)?finn\.no$/i,
  /^(.+\.)?blocket\.se$/i,
  /^(.+\.)?bytbil\.com$/i,
  /^(.+\.)?willhaben\.at$/i,
  /^(.+\.)?car\.gr$/i,
  /^(.+\.)?autotrader\.co\.uk$/i,
  /^(.+\.)?motors\.co\.uk$/i,
  /^(.+\.)?hasznaltauto\.hu$/i,
  /^(.+\.)?tipcars\.com$/i,
  /^(.+\.)?bazos\.(?:cz|sk)$/i,
  /^(.+\.)?cloudfront\.net$/i,
  /^(.+\.)?amazonaws\.com$/i,
  /^(.+\.)?imgix\.net$/i,
  /^(.+\.)?cloudinary\.com$/i,
  /^(.+\.)?scene7\.com$/i,
  /^(.+\.)?akamaihd\.net$/i,
  /^(.+\.)?akamaized\.net$/i,
  /^(.+\.)?alicdn\.com$/i,
  /^(.+\.)?qiniucdn\.com$/i,
  /^(.+\.)?imagekit\.io$/i,
  /^img\.avtocena\.com$/i,
];
export { CATALOG_CHUNK_SIZE };
export type OfferLocation = { market: CatalogMarket; chunk: string };
export type CatalogManifest = { version: 2; generationId: string; updatedAt: string; markets: Record<string, { count: number; chunks: string[]; updatedAt: string }> };
type JapanAuctionArchiveManifest = { version: 1; updatedAt: string; retentionDays: 30; activeSlot: "a" | "b"; count: number; chunks: string[]; contentHash: string };
export type CatalogFacets = { generationId: string; makes: string[]; models: Array<{ make: string; model: string; aliases?: string[]; popularityDecile?: number }>; markets: string[]; bodyTypes: string[]; fuels: string[]; transmissions: string[]; drives: string[] };
export type CatalogBrandSummaryModel = { model: string; count: number; marketCounts: Record<string, number> };
export type CatalogBrandSummary = { generationId: string; brands: Record<string, { make: string; count: number; marketCounts: Record<string, number>; models: CatalogBrandSummaryModel[] }> };
export type CatalogSearchProjection = {
  id: string; market: string; make: string; model: string; year: number; totalRub?: number | null; mileageKm?: number; engineCc?: number; powerHp?: number;
  fuel?: string; bodyType?: string; transmission?: string; drive?: string; auctionGrade?: string; auctionDate?: string; updatedAt?: string; firstSeenAt?: string; sourcePublishedAt?: string;
  trim?: string; powerKw?: number; icePowerKw?: number; powertrainKind?: string; power30MinKw?: number; power30MinKwByMotor?: number[]; utilizationPowerKw?: number;
  powerDataConfidence?: string; powerDataSource?: string;
  sourcePrice?: number | null; sourceCurrency?: string | null; priceMode?: string; previousTotalRub?: number | null; priceDeltaRub?: number | null; priceChangedAt?: string;
  calculationStatus?: string; calculationSnapshot?: { currencyRate?: any; pricingConfidence?: string } | null; publicVisibleRub?: number; cardImageUrl?: string; seriesId?: string; cardProjectionVersion?: 1 | 2;
};
export function publicOffer(offer: VehicleOffer): PublicVehicleOffer { const { operational, vin, frameNumber, sourceId, ...dto } = offer as any; return { ...dto, images: offer.images.map((img) => ({ id: img.id, url: img.url, width: img.width, height: img.height, size: img.size, mimeType: img.mimeType })) } as any; }
export function compactPublicStorageOffer(offer: VehicleOffer): VehicleOffer {
  // Source adapters may retain complete HTML/JSON responses in operational.raw
  // for diagnostics. Public generations are immutable and were duplicating that
  // payload (hundreds of MB per generation) even though public readers never use
  // it. Keep the normalized card, calculation and verification metadata only.
  const operational = { ...(offer.operational || {}) } as any;
  const publicJapanSoldIdentityVerified = isJapanAuctionOffer(offer) && japanAuctionSoldIdentityVerified(offer);
  delete operational.raw;
  delete operational.publicJapanSoldIdentityVerified;
  if (publicJapanSoldIdentityVerified) operational.publicJapanSoldIdentityVerified = true;
  return { ...offer, operational };
}
export function stableOfferId(sourceId: string, sourceOfferId: string) { return crypto.createHash("sha256").update(`${sourceId}:${sourceOfferId}`).digest("hex").slice(0, 24); }
export function publicImageUrl(imageId: string, objectKey: string) { const cdn = process.env.CATALOG_IMAGE_CDN_URL?.replace(/\/+$/g, ""); return cdn ? `${cdn}/${objectKey}` : `/api/catalog/images/${imageId}`; }

type ImageSourceCacheRecord = { objectKey: string; imageId: string; checksum: string; mimeType: string; size: number; createdAt: string };
type ImageSourceCacheShard = { version: 1; records: Record<string, ImageSourceCacheRecord> };
const imageSourceCacheMemory = new Map<string, ImageSourceCacheShard>();
const imageSourceCacheLocks = new Map<string, Promise<unknown>>();
const imageHostStates = new Map<string, { active: number; nextStartAt: number; blockedUntil: number; failures: number; waiters: Array<() => void> }>();

function normalizedImageSourceUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  url.hash = "";
  const transient = /^(x-amz-(algorithm|credential|date|expires|signedheaders|signature|security-token)|key-pair-id|signature|expires)$/i;
  for (const key of [...url.searchParams.keys()]) if (transient.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}

function imageSourceCacheIdentity(rawUrl: string) {
  const hash = crypto.createHash("sha256").update(normalizedImageSourceUrl(rawUrl)).digest("hex");
  return { hash, shardPath: `catalog/image-source-cache/v${IMAGE_SOURCE_CACHE_VERSION}/${hash.slice(0, 3)}.json` };
}

async function withImageSourceCacheLock<T>(key: string, fn: () => Promise<T>) {
  const previous = imageSourceCacheLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  imageSourceCacheLocks.set(key, previous.then(() => current, () => current));
  await previous.catch(() => undefined);
  try { return await fn(); }
  finally { release(); }
}

async function readImageSourceCacheShard(shardPath: string) {
  const cached = imageSourceCacheMemory.get(shardPath);
  if (cached) return cached;
  const stored = await getJsonStorage().readJson<ImageSourceCacheShard>(shardPath, { version: 1, records: {} }).catch(() => ({ version: 1 as const, records: {} }));
  const valid = stored?.version === 1 && stored.records && typeof stored.records === "object" ? stored : { version: 1 as const, records: {} };
  imageSourceCacheMemory.set(shardPath, valid);
  return valid;
}

async function rememberImageSource(rawUrl: string, image: CatalogImage) {
  const { hash, shardPath } = imageSourceCacheIdentity(rawUrl);
  await withImageSourceCacheLock(shardPath, async () => {
    const storage = getJsonStorage();
    for (let attempt = 0; attempt < 6; attempt++) {
      const meta = await storage.readJsonWithMeta<ImageSourceCacheShard>(shardPath, { version: 1, records: {} });
      const current = meta.value?.version === 1 && meta.value.records && typeof meta.value.records === "object" ? meta.value : { version: 1 as const, records: {} };
      const existing = current.records[hash];
      if (existing?.objectKey === image.objectKey && existing?.checksum === image.checksum) { imageSourceCacheMemory.set(shardPath, current); return; }
      const entries = Object.entries(current.records).filter(([key]) => key !== hash);
      const retained = entries.length >= IMAGE_SOURCE_CACHE_SHARD_LIMIT ? entries.slice(entries.length - IMAGE_SOURCE_CACHE_SHARD_LIMIT + 1) : entries;
      const next: ImageSourceCacheShard = { version: 1, records: Object.fromEntries([...retained, [hash, { objectKey: image.objectKey, imageId: image.id, checksum: image.checksum, mimeType: image.mimeType, size: image.size, createdAt: new Date().toISOString() }]]) };
      try {
        await storage.writeJson(shardPath, next, meta.found && meta.etag ? { ifMatch: meta.etag } : { ifNoneMatch: "*" });
        imageSourceCacheMemory.set(shardPath, next);
        return;
      } catch (error) {
        if (!(error instanceof StorageConflictError)) throw error;
      }
    }
  });
}

async function cachedImageForSource(rawUrl: string) {
  const { hash, shardPath } = imageSourceCacheIdentity(rawUrl);
  const record = (await readImageSourceCacheShard(shardPath)).records[hash];
  if (!record?.objectKey || !(await getJsonStorage().binaryExists?.(record.objectKey).catch(() => false))) return null;
  return { id: record.imageId, url: publicImageUrl(record.imageId, record.objectKey), objectKey: record.objectKey, checksum: record.checksum, mimeType: record.mimeType, size: record.size } satisfies CatalogImage;
}

async function withImageHostLimit<T>(hostname: string, fn: () => Promise<T>) {
  const state = imageHostStates.get(hostname) || { active: 0, nextStartAt: 0, blockedUntil: 0, failures: 0, waiters: [] };
  imageHostStates.set(hostname, state);
  while (state.active >= IMAGE_SOURCE_HOST_CONCURRENCY) await new Promise<void>((resolve) => state.waiters.push(resolve));
  const waitMs = Math.max(0, state.nextStartAt - Date.now(), state.blockedUntil - Date.now());
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  state.active++;
  state.nextStartAt = Date.now() + Math.ceil(60_000 / IMAGE_SOURCE_HOST_RPM);
  try { const result = await fn(); state.failures = 0; return result; }
  catch (error) {
    state.failures++;
    if (String(error instanceof Error ? error.message : error).includes("image_source_rate_limited")) state.blockedUntil = Date.now() + Math.min(5 * 60_000, 30_000 * 2 ** Math.min(3, state.failures - 1));
    throw error;
  }
  finally { state.active--; state.waiters.shift()?.(); }
}

export function resetImageSourceCacheForTests() { imageSourceCacheMemory.clear(); imageSourceCacheLocks.clear(); imageHostStates.clear(); }
const MAX_INDEX_SHARD_BYTES = 180;
export function catalogIndexShardKey(value?: string | number) {
  const normalized = String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
  if (Buffer.byteLength(normalized, "utf8") <= MAX_INDEX_SHARD_BYTES) return normalized;
  const digest = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  let prefix = "";
  for (const character of normalized) {
    if (Buffer.byteLength(`${prefix}${character}`, "utf8") > 150) break;
    prefix += character;
  }
  prefix = prefix.replace(/-+$/g, "");
  return `${prefix || "value"}-${digest}`;
}
const cleanShard = catalogIndexShardKey;
function cleanFacet(value: unknown) { return String(value || "").replace(/\s+/g, " ").trim(); }
export function catalogMakeFilterValues(value: unknown) {
  return [...new Set(String(value || "").split(",").map(cleanFacet).filter(Boolean))];
}
function generationPath(generationId: string, rel: string) { return `catalog/generations/${generationId}/${rel}`; }
function currentProjectionPath(market: string) { return `catalog/public/projection/${cleanShard(market)}.json`; }
function catalogBrandReadModelKey(value: unknown) { return cleanFacet(value).toLocaleLowerCase("ru-RU"); }
function currentBrandProjectionPath(make: string) {
  const normalized = catalogBrandReadModelKey(make);
  const digest = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  const label = cleanShard(make);
  return `catalog/public/projection-brand/${label}-${digest}.json`;
}
const CURRENT_ALL_MARKETS_PROJECTION = "all";
function currentOfferShardName(id: string) { return String(id || "").toLowerCase().replace(/[^a-f0-9]/g, "").slice(0, 2) || "unknown"; }
function currentOfferShardPath(id: string) { return `catalog/public/offers/${currentOfferShardName(id)}.json`; }
const CURRENT_FACETS_PATH = "catalog/public/facets.json";
const CURRENT_BRAND_SUMMARY_PATH = "catalog/public/brand-summary.json";
function uniqueText(values: unknown[]) { return [...new Set(values.map(cleanFacet).filter(Boolean))]; }
export function buildCatalogBrandSummary(generationId: string, rows: CatalogSearchProjection[]): CatalogBrandSummary {
  const brands = new Map<string, { make: string; count: number; marketCounts: Record<string, number>; models: Map<string, CatalogBrandSummaryModel> }>();
  for (const row of rows) {
    const make = cleanFacet(row.make);
    const model = cleanFacet(row.model);
    if (!make) continue;
    const brandKey = catalogBrandReadModelKey(make);
    const brand = brands.get(brandKey) || { make, count: 0, marketCounts: {}, models: new Map<string, CatalogBrandSummaryModel>() };
    brand.count += 1;
    if (row.market) brand.marketCounts[row.market] = (brand.marketCounts[row.market] || 0) + 1;
    if (model) {
      const modelKey = model.toLocaleLowerCase("ru-RU");
      const current = brand.models.get(modelKey) || { model, count: 0, marketCounts: {} };
      current.count += 1;
      if (row.market) current.marketCounts[row.market] = (current.marketCounts[row.market] || 0) + 1;
      brand.models.set(modelKey, current);
    }
    brands.set(brandKey, brand);
  }
  return {
    generationId,
    brands: Object.fromEntries([...brands.entries()]
      .sort((a, b) => a[1].make.localeCompare(b[1].make, "ru"))
      .map(([key, brand]) => [key, {
        make: brand.make, count: brand.count, marketCounts: brand.marketCounts,
        models: [...brand.models.values()].sort((a, b) => b.count - a.count || a.model.localeCompare(b.model, "ru")),
      }])),
  };
}
export function offerPath(generationId: string, market: string, chunk: string) { return generationPath(generationId, `offers/${market}/${chunk}.json`); }
function storedOfferChunkPath(generationId: string, market: string, chunk: string) {
  return String(chunk || "").startsWith("catalog/") ? String(chunk) : offerPath(generationId, market, chunk);
}
export function chunkName(index: number) { return `chunk-${String(index).padStart(4, "0")}`; }
// The manifest is tiny but a signed cross-service Object Storage GET can take
// several seconds after a container resumes. Catalog publications are atomic
// and tolerate a short visibility delay, so keep it in the warm process long
// enough for a real browsing session instead of re-reading it on every tap.
const MANIFEST_CACHE_MS = Math.max(1_000, Number(process.env.CATALOG_MANIFEST_CACHE_MS || 60_000));
let manifestCache: { expiresAt: number; promise: Promise<CatalogManifest> } | null = null;
async function readManifest(): Promise<CatalogManifest> {
  const now = Date.now();
  if (manifestCache && manifestCache.expiresAt > now) return manifestCache.promise;
  const promise = readDataJson<CatalogManifest>("catalog/manifest.json", { version: 2, generationId: "empty", updatedAt: "", markets: {} })
    .catch((error) => { manifestCache = null; throw error; });
  manifestCache = { expiresAt: now + MANIFEST_CACHE_MS, promise };
  return promise;
}
async function readIndex<T>(generationId: string, path: string, fallback: T) { return readDataJson<T>(generationPath(generationId, `indexes/${path}`), fallback); }
async function writeJsonAtomic(path: string, value: unknown, ifNoneMatch = true) { const storage = getJsonStorage(); try { await storage.writeJson(path, value, ifNoneMatch ? { ifNoneMatch: "*" } : undefined); } catch (e) { if (e instanceof StorageConflictError && ifNoneMatch) return; throw e; } }

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

function searchProjectionFromOffer(offer: VehicleOffer): CatalogSearchProjection {
  const visibleRub = catalogOfferVisibleRub(offer);
  const raw: any = offer.operational?.raw || {};
  return {
    id: offer.id, market: String(offer.market || ""), make: cleanFacet(offer.make), model: cleanFacet(offer.model), year: Number(offer.year || 0),
    totalRub: visibleRub || null, mileageKm: offer.mileageKm, engineCc: offer.engineCc, powerHp: offer.powerHp, fuel: cleanFacet(offer.fuel), bodyType: cleanFacet(offer.bodyType),
    transmission: cleanFacet(offer.transmission), drive: cleanFacet(offer.drive), auctionGrade: cleanFacet(offer.auctionGrade), auctionDate: offer.auctionDate, updatedAt: offer.updatedAt,
    firstSeenAt: offer.firstSeenAt, sourcePublishedAt: String((offer.operational as any)?.sourcePublishedAt || "") || undefined,
    trim: cleanFacet(offer.trim), powerKw: offer.powerKw, icePowerKw: offer.icePowerKw, powertrainKind: offer.powertrainKind, power30MinKw: offer.power30MinKw, power30MinKwByMotor: offer.power30MinKwByMotor, utilizationPowerKw: offer.utilizationPowerKw,
    powerDataConfidence: offer.powerDataConfidence, powerDataSource: offer.powerDataSource,
    sourcePrice: offer.sourcePrice, sourceCurrency: offer.sourceCurrency, priceMode: offer.priceMode, previousTotalRub: visibleRub ? offer.previousTotalRub : null, priceDeltaRub: visibleRub ? offer.priceDeltaRub : null, priceChangedAt: offer.priceChangedAt,
    calculationStatus: offer.calculationStatus, calculationSnapshot: { currencyRate: offer.calculationSnapshot?.currencyRate, pricingConfidence: offer.calculationSnapshot?.pricingConfidence },
    publicVisibleRub: visibleRub || undefined, cardImageUrl: rankedCatalogImageUrls(offer)[0] || undefined,
    seriesId: String(raw?.listing?.seriesId || raw?.seriesId || (offer as any)?.seriesId || "") || undefined, cardProjectionVersion: 2,
  };
}
function projectionCanRenderCard(row: CatalogSearchProjection) {
  return [1, 2].includes(Number(row.cardProjectionVersion)) && Boolean(row.id && row.market && row.make && row.model && row.year);
}
function publicOfferFromProjection(row: CatalogSearchProjection): PublicVehicleOffer {
  const imageUrl = String(row.cardImageUrl || "");
  return {
    ...row, status: "active", offerType: "fixed", priceMode: (row.priceMode || "fixed") as any, calculationStatus: (row.calculationStatus || "needs_data") as any,
    sourcePrice: row.sourcePrice ?? null, sourceCurrency: row.sourceCurrency ?? null,
    images: imageUrl ? [{ id: "", url: imageUrl, width: undefined, height: undefined, size: 0, mimeType: "image/jpeg" }] : [],
    firstSeenAt: row.firstSeenAt || row.updatedAt || "", updatedAt: row.updatedAt || row.firstSeenAt || "",
  } as any;
}
const SEARCH_PROJECTION_CACHE_MAX = Math.max(1, Math.min(14, Number(process.env.CATALOG_SEARCH_PROJECTION_CACHE_MAX || 8)));
const searchProjectionCache = new Map<string, Promise<{ generationId: string; items: CatalogSearchProjection[] }>>();
const CURRENT_READ_MODEL_CACHE_MS = Math.max(1_000, Number(process.env.CATALOG_CURRENT_READ_MODEL_CACHE_MS || 60_000));
const currentProjectionCache = new Map<string, { expiresAt: number; promise: Promise<{ generationId: string; items: CatalogSearchProjection[] }> }>();
const currentBrandProjectionCache = new Map<string, { expiresAt: number; promise: Promise<{ generationId: string; items: CatalogSearchProjection[] }> }>();
let currentFacetsCache: { expiresAt: number; promise: Promise<CatalogFacets> } | null = null;
let currentBrandSummaryCache: { expiresAt: number; promise: Promise<CatalogBrandSummary> } | null = null;
const currentOfferShardCache = new Map<string, { expiresAt: number; promise: Promise<{ generationId: string; items: VehicleOffer[] }> }>();
let projectionCacheGeneration = "";
let offerLookupCacheGeneration = "";
let offerLocationIndexCache: Promise<{ byId: Record<string, OfferLocation> }> | null = null;
const offerChunkCache = new Map<string, Promise<VehicleOffer[]>>();
const OFFER_CHUNK_CACHE_MAX = Math.max(1, Math.min(24, Number(process.env.CATALOG_OFFER_CHUNK_CACHE_MAX || 8)));
export function resetCatalogReadCachesForTests() {
  manifestCache = null;
  searchProjectionCache.clear();
  currentProjectionCache.clear();
  currentBrandProjectionCache.clear();
  currentFacetsCache = null;
  currentBrandSummaryCache = null;
  currentOfferShardCache.clear();
  projectionCacheGeneration = "";
  offerLookupCacheGeneration = "";
  offerLocationIndexCache = null;
  offerChunkCache.clear();
}
async function readCurrentSearchProjection(market: string) {
  const key = cleanShard(market);
  const now = Date.now();
  const current = currentProjectionCache.get(key);
  if (current && current.expiresAt > now) return current.promise;
  const promise = readDataJson<{ generationId: string; items: CatalogSearchProjection[] }>(currentProjectionPath(market), { generationId: "", items: [] })
    .catch((error) => { currentProjectionCache.delete(key); throw error; });
  currentProjectionCache.set(key, { expiresAt: now + CURRENT_READ_MODEL_CACHE_MS, promise });
  while (currentProjectionCache.size > SEARCH_PROJECTION_CACHE_MAX) {
    const oldest = currentProjectionCache.keys().next().value as string | undefined;
    if (!oldest || oldest === key) break;
    currentProjectionCache.delete(oldest);
  }
  return promise;
}
async function readCurrentBrandProjection(make: string) {
  const key = cleanShard(make);
  const now = Date.now();
  const current = currentBrandProjectionCache.get(key);
  if (current && current.expiresAt > now) return current.promise;
  const promise = readDataJson<{ generationId: string; items: CatalogSearchProjection[] }>(currentBrandProjectionPath(make), { generationId: "", items: [] })
    .catch((error) => { currentBrandProjectionCache.delete(key); throw error; });
  currentBrandProjectionCache.set(key, { expiresAt: now + CURRENT_READ_MODEL_CACHE_MS, promise });
  while (currentBrandProjectionCache.size > 96) {
    const oldest = currentBrandProjectionCache.keys().next().value as string | undefined;
    if (!oldest || oldest === key) break;
    currentBrandProjectionCache.delete(oldest);
  }
  return promise;
}
async function readCurrentFacets() {
  const now = Date.now();
  if (currentFacetsCache && currentFacetsCache.expiresAt > now) return currentFacetsCache.promise;
  const promise = readDataJson<CatalogFacets>(CURRENT_FACETS_PATH, { generationId: "", makes: [], models: [], markets: [...PUBLIC_CATALOG_MARKETS], bodyTypes: [], fuels: [], transmissions: [], drives: [] })
    .catch((error) => { currentFacetsCache = null; throw error; });
  currentFacetsCache = { expiresAt: now + CURRENT_READ_MODEL_CACHE_MS, promise };
  return promise;
}
async function readCurrentBrandSummary() {
  const now = Date.now();
  if (currentBrandSummaryCache && currentBrandSummaryCache.expiresAt > now) return currentBrandSummaryCache.promise;
  const promise = readDataJson<CatalogBrandSummary>(CURRENT_BRAND_SUMMARY_PATH, { generationId: "", brands: {} })
    .catch((error) => { currentBrandSummaryCache = null; throw error; });
  currentBrandSummaryCache = { expiresAt: now + CURRENT_READ_MODEL_CACHE_MS, promise };
  return promise;
}
async function readCurrentOfferShard(id: string) {
  const key = currentOfferShardName(id);
  const now = Date.now();
  const current = currentOfferShardCache.get(key);
  if (current && current.expiresAt > now) return current.promise;
  const promise = readDataJson<{ generationId: string; items: VehicleOffer[] }>(currentOfferShardPath(id), { generationId: "", items: [] })
    .catch((error) => { currentOfferShardCache.delete(key); throw error; });
  currentOfferShardCache.set(key, { expiresAt: now + CURRENT_READ_MODEL_CACHE_MS, promise });
  while (currentOfferShardCache.size > 64) {
    const oldest = currentOfferShardCache.keys().next().value as string | undefined;
    if (!oldest || oldest === key) break;
    currentOfferShardCache.delete(oldest);
  }
  return promise;
}
async function readSearchProjection(generationId: string, market: string) {
  if (projectionCacheGeneration && projectionCacheGeneration !== generationId) searchProjectionCache.clear();
  projectionCacheGeneration = generationId;
  const key = `${generationId}:${cleanShard(market)}`;
  const current = searchProjectionCache.get(key);
  if (current) return current;
  const promise = readIndex<{ generationId: string; items: CatalogSearchProjection[] }>(generationId, `projection/${cleanShard(market)}.json`, { generationId, items: [] })
    .catch((error) => { searchProjectionCache.delete(key); throw error; });
  searchProjectionCache.set(key, promise);
  while (searchProjectionCache.size > SEARCH_PROJECTION_CACHE_MAX) {
    const oldest = searchProjectionCache.keys().next().value as string | undefined;
    if (!oldest || oldest === key) break;
    searchProjectionCache.delete(oldest);
  }
  return promise;
}
function projectionNumber(value: unknown, missing: number) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : missing; }
function projectionUtilizationPowerHp(row: CatalogSearchProjection) {
  const utilizationPowerKw = projectionNumber(row.utilizationPowerKw, 0);
  if (utilizationPowerKw) return utilizationPowerKw * 1.35962;
  const powertrainKind = cleanFacet(row.powertrainKind).toLowerCase();
  const fuel = cleanFacet(row.fuel).toLowerCase();
  if (["electric", "series_hybrid", "other_hybrid"].includes(powertrainKind)
    || /electric|hybrid|phev|hev|bev|электро|гибрид/.test(fuel)) return 0;
  return projectionNumber(row.powerHp, 0);
}
export function catalogSearchProjectionMatches(row: CatalogSearchProjection, params: CatalogSearchParams, modelKeys: Set<string> | null = null) {
  const lower = (value: unknown) => cleanFacet(value).toLocaleLowerCase("ru-RU");
  if (params.market && params.market !== "any" && lower(row.market) !== lower(params.market)) return false;
  if (params.make && !catalogMakeFilterValues(params.make).some((make) => lower(row.make) === lower(make))) return false;
  if (params.model) {
    const canonicalMatch = modelKeys?.size ? modelKeys.has(`${lower(row.make)}:${lower(row.model)}`) : false;
    const literalMatch = !modelKeys?.size && lower(row.model).includes(lower(params.model));
    if (!canonicalMatch && !literalMatch) return false;
  }
  if (params.hasPrice) { const value = Number(row.totalRub || 0) > 0 ? "yes" : "no"; if (value !== params.hasPrice) return false; }
  if (params.budgetFrom && projectionNumber(row.totalRub, 0) < params.budgetFrom) return false;
  if (params.budgetTo && projectionNumber(row.totalRub, Infinity) > params.budgetTo) return false;
  if (params.yearFrom && Number(row.year || 0) < params.yearFrom) return false;
  if (params.yearTo && Number(row.year || 0) > params.yearTo) return false;
  if (params.mileageFrom && projectionNumber(row.mileageKm, 0) < params.mileageFrom) return false;
  if (params.mileageTo && projectionNumber(row.mileageKm, Infinity) > params.mileageTo) return false;
  if (params.engineFrom && projectionNumber(row.engineCc, 0) < params.engineFrom) return false;
  if (params.engineTo && projectionNumber(row.engineCc, Infinity) > params.engineTo) return false;
  if (params.powerFrom || params.powerTo) {
    // This public control explains the utilization-fee threshold, so EVs and
    // hybrids must be filtered by the certified calculation power rather than
    // by their much larger short peak rating. Missing certified power remains
    // excluded from an upper-bound query instead of being presented as eligible.
    const utilizationPowerHp = projectionUtilizationPowerHp(row);
    if (!utilizationPowerHp) return false;
    if (params.powerFrom && utilizationPowerHp < params.powerFrom) return false;
    if (params.powerTo && utilizationPowerHp > params.powerTo + 0.01) return false;
  }
  if (params.fuel && lower(row.fuel) !== lower(params.fuel)) return false;
  if (params.bodyType && lower(row.bodyType) !== lower(params.bodyType)) return false;
  if (params.transmission && lower(row.transmission) !== lower(params.transmission)) return false;
  if (params.drive && lower(row.drive) !== lower(params.drive)) return false;
  if (params.auctionGrade && lower(row.auctionGrade) !== lower(params.auctionGrade)) return false;
  if (params.auctionDateFrom && (!row.auctionDate || String(row.auctionDate) < params.auctionDateFrom)) return false;
  if (params.auctionDateTo && (!row.auctionDate || String(row.auctionDate) > params.auctionDateTo)) return false;
  return true;
}
function projectionFreshness(row: CatalogSearchProjection) { return Date.parse(String(row.auctionDate || row.sourcePublishedAt || row.firstSeenAt || row.updatedAt || "")) || 0; }
export function catalogSearchProjectionSort(rows: CatalogSearchProjection[], sort = "updatedAt") {
  return rows.sort((a, b) => sort === "totalRub" ? projectionNumber(a.totalRub, Infinity) - projectionNumber(b.totalRub, Infinity)
    : sort === "totalRubDesc" ? projectionNumber(b.totalRub, -Infinity) - projectionNumber(a.totalRub, -Infinity)
      : sort === "year" ? Number(b.year || 0) - Number(a.year || 0)
        : sort === "yearAsc" ? Number(a.year || 0) - Number(b.year || 0)
      : sort === "mileage" ? projectionNumber(a.mileageKm, 0) - projectionNumber(b.mileageKm, 0)
        : projectionFreshness(b) - projectionFreshness(a) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}
async function projectionModelKeys(params: CatalogSearchParams) {
  if (!params.model) return null;
  const lower = (value: unknown) => cleanFacet(value).toLocaleLowerCase("ru-RU");
  const makes = catalogMakeFilterValues(params.make);
  const scopes: Array<string | undefined> = makes.length ? makes : [undefined];
  const matches = (await Promise.all(scopes.map((make) => resolveVehicleModelQuery(params.model, make, 100)))).flat();
  const candidates = matches.length
    ? matches.map((match) => ({ make: match.make, model: match.model }))
    : makes.length
      ? makes.map((make) => ({ make, model: String(params.model) }))
      : [];
  return new Set(candidates.map((item) => `${lower(item.make)}:${lower(item.model)}`));
}
async function readProjectionRows(manifest: CatalogManifest, params: CatalogSearchParams) {
  const markets = params.market && params.market !== "any" ? [String(params.market)] : MARKETS;
  return (await mapWithConcurrency(markets, Math.min(7, markets.length || 1), async (market) => {
    const projection = await readSearchProjection(manifest.generationId, market);
    if ((projection.items || []).length || Number(manifest.markets?.[market]?.count || 0) === 0) return projection.items || [];
    // Backward-compatible bridge for the currently published generation: older
    // generations do not have compact projection shards yet. Preserve correctness
    // by falling back to one market scan until the next catalog generation writes
    // the new projection index; subsequent generations stay on the compact path.
    const legacy = (await readMarketOffers(market)).filter(isPublicOffer);
    return legacy.map(searchProjectionFromOffer);
  })).flat();
}

async function currentProjectionRows(params: CatalogSearchParams = {}) {
  const manifest = await readManifest();
  const scope = params.market && params.market !== "any" ? String(params.market) : CURRENT_ALL_MARKETS_PROJECTION;
  const current = await readCurrentSearchProjection(scope);
  if (current.generationId === manifest.generationId) return { generationId: manifest.generationId, rows: current.items || [] };
  return { generationId: manifest.generationId, rows: await readProjectionRows(manifest, params) };
}

export async function readCurrentPublicCatalogProjection() {
  return currentProjectionRows({});
}

export async function readPublicCatalogMarketCounts() {
  const [manifest, projection] = await Promise.all([readManifest(), currentProjectionRows({})]);
  const markets = Object.fromEntries(MARKETS.map((market) => [
    market,
    projection.rows.filter((row) => row.market === market).length,
  ]));
  return {
    generationId: projection.generationId,
    updatedAt: manifest.updatedAt,
    markets,
    total: Object.values(markets).reduce((sum, count) => sum + count, 0),
  };
}

export async function readCatalogBrandCounts(params: CatalogSearchParams = {}) {
  const filters: CatalogSearchParams = { ...params, make: undefined };
  const simpleSummaryQuery = !filters.model && !filters.hasPrice && !filters.budgetFrom && !filters.budgetTo
    && !filters.yearFrom && !filters.yearTo && !filters.mileageFrom && !filters.mileageTo
    && !filters.engineFrom && !filters.engineTo && !filters.powerFrom && !filters.powerTo
    && !filters.fuel && !filters.bodyType && !filters.transmission && !filters.drive
    && !filters.auctionGrade && !filters.auctionDateFrom && !filters.auctionDateTo;
  if (simpleSummaryQuery) {
    const [manifest, summary] = await Promise.all([readManifest(), readCurrentBrandSummary()]);
    if (summary.generationId === manifest.generationId) {
      const visibleBrands = Object.values(summary.brands)
        .map((brand) => ({
          brand,
          count: filters.market && filters.market !== "any" ? Number(brand.marketCounts[filters.market] || 0) : brand.count,
          modelCount: filters.market && filters.market !== "any"
            ? brand.models.filter((model) => Number(model.marketCounts[filters.market!] || 0) > 0).length
            : brand.models.length,
        }))
        .filter((item) => item.count > 0)
        .sort((a, b) => a.brand.make.localeCompare(b.brand.make, "ru"));
      const counts = Object.fromEntries(visibleBrands.map((item) => [item.brand.make, item.count]));
      const modelCounts = Object.fromEntries(visibleBrands.map((item) => [item.brand.make, item.modelCount]));
      return { generationId: manifest.generationId, counts, modelCounts };
    }
  }
  const { generationId, rows } = await currentProjectionRows(filters);
  const modelKeys = await projectionModelKeys(filters);
  const counts = new Map<string, number>();
  const models = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!catalogSearchProjectionMatches(row, filters, modelKeys)) continue;
    const make = cleanFacet(row.make);
    if (!make) continue;
    counts.set(make, (counts.get(make) || 0) + 1);
    const model = cleanFacet(row.model);
    if (model) {
      const set = models.get(make) || new Set<string>();
      set.add(model.toLocaleLowerCase("ru-RU"));
      models.set(make, set);
    }
  }
  const ordered = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "ru"));
  return {
    generationId,
    counts: Object.fromEntries(ordered),
    modelCounts: Object.fromEntries(ordered.map(([make]) => [make, models.get(make)?.size || 0])),
  };
}

export async function readCatalogBrandModelCounts(make: string) {
  const [manifest, summary] = await Promise.all([readManifest(), readCurrentBrandSummary()]);
  if (summary.generationId === manifest.generationId) {
    const brand = summary.brands[catalogBrandReadModelKey(make)];
    if (brand) return { generationId: manifest.generationId, models: brand.models };
  }
  const filters: CatalogSearchParams = { make };
  const { generationId, rows } = await currentProjectionRows(filters);
  const models = new Map<string, CatalogBrandSummaryModel>();
  for (const row of rows) {
    if (!catalogSearchProjectionMatches(row, filters)) continue;
    const model = cleanFacet(row.model);
    if (!model) continue;
    const key = model.toLocaleLowerCase("ru-RU");
    const current = models.get(key) || { model, count: 0, marketCounts: {} };
    current.count += 1;
    current.marketCounts[row.market] = (current.marketCounts[row.market] || 0) + 1;
    models.set(key, current);
  }
  return { generationId, models: [...models.values()].sort((a, b) => b.count - a.count || a.model.localeCompare(b.model, "ru")) };
}

async function readOfferLists(paths: string[]) {
  const concurrency = Math.max(1, Math.min(32, Number(process.env.CATALOG_READ_CONCURRENCY || 12)));
  return (await mapWithConcurrency(paths, concurrency, (path) => readDataJson<VehicleOffer[]>(path, []))).flat();
}

export async function readMarketOffers(market: string) {
  const manifest = await readManifest();
  const chunks: string[] = manifest.markets?.[market]?.chunks || [];
  return readOfferLists(chunks.map((chunk) => storedOfferChunkPath(manifest.generationId, market, chunk)));
}
export async function readAllOffersForMaintenance() {
  const [manifest, japanArchive] = await Promise.all([
    readDataJson<any>(INTERNAL_MANIFEST_PATH, { generationId: "", sources: {} }),
    readDataJson<JapanAuctionArchiveManifest | null>(JAPAN_ARCHIVE_MANIFEST_PATH, null),
  ]);
  const chunks: string[] = [
    ...Object.values<any>(manifest.sources || {}).flatMap((source) => source.chunks || []),
    ...(Array.isArray(japanArchive?.chunks) ? japanArchive.chunks : []),
  ];
  const rows = await readOfferLists([...new Set(chunks)]);
  return [...new Map(rows.map((offer) => [offer.id, offer])).values()];
}
export const readAllOffers = readAllOffersForMaintenance;
async function facetsFromProjection(generationId: string, rows: CatalogSearchProjection[], params: CatalogSearchParams, hasFilters: boolean): Promise<CatalogFacets> {
  if (!hasFilters) {
    return {
      generationId,
      makes: uniqueText(rows.map((row) => row.make)).sort((a, b) => a.localeCompare(b, "ru")),
      models: [], markets: [...PUBLIC_CATALOG_MARKETS],
      bodyTypes: uniqueText(rows.map((row) => row.bodyType)).sort(),
      fuels: uniqueText(rows.map((row) => row.fuel)).sort(),
      transmissions: uniqueText(rows.map((row) => row.transmission)).sort(),
      drives: uniqueText(rows.map((row) => row.drive)).sort(),
    };
  }
  const modelKeys = await projectionModelKeys(params);
  const offers = rows.filter((row) => catalogSearchProjectionMatches(row, params, modelKeys));
  const values = (selector: (offer: CatalogSearchProjection) => unknown) => uniqueText(offers.map(selector)).sort((a, b) => a.localeCompare(b, "ru"));
  const offerModels = [...new Map(offers.map((offer) => [`${cleanFacet(offer.make)}:${cleanFacet(offer.model)}`, { make: cleanFacet(offer.make), model: cleanFacet(offer.model) }])).values()]
    .filter((item) => item.make && item.model)
    .sort((a, b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`, "ru"));
  return {
    generationId, makes: values((offer) => offer.make), models: offerModels, markets: [...PUBLIC_CATALOG_MARKETS],
    bodyTypes: values((offer) => offer.bodyType), fuels: values((offer) => offer.fuel), transmissions: values((offer) => offer.transmission), drives: values((offer) => offer.drive),
  };
}
export async function readCatalogFacets(params: CatalogSearchParams = {}): Promise<CatalogFacets> {
  const hasFilters = Boolean(params.make || params.model || params.hasPrice
    || params.budgetFrom || params.budgetTo || params.yearFrom || params.yearTo
    || params.mileageFrom || params.mileageTo || params.engineFrom || params.engineTo
    || params.powerFrom || params.powerTo || params.fuel || params.bodyType
    || params.transmission || params.drive || params.auctionGrade || params.auctionDateFrom || params.auctionDateTo);
  const currentProjectionScope = params.market && params.market !== "any"
    ? String(params.market)
    : hasFilters ? CURRENT_ALL_MARKETS_PROJECTION : "";
  const manifest = await readManifest();
  if (currentProjectionScope) {
    const current = await readCurrentSearchProjection(currentProjectionScope);
    if (current.generationId === manifest.generationId) return facetsFromProjection(current.generationId, current.items || [], params, hasFilters);
  } else if (!hasFilters) {
    const current = await readCurrentFacets();
    if (current.generationId === manifest.generationId) {
      return { ...current, makes: uniqueText(current.makes || []).sort((a, b) => a.localeCompare(b, "ru")), models: [], markets: [...PUBLIC_CATALOG_MARKETS] };
    }
  }

  const fallback: CatalogFacets = { generationId: manifest.generationId, makes: [], models: [], markets: [...PUBLIC_CATALOG_MARKETS], bodyTypes: [], fuels: [], transmissions: [], drives: [] };
  const indexed = await readIndex<CatalogFacets>(manifest.generationId, "facets.json", fallback);

  if (!hasFilters) {
    if (params.market && params.market !== "any") {
      const projection = await readSearchProjection(manifest.generationId, String(params.market));
      if ((projection.items || []).length) return facetsFromProjection(manifest.generationId, projection.items || [], params, false);
    }
    return {
      ...indexed, generationId: manifest.generationId,
      makes: uniqueText(indexed.makes || []).sort((a, b) => a.localeCompare(b, "ru")),
      models: [], markets: [...PUBLIC_CATALOG_MARKETS],
    };
  }

  return facetsFromProjection(manifest.generationId, await readProjectionRows(manifest, params), params, true);
}

async function persistInternalCatalog(storage: ReturnType<typeof getJsonStorage>, generationId: string, offers: VehicleOffer[]) {
  const now = new Date().toISOString();
  const sources: Record<string, { count: number; chunks: string[]; updatedAt: string }> = {};
  const bySource = new Map<string, VehicleOffer[]>();
  // Completed Japanese auctions live in their own bounded monthly archive.
  // Repeating them in every internal generation was one of the main sources of
  // Object Storage growth.
  for (const offer of offers) if (offer.market !== "japan") bySource.set(offer.sourceId, [...(bySource.get(offer.sourceId) || []), offer]);
  for (const [sourceId, list] of bySource) {
    const chunks: string[] = [];
    for (let i = 0; i < list.length; i += CATALOG_CHUNK_SIZE) {
      const file = `catalog/internal/offers/${sourceId}/${generationId}-${chunkName(chunks.length + 1)}.json`;
      chunks.push(file);
      await writeJsonAtomic(file, list.slice(i, i + CATALOG_CHUNK_SIZE));
    }
    sources[sourceId] = { count: list.length, chunks, updatedAt: now };
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await storage.readJsonWithMeta<any>(INTERNAL_MANIFEST_PATH, { generationId: "", sources: {} });
    try { await storage.writeJson(INTERNAL_MANIFEST_PATH, { generationId, updatedAt: now, sources }, current.found && current.etag ? { ifMatch: current.etag } : { ifNoneMatch: "*" }); return; }
    catch (e) { if (e instanceof StorageConflictError) continue; throw e; }
  }
  throw new StorageConflictError();
}

async function persistJapanAuctionHistory(storage: ReturnType<typeof getJsonStorage>, offers: VehicleOffer[]) {
  // The Japan publisher applies the 30-day source-date cutoff before this write.
  // Storage owns the separate bounded representation and records that retention
  // contract without re-filtering an untouched market during another market's
  // atomic publication.
  const retained = offers.filter((offer) => offer.market === "japan");
  const contentHash = crypto.createHash("sha256").update(JSON.stringify(retained)).digest("hex");
  const current = await storage.readJsonWithMeta<JapanAuctionArchiveManifest | null>(JAPAN_ARCHIVE_MANIFEST_PATH, null);
  if (current.value?.version === 1 && current.value.contentHash === contentHash) return current.value;

  const activeSlot: "a" | "b" = current.value?.activeSlot === "a" ? "b" : "a";
  const chunks: string[] = [];
  for (let index = 0; index < retained.length; index += CATALOG_CHUNK_SIZE) {
    const path = `catalog/japan-auction-history/slots/${activeSlot}/${chunkName(chunks.length + 1)}.json`;
    chunks.push(path);
    await writeJsonAtomic(path, retained.slice(index, index + CATALOG_CHUNK_SIZE), false);
  }
  const manifest: JapanAuctionArchiveManifest = {
    version: 1,
    updatedAt: new Date().toISOString(),
    retentionDays: JAPAN_ARCHIVE_RETENTION_DAYS,
    activeSlot,
    count: retained.length,
    chunks,
    contentHash,
  };
  await storage.writeJson(JAPAN_ARCHIVE_MANIFEST_PATH, manifest, current.found && current.etag ? { ifMatch: current.etag } : { ifNoneMatch: "*" });
  return manifest;
}
export function isPublicOffer(o: VehicleOffer) {
  return o.status === "active"
    && isCatalogYearAllowed(o.year, o.market)
    && hasCredibleOfferContent(o)
    && catalogPublicPriority(o).eligible;
}
async function writeIndexShard(generationId: string, name: string, key: string, ids: string[]) { await writeJsonAtomic(generationPath(generationId, `indexes/${name}/${cleanShard(key)}.json`), { generationId, updatedAt: new Date().toISOString(), ids }); }
async function runWithConcurrency(tasks: Array<() => Promise<void>>, concurrency: number) {
  if (!tasks.length) return;
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), tasks.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const current = cursor++;
      if (current >= tasks.length) return;
      await tasks[current]();
    }
  }));
}
async function assertCurrentCatalogReadModelsReady(generationId: string, offers: VehicleOffer[]) {
  const all = await readDataJson<{ generationId: string; items: CatalogSearchProjection[] }>(
    currentProjectionPath(CURRENT_ALL_MARKETS_PROJECTION),
    { generationId: "", items: [] },
  );
  if (all.generationId !== generationId || Number(all.items?.length || 0) !== offers.length) {
    throw new Error(`catalog_current_projection_not_ready:${all.generationId}:${Number(all.items?.length || 0)}:${generationId}:${offers.length}`);
  }
  const byMarket = new Map<string, VehicleOffer[]>();
  for (const offer of offers) byMarket.set(String(offer.market || ""), [...(byMarket.get(String(offer.market || "")) || []), offer]);
  for (const [market, rows] of byMarket) {
    const projection = await readDataJson<{ generationId: string; items: CatalogSearchProjection[] }>(
      currentProjectionPath(market),
      { generationId: "", items: [] },
    );
    if (projection.generationId !== generationId || Number(projection.items?.length || 0) !== rows.length) {
      throw new Error(`catalog_current_market_projection_not_ready:${market}:${projection.generationId}:${Number(projection.items?.length || 0)}:${generationId}:${rows.length}`);
    }
    // Verify one representative from every physical offer shard. Sampling the
    // first five rows let a later shard disappear while its card projection was
    // already public, producing a valid-looking card that navigated to 404.
    const shardRepresentatives = [...new Map(rows.map((offer) => [currentOfferShardName(offer.id), offer])).values()];
    for (const offer of shardRepresentatives) {
      const shard = await readDataJson<{ generationId: string; items: VehicleOffer[] }>(
        currentOfferShardPath(offer.id),
        { generationId: "", items: [] },
      );
      if (shard.generationId !== generationId || !(shard.items || []).some((item) => item.id === offer.id)) {
        throw new Error(`catalog_current_offer_shard_not_ready:${market}:${offer.id}:${shard.generationId}:${generationId}`);
      }
    }
  }
}

export type PersistCatalogOptions = {
  beforePersistValidate?: (publicOffers: VehicleOffer[]) => void | Promise<void>;
  beforePublishValidate?: (publishedOffers: VehicleOffer[]) => void | Promise<void>;
  // Recovery writers may preserve already-published markets byte-for-byte while
  // rebuilding only their target market. Those rows are trusted only because
  // the caller has already read and hash-validated the current public market.
  preservePublicOffersByMarket?: Partial<Record<CatalogMarket, VehicleOffer[]>>;
  // A normal market refresh may append canonical newcomers while keeping every
  // already-published row byte-stable. Protected rows win duplicate and quota
  // ties, which makes routine collection genuinely grow-only.
  appendPublicOffersByMarket?: Partial<Record<CatalogMarket, VehicleOffer[]>>;
};
export async function persistCatalogOffers(nextOffers: VehicleOffer[], options: PersistCatalogOptions = {}) {
  const storage = getJsonStorage();
  const growOnlyMarkets = new Set(String(process.env.CATALOG_GROW_ONLY_MARKETS ?? "korea").split(",").map((value) => value.trim()).filter(Boolean));
  const preservedPublicOffersByMarket = options.preservePublicOffersByMarket || {};
  const appendPublicOffersByMarket = options.appendPublicOffersByMarket || {};
  const preservedMarketKeys = Object.keys(preservedPublicOffersByMarket);
  const appendMarketKeys = Object.keys(appendPublicOffersByMarket);
  for (const market of preservedMarketKeys) {
    if (!MARKETS.includes(market as CatalogMarket)) throw new Error(`catalog_preserved_public_market_unknown:${market}`);
  }
  for (const market of appendMarketKeys) {
    if (!MARKETS.includes(market as CatalogMarket)) throw new Error(`catalog_append_public_market_unknown:${market}`);
    if (preservedMarketKeys.includes(market)) throw new Error(`catalog_public_market_mode_conflict:${market}`);
  }
  const exactPreserveMarkets = new Set(preservedMarketKeys as CatalogMarket[]);
  const protectedPublicIds = new Set([
    ...Object.values(preservedPublicOffersByMarket),
    ...Object.values(appendPublicOffersByMarket),
  ].flatMap((rows) => rows || []).map((offer) => String(offer?.id || "")).filter(Boolean));
  const normalized = await Promise.all(nextOffers.map(async (offer) => exactPreserveMarkets.has(offer.market) || protectedPublicIds.has(String(offer.id))
    ? offer
    : normalizeVehicleOfferSpecs(await enrichOfferWithKnowledgeCore(offer))));
  if (growOnlyMarkets.size) {
    const current = await readAllOffersForMaintenance();
    const merged = new Map(normalized.map((offer) => [offer.id, offer]));
    for (const offer of current) {
      if (exactPreserveMarkets.has(offer.market)) continue;
      if (!growOnlyMarkets.has(String(offer.market)) || !hasCredibleOfferContent({ ...offer, status: "active" })) continue;
      const incoming = merged.get(offer.id);
      if (!incoming || incoming.status !== "active" || !hasCredibleOfferContent({ ...incoming, status: "active" })) {
        const restored = normalizeVehicleOfferSpecs(await enrichOfferWithKnowledgeCore({ ...offer, status: "active" }));
        merged.set(offer.id, restored);
      }
    }
    nextOffers = [...merged.values()];
  } else {
    nextOffers = normalized;
  }
  const publicOffers = nextOffers.filter((offer) => !exactPreserveMarkets.has(offer.market) && !protectedPublicIds.has(String(offer.id)) && isPublicOffer(offer));
  for (const [market, rows] of Object.entries(preservedPublicOffersByMarket)) {
    for (const offer of rows || []) {
      if (!offer?.id || String(offer.market || "") !== market) throw new Error(`catalog_preserved_public_row_invalid:${market}:${String(offer?.id || "missing")}`);
      publicOffers.push(offer);
    }
  }
  for (const [market, rows] of Object.entries(appendPublicOffersByMarket)) {
    for (const offer of rows || []) {
      if (!offer?.id || String(offer.market || "") !== market) throw new Error(`catalog_append_public_row_invalid:${market}:${String(offer?.id || "missing")}`);
      publicOffers.push(offer);
    }
  }
  const seenPublicIds = new Set<string>();
  for (const offer of publicOffers) {
    const id = String(offer?.id || "");
    if (!id) throw new Error("catalog_public_offer_id_missing");
    if (seenPublicIds.has(id)) throw new Error(`catalog_public_offer_id_duplicate:${id}`);
    seenPublicIds.add(id);
  }
  // A guarded writer can inspect the exact normalized public rows that would be
  // persisted. The validator runs before any generation/internal/index object is
  // written, so a preservation mismatch cannot switch or partially stage a new
  // catalog generation.
  if (options.beforePersistValidate) await options.beforePersistValidate(publicOffers);
  const canonicalPublic = await canonicalizePublicCatalogOffers(publicOffers, exactPreserveMarkets, protectedPublicIds);
  const publishedOffers = canonicalPublic.offers;
  if (options.beforePublishValidate) await options.beforePublishValidate(publishedOffers);
  const generationId = `gen_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const japanArchive = await persistJapanAuctionHistory(storage, publicOffers.filter((offer) => offer.market === "japan"));
  await persistInternalCatalog(storage, generationId, nextOffers);
  const byMarket = new Map<string, VehicleOffer[]>();
  for (const offer of publishedOffers) byMarket.set(offer.market, [...(byMarket.get(offer.market) || []), offer]);
  const markets: CatalogManifest["markets"] = {};
  const byId: Record<string, OfferLocation> = {};
  const imagesById: Record<string, { objectKey: string; mimeType: string; checksum: string; size: number }> = {};
  for (const [market, offers] of byMarket) {
    const chunks: string[] = [];
    for (let i = 0; i < offers.length; i += CATALOG_CHUNK_SIZE) {
      const name = chunkName(chunks.length + 1);
      chunks.push(name);
      const slice = offers.slice(i, i + CATALOG_CHUNK_SIZE);
      slice.forEach((o) => { byId[o.id] = { market: o.market, chunk: name }; o.images.forEach((img) => { imagesById[img.id] = { objectKey: img.objectKey, mimeType: img.mimeType, checksum: img.checksum, size: img.size }; }); });
      await writeJsonAtomic(offerPath(generationId, market, name), slice.map(compactPublicStorageOffer));
    }
    markets[market] = { count: offers.length, chunks, updatedAt: now };
  }
  await rebuildIndexes(generationId, publishedOffers, byId, imagesById);
  // Every immutable generation is already canonical. Until the manifest switch
  // readers keep using the previous complete generation; immediately after it
  // they can safely fall back to these generation indexes while the optional
  // one-hop read models are refreshed.
  const manifest: CatalogManifest = { version: 2, generationId, updatedAt: now, markets };
  // Stage every one-hop read model before the public manifest cutover. Readers
  // compare each read model with the still-current manifest, so while staging
  // they safely fall back to the previous immutable generation. Only after the
  // projections AND full offer-detail shards are verified do we expose the new
  // generation. This prevents cards from pointing at temporarily unavailable
  // /cars/offer/:id pages.
  await writeCurrentCatalogReadModels(generationId, publishedOffers, true);
  await assertCurrentCatalogReadModelsReady(generationId, publishedOffers);
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await storage.readJsonWithMeta<CatalogManifest>("catalog/manifest.json", manifest);
    try {
      await storage.writeJson("catalog/manifest.json", manifest, current.found && current.etag ? { ifMatch: current.etag } : { ifNoneMatch: "*" });
      resetCatalogReadCachesForTests();
      return manifest;
    }
    catch (e) { if (e instanceof StorageConflictError) continue; throw e; }
  }
  throw new StorageConflictError();
}
export async function rebuildIndexes(generationId: string, offers: VehicleOffer[], byId: Record<string, OfferLocation>, imagesById: Record<string, { objectKey: string; mimeType: string; checksum: string; size: number }> = {}) {
  // Public search and facets use compact current projections. Only the market
  // shard is still read by the homepage; the thousands of per-value shards that
  // used to be written here were dead data duplicated in every generation.
  const maps: Record<string, Map<string, string[]>> = { market: new Map() };
  const makes = new Map<string, string>();
  const models = new Map<string, { make: string; model: string }>();
  for (const o of offers) {
    const make = cleanFacet(o.make);
    const model = cleanFacet(o.model);
    if (make) makes.set(cleanShard(make), make);
    if (make && model) models.set(`${cleanShard(make)}:${cleanShard(model)}`, { make, model });
    const pairs = { market: o.market };
    for (const [name, key] of Object.entries(pairs)) { const map = maps[name]; const shard = cleanShard(key); map.set(shard, [...(map.get(shard) || []), o.id]); }
  }
  await writeJsonAtomic(generationPath(generationId, "indexes/offers-by-id.json"), { generationId, byId });
  await writeJsonAtomic(generationPath(generationId, "indexes/images-by-id.json"), { generationId, imagesById });
  const facets: CatalogFacets = {
    generationId,
    makes: [...makes.values()].sort((a,b) => a.localeCompare(b, "ru")),
    models: [...models.values()].sort((a,b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`, "ru")),
    markets: [...new Set(offers.map((offer) => cleanFacet(offer.market)).filter(Boolean))].sort(),
    bodyTypes: [...new Set(offers.map((offer) => cleanFacet(offer.bodyType)).filter(Boolean))].sort(),
    fuels: [...new Set(offers.map((offer) => cleanFacet(offer.fuel)).filter(Boolean))].sort(),
    transmissions: [...new Set(offers.map((offer) => cleanFacet(offer.transmission)).filter(Boolean))].sort(),
    drives: [...new Set(offers.map((offer) => cleanFacet(offer.drive)).filter(Boolean))].sort(),
  };
  await writeJsonAtomic(generationPath(generationId, "indexes/facets.json"), facets);
  const projectionsByMarket = new Map<string, CatalogSearchProjection[]>();
  for (const offer of offers) {
    const market = String(offer.market || "");
    if (!market) continue;
    const row = searchProjectionFromOffer(offer);
    projectionsByMarket.set(market, [...(projectionsByMarket.get(market) || []), row]);
  }
  await mapWithConcurrency([...projectionsByMarket.entries()], 4, async ([market, items]) => {
    const projection = { generationId, items };
    await writeJsonAtomic(generationPath(generationId, `indexes/projection/${cleanShard(market)}.json`), projection);
  });
  const freshness = (offer: VehicleOffer) => Date.parse(String((offer.operational as any)?.sourcePublishedAt || offer.firstSeenAt || offer.updatedAt || "")) || 0;
  await writeJsonAtomic(generationPath(generationId, "indexes/order-updatedAt.json"), { generationId, ids: [...offers].sort((a,b) => freshness(b) - freshness(a) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))).map((o) => o.id) });
  const tasks = Object.entries(maps).flatMap(([name, map]) => [...map.entries()].map(([key, ids]) => () => writeIndexShard(generationId, name, key, ids)));
  const concurrency = Math.max(1, Number(process.env.CATALOG_INDEX_WRITE_CONCURRENCY || 6));
  await runWithConcurrency(tasks, concurrency);
}

async function canonicalizePublicCatalogOffers(storedOffers: VehicleOffer[], _skipDisplayIdentityMarkets = new Set<CatalogMarket>(), protectedPublicIds = new Set<string>()) {
  // Keep source/internal objects immutable. Mutable rows receive the same
  // deterministic V2 + source-translation identity used by cards.
  // A one-market writer must not rename, reprice or delete another market.
  // Protected rows were read from the active public generation and hash-gated
  // by the caller; only that market's own refresh may revalidate them.
  const protectedRows = storedOffers.filter((offer) => protectedPublicIds.has(String(offer.id)));
  const mutableRows = storedOffers.filter((offer) => !protectedPublicIds.has(String(offer.id)));
  const identifiedOffers = await applyEncyclopediaDisplayIdentityBatch(mutableRows);
  const qualityRejected = identifiedOffers.filter((offer) => !isPublicOffer(offer));
  const qualityEligibleOffers = identifiedOffers.filter(isPublicOffer);
  const identityRejected = qualityEligibleOffers.filter((offer) => !isSupportedPublicCatalogIdentity(offer));
  const identityEligibleOffers = qualityEligibleOffers.filter(isSupportedPublicCatalogIdentity);
  const priceOutliers = findCatalogPriceOutliers(identityEligibleOffers);
  const rejectedPriceIds = new Set(priceOutliers.map((outlier) => outlier.id).filter((id) => !protectedPublicIds.has(String(id))));
  const priceFilteredOffers = identityEligibleOffers.filter((offer) => !rejectedPriceIds.has(offer.id));
  const deduplicated = deduplicatePublicCatalogOffers([...protectedRows, ...priceFilteredOffers], { protectedIds: protectedPublicIds });
  const quota = enforceCatalogModelYearQuota(deduplicated.rows, { protectedIds: protectedPublicIds });
  return { offers: quota.rows, qualityRejected, identityRejected, priceOutliers, deduplicated, quota };
}

export async function previewCanonicalPublicCatalogOffers(storedOffers: VehicleOffer[]) {
  return canonicalizePublicCatalogOffers(storedOffers);
}

async function writeCurrentCatalogReadModels(generationId: string, storedOffers: VehicleOffer[], alreadyCanonical = false) {
  const exactMarkets = alreadyCanonical ? new Set<CatalogMarket>(storedOffers.map((offer) => offer.market).filter(Boolean)) : undefined;
  const protectedIds = alreadyCanonical ? new Set(storedOffers.map((offer) => String(offer.id || "")).filter(Boolean)) : undefined;
  const canonical = await canonicalizePublicCatalogOffers(storedOffers, exactMarkets, protectedIds);
  const { offers, qualityRejected, identityRejected, priceOutliers, deduplicated, quota } = canonical;
  const previousAllProjection = await readCurrentSearchProjection(CURRENT_ALL_MARKETS_PROJECTION).catch(() => ({ generationId: "", items: [] }));

  const makes = uniqueText(offers.map((offer) => offer.make)).sort((a, b) => a.localeCompare(b, "ru"));
  const models = [...new Map(offers.map((offer) => {
    const make = cleanFacet(offer.make);
    const model = cleanFacet(offer.model);
    return [`${make}:${model}`, { make, model }];
  })).values()].filter((item) => item.make && item.model)
    .sort((a, b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`, "ru"));
  const facets: CatalogFacets = {
    generationId,
    makes,
    models,
    markets: [...new Set(offers.map((offer) => cleanFacet(offer.market)).filter(Boolean))].sort(),
    bodyTypes: uniqueText(offers.map((offer) => offer.bodyType)).sort(),
    fuels: uniqueText(offers.map((offer) => offer.fuel)).sort(),
    transmissions: uniqueText(offers.map((offer) => offer.transmission)).sort(),
    drives: uniqueText(offers.map((offer) => offer.drive)).sort(),
  };

  const projectionsByMarket = new Map<string, CatalogSearchProjection[]>();
  const projectionsByBrand = new Map<string, CatalogSearchProjection[]>();
  const allProjectionItems: CatalogSearchProjection[] = [];
  const offersByShard = new Map<string, VehicleOffer[]>();
  for (const offer of offers) {
    const market = String(offer.market || "");
    if (market) {
      const row = searchProjectionFromOffer(offer);
      allProjectionItems.push(row);
      projectionsByMarket.set(market, [...(projectionsByMarket.get(market) || []), row]);
      const make = cleanFacet(row.make);
      const brandKey = catalogBrandReadModelKey(make);
      if (brandKey) projectionsByBrand.set(brandKey, [...(projectionsByBrand.get(brandKey) || []), row]);
    }
    const shard = currentOfferShardName(offer.id);
    offersByShard.set(shard, [...(offersByShard.get(shard) || []), compactPublicStorageOffer(offer)]);
  }

  await writeJsonAtomic(CURRENT_FACETS_PATH, facets, false);
  await writeJsonAtomic(currentProjectionPath(CURRENT_ALL_MARKETS_PROJECTION), { generationId, items: allProjectionItems }, false);
  const brandSummary = buildCatalogBrandSummary(generationId, allProjectionItems);
  await writeJsonAtomic(CURRENT_BRAND_SUMMARY_PATH, brandSummary, false);
  const brandProjectionsToWrite = new Set([
    ...projectionsByBrand.keys(),
    ...(previousAllProjection.items || []).map((row) => catalogBrandReadModelKey(row.make)).filter(Boolean),
  ]);
  await mapWithConcurrency([...brandProjectionsToWrite], 16, (make) =>
    writeJsonAtomic(currentBrandProjectionPath(make), { generationId, items: projectionsByBrand.get(make) || [] }, false));
  await mapWithConcurrency(MARKETS, 7, (market) =>
    writeJsonAtomic(currentProjectionPath(market), { generationId, items: projectionsByMarket.get(market) || [] }, false));
  const offerShardsToWrite = new Set([
    ...offersByShard.keys(),
    ...(previousAllProjection.items || []).map((row) => currentOfferShardName(row.id)),
  ]);
  await mapWithConcurrency([...offerShardsToWrite], 12, (shard) =>
    writeJsonAtomic(`catalog/public/offers/${shard}.json`, { generationId, items: offersByShard.get(shard) || [] }, false));
  const aiProductFeed = await publishAiProductFeed({ generationId, items: allProjectionItems });

  return {
    generationId,
    total: offers.length,
    markets: Object.fromEntries(MARKETS.map((market) => [market, offers.filter((offer) => offer.market === market).length])),
    projectionMarkets: projectionsByMarket.size,
    allProjectionCount: allProjectionItems.length,
    brandSummaryCount: Object.keys(brandSummary.brands).length,
    brandProjectionCount: projectionsByBrand.size,
    offerShards: offersByShard.size,
    identityRejected: identityRejected.length,
    identityRejections: identityRejected.slice(0, 100).map((offer) => ({
      id: offer.id,
      market: offer.market,
      make: offer.make,
      model: offer.model,
      reason: publicCatalogIdentityRejectionReason(offer),
    })),
    qualityRejected: qualityRejected.length,
    qualityRejections: qualityRejected.slice(0, 100).map((offer) => ({
      id: offer.id,
      market: offer.market,
      make: offer.make,
      model: offer.model,
      reason: catalogPublicPriority(offer).reason,
    })),
    priceOutliersRejected: priceOutliers.length,
    priceOutliers: priceOutliers.slice(0, 50),
    semanticDuplicatesRejected: deduplicated.removed.length,
    semanticDuplicates: deduplicated.removed.slice(0, 100),
    modelYearQuotaRejected: quota.removed.length,
    aiProductFeedProducts: aiProductFeed.productCount,
    aiProductFeedBytes: aiProductFeed.size,
  };
}

export async function publishCurrentCatalogReadModels() {
  const manifest = await readManifest();
  const marketIds = Object.keys(manifest.markets || {}).filter((market) => Number(manifest.markets[market]?.count || 0) > 0);
  const storedOffers = (await mapWithConcurrency(marketIds, Math.min(7, Math.max(1, marketIds.length)), (market) => readMarketOffers(market))).flat()
    .filter(isPublicOffer);
  return writeCurrentCatalogReadModels(manifest.generationId, storedOffers);
}
export async function getOffer(id: string) {
  const [manifest, current] = await Promise.all([readManifest(), readCurrentOfferShard(id)]);
  if (current.generationId === manifest.generationId) {
    return (current.items || []).find((item) => item.id === id && isPublicOffer(item)) || null;
  }
  if (offerLookupCacheGeneration !== manifest.generationId) {
    offerLookupCacheGeneration = manifest.generationId;
    offerLocationIndexCache = null;
    offerChunkCache.clear();
  }
  offerLocationIndexCache ||= readIndex<{ byId: Record<string, OfferLocation> }>(manifest.generationId, "offers-by-id.json", { byId: {} })
    .catch((error) => { offerLocationIndexCache = null; throw error; });
  const byId = await offerLocationIndexCache;
  const loc = byId.byId[id];
  if (!loc) return null;
  const path = storedOfferChunkPath(manifest.generationId, loc.market, loc.chunk);
  let chunkPromise = offerChunkCache.get(path);
  if (!chunkPromise) {
    chunkPromise = readDataJson<VehicleOffer[]>(path, []).catch((error) => { offerChunkCache.delete(path); throw error; });
    offerChunkCache.set(path, chunkPromise);
    while (offerChunkCache.size > OFFER_CHUNK_CACHE_MAX) {
      const oldest = offerChunkCache.keys().next().value as string | undefined;
      if (!oldest || oldest === path) break;
      offerChunkCache.delete(oldest);
    }
  }
  const chunk = await chunkPromise;
  return chunk.find((offer) => offer.id === id && isPublicOffer(offer)) || null;
}
export async function searchOffers(params: CatalogSearchParams) {
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.min(48, Math.max(1, Number(params.pageSize || 24)));
  const needsProjection = Boolean((params.market && params.market !== "any") || params.make || params.model || params.hasPrice
    || params.budgetFrom || params.budgetTo || params.yearFrom || params.yearTo || params.mileageFrom || params.mileageTo
    || params.engineFrom || params.engineTo || params.powerFrom || params.powerTo || params.auctionGrade || params.auctionDateFrom || params.auctionDateTo
    || params.fuel || params.bodyType || params.transmission || params.drive
    || (params.sort && params.sort !== "updatedAt"));

  const requestedMakes = catalogMakeFilterValues(params.make);
  if ((!params.market || params.market === "any") && requestedMakes.length) {
    const manifest = await readManifest();
    const parts = await mapWithConcurrency(requestedMakes, Math.min(8, requestedMakes.length), async (make) => ({
      make, projection: await readCurrentBrandProjection(make),
    }));
    if (parts.every(({ projection }) => projection.generationId === manifest.generationId)) {
      const modelKeys = await projectionModelKeys(params);
      const rows = parts.flatMap(({ projection }) => projection.items || [])
        .filter((row) => catalogSearchProjectionMatches(row, params, modelKeys));
      if (needsProjection) catalogSearchProjectionSort(rows, params.sort || "updatedAt");
      else rows.sort((a, b) => projectionFreshness(b) - projectionFreshness(a) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      const total = rows.length;
      const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
      if (pageRows.every(projectionCanRenderCard)) return {
        generationId: manifest.generationId, total, page, pageSize,
        items: pageRows.map(publicOfferFromProjection),
        usedIndexShards: requestedMakes.map(currentBrandProjectionPath),
      };
    }
  }

  const currentProjectionScope = params.market && params.market !== "any" ? String(params.market) : CURRENT_ALL_MARKETS_PROJECTION;
  const [manifest, current] = await Promise.all([
    readManifest(),
    readCurrentSearchProjection(currentProjectionScope),
  ]);
  if (current.generationId === manifest.generationId) {
    const modelKeys = await projectionModelKeys(params);
    const rows = (current.items || []).filter((row) => catalogSearchProjectionMatches(row, params, modelKeys));
    if (needsProjection) catalogSearchProjectionSort(rows, params.sort || "updatedAt");
    else rows.sort((a, b) => projectionFreshness(b) - projectionFreshness(a) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    const total = rows.length;
    const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
    if (pageRows.every(projectionCanRenderCard)) {
      return {
        generationId: current.generationId, total, page, pageSize,
        items: pageRows.map(publicOfferFromProjection),
        usedIndexShards: [currentProjectionPath(currentProjectionScope)],
      };
    }
  }

  // Current generations contain a compact per-market projection with every field
  // required by public cards and filters. Prefer that single object over reading a
  // market shard + multiple range shards + offers-by-id + ordering and then the
  // same projection again. The Promise cache above also lets facets + results in
  // the same server render share one immutable generation read.
  const directMarkets = params.market && params.market !== "any" ? [String(params.market)] : MARKETS;
  const directProjectionParts = await mapWithConcurrency(directMarkets, Math.min(7, directMarkets.length || 1), async (market) => ({
    market, projection: await readSearchProjection(manifest.generationId, market),
  }));
  const directProjectionReady = directProjectionParts.every(({ market, projection }) =>
    (projection.items || []).length > 0 || Number(manifest.markets?.[market]?.count || 0) === 0);
  if (directProjectionReady) {
    const modelKeys = await projectionModelKeys(params);
    const rows = directProjectionParts.flatMap(({ projection }) => projection.items || [])
      .filter((row) => catalogSearchProjectionMatches(row, params, modelKeys));
    if (needsProjection) {
      catalogSearchProjectionSort(rows, params.sort || "updatedAt");
    } else {
      rows.sort((a, b) => {
        const af = Date.parse(String(a.sourcePublishedAt || a.firstSeenAt || a.updatedAt || "")) || 0;
        const bf = Date.parse(String(b.sourcePublishedAt || b.firstSeenAt || b.updatedAt || "")) || 0;
        return bf - af || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
      });
    }
    const total = rows.length;
    const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
    if (pageRows.every(projectionCanRenderCard)) {
      return {
        generationId: manifest.generationId, total, page, pageSize,
        items: pageRows.map(publicOfferFromProjection),
        usedIndexShards: directMarkets.map((market) => `catalog/generations/${manifest.generationId}/indexes/projection/${cleanShard(market)}.json`),
      };
    }
  }

  // Legacy generations may not contain every optional index shard. Use their
  // ordering index only as the candidate list, then apply every requested
  // filter against the projection (or its exact offer-scan fallback) below.
  const ids: Set<string> | null = null;
  const used: string[] = [];
  const byId = await readIndex<{ byId: Record<string, OfferLocation> }>(manifest.generationId, "offers-by-id.json", { byId: {} });
  const order = await readIndex<{ ids: string[] }>(manifest.generationId, "order-updatedAt.json", { ids: Object.keys(byId.byId) });
  const idList = ids ? order.ids.filter((id) => ids.has(id)) : order.ids;
  let total = idList.length;
  let pageIds = idList.slice((page - 1) * pageSize, page * pageSize);

  if (needsProjection) {
    const allowed = new Set(idList);
    const modelKeys = await projectionModelKeys(params);
    const projectionRows = (await readProjectionRows(manifest, params))
      .filter((row) => allowed.has(row.id) && catalogSearchProjectionMatches(row, params, modelKeys));
    catalogSearchProjectionSort(projectionRows, params.sort || "updatedAt");
    total = projectionRows.length;
    pageIds = projectionRows.slice((page - 1) * pageSize, page * pageSize).map((row) => row.id);
    const markets = params.market && params.market !== "any" ? [String(params.market)] : MARKETS;
    used.push(...markets.map((market) => `catalog/generations/${manifest.generationId}/indexes/projection/${cleanShard(market)}.json`));
  }

  const projectionMarkets = params.market && params.market !== "any" ? [String(params.market)] : [...new Set(pageIds.map((id) => String(byId.byId[id]?.market || "")).filter(Boolean))];
  if (projectionMarkets.length) {
    const projected = (await mapWithConcurrency(projectionMarkets, Math.min(7, projectionMarkets.length), async (market) => (await readSearchProjection(manifest.generationId, market)).items || [])).flat();
    const projectedById = new Map(projected.filter(projectionCanRenderCard).map((row) => [row.id, row]));
    if (pageIds.length && pageIds.every((id) => projectedById.has(id))) {
      used.push(...projectionMarkets.map((market) => `catalog/generations/${manifest.generationId}/indexes/projection/${cleanShard(market)}.json`));
      return { generationId: manifest.generationId, total, page, pageSize, items: pageIds.map((id) => publicOfferFromProjection(projectedById.get(id)!)), usedIndexShards: [...new Set(used.length ? used : [`catalog/generations/${manifest.generationId}/indexes/order-updatedAt.json`])] };
    }
  }

  const pageSet = new Set(pageIds);
  const chunkKeys = new Map<string, OfferLocation>();
  for (const id of pageIds) { const loc = byId.byId[id]; if (loc) chunkKeys.set(`${loc.market}/${loc.chunk}`, loc); }
  const chunkLocations = [...chunkKeys.values()];
  const readConcurrency = Math.max(1, Math.min(32, Number(process.env.CATALOG_SEARCH_CHUNK_CONCURRENCY || 12)));
  const loaded = (await mapWithConcurrency(chunkLocations, readConcurrency, (loc) => readDataJson<VehicleOffer[]>(storedOfferChunkPath(manifest.generationId, loc.market, loc.chunk), []))).flat();
  let items = loaded.filter((offer) => pageSet.has(offer.id) && isPublicOffer(offer));
  const rank = new Map(pageIds.map((id, index) => [id, index]));
  items.sort((a,b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  return { generationId: manifest.generationId, total, page, pageSize, items: items.map(publicOffer), usedIndexShards: used.length ? used : [`catalog/generations/${manifest.generationId}/indexes/order-updatedAt.json`] };
}

export async function readHomeCatalogSnapshot(perMarket = 6) {
  const manifest = await readManifest();
  const limit = Math.min(12, Math.max(1, Number(perMarket || 6)));
  const currentProjection = await readCurrentSearchProjection(CURRENT_ALL_MARKETS_PROJECTION);
  if (currentProjection.generationId === manifest.generationId) {
    const marketCounts: Record<string, number> = {};
    const items = MARKETS.flatMap((market) => {
      const rows = (currentProjection.items || []).filter((row) => row.market === market && projectionCanRenderCard(row));
      marketCounts[market] = rows.length;
      catalogSearchProjectionSort(rows, "updatedAt");
      return selectCatalogShowcaseDiversity(rows, limit).map(publicOfferFromProjection);
    });
    return {
      generationId: manifest.generationId,
      items,
      marketCounts,
      total: Object.values(marketCounts).reduce((sum, count) => sum + count, 0),
    };
  }
  const [byId, order, marketShards] = await Promise.all([
    readIndex<{ byId: Record<string, OfferLocation> }>(manifest.generationId, "offers-by-id.json", { byId: {} }),
    readIndex<{ ids: string[] }>(manifest.generationId, "order-updatedAt.json", { ids: [] }),
    mapWithConcurrency(MARKETS, MARKETS.length, async (market) => ({
      market,
      shard: await readIndex<{ ids: string[] }>(manifest.generationId, `market/${cleanShard(market)}.json`, { ids: [] }),
    })),
  ]);

  const marketCounts: Record<string, number> = {};
  // Homepage cards only need the compact card projection. Reading full offer chunks
  // for ~6 cards x 7 markets turned a simple initial render into dozens of object-store
  // reads. Prefer the per-market projection shards and fall back to full chunks only for
  // IDs from an older generation that cannot render a card from projection.
  const projectionShards = await mapWithConcurrency(MARKETS, MARKETS.length, async (market) => ({
    market,
    items: (await readSearchProjection(manifest.generationId, market)).items || [],
  }));
  const projected = projectionShards.flatMap(({ items }) => items);
  const projectedById = new Map(projected.filter(projectionCanRenderCard).map((row) => [row.id, row]));
  const orderRank = new Map((order.ids || []).map((id, index) => [id, index]));
  const selectedIds: string[] = [];
  for (const { market, shard } of marketShards) {
    const allowed = new Set(shard.ids || []);
    marketCounts[market] = allowed.size;
    const projection = projectionShards.find((entry) => entry.market === market)?.items || [];
    const candidates = projection
      .filter((row) => allowed.has(row.id) && byId.byId[row.id] && projectionCanRenderCard(row))
      .sort((a, b) => Number(orderRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - Number(orderRank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
    const diverse = selectCatalogShowcaseDiversity(candidates, limit);
    selectedIds.push(...diverse.map((row) => row.id));
    if (diverse.length >= limit) continue;
    const alreadySelected = new Set(diverse.map((row) => row.id));
    for (const id of order.ids || []) {
      if (!allowed.has(id) || !byId.byId[id] || alreadySelected.has(id)) continue;
      selectedIds.push(id);
      alreadySelected.add(id);
      if (alreadySelected.size >= limit) break;
    }
  }
  const missingIds = selectedIds.filter((id) => !projectedById.has(id));

  const fallbackById = new Map<string, VehicleOffer>();
  if (missingIds.length) {
    const chunkLocations = new Map<string, OfferLocation>();
    for (const id of missingIds) {
      const location = byId.byId[id];
      if (location) chunkLocations.set(`${location.market}/${location.chunk}`, location);
    }
    const readConcurrency = Math.max(1, Math.min(32, Number(process.env.CATALOG_SEARCH_CHUNK_CONCURRENCY || 12)));
    const loaded = (await mapWithConcurrency([...chunkLocations.values()], readConcurrency, (location) =>
      readDataJson<VehicleOffer[]>(storedOfferChunkPath(manifest.generationId, location.market, location.chunk), []))).flat();
    for (const offer of loaded.filter(isPublicOffer)) fallbackById.set(offer.id, offer);
  }

  const items = selectedIds.flatMap((id) => {
    const row = projectedById.get(id);
    if (row) return [publicOfferFromProjection(row)];
    const offer = fallbackById.get(id);
    return offer ? [publicOffer(offer)] : [];
  });

  return {
    generationId: manifest.generationId,
    items,
    marketCounts,
    total: Object.values(marketCounts).reduce((sum, count) => sum + count, 0),
  };
}

function isPrivateHost(hostname: string) { const h = hostname.toLowerCase(); if (["localhost", "0.0.0.0"].includes(h)) return true; if (/^(127\.|10\.|169\.254\.|192\.168\.)/.test(h)) return true; const m = h.match(/^172\.(\d+)\./); if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true; return h === "metadata.google.internal" || h === "169.254.169.254"; }
export function assertSafeImageUrl(rawUrl: string) { const parsed = new URL(rawUrl); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("image_url_protocol_blocked"); if (isPrivateHost(parsed.hostname)) throw new Error("image_url_private_host_blocked"); if (!ALLOWED_IMAGE_HOSTS.some((re) => re.test(parsed.hostname))) throw new Error("image_url_host_not_allowed"); return parsed.toString(); }

async function optimizeCatalogImage(input: Buffer, sourceMimeType: string) {
  if (IMAGE_OPTIMIZATION_DISABLED) return { data: input, mimeType: sourceMimeType, extension: sourceMimeType.includes("png") ? "png" : sourceMimeType.includes("webp") ? "webp" : "jpg", width: undefined, height: undefined };
  try {
    const result = await sharp(input, { failOn: "warning", limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: IMAGE_MAX_WIDTH, height: IMAGE_MAX_HEIGHT, fit: "inside", withoutEnlargement: true })
      .webp({ quality: IMAGE_WEBP_QUALITY, effort: 4, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });
    return { data: result.data, mimeType: "image/webp", extension: "webp", width: result.info.width, height: result.info.height };
  } catch {
    // A malformed but browser-decodable source image must not make the whole
    // market publication fail. Keep the already size-bounded original.
    return { data: input, mimeType: sourceMimeType, extension: sourceMimeType.includes("png") ? "png" : sourceMimeType.includes("webp") ? "webp" : "jpg", width: undefined, height: undefined };
  }
}

export async function cacheImageFromUrl(url: string, market: string, init?: RequestInit): Promise<CatalogImage | null> {
  let safeUrl: string; try { safeUrl = assertSafeImageUrl(url); } catch { return null; }
  try {
    const existing = await cachedImageForSource(safeUrl);
    if (existing) return existing;
    return await withImageHostLimit(new URL(safeUrl).hostname.toLowerCase(), async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_IMAGE_TIMEOUT_MS || 12000));
      try {
        let currentUrl = safeUrl; let res: Response | null = null;
        for (let redirects = 0; redirects <= 3; redirects++) {
          res = await fetch(currentUrl, { ...init, signal: controller.signal, redirect: "manual" });
          if (res.status === 403 || res.status === 429) throw new Error(`image_source_rate_limited_${res.status}`);
          if ([301,302,303,307,308].includes(res.status)) { const location = res.headers.get("location"); if (!location || redirects === 3) return null; currentUrl = assertSafeImageUrl(new URL(location, currentUrl).toString()); continue; }
          break;
        }
        if (!res || !res.ok) return null;
        const mimeType = (res.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
        if (!/^image\/(jpeg|png|webp)$/.test(mimeType)) return null;
        const len = Number(res.headers.get("content-length") || 0); if (len > IMAGE_MAX_BYTES) return null;
        const buf = Buffer.from(await res.arrayBuffer()); if (!buf.length || buf.length > IMAGE_MAX_BYTES) return null;
        const optimized = await optimizeCatalogImage(buf, mimeType);
        const checksum = crypto.createHash("sha256").update(optimized.data).digest("hex"); const imageId = checksum.slice(0, 32); const objectKey = `catalog/images/${market}/${checksum}.${optimized.extension}`; const storage = getJsonStorage();
        if (!(await storage.binaryExists?.(objectKey))) {
          try { await storage.putBinary?.(objectKey, optimized.data, optimized.mimeType, { ifNoneMatch: "*" }); }
          catch (error) { if (!(error instanceof StorageConflictError) || !(await storage.binaryExists?.(objectKey))) throw error; }
        }
        const image = { id: imageId, url: publicImageUrl(imageId, objectKey), objectKey, checksum, mimeType: optimized.mimeType, size: optimized.data.length, width: optimized.width, height: optimized.height } satisfies CatalogImage;
        await rememberImageSource(safeUrl, image).catch(() => undefined);
        return image;
      } finally { clearTimeout(timeout); }
    });
  } catch { return null; }
}
