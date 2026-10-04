import {isGreenCornerOffer} from "./green-corner-contract";
import {getSavedOfferCalculation} from "./saved-offer-calculation";
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
const cache=new DetailReadCache<Index>({maxEntries:1,maxBytes:8*1024*1024,ttlMs:60000,concurrency:1});
export function savedPreviewEntry(record:SavedOfferCalculation,offer:VehicleOffer):Entry|null {
 if(record.draft.deliveryCity || !matchingSavedCalculation(record,offer) || !Number.isFinite(record.calculation.totalRub))return null;
 try {
  const parameters=validateCustomerParameters(record.draft);
  return {market:offer.market,sourceId:offer.sourceId,sourceOfferId:offer.sourceOfferId,identity:record.identity,savedAt:record.savedAt,
   preview:{depositCostIncluded:record.calculation.breakdown?.some(line=>line.id==="contract-services"),version:record.version,totalRub:record.calculation.totalRub!,parameters,
    deliveryPricingBasis:record.calculation.deliveryPricingBasis,currencyRate:record.calculation.currencyRate,utilizationPowerKw:record.calculation.customs?.utilizationPowerKw,deliveryCity:record.draft.deliveryCity||""}};
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
   const publicRecord=offer?await getSavedOfferCalculation(offer):null;
   const entry=offer && publicRecord?savedPreviewEntry(publicRecord,offer):null;
   if(entry)entries[record.offerId]=entry;
  }
 }));
 // A concurrent save wins over older records seen during the one-time migration.
 return mutateDataJson<Index>(SAVED_PREVIEW_PATH,{version:1,entries:{}},current=>({version:1,entries:{...entries,...current.entries}}));
}
const refreshedEntries=new DetailReadCache<Entry|null>({maxEntries:512,maxBytes:4*1024*1024,ttlMs:60000,concurrency:4});
export async function readSavedPreviewIndex(requestedIds?:string[]) {
 const index=await cache.get("current",()=>readDataJson<Index>(SAVED_PREVIEW_PATH,{version:1,entries:{}}));
 const ids=[...new Set(requestedIds||Object.keys(index.entries))].filter(id=>index.entries[id]);
 const entries:Record<string,Entry>={};
 if(ids.length){
  const {getOfferFromCurrentShard}=await import("./storage");
  const {getGreenCornerOffer}=await import("./green-corner");
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{
   while(cursor<ids.length){
    const id=ids[cursor++],original=index.entries[id];
    const entry=await refreshedEntries.get(id+':'+original.savedAt,async()=>{
     const offer=/^green-\d+$/.test(id)?await getGreenCornerOffer(id):await getOfferFromCurrentShard(id);
     if(!offer)return null;
     const record=await getSavedOfferCalculation(offer);
     return record?savedPreviewEntry(record,offer):null;
    });
    if(entry)entries[id]=entry;
   }
  }));
 }
 return {...index,entries};
}
export async function publishSavedCalculationPreview(record:SavedOfferCalculation,offer:VehicleOffer) {
 const entry=savedPreviewEntry(record,offer);if(!entry)throw Error("invalid_saved_preview");
 await mutateDataJson<Index>(SAVED_PREVIEW_PATH,{version:1,entries:{}},current=>{
  const prior=current.entries[offer.id];
  if(prior && prior.savedAt>entry.savedAt)return current;
  return {version:1,entries:{...current.entries,[offer.id]:entry}};
 });
 cache.clear();
 refreshedEntries.clear();
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
 const index=await readSavedPreviewIndex(offers.flatMap(offer=>offer.id?[offer.id]:[]));
 const attached=attachSavedPreviewEntries(offers,index);
 return Promise.all(attached.map(async offer=>{
  if(!isGreenCornerOffer(offer) || !(offer as any).savedCalculationPreview)return offer;
  const record=await getSavedOfferCalculation(offer as VehicleOffer);
  return {...offer,savedCalculationPreview:record?savedPreviewEntry(record,offer as VehicleOffer)?.preview:undefined};
 }));
}
