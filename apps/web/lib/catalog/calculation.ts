import { calculateAvtocenaFromBusinessConfig } from "../../../../packages/engine/src/calculation/calculateAvtocena";
import { readDataJson } from "../data";
import type { VehicleOffer } from "./types";
import type { MarketBusinessConfig } from "../../../../packages/engine/src/types";
type MarketRow = MarketBusinessConfig & { id:string };
export function calculateOfferSnapshot(offer: VehicleOffer){ const markets=readDataJson<MarketRow[]>("markets/markets.json", []); const marketConfig=markets.find(m=>m.id===offer.market) || {id:`${offer.market}-default`, currency: offer.currency}; const result=calculateAvtocenaFromBusinessConfig({ marketId: offer.market, marketConfig, carPriceRub: offer.priceLocal }); return { settingsVersion: result.configVersion, calculatedAt: new Date().toISOString(), exchangeRate: 1, sourcePriceLocal: offer.priceLocal, totalRub: result.totalRub, lines: result.breakdown.map(({id,title,amountRub})=>({id,title,amountRub})) }; }
