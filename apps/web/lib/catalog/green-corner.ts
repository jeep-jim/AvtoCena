import { unstable_cache } from "next/cache";
import { getJsonStorage } from "../data";
import type { VehicleOffer } from "./types";
import { isGreenCornerOffer } from "./green-corner-contract";
export const GREEN_CORNER_PATH="catalog/green-corner/current.json";
export type GreenCornerSnapshot={version:1;updatedAt:string;sourceCount:number;items:VehicleOffer[]};
export const readGreenCorner = unstable_cache(async ():Promise<GreenCornerSnapshot>=>{
 const value=await getJsonStorage().readJson<GreenCornerSnapshot|null>(GREEN_CORNER_PATH,null);
 if(!value)return {version:1,updatedAt:"",sourceCount:0,items:[]};
 if(value.version!==1||!Array.isArray(value.items)||!value.items.every(isGreenCornerOffer))throw Error("green_invalid_snapshot");
 return value;
},["green-corner-v1"],{revalidate:60});
export async function getGreenCornerOffer(id:string){
 if(!/^green-\d+$/.test(id))return null;
 return (await readGreenCorner()).items.find(row=>row.id===id)||null;
}
export function publicGreenOffer(offer:VehicleOffer){const {operational,vin,frameNumber,...row}=offer;return row;}

// One currency lookup for stock filters; only the visible page needs full display enrichment.
export async function currentGreenCornerPrices(items:VehicleOffer[]):Promise<VehicleOffer[]> {
 const {convertToRub}=await import("./rates");
 const rate=await convertToRub(1,"JPY").catch(()=>null);
 if(!rate || !["cbr","cbr_live"].includes(rate.rateSource) || !(rate.effectiveRate>0)
  || !Number.isFinite(Date.parse(rate.rateDate)) || Math.abs(Date.now()-Date.parse(rate.rateDate))>4*86400000)return items;
 return items.map(offer=>{const sourcePriceRub=Number(offer.sourcePrice)*rate.effectiveRate;return {...offer,sellerPriceRub:Math.round(sourcePriceRub),calculationSnapshot:{...offer.calculationSnapshot,sourcePriceRub:Math.round(sourcePriceRub),currencyRate:{...rate,sourcePrice:offer.sourcePrice,sourcePriceRub}}};});
}
