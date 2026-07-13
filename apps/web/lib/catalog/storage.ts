import { readDataJson } from "../data";
import type { MarketId, VehicleOffer } from "./types";
const markets: MarketId[] = ["china", "japan", "korea", "uae", "europe"];
export function readMarketOffers(market: MarketId){ const manifest = readDataJson<{chunks:{file:string;count:number}[]}>(`catalog/offers/${market}/manifest.json`, { chunks: [] }); return manifest.chunks.flatMap((chunk)=>readDataJson<VehicleOffer[]>(`catalog/offers/${market}/${chunk.file}`, [])); }
export function readAllMarketOffers(){ return markets.flatMap(readMarketOffers); }
