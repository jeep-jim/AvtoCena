import {withCatalogEditorial,applyCatalogEditorial,editorialHidden} from './editorial';
import { createHash } from "node:crypto";
import { DetailReadCache } from "./detail-read-cache";
import { withGreenCornerFuel } from "./green-corner-fuel";
import { getJsonStorage } from "../data";
import type { VehicleOffer } from "./types";
import { isGreenCornerOffer } from "./green-corner-contract";
import { greenCornerNeedsFullPricing,greenCornerPageSelection,type GreenFilters } from "./green-corner-search";
import { applyEncyclopediaDisplayIdentityBatch } from "./display-identity";
export const GREEN_CORNER_PATH="catalog/green-corner/current.json";
export type GreenCornerSnapshot={version:1;updatedAt:string;sourceCount:number;items:VehicleOffer[]};
const stockSnapshot = new DetailReadCache<GreenCornerSnapshot>({maxEntries:1,maxBytes:32*1024*1024,ttlMs:60_000,concurrency:1});
// One immutable validated snapshot per minute. Next's JSON cache parsed a new
// complete copy on every offer page even when the saved stock had not changed.
export const readGreenCorner = ():Promise<GreenCornerSnapshot>=>stockSnapshot.get(GREEN_CORNER_PATH,async()=>{
 const value=await getJsonStorage().readJson<GreenCornerSnapshot|null>(GREEN_CORNER_PATH,null);
 if(!value)return {version:1,updatedAt:"",sourceCount:0,items:[]};
 if(value.version!==1||!Array.isArray(value.items)||!value.items.every(isGreenCornerOffer))throw Error("green_invalid_snapshot");
 return {...value, items: value.items.map(withGreenCornerFuel)};
});
export async function getGreenCornerOffer(id:string){
 if(!/^green-\d+$/.test(id))return null;
 return (await readGreenCorner()).items.find(row=>row.id===id)||null;
}
export function publicGreenOffer(offer:VehicleOffer){const {operational,vin,frameNumber,...row}=offer;return row;}

export async function readGreenCornerPage(items:VehicleOffer[],params:GreenFilters,clampPage=true,pageSize=24) {
 return withCatalogEditorial(async()=>{
  const visible=items.filter(item=>!editorialHidden(item)).map(item=>applyCatalogEditorial(item));
  const current=await applyEncyclopediaDisplayIdentityBatch(visible);
  return greenCornerPageSelection(current.map(item=>applyCatalogEditorial(item)),params,async rows=>(await currentGreenCornerPrices(rows)).map(item=>applyCatalogEditorial(item)),clampPage,pageSize);
 });
}

const pricedStock = new DetailReadCache<VehicleOffer[]>({maxEntries:2,maxBytes:16*1024*1024,ttlMs:60_000,concurrency:1});

// Use the same current calculated rows for filtering, sorting and rendering.
// Preview calculations are cached and their concurrency is bounded in the shared pipeline.
export async function currentGreenCornerPrices(items:VehicleOffer[]):Promise<VehicleOffer[]> {
 const {applyActiveBusinessPricingBatch}=await import("./live-business-pricing");
 if(!items.length)return items;
 const [{getEffectiveMarketsWithDefaults},{readSavedPreviewIndex},{convertToRub},{greenCornerPaymentRate}]=await Promise.all([
  import("../effective-market-settings"),import("./saved-calculation-previews"),import("./rates"),import("./green-corner-payment-rate")
 ]);
 // Bind the complete list to the same inputs as the card calculations. A saved
 // scenario or settings/rate change invalidates the cache without waiting for TTL.
 const inputs=await Promise.all([getEffectiveMarketsWithDefaults(),readSavedPreviewIndex(items.map(item=>item.id)).catch(()=>null),
  convertToRub(1,"JPY"),convertToRub(1,"EUR"),greenCornerPaymentRate(items[0])]);
 const key=createHash("sha256").update(JSON.stringify([items,inputs,new Date().toISOString().slice(0,10)])).digest("hex");
 return pricedStock.get(key,()=>applyActiveBusinessPricingBatch(items));
}
