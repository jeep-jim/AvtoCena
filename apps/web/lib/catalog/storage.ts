import crypto from "node:crypto";
import { getJsonStorage, readDataJson, StorageConflictError } from "../data";
import type { CatalogImage, CatalogMarket, CatalogSearchParams, PublicVehicleOffer, VehicleOffer } from "./types";
import { hasCredibleOfferContent } from "./offer-quality";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import { CATALOG_CHUNK_SIZE, PUBLIC_CATALOG_MARKETS } from "./runtime-config";
import { enrichOfferWithVehicleKnowledge, resolveVehicleModelQuery } from "./vehicle-knowledge";

const MARKETS: CatalogMarket[] = [...PUBLIC_CATALOG_MARKETS];
const IMAGE_MAX_BYTES = Number(process.env.CATALOG_IMAGE_MAX_BYTES || 8_000_000);
const INTERNAL_MANIFEST_PATH = "catalog/internal/manifest.json";
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
export type CatalogFacets = { generationId: string; makes: string[]; models: Array<{ make: string; model: string; aliases?: string[]; popularityDecile?: number }>; markets: string[]; bodyTypes: string[]; fuels: string[]; transmissions: string[]; drives: string[] };
export function publicOffer(offer: VehicleOffer): PublicVehicleOffer { const { operational, vin, frameNumber, sourceId, ...dto } = offer as any; return { ...dto, images: offer.images.map((img) => ({ id: img.id, url: img.url, width: img.width, height: img.height, size: img.size, mimeType: img.mimeType })) } as any; }
export function stableOfferId(sourceId: string, sourceOfferId: string) { return crypto.createHash("sha256").update(`${sourceId}:${sourceOfferId}`).digest("hex").slice(0, 24); }
export function publicImageUrl(imageId: string, objectKey: string) { const cdn = process.env.CATALOG_IMAGE_CDN_URL?.replace(/\/+$/g, ""); return cdn ? `${cdn}/${objectKey}` : `/api/catalog/images/${imageId}`; }
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
function numericBucket(value: number | null | undefined, size: number) { const number = Number(value || 0); return number > 0 ? String(Math.ceil(number / size) * size) : "unknown"; }
function budgetBucket(value?: number | null) { return numericBucket(value, 500_000); }
function powerBucket(value?: number | null) { return numericBucket(value, 25); }
function mileageBucket(value?: number | null) { return numericBucket(value, 25_000); }
function engineBucket(value?: number | null) { return numericBucket(value, 250); }
function generationPath(generationId: string, rel: string) { return `catalog/generations/${generationId}/${rel}`; }
function uniqueText(values: unknown[]) { return [...new Set(values.map(cleanFacet).filter(Boolean))]; }
export function offerPath(generationId: string, market: string, chunk: string) { return generationPath(generationId, `offers/${market}/${chunk}.json`); }
export function chunkName(index: number) { return `chunk-${String(index).padStart(4, "0")}`; }
async function readManifest(): Promise<CatalogManifest> { return readDataJson<CatalogManifest>("catalog/manifest.json", { version: 2, generationId: "empty", updatedAt: "", markets: {} }); }
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

async function readOfferLists(paths: string[]) {
  const concurrency = Math.max(1, Math.min(32, Number(process.env.CATALOG_READ_CONCURRENCY || 12)));
  return (await mapWithConcurrency(paths, concurrency, (path) => readDataJson<VehicleOffer[]>(path, []))).flat();
}

