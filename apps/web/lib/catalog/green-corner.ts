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
