import fs from "node:fs";
import path from "node:path";
import { getDataRoot, readDataJson } from "../data";
import type { MarketId, VehicleOffer } from "./types";
import { isPublicCatalogOffer } from "./public";
export const catalogMarkets: MarketId[] = ["china", "japan", "korea", "uae", "europe"];
export const MAX_RECORDS_PER_CHUNK = 500;

type Manifest = { market: MarketId; maxRecordsPerChunk: number; total: number; chunks: { file: string; count: number }[]; updatedAt: string };
function atomicWriteJson(relativePath: string, value: unknown) { const file=path.join(getDataRoot(), relativePath); fs.mkdirSync(path.dirname(file), { recursive:true }); const tmp=`${file}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2)); fs.renameSync(tmp, file); }
export function readMarketManifest(market: MarketId){ return readDataJson<Manifest>(`catalog/offers/${market}/manifest.json`, { market, maxRecordsPerChunk: MAX_RECORDS_PER_CHUNK, total:0, chunks:[], updatedAt:"" }); }
export function readMarketOffers(market: MarketId){ const manifest=readMarketManifest(market); return manifest.chunks.flatMap((chunk)=>readDataJson<VehicleOffer[]>(`catalog/offers/${market}/${chunk.file}`, [])); }
export function readAllMarketOffers(){ return catalogMarkets.flatMap(readMarketOffers); }
export function writeMarketOffers(market: MarketId, offers: VehicleOffer[], now = new Date().toISOString()) { const chunks: Manifest["chunks"] = []; for (let offset=0; offset<Math.max(1, Math.ceil(offers.length / MAX_RECORDS_PER_CHUNK)); offset++) { const part=offers.slice(offset*MAX_RECORDS_PER_CHUNK, (offset+1)*MAX_RECORDS_PER_CHUNK); const file=`chunk-${String(offset+1).padStart(4,"0")}.json`; atomicWriteJson(`catalog/offers/${market}/${file}`, part); chunks.push({ file, count: part.length }); } atomicWriteJson(`catalog/offers/${market}/manifest.json`, { market, maxRecordsPerChunk: MAX_RECORDS_PER_CHUNK, total: offers.length, chunks, updatedAt: now }); }
export function writeAllMarketOffers(offers: VehicleOffer[], now = new Date().toISOString()) { for (const market of catalogMarkets) writeMarketOffers(market, offers.filter((offer)=>offer.market===market), now); }
export function upsertMarketOffers(nextOffers: VehicleOffer[]) { const byId = new Map(readAllMarketOffers().map((offer)=>[offer.id, offer])); for (const offer of nextOffers) byId.set(offer.id, offer); writeAllMarketOffers([...byId.values()]); }
export function buildFeaturedOffers(limit = 24) { return readAllMarketOffers().filter(isPublicCatalogOffer).slice(0, limit).map((offer)=>({ id: offer.id, market: offer.market, brand: offer.brand, model: offer.model, trim: offer.trim, year: offer.advertisedModelYear || offer.year, mileageKm: offer.mileageKm, bodyType: offer.bodyType, engineCc: offer.engineCc, advertisedPower: offer.advertisedPower, sourceName: offer.sourceName, sourceUrl: offer.sourceUrl, sourcePriceLocal: offer.priceLocal, sourceCurrency: offer.currency, sourcePriceRub: offer.calculationSnapshot?.sourcePriceRub || null, totalRub: offer.calculationComplete ? offer.calculationSnapshot?.totalRub || null : null, calculationStatus: offer.calculationStatus, calculationComplete: offer.calculationComplete, lines: offer.calculationSnapshot?.lines || [], knownCostRub: offer.calculationSnapshot?.sourcePriceRub || null, lastCheckedAt: offer.lastCheckedAt, imageMode: offer.imageMode })); }
export function writeFeaturedOffers() { atomicWriteJson("catalog/featured-offers.json", buildFeaturedOffers()); }