export async function readMarketOffers(market: string) {
  const manifest = await readManifest();
  const chunks: string[] = manifest.markets?.[market]?.chunks || [];
  return readOfferLists(chunks.map((chunk) => offerPath(manifest.generationId, market, chunk)));
}
export async function readAllOffersForMaintenance() {
  const manifest = await readDataJson<any>(INTERNAL_MANIFEST_PATH, { generationId: "", sources: {} });
  const chunks: string[] = Object.values<any>(manifest.sources || {}).flatMap((source) => source.chunks || []);
  return readOfferLists(chunks);
}
export const readAllOffers = readAllOffersForMaintenance;
export async function readCatalogFacets(params: CatalogSearchParams = {}): Promise<CatalogFacets> {
  const manifest = await readManifest();
  const fallback: CatalogFacets = { generationId: manifest.generationId, makes: [], models: [], markets: [...PUBLIC_CATALOG_MARKETS], bodyTypes: [], fuels: [], transmissions: [], drives: [] };
  const indexed = await readIndex<CatalogFacets>(manifest.generationId, "facets.json", fallback);
  // `market` alone is not a reason to deserialize the full market merely to draw the
  // filter UI. Use the generation facet index for the initial/market-only screen.
  // More selective facet projections are handled separately; this fast path removes
  // the worst navigation cost immediately.
  const hasFilters = Boolean(params.make || params.model || params.hasPrice
    || params.budgetFrom || params.budgetTo || params.yearFrom || params.yearTo
    || params.mileageFrom || params.mileageTo || params.engineFrom || params.engineTo
    || params.powerFrom || params.powerTo || params.fuel || params.bodyType
    || params.transmission || params.drive || params.auctionGrade);

  if (!hasFilters) {
    return {
      ...indexed,
      generationId: manifest.generationId,
      makes: uniqueText(indexed.makes || []).sort((a, b) => a.localeCompare(b, "ru")),
      models: [],
      markets: [...PUBLIC_CATALOG_MARKETS],
    };
  }

  const marketIds = params.market && params.market !== "any" ? [String(params.market)] : MARKETS;
  const rows = (await Promise.all(marketIds.map((market) => readMarketOffers(market)))).flat().filter(isPublicOffer);
  const lower = (value: unknown) => cleanFacet(value).toLocaleLowerCase("ru-RU");
  let modelKeys: Set<string> | null = null;

  if (params.model) {
    const matches = await resolveVehicleModelQuery(params.model, params.make, 100);
    const candidates = matches.length
      ? matches.map((match) => ({ make: match.make, model: match.model }))
      : params.make ? [{ make: params.make, model: params.model }] : [];
    modelKeys = new Set(candidates.map((item) => `${lower(item.make)}:${lower(item.model)}`));
  }

  const offers = rows.filter((offer) => {
    if (params.make && lower(offer.make) !== lower(params.make)) return false;
    if (params.model && (!modelKeys?.size || !modelKeys.has(`${lower(offer.make)}:${lower(offer.model)}`))) return false;
    if (params.hasPrice) {
      const value = Number(offer.totalRub || 0) > 0 ? "yes" : "no";
      if (value !== params.hasPrice) return false;
    }
    if (params.budgetFrom && (offer.totalRub || 0) < params.budgetFrom) return false;
    if (params.budgetTo && (offer.totalRub || Infinity) > params.budgetTo) return false;
    if (params.yearFrom && offer.year < params.yearFrom) return false;
    if (params.yearTo && offer.year > params.yearTo) return false;
    if (params.mileageFrom && (offer.mileageKm || 0) < params.mileageFrom) return false;
    if (params.mileageTo && (offer.mileageKm || Infinity) > params.mileageTo) return false;
    if (params.engineFrom && (offer.engineCc || 0) < params.engineFrom) return false;
    if (params.engineTo && (offer.engineCc || Infinity) > params.engineTo) return false;
    if (params.powerFrom && (offer.powerHp || 0) < params.powerFrom) return false;
    if (params.powerTo && (offer.powerHp || Infinity) > params.powerTo) return false;
    if (params.fuel && lower(offer.fuel) !== lower(params.fuel)) return false;
    if (params.bodyType && lower(offer.bodyType) !== lower(params.bodyType)) return false;
    if (params.transmission && lower(offer.transmission) !== lower(params.transmission)) return false;
    if (params.drive && lower(offer.drive) !== lower(params.drive)) return false;
    if (params.auctionGrade && lower(offer.auctionGrade) !== lower(params.auctionGrade)) return false;
    return true;
  });

  const values = (selector: (offer: VehicleOffer) => unknown) => uniqueText(offers.map(selector)).sort((a, b) => a.localeCompare(b, "ru"));
  const offerModels = [...new Map(offers.map((offer) => [`${cleanFacet(offer.make)}:${cleanFacet(offer.model)}`, { make: cleanFacet(offer.make), model: cleanFacet(offer.model) }])).values()]
    .filter((item) => item.make && item.model)
    .sort((a, b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`, "ru"));

  return {
    generationId: manifest.generationId,
    makes: values((offer) => offer.make),
    models: offerModels,
    markets: [...PUBLIC_CATALOG_MARKETS],
    bodyTypes: values((offer) => offer.bodyType),
    fuels: values((offer) => offer.fuel),
    transmissions: values((offer) => offer.transmission),
    drives: values((offer) => offer.drive),
  };
}

async function persistInternalCatalog(storage: ReturnType<typeof getJsonStorage>, generationId: string, offers: VehicleOffer[]) {
  const now = new Date().toISOString();
  const sources: Record<string, { count: number; chunks: string[]; updatedAt: string }> = {};
  const bySource = new Map<string, VehicleOffer[]>();
  for (const offer of offers) bySource.set(offer.sourceId, [...(bySource.get(offer.sourceId) || []), offer]);
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
function isPublicOffer(o: VehicleOffer) { return o.status === "active" && hasCredibleOfferContent(o); }
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
export async function persistCatalogOffers(nextOffers: VehicleOffer[]) {
  const storage = getJsonStorage();
  const growOnlyMarkets = new Set(String(process.env.CATALOG_GROW_ONLY_MARKETS ?? "korea").split(",").map((value) => value.trim()).filter(Boolean));
  const normalized = await Promise.all(nextOffers.map(async (offer) => normalizeVehicleOfferSpecs(await enrichOfferWithVehicleKnowledge(offer))));
  if (growOnlyMarkets.size) {
    const current = await readAllOffersForMaintenance();
    const merged = new Map(normalized.map((offer) => [offer.id, offer]));
    for (const offer of current) {
      if (!growOnlyMarkets.has(String(offer.market)) || !hasCredibleOfferContent({ ...offer, status: "active" })) continue;
      const incoming = merged.get(offer.id);
      if (!incoming || incoming.status !== "active" || !hasCredibleOfferContent({ ...incoming, status: "active" })) {
        const restored = normalizeVehicleOfferSpecs(await enrichOfferWithVehicleKnowledge({ ...offer, status: "active" }));
        merged.set(offer.id, restored);
      }
    }
    nextOffers = [...merged.values()];
  } else {
    nextOffers = normalized;
  }
  const generationId = `gen_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  await persistInternalCatalog(storage, generationId, nextOffers);
  const byMarket = new Map<string, VehicleOffer[]>();
  for (const offer of nextOffers.filter(isPublicOffer)) byMarket.set(offer.market, [...(byMarket.get(offer.market) || []), offer]);
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
      await writeJsonAtomic(offerPath(generationId, market, name), slice);
    }
    markets[market] = { count: offers.length, chunks, updatedAt: now };
  }
  await rebuildIndexes(generationId, nextOffers.filter(isPublicOffer), byId, imagesById);
  const manifest: CatalogManifest = { version: 2, generationId, updatedAt: now, markets };
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await storage.readJsonWithMeta<CatalogManifest>("catalog/manifest.json", manifest);
    try { await storage.writeJson("catalog/manifest.json", manifest, current.found && current.etag ? { ifMatch: current.etag } : { ifNoneMatch: "*" }); return manifest; }
    catch (e) { if (e instanceof StorageConflictError) continue; throw e; }
  }
  throw new StorageConflictError();
}
export async function rebuildIndexes(generationId: string, offers: VehicleOffer[], byId: Record<string, OfferLocation>, imagesById: Record<string, { objectKey: string; mimeType: string; checksum: string; size: number }> = {}) {
  const maps: Record<string, Map<string, string[]>> = {
    market: new Map(), make: new Map(), model: new Map(), year: new Map(), budget: new Map(),
    power: new Map(), mileage: new Map(), engine: new Map(), fuel: new Map(), body: new Map(),
    transmission: new Map(), drive: new Map(), hasPrice: new Map(),
  };
  const makes = new Map<string, string>();
  const models = new Map<string, { make: string; model: string }>();
  for (const o of offers) {
    const make = cleanFacet(o.make);
    const model = cleanFacet(o.model);
    if (make) makes.set(cleanShard(make), make);
    if (make && model) models.set(`${cleanShard(make)}:${cleanShard(model)}`, { make, model });
    const pairs = {
      market: o.market, make, model: `${make}:${model}`, year: o.year, budget: budgetBucket(o.totalRub),
      power: powerBucket(o.powerHp), mileage: mileageBucket(o.mileageKm), engine: engineBucket(o.engineCc),
      fuel: o.fuel, body: o.bodyType, transmission: o.transmission, drive: o.drive, hasPrice: o.totalRub ? "yes" : "no",
    };
    for (const [name, key] of Object.entries(pairs)) { const map = maps[name]; const shard = cleanShard(key); map.set(shard, [...(map.get(shard) || []), o.id]); }
  }
  await writeJsonAtomic(generationPath(generationId, "indexes/offers-by-id.json"), { generationId, byId });
  await writeJsonAtomic(generationPath(generationId, "indexes/images-by-id.json"), { generationId, imagesById });
  await writeJsonAtomic(generationPath(generationId, "indexes/facets.json"), {
    generationId,
    makes: [...makes.values()].sort((a,b) => a.localeCompare(b, "ru")),
    models: [...models.values()].sort((a,b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`, "ru")),
    markets: [...new Set(offers.map((offer) => cleanFacet(offer.market)).filter(Boolean))].sort(),
    bodyTypes: [...new Set(offers.map((offer) => cleanFacet(offer.bodyType)).filter(Boolean))].sort(),
    fuels: [...new Set(offers.map((offer) => cleanFacet(offer.fuel)).filter(Boolean))].sort(),
    transmissions: [...new Set(offers.map((offer) => cleanFacet(offer.transmission)).filter(Boolean))].sort(),
    drives: [...new Set(offers.map((offer) => cleanFacet(offer.drive)).filter(Boolean))].sort(),
  });
  const freshness = (offer: VehicleOffer) => Date.parse(String((offer.operational as any)?.sourcePublishedAt || offer.firstSeenAt || offer.updatedAt || "")) || 0;
  await writeJsonAtomic(generationPath(generationId, "indexes/order-updatedAt.json"), { generationId, ids: [...offers].sort((a,b) => freshness(b) - freshness(a) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))).map((o) => o.id) });
  const tasks = Object.entries(maps).flatMap(([name, map]) => [...map.entries()].map(([key, ids]) => () => writeIndexShard(generationId, name, key, ids)));
  const concurrency = Math.max(1, Number(process.env.CATALOG_INDEX_WRITE_CONCURRENCY || 6));
  await runWithConcurrency(tasks, concurrency);
}
function intersect(a: Set<string> | null, ids: string[]) { const b = new Set(ids); if (!a) return b; return new Set([...a].filter((id) => b.has(id))); }
function rangeKeys(from: number | undefined, to: number | undefined, step: number, maximum: number) {
  const low = Math.max(0, Number(from || 0));
  const high = Math.min(maximum, Number(to || maximum));
  if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) return [];
  const first = Math.max(step, Math.ceil(low / step) * step);
  const last = Math.max(first, Math.ceil(high / step) * step);
  const keys: number[] = [];
  for (let value = first; value <= last && keys.length < 1_000; value += step) keys.push(value);
  return keys;
}
function yearKeys(from?: number, to?: number) {
  const current = new Date().getFullYear() + 2;
  const low = Math.max(1886, Math.floor(Number(from || 1886)));
  const high = Math.min(current, Math.floor(Number(to || current)));
  if (high < low) return [];
  return Array.from({ length: high - low + 1 }, (_, index) => low + index);
}
async function unionIndexIds(manifest: CatalogManifest, name: string, keys: Array<string | number>, used: string[]) {
  const uniqueKeys = [...new Set(keys.map(cleanShard).filter((key) => key && key !== "unknown"))];
  const concurrency = Math.max(1, Math.min(32, Number(process.env.CATALOG_INDEX_READ_CONCURRENCY || 16)));
  const shards = await mapWithConcurrency(uniqueKeys, concurrency, async (key) => {
    const path = `${name}/${key}.json`;
    used.push(`catalog/generations/${manifest.generationId}/indexes/${path}`);
    return readIndex<{ ids: string[] }>(manifest.generationId, path, { ids: [] });
  });
  return [...new Set(shards.flatMap((shard) => shard.ids || []))];
}
async function candidateIds(manifest: CatalogManifest, params: CatalogSearchParams) {
  const used: string[] = [];
  let ids: Set<string> | null = null;
  const specs: [string, string | number | undefined][] = [
    ["market", params.market && params.market !== "any" ? params.market : undefined],
    ["make", params.make], ["fuel", params.fuel], ["body", params.bodyType],
    ["transmission", params.transmission], ["drive", params.drive], ["hasPrice", params.hasPrice],
  ];
  for (const [name, key] of specs) if (key) {
    const path = `${name}/${cleanShard(key)}.json`;
    const shard = await readIndex<{ ids: string[] }>(manifest.generationId, path, { ids: [] });
    used.push(`catalog/generations/${manifest.generationId}/indexes/${path}`);
    ids = intersect(ids, shard.ids || []);
  }
  if (params.model) {
    const matches = await resolveVehicleModelQuery(params.model, params.make, 100);
    const candidates = matches.length ? matches.map((match) => `${match.make}:${match.model}`) : params.make ? [`${params.make}:${params.model}`] : [];
    ids = intersect(ids, await unionIndexIds(manifest, "model", candidates, used));
  }
  if (params.yearFrom || params.yearTo) ids = intersect(ids, await unionIndexIds(manifest, "year", yearKeys(params.yearFrom, params.yearTo), used));
  if (params.budgetFrom || params.budgetTo) ids = intersect(ids, await unionIndexIds(manifest, "budget", rangeKeys(params.budgetFrom, params.budgetTo, 500_000, 100_000_000), used));
  if (params.mileageFrom || params.mileageTo) ids = intersect(ids, await unionIndexIds(manifest, "mileage", rangeKeys(params.mileageFrom, params.mileageTo, 25_000, 1_000_000), used));
  if (params.engineFrom || params.engineTo) ids = intersect(ids, await unionIndexIds(manifest, "engine", rangeKeys(params.engineFrom, params.engineTo, 250, 10_000), used));
  if (params.powerFrom || params.powerTo) ids = intersect(ids, await unionIndexIds(manifest, "power", rangeKeys(params.powerFrom, params.powerTo, 25, 2_500), used));
  return { ids, used };
}
export async function getOffer(id: string) { const manifest = await readManifest(); const byId = await readIndex<{ byId: Record<string, OfferLocation> }>(manifest.generationId, "offers-by-id.json", { byId: {} }); const loc = byId.byId[id]; if (!loc) return null; const chunk = await readDataJson<VehicleOffer[]>(offerPath(manifest.generationId, loc.market, loc.chunk), []); return chunk.find((o) => o.id === id && isPublicOffer(o)) || null; }
export async function searchOffers(params: CatalogSearchParams) {
  const manifest = await readManifest();
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.min(48, Math.max(1, Number(params.pageSize || 24)));
  const { ids, used } = await candidateIds(manifest, params);
  const byId = await readIndex<{ byId: Record<string, OfferLocation> }>(manifest.generationId, "offers-by-id.json", { byId: {} });
  const order = await readIndex<{ ids: string[] }>(manifest.generationId, "order-updatedAt.json", { ids: Object.keys(byId.byId) });
  const idList = ids ? order.ids.filter((id) => ids.has(id)) : order.ids;
  const hasRangeFilters = Boolean(params.budgetFrom || params.budgetTo || params.yearFrom || params.yearTo || params.mileageFrom || params.mileageTo || params.engineFrom || params.engineTo || params.powerFrom || params.powerTo || params.transmission || params.auctionGrade || (params.sort && params.sort !== "updatedAt"));
  let total = idList.length;
  let pageIds = idList.slice((page - 1) * pageSize, page * pageSize);
  if (hasRangeFilters) pageIds = idList;
  const pageSet = new Set(pageIds);
  const chunkKeys = new Map<string, OfferLocation>();
  for (const id of pageIds) { const loc = byId.byId[id]; if (loc) chunkKeys.set(`${loc.market}/${loc.chunk}`, loc); }
  const chunkLocations = [...chunkKeys.values()];
  const readConcurrency = Math.max(1, Math.min(32, Number(process.env.CATALOG_SEARCH_CHUNK_CONCURRENCY || 12)));
  const loaded = (await mapWithConcurrency(chunkLocations, readConcurrency, (loc) => readDataJson<VehicleOffer[]>(offerPath(manifest.generationId, loc.market, loc.chunk), []))).flat();
  let items = loaded.filter((offer) => pageSet.has(offer.id) && isPublicOffer(offer));
  if (hasRangeFilters) {
    items = items.filter((offer) => (!params.budgetFrom || (offer.totalRub || 0) >= params.budgetFrom)
      && (!params.budgetTo || (offer.totalRub || Infinity) <= params.budgetTo)
      && (!params.yearFrom || offer.year >= params.yearFrom) && (!params.yearTo || offer.year <= params.yearTo)
      && (!params.mileageFrom || (offer.mileageKm || 0) >= params.mileageFrom) && (!params.mileageTo || (offer.mileageKm || Infinity) <= params.mileageTo)
      && (!params.engineFrom || (offer.engineCc || 0) >= params.engineFrom) && (!params.engineTo || (offer.engineCc || Infinity) <= params.engineTo)
      && (!params.powerFrom || (offer.powerHp || 0) >= params.powerFrom) && (!params.powerTo || (offer.powerHp || Infinity) <= params.powerTo)
      && (!params.transmission || offer.transmission === params.transmission) && (!params.auctionGrade || offer.auctionGrade === params.auctionGrade));
    const sort = params.sort || "updatedAt";
    items.sort((a,b) => sort === "totalRub" ? (a.totalRub ?? Infinity) - (b.totalRub ?? Infinity)
      : sort === "year" ? b.year - a.year
        : sort === "mileage" ? (a.mileageKm || 0) - (b.mileageKm || 0)
          : String(b.auctionDate || b.updatedAt).localeCompare(String(a.auctionDate || a.updatedAt)));
    total = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize);
  } else {
    const rank = new Map(pageIds.map((id, index) => [id, index]));
    items.sort((a,b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  }
  return { generationId: manifest.generationId, total, page, pageSize, items: items.map(publicOffer), usedIndexShards: used.length ? used : [`catalog/generations/${manifest.generationId}/indexes/order-updatedAt.json`] };
}
function isPrivateHost(hostname: string) { const h = hostname.toLowerCase(); if (["localhost", "0.0.0.0"].includes(h)) return true; if (/^(127\.|10\.|169\.254\.|192\.168\.)/.test(h)) return true; const m = h.match(/^172\.(\d+)\./); if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true; return h === "metadata.google.internal" || h === "169.254.169.254"; }
export function assertSafeImageUrl(rawUrl: string) { const parsed = new URL(rawUrl); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("image_url_protocol_blocked"); if (isPrivateHost(parsed.hostname)) throw new Error("image_url_private_host_blocked"); if (!ALLOWED_IMAGE_HOSTS.some((re) => re.test(parsed.hostname))) throw new Error("image_url_host_not_allowed"); return parsed.toString(); }
export async function cacheImageFromUrl(url: string, market: string, init?: RequestInit): Promise<CatalogImage | null> {
  let safeUrl: string; try { safeUrl = assertSafeImageUrl(url); } catch { return null; }
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_IMAGE_TIMEOUT_MS || 12000));
  try {
    let currentUrl = safeUrl; let res: Response | null = null; for (let redirects = 0; redirects <= 3; redirects++) { res = await fetch(currentUrl, { ...init, signal: controller.signal, redirect: "manual" }); if ([301,302,303,307,308].includes(res.status)) { const location = res.headers.get("location"); if (!location || redirects === 3) return null; currentUrl = assertSafeImageUrl(new URL(location, currentUrl).toString()); continue; } break; } if (!res || !res.ok) return null; const mimeType = res.headers.get("content-type") || ""; if (!/^image\/(jpeg|png|webp)$/.test(mimeType)) return null;
    const len = Number(res.headers.get("content-length") || 0); if (len > IMAGE_MAX_BYTES) return null; const buf = Buffer.from(await res.arrayBuffer()); if (!buf.length || buf.length > IMAGE_MAX_BYTES) return null;
    const checksum = crypto.createHash("sha256").update(buf).digest("hex"); const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg"; const imageId = checksum.slice(0, 32); const objectKey = `catalog/images/${market}/${checksum}.${ext}`; const storage = getJsonStorage(); if (!(await storage.binaryExists?.(objectKey))) await storage.putBinary?.(objectKey, buf, mimeType, { ifNoneMatch: "*" }); return { id: imageId, url: publicImageUrl(imageId, objectKey), objectKey, checksum, mimeType, size: buf.length };
  } catch { return null; } finally { clearTimeout(timeout); }
}
