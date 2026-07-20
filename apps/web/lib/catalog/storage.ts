import crypto from "node:crypto";
import { getJsonStorage, readDataJson, StorageConflictError } from "../data";
import type { CatalogImage, CatalogMarket, CatalogSearchParams, PublicVehicleOffer, VehicleOffer } from "./types";
import { hasCredibleOfferContent } from "./offer-quality";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";

const MARKETS: CatalogMarket[] = ["japan", "korea", "china", "uae", "europe"];
const IMAGE_MAX_BYTES = Number(process.env.CATALOG_IMAGE_MAX_BYTES || 8_000_000);
const INTERNAL_MANIFEST_PATH = "catalog/internal/manifest.json";
const ALLOWED_IMAGE_HOSTS = [
  /^(.+\.)?encar\.com$/i,
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
export const CATALOG_CHUNK_SIZE = 500;
export type OfferLocation = { market: CatalogMarket; chunk: string };
export type CatalogManifest = { version: 2; generationId: string; updatedAt: string; markets: Record<string, { count: number; chunks: string[]; updatedAt: string }> };
export type CatalogFacets = { generationId: string; makes: string[]; models: Array<{ make: string; model: string }>; markets: string[]; bodyTypes: string[]; fuels: string[]; transmissions: string[]; drives: string[] };

export function publicOffer(offer: VehicleOffer): PublicVehicleOffer { const { operational, vin, frameNumber, sourceId, ...dto } = offer as any; return { ...dto, images: offer.images.map((img) => ({ id: img.id, url: img.url, width: img.width, height: img.height, size: img.size, mimeType: img.mimeType })) } as any; }
export function stableOfferId(sourceId: string, sourceOfferId: string) { return crypto.createHash("sha256").update(`${sourceId}:${sourceOfferId}`).digest("hex").slice(0, 24); }
export function publicImageUrl(imageId: string, objectKey: string) { const cdn = process.env.CATALOG_IMAGE_CDN_URL?.replace(/\/+$/g, ""); return cdn ? `${cdn}/${objectKey}` : `/api/catalog/images/${imageId}`; }
function cleanShard(value?: string | number) { return String(value || "unknown").toLowerCase().replace(/[^a-z0-9а-яё-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "unknown"; }
function cleanFacet(value: unknown) { return String(value || "").replace(/\s+/g, " ").trim(); }
function budgetBucket(v?: number | null) { if (!v) return "unknown"; return String(Math.ceil(v / 500_000) * 500_000); }
function generationPath(generationId: string, rel: string) { return `catalog/generations/${generationId}/${rel}`; }
export function offerPath(generationId: string, market: string, chunk: string) { return generationPath(generationId, `offers/${market}/${chunk}.json`); }
export function chunkName(index: number) { return `chunk-${String(index).padStart(4, "0")}`; }
async function readManifest(): Promise<CatalogManifest> { return readDataJson<CatalogManifest>("catalog/manifest.json", { version: 2, generationId: "empty", updatedAt: "", markets: {} }); }
async function readIndex<T>(generationId: string, path: string, fallback: T) { return readDataJson<T>(generationPath(generationId, `indexes/${path}`), fallback); }
async function writeJsonAtomic(path: string, value: unknown, ifNoneMatch = true) { const storage = getJsonStorage(); try { await storage.writeJson(path, value, ifNoneMatch ? { ifNoneMatch: "*" } : undefined); } catch (e) { if (e instanceof StorageConflictError && ifNoneMatch) return; throw e; } }
export async function readMarketOffers(market: string) { const manifest = await readManifest(); const chunks: string[] = manifest.markets?.[market]?.chunks || []; const lists = await Promise.all(chunks.map((c) => readDataJson<VehicleOffer[]>(offerPath(manifest.generationId, market, c), []))); return lists.flat(); }
export async function readAllOffersForMaintenance() { const manifest = await readDataJson<any>(INTERNAL_MANIFEST_PATH, { generationId: "", sources: {} }); const chunks: string[] = Object.values<any>(manifest.sources || {}).flatMap((source) => source.chunks || []); const lists = await Promise.all(chunks.map((path) => readDataJson<VehicleOffer[]>(path, []))); return lists.flat(); }
export const readAllOffers = readAllOffersForMaintenance;
export async function readCatalogFacets(params: Pick<CatalogSearchParams, "market" | "make"> = {}): Promise<CatalogFacets> {
  const manifest = await readManifest();
  const fallback: CatalogFacets = { generationId: manifest.generationId, makes: [], models: [], markets: [], bodyTypes: [], fuels: [], transmissions: [], drives: [] };
  if (!params.market && !params.make) return readIndex<CatalogFacets>(manifest.generationId, "facets.json", fallback);
  const marketIds = params.market && params.market !== "any" ? [String(params.market)] : MARKETS;
  const rows = (await Promise.all(marketIds.map((market) => readMarketOffers(market)))).flat().filter(isPublicOffer);
  const offers = params.make ? rows.filter((offer) => cleanFacet(offer.make) === cleanFacet(params.make)) : rows;
  const values = (selector: (offer: VehicleOffer) => unknown) => [...new Set(offers.map(selector).map(cleanFacet).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
  const makes = values((offer) => offer.make);
  const models = [...new Map(offers.map((offer) => [`${cleanFacet(offer.make)}:${cleanFacet(offer.model)}`, { make: cleanFacet(offer.make), model: cleanFacet(offer.model) }])).values()].filter((item) => item.make && item.model).sort((a, b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`, "ru"));
  return { generationId: manifest.generationId, makes, models, markets: values((offer) => offer.market), bodyTypes: values((offer) => offer.bodyType), fuels: values((offer) => offer.fuel), transmissions: values((offer) => offer.transmission), drives: values((offer) => offer.drive) };
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
function isPublicOffer(o: VehicleOffer) { return o.status === "active" && hasCredibleOfferContent(o) && Boolean(o.totalRub); }
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
  const normalized = nextOffers.map((offer) => normalizeVehicleOfferSpecs(offer));
  if (growOnlyMarkets.size) {
    const current = await readAllOffersForMaintenance();
    const merged = new Map(normalized.map((offer) => [offer.id, offer]));
    for (const offer of current) {
      if (!growOnlyMarkets.has(String(offer.market)) || !hasCredibleOfferContent({ ...offer, status: "active" })) continue;
      const incoming = merged.get(offer.id);
      if (!incoming || incoming.status !== "active" || !hasCredibleOfferContent({ ...incoming, status: "active" })) merged.set(offer.id, normalizeVehicleOfferSpecs({ ...offer, status: "active" }));
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
  const maps: Record<string, Map<string, string[]>> = { market: new Map(), make: new Map(), model: new Map(), year: new Map(), budget: new Map(), fuel: new Map(), body: new Map(), transmission: new Map(), drive: new Map(), hasPrice: new Map() };
  const makes = new Map<string, string>();
  const models = new Map<string, { make: string; model: string }>();
  for (const o of offers) {
    const make = cleanFacet(o.make);
    const model = cleanFacet(o.model);
    if (make) makes.set(cleanShard(make), make);
    if (make && model) models.set(`${cleanShard(make)}:${cleanShard(model)}`, { make, model });
    const pairs = { market: o.market, make, model: `${make}:${model}`, year: o.year, budget: budgetBucket(o.totalRub), fuel: o.fuel, body: o.bodyType, transmission: o.transmission, drive: o.drive, hasPrice: o.totalRub ? "yes" : "no" };
    for (const [name, key] of Object.entries(pairs)) { const m = maps[name]; const k = cleanShard(key); m.set(k, [...(m.get(k) || []), o.id]); }
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
async function candidateIds(manifest: CatalogManifest, params: CatalogSearchParams) {
  const used: string[] = []; let ids: Set<string> | null = null;
  const specs: [string, string | number | undefined][] = [["market", params.market && params.market !== "any" ? params.market : undefined], ["make", params.make], ["model", params.make && params.model ? `${params.make}:${params.model}` : undefined], ["year", params.yearFrom && params.yearFrom === params.yearTo ? params.yearFrom : undefined], ["fuel", params.fuel], ["body", params.bodyType], ["drive", params.drive], ["hasPrice", params.hasPrice]];
  for (const [name, key] of specs) if (key) { const path = `${name}/${cleanShard(key)}.json`; const shard = await readIndex<{ ids: string[] }>(manifest.generationId, path, { ids: [] }); used.push(`catalog/generations/${manifest.generationId}/indexes/${path}`); ids = intersect(ids, shard.ids || []); }
  return { ids, used };
}
export async function getOffer(id: string) { const manifest = await readManifest(); const byId = await readIndex<{ byId: Record<string, OfferLocation> }>(manifest.generationId, "offers-by-id.json", { byId: {} }); const loc = byId.byId[id]; if (!loc) return null; const chunk = await readDataJson<VehicleOffer[]>(offerPath(manifest.generationId, loc.market, loc.chunk), []); return chunk.find((o) => o.id === id && isPublicOffer(o)) || null; }
export async function searchOffers(params: CatalogSearchParams) {
  const manifest = await readManifest(); const page = Math.max(1, Number(params.page || 1)); const pageSize = Math.min(48, Math.max(1, Number(params.pageSize || 24))); const { ids, used } = await candidateIds(manifest, params); const byId = await readIndex<{ byId: Record<string, OfferLocation> }>(manifest.generationId, "offers-by-id.json", { byId: {} });
  const order = await readIndex<{ ids: string[] }>(manifest.generationId, "order-updatedAt.json", { ids: Object.keys(byId.byId) }); let idList = ids ? order.ids.filter((id) => ids.has(id)) : order.ids;
  const hasRangeFilters = Boolean(params.budgetFrom || params.budgetTo || params.yearFrom || params.yearTo || params.mileageFrom || params.mileageTo || params.engineFrom || params.engineTo || params.powerFrom || params.powerTo || params.transmission || params.auctionGrade || (params.sort && params.sort !== "updatedAt"));
  let total = idList.length; let pageIds = idList.slice((page - 1) * pageSize, page * pageSize);
  if (hasRangeFilters) pageIds = idList;
  const pageSet = new Set(pageIds); const chunkKeys = new Map<string, OfferLocation>(); for (const id of pageIds) { const loc = byId.byId[id]; if (loc) chunkKeys.set(`${loc.market}/${loc.chunk}`, loc); }
  const loaded = (await Promise.all([...chunkKeys.values()].map((loc) => readDataJson<VehicleOffer[]>(offerPath(manifest.generationId, loc.market, loc.chunk), [])))).flat();
  let items = loaded.filter((o) => pageSet.has(o.id) && isPublicOffer(o));
  if (hasRangeFilters) { items = items.filter((o) => (!params.budgetFrom || (o.totalRub || 0) >= params.budgetFrom) && (!params.budgetTo || (o.totalRub || Infinity) <= params.budgetTo) && (!params.yearFrom || o.year >= params.yearFrom) && (!params.yearTo || o.year <= params.yearTo) && (!params.mileageFrom || (o.mileageKm || 0) >= params.mileageFrom) && (!params.mileageTo || (o.mileageKm || 0) <= params.mileageTo) && (!params.engineFrom || (o.engineCc || 0) >= params.engineFrom) && (!params.engineTo || (o.engineCc || Infinity) <= params.engineTo) && (!params.powerFrom || (o.powerHp || 0) >= params.powerFrom) && (!params.powerTo || (o.powerHp || Infinity) <= params.powerTo) && (!params.transmission || o.transmission === params.transmission) && (!params.auctionGrade || o.auctionGrade === params.auctionGrade)); const sort = params.sort || "updatedAt"; items.sort((a,b) => sort === "totalRub" ? (a.totalRub ?? Infinity) - (b.totalRub ?? Infinity) : sort === "year" ? b.year - a.year : sort === "mileage" ? (a.mileageKm || 0) - (b.mileageKm || 0) : String(b.auctionDate || b.updatedAt).localeCompare(String(a.auctionDate || a.updatedAt))); total = items.length; items = items.slice((page-1)*pageSize, page*pageSize); } else { const rank = new Map(pageIds.map((id, index) => [id, index])); items.sort((a,b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)); }
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
    const checksum = crypto.createHash("sha256").update(buf).digest("hex"); const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg"; const imageId = checksum.slice(0, 32); const objectKey = `catalog/images/${market}/${checksum}.${ext}`; const storage = getJsonStorage(); if (!(await storage.binaryExists?.(objectKey))) await storage.putBinary?.(objectKey, buf, mimeType, { ifNoneMatch: "*" }); return { id: imageId, objectKey, url: publicImageUrl(imageId, objectKey), size: buf.length, checksum, mimeType };
  } finally { clearTimeout(timeout); }
}
export async function readCatalogImage(imageId: string) { const manifest = await readManifest(); const index = await readIndex<{ imagesById: Record<string, { objectKey: string; mimeType: string; checksum: string; size: number }> }>(manifest.generationId, "images-by-id.json", { imagesById: {} }); const meta = index.imagesById[imageId]; if (!meta) return null; const binary = await getJsonStorage().getBinary?.(meta.objectKey); return binary ? { ...binary, mimeType: binary.mimeType || meta.mimeType, checksum: meta.checksum, size: meta.size } : null; }
