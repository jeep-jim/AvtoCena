import crypto from "node:crypto";
import { getJsonStorage, readDataJson, StorageConflictError } from "../data";
import type { CatalogImage, CatalogMarket, CatalogSearchParams, PublicVehicleOffer, VehicleOffer } from "./types";

const MARKETS: CatalogMarket[] = ["japan", "korea", "china", "uae", "europe"];
const IMAGE_MAX_BYTES = Number(process.env.CATALOG_IMAGE_MAX_BYTES || 8_000_000);
const INTERNAL_CATALOG_PATH = "catalog/internal/offers.json";
const ALLOWED_IMAGE_HOSTS = [/encar\.com$/i, /che168\.com$/i, /autohome\.com\.cn$/i, /beforward\.jp$/i, /bf\.jp$/i, /cloudfront\.net$/i, /img\.avtocena\.com$/i];
export const CATALOG_CHUNK_SIZE = 500;
export type OfferLocation = { market: CatalogMarket; chunk: string };
export type CatalogManifest = { version: 2; generationId: string; updatedAt: string; markets: Record<string, { count: number; chunks: string[]; updatedAt: string }> };

export function publicOffer(offer: VehicleOffer): PublicVehicleOffer { const { operational, vin, frameNumber, sourceId, ...dto } = offer as any; return { ...dto, images: offer.images.map((img) => ({ id: img.id, url: img.url, width: img.width, height: img.height, size: img.size, mimeType: img.mimeType })) } as any; }
export function stableOfferId(sourceId: string, sourceOfferId: string) { return crypto.createHash("sha256").update(`${sourceId}:${sourceOfferId}`).digest("hex").slice(0, 24); }
export function publicImageUrl(imageId: string, objectKey: string) { const cdn = process.env.CATALOG_IMAGE_CDN_URL?.replace(/\/+$/g, ""); return cdn ? `${cdn}/${objectKey}` : `/api/catalog/images/${imageId}`; }
function cleanShard(value?: string | number) { return String(value || "unknown").toLowerCase().replace(/[^a-z0-9а-яё-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "unknown"; }
function budgetBucket(v?: number | null) { if (!v) return "unknown"; return String(Math.ceil(v / 500_000) * 500_000); }
function generationPath(generationId: string, rel: string) { return `catalog/generations/${generationId}/${rel}`; }
export function offerPath(generationId: string, market: string, chunk: string) { return generationPath(generationId, `offers/${market}/${chunk}.json`); }
export function chunkName(index: number) { return `chunk-${String(index).padStart(4, "0")}`; }
async function readManifest(): Promise<CatalogManifest> { return readDataJson<CatalogManifest>("catalog/manifest.json", { version: 2, generationId: "empty", updatedAt: "", markets: {} }); }
async function readIndex<T>(generationId: string, path: string, fallback: T) { return readDataJson<T>(generationPath(generationId, `indexes/${path}`), fallback); }
async function writeJsonAtomic(path: string, value: unknown, ifNoneMatch = true) { const storage = getJsonStorage(); try { await storage.writeJson(path, value, ifNoneMatch ? { ifNoneMatch: "*" } : undefined); } catch (e) { if (e instanceof StorageConflictError && ifNoneMatch) return; throw e; } }
export async function readMarketOffers(market: string) { const manifest = await readManifest(); const chunks: string[] = manifest.markets?.[market]?.chunks || []; const lists = await Promise.all(chunks.map((c) => readDataJson<VehicleOffer[]>(offerPath(manifest.generationId, market, c), []))); return lists.flat(); }
export async function readAllOffersForMaintenance() { return readDataJson<VehicleOffer[]>(INTERNAL_CATALOG_PATH, []); }
export const readAllOffers = readAllOffersForMaintenance;
function isPublicOffer(o: VehicleOffer) { return o.status === "active" && o.images.length > 0 && Boolean(o.totalRub || o.calculationStatus === "needs_data" || o.calculationStatus === "auction_start"); }
async function writeIndexShard(generationId: string, name: string, key: string, ids: string[]) { await writeJsonAtomic(generationPath(generationId, `indexes/${name}/${cleanShard(key)}.json`), { generationId, updatedAt: new Date().toISOString(), ids }); }
export async function persistCatalogOffers(nextOffers: VehicleOffer[]) {
  const storage = getJsonStorage();
  await storage.writeJson(INTERNAL_CATALOG_PATH, nextOffers);
  const generationId = `gen_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
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
  const maps: Record<string, Map<string, string[]>> = { market: new Map(), make: new Map(), model: new Map(), year: new Map(), budget: new Map(), fuel: new Map(), body: new Map(), drive: new Map(), hasPrice: new Map() };
  for (const o of offers) {
    const pairs = { market: o.market, make: o.make, model: `${o.make}:${o.model}`, year: o.year, budget: budgetBucket(o.totalRub), fuel: o.fuel, body: o.bodyType, drive: o.drive, hasPrice: o.totalRub ? "yes" : "no" };
    for (const [name, key] of Object.entries(pairs)) { const m = maps[name]; const k = cleanShard(key); m.set(k, [...(m.get(k) || []), o.id]); }
  }
  await writeJsonAtomic(generationPath(generationId, "indexes/offers-by-id.json"), { generationId, byId });
  await writeJsonAtomic(generationPath(generationId, "indexes/images-by-id.json"), { generationId, imagesById });
  await writeJsonAtomic(generationPath(generationId, "indexes/facets.json"), { generationId, makes: [...maps.make.keys()].sort(), models: [...maps.model.keys()].sort() });
  await Promise.all(Object.entries(maps).flatMap(([name, map]) => [...map.entries()].map(([key, ids]) => writeIndexShard(generationId, name, key, ids))));
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
  let idList = ids ? [...ids] : Object.keys(byId.byId); const chunkKeys = new Map<string, OfferLocation>(); for (const id of idList) { const loc = byId.byId[id]; if (loc) chunkKeys.set(`${loc.market}/${loc.chunk}`, loc); }
  const loaded = (await Promise.all([...chunkKeys.values()].map((loc) => readDataJson<VehicleOffer[]>(offerPath(manifest.generationId, loc.market, loc.chunk), [])))).flat();
  let items = loaded.filter((o) => idList.includes(o.id) && isPublicOffer(o));
  items = items.filter((o) => (!params.budgetTo || (o.totalRub || Infinity) <= params.budgetTo) && (!params.yearFrom || o.year >= params.yearFrom) && (!params.yearTo || o.year <= params.yearTo) && (!params.mileageTo || (o.mileageKm || 0) <= params.mileageTo) && (!params.engineFrom || (o.engineCc || 0) >= params.engineFrom) && (!params.engineTo || (o.engineCc || Infinity) <= params.engineTo) && (!params.powerFrom || (o.powerHp || 0) >= params.powerFrom) && (!params.transmission || o.transmission === params.transmission) && (!params.auctionGrade || o.auctionGrade === params.auctionGrade));
  const sort = params.sort || "updatedAt"; items.sort((a,b) => sort === "totalRub" ? (a.totalRub ?? Infinity) - (b.totalRub ?? Infinity) : sort === "year" ? b.year - a.year : sort === "mileage" ? (a.mileageKm || 0) - (b.mileageKm || 0) : String(b.auctionDate || b.updatedAt).localeCompare(String(a.auctionDate || a.updatedAt)));
  return { generationId: manifest.generationId, total: items.length, page, pageSize, items: items.slice((page-1)*pageSize, page*pageSize).map(publicOffer), usedIndexShards: used.length ? used : [`catalog/generations/${manifest.generationId}/indexes/offers-by-id.json`] };
}
function isPrivateHost(hostname: string) { const h = hostname.toLowerCase(); if (["localhost", "0.0.0.0"].includes(h)) return true; if (/^(127\.|10\.|169\.254\.|192\.168\.)/.test(h)) return true; const m = h.match(/^172\.(\d+)\./); if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true; return h === "metadata.google.internal" || h === "169.254.169.254"; }
export function assertSafeImageUrl(rawUrl: string) { const parsed = new URL(rawUrl); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("image_url_protocol_blocked"); if (isPrivateHost(parsed.hostname)) throw new Error("image_url_private_host_blocked"); if (!ALLOWED_IMAGE_HOSTS.some((re) => re.test(parsed.hostname))) throw new Error("image_url_host_not_allowed"); return parsed.toString(); }
export async function cacheImageFromUrl(url: string, market: string, init?: RequestInit): Promise<CatalogImage | null> {
  let safeUrl: string; try { safeUrl = assertSafeImageUrl(url); } catch { return null; }
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_IMAGE_TIMEOUT_MS || 12000));
  try {
    const res = await fetch(safeUrl, { ...init, signal: controller.signal, redirect: "manual" }); if (!res.ok) return null; const mimeType = res.headers.get("content-type") || ""; if (!/^image\/(jpeg|png|webp)$/.test(mimeType)) return null;
    const len = Number(res.headers.get("content-length") || 0); if (len > IMAGE_MAX_BYTES) return null; const buf = Buffer.from(await res.arrayBuffer()); if (!buf.length || buf.length > IMAGE_MAX_BYTES) return null;
    const checksum = crypto.createHash("sha256").update(buf).digest("hex"); const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg"; const imageId = checksum.slice(0, 32); const objectKey = `catalog/images/${market}/${checksum}.${ext}`; const storage = getJsonStorage(); if (!(await storage.binaryExists?.(objectKey))) await storage.putBinary?.(objectKey, buf, mimeType, { ifNoneMatch: "*" }); return { id: imageId, objectKey, url: publicImageUrl(imageId, objectKey), size: buf.length, checksum, mimeType };
  } finally { clearTimeout(timeout); }
}
export async function readCatalogImage(imageId: string) { const manifest = await readManifest(); const index = await readIndex<{ imagesById: Record<string, { objectKey: string; mimeType: string; checksum: string; size: number }> }>(manifest.generationId, "images-by-id.json", { imagesById: {} }); const meta = index.imagesById[imageId]; if (!meta) return null; const binary = await getJsonStorage().getBinary?.(meta.objectKey); return binary ? { ...binary, mimeType: binary.mimeType || meta.mimeType, checksum: meta.checksum, size: meta.size } : null; }
