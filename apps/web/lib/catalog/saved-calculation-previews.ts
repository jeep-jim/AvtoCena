import {getJsonStorage,mutateDataJson,readDataJson} from "../data";
import {validateCustomerParameters} from "./customer-parameters";
import {matchingSavedCalculation,type SavedOfferCalculation} from "./saved-offer-calculation";
import type {VehicleOffer} from "./types";
import type {SavedCalculationPreview} from "./saved-calculation-preview";
import {DetailReadCache} from "./detail-read-cache";

export const SAVED_PREVIEW_PATH="offer-calculation-previews/current.json";
type Entry={market:string;sourceId:string;sourceOfferId:string;identity:string;savedAt:string;preview:SavedCalculationPreview};
type Index={version:1;entries:Record<string,Entry>};
// One compact read per rendered batch, shared across simultaneous rails. No per-card reads.
const cache=new DetailReadCache<Index>({maxEntries:1,maxBytes:8*1024*1024,ttlMs:1000,concurrency:1});
export function savedPreviewEntry(record:SavedOfferCalculation,offer:VehicleOffer):Entry|null {
 if(!matchingSavedCalculation(record,offer) || !Number.isFinite(record.calculation.totalRub))return null;
 try {
  const parameters=validateCustomerParameters(record.draft);
  return {market:offer.market,sourceId:offer.sourceId,sourceOfferId:offer.sourceOfferId,identity:record.identity,savedAt:record.savedAt,
   preview:{version:record.version,totalRub:record.calculation.totalRub!,parameters,
    currencyRate:record.calculation.currencyRate,utilizationPowerKw:record.calculation.customs?.utilizationPowerKw,deliveryCity:record.draft.deliveryCity||""}};
 } catch {return null;}
}
export async function rebuildSavedPreviewIndex():Promise<Index> {
 const storage=getJsonStorage();
 if(!storage.listObjects)throw Error("saved_preview_listing_unavailable");
 const files=(await storage.listObjects("offer-calculations")).filter(x=>/^offer-calculations\/[a-f0-9]{64}\.json$/.test(x.key));
 const entries:Record<string,Entry>={};
 const {getOfferFromCurrentShard}=await import("./storage");
 const green=files.length?await storage.readJson<{items:VehicleOffer[]}>("catalog/green-corner/current.json",{items:[]}):{items:[]};
 let cursor=0;
 await Promise.all(Array.from({length:Math.min(4,files.length)},async()=>{
  while(cursor<files.length){
   const file=files[cursor++];
   const record=await storage.readJson<SavedOfferCalculation|null>(file.key,null);
   if(!record?.offerId)continue;
   const offer=/^green-\d+$/.test(record.offerId)?green.items.find(o=>o.id===record.offerId):await getOfferFromCurrentShard(record.offerId);
   const entry=offer?savedPreviewEntry(record,offer):null;
   if(entry)entries[record.offerId]=entry;
  }
 }));
 // A concurrent save wins over older records seen during the one-time migration.
 return mutateDataJson<Index>(SAVED_PREVIEW_PATH,{version:1,entries:{}},current=>({version:1,entries:{...entries,...current.entries}}));
}
export async function readSavedPreviewIndex() {
 return cache.get("current",async()=>await readDataJson<Index>(SAVED_PREVIEW_PATH,{version:1,entries:{}}));
}
export async function publishSavedCalculationPreview(record:SavedOfferCalculation,offer:VehicleOffer) {
 const entry=savedPreviewEntry(record,offer);if(!entry)throw Error("invalid_saved_preview");
 await mutateDataJson<Index>(SAVED_PREVIEW_PATH,{version:1,entries:{}},current=>{
  const prior=current.entries[offer.id];
  if(prior && prior.savedAt>entry.savedAt)return current;
  return {version:1,entries:{...current.entries,[offer.id]:entry}};
 });
 cache.clear();
}
export function attachSavedPreviewEntries<T extends Partial<VehicleOffer>>(offers:T[],index:Index):T[] {
 return offers.map(offer=>{
  const entry=offer.id?index.entries[offer.id]:undefined;
  const source=offer.sourceId||(offer as any).sourceGroup;
  if(!entry || offer.market!==entry.market || source&&source!==entry.sourceId
   || offer.sourceOfferId&&offer.sourceOfferId!==entry.sourceOfferId)return offer;
  return {...offer,savedCalculationPreview:entry.preview};
 });
}
export async function attachSavedCalculationPreviews<T extends Partial<VehicleOffer>>(offers:T[]):Promise<T[]> {
 if(!offers.length)return offers;
 const index=await readSavedPreviewIndex();
 return attachSavedPreviewEntries(offers,index);
}
