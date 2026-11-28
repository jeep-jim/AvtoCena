import {createHash} from 'node:crypto';
import type {AjesPublicEvidenceSnapshot} from './ajes-public';
import type {VehicleOffer} from './types';
import type {CatalogEditorialIndex} from './editorial';
import type {ManagementKnowledge} from './management-knowledge';

type PreviewIndex={version:1;entries:Record<string,{market:string;sourceId:string;sourceOfferId:string;[key:string]:unknown}>};
export type AjesCountPricingInputs={
 runtimeSha:string;day:string;editorial:CatalogEditorialIndex;calculationDigest:string|null;
 configuration:unknown;rates:unknown;knowledge:ManagementKnowledge;previews:PreviewIndex;
};
export type AjesCountPricingContext={
 digest:string;correctionIds:readonly string[];
 run<T>(work:()=>Promise<T>):Promise<T>;
 price<T extends Partial<VehicleOffer>>(offers:T[]):Promise<T[]>;
 assertCurrent():Promise<void>;
};
const ajesId=/^ajes-stats-([A-Za-z0-9_-]{1,64})$/;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity=(id:string,entry:{market?:string;sourceId?:string;sourceOfferId?:string})=>
 ajesId.test(id)&&entry.market==='japan'&&entry.sourceId==='ajes_japan_feed'&&entry.sourceOfferId===id.slice('ajes-stats-'.length);

/** The only listing identities needed by a census are already recorded local
 * exceptions. This never obtains an inventory ID directory from the supplier. */
export function ajesPricingCorrectionIds(inputs:Pick<AjesCountPricingInputs,'editorial'|'knowledge'|'previews'>):readonly string[]{
 const ids=new Set<string>();
 for(const [id,entry] of Object.entries(inputs.editorial.entries))if(identity(id,entry))ids.add(id);
 for(const [id,entry] of Object.entries(inputs.previews.entries))if(identity(id,entry))ids.add(id);
 for(const facts of Object.values(inputs.knowledge.models))for(const fact of Object.values(facts)){
  if(ajesId.test(fact.offerId))ids.add(fact.offerId);
  if(fact.targetOfferId&&ajesId.test(fact.targetOfferId))ids.add(fact.targetOfferId);
 }
 return Object.freeze([...ids].sort());
}
function contextDigest(inputs:AjesCountPricingInputs){
 return digest({version:1,runtimeSha:inputs.runtimeSha,day:inputs.day,editorial:inputs.editorial,
  calculationDigest:inputs.calculationDigest,configuration:inputs.configuration,rates:inputs.rates,
  knowledge:inputs.knowledge,previews:inputs.previews});
}

/** Fence the actual readers used by the existing calculation code. We do not
 * override the shared FX clock or mutate pricing settings for a Japan request.
 * A changed input invalidates the whole count instead of mixing observations. */
export async function createAjesCountPricingContext(snapshot:AjesPublicEvidenceSnapshot,dependencies:{
 read():Promise<AjesCountPricingInputs>;
 price<T extends Partial<VehicleOffer>>(offers:T[],inputs:AjesCountPricingInputs):Promise<T[]>;
}):Promise<AjesCountPricingContext>{
 const inputs=await dependencies.read();
 const compatible=(value:AjesCountPricingInputs)=>value.editorial.revision===snapshot.editorial.revision
  &&value.calculationDigest===(snapshot.calculationIndex?.digest??null);
 if(!compatible(inputs))throw Error('ajes_count_context_changed');
 const expected=contextDigest(inputs),correctionIds=ajesPricingCorrectionIds(inputs);
 let depth=0;
 const assertCurrent=async()=>{
  const current=await dependencies.read();
  if(!compatible(current)||contextDigest(current)!==expected)throw Error('ajes_count_context_changed');
 };
 return Object.freeze({digest:expected,correctionIds,assertCurrent,
  async run<T>(work:()=>Promise<T>):Promise<T>{
   await assertCurrent();depth++;
   try{const result=await work();await assertCurrent();return result;}finally{depth--;}
  },
  async price<T extends Partial<VehicleOffer>>(offers:T[]):Promise<T[]>{
   if(!depth)throw Error('ajes_count_price_outside_context');
   if(offers.some(offer=>!offer.id||!identity(offer.id,offer)||!offer.operational?.raw))throw Error('ajes_count_price_identity');
   return dependencies.price(offers,inputs);
  },
 });
}

/** Same calculation stages as ordinary AJ cards, using the complete records
 * already supplied to this batch. Saved calculations are replayed from local
 * records, so a count never causes one extra supplier detail request per car. */
export async function priceAjesCountOffers<T extends Partial<VehicleOffer>>(offers:T[],inputs:AjesCountPricingInputs):Promise<T[]>{
 if(!offers.length)return offers;
 const [{applyActiveBusinessPriceBatch},{applyEncyclopediaDisplayIdentityBatch},
  {getSavedOfferCalculation},{savedPreviewEntry},{attachJapanDeliveredPreviews},{attachManagementPreviews}]=await Promise.all([
  import('./live-business-pricing'),import('./display-identity'),import('./saved-offer-calculation'),
  import('./saved-calculation-previews'),import('./japan-delivered-preview'),import('./management-previews'),
 ]);
 const markets=[{id:'japan',effectiveVersion:inputs.configuration}] as any;
 const priced=await applyActiveBusinessPriceBatch(offers,{},markets);
 const identified=await applyEncyclopediaDisplayIdentityBatch(priced as any[]) as T[];
 const saved=[...identified];let cursor=0;
 await Promise.all(Array.from({length:Math.min(4,saved.length)},async()=>{
  while(cursor<saved.length){
   const at=cursor++,offer=saved[at],entry=offer.id?inputs.previews.entries[offer.id]:undefined;
   if(!entry||!offer.id||!identity(offer.id,entry))continue;
   const record=await getSavedOfferCalculation(offer as VehicleOffer,undefined,inputs.knowledge);
   const preview=record?savedPreviewEntry(record,offer as VehicleOffer)?.preview:undefined;
   if(preview)saved[at]={...offer,savedCalculationPreview:preview};
  }
 }));
 const japan=await attachJapanDeliveredPreviews(saved,inputs.configuration);
 const result=[...japan];cursor=0;
 // Legacy management enrichment has a per-batch candidate bound. Evaluate
 // each identity independently so group and page composition cannot alter a
 // budget predicate. Concurrency stays bounded; every record remains inline.
 await Promise.all(Array.from({length:Math.min(4,result.length)},async()=>{
  while(cursor<result.length){const at=cursor++;result[at]=(await attachManagementPreviews([japan[at]],markets))[0];}
 }));
 return result;
}

export async function captureAjesCountPricingContext(snapshot:AjesPublicEvidenceSnapshot):Promise<AjesCountPricingContext>{
 const [{readCatalogEditorial},{readCalculationIndex},{getEffectiveMarketVersion},{convertToRub,catalogPricingNow},
  {readManagementKnowledge},{readDataJson},{SAVED_PREVIEW_PATH}]=await Promise.all([
  import('./editorial'),import('../encyclopedia/calculation-index'),import('../effective-market-settings'),import('./rates'),
  import('./management-knowledge'),import('../data'),import('./saved-calculation-previews'),
 ]);
 const read=async():Promise<AjesCountPricingInputs>=>{
  const [editorial,configuration,knowledge,allPreviews]=await Promise.all([
   readCatalogEditorial(),getEffectiveMarketVersion('japan'),readManagementKnowledge(),
   readDataJson<PreviewIndex>(SAVED_PREVIEW_PATH,{version:1,entries:{}}),
  ]);
  const previews:PreviewIndex={version:1,entries:Object.fromEntries(Object.entries(allPreviews.entries).filter(([id,entry])=>identity(id,entry)))};
  const currencies=[...new Set(['JPY','EUR','USD','RUB',...Object.entries(editorial.entries)
   .filter(([id,entry])=>identity(id,entry)).flatMap(([,entry])=>entry.sellerPrice?[entry.sellerPrice.currency]:[])])].sort();
  const rates=await Promise.all(currencies.map(async currency=>{
   const rate=await convertToRub(1,currency);
   if(!rate)return [currency,null];
   const {fetchedAt:_fetchedAt,...value}=rate;
   return [currency,value,Math.abs(catalogPricingNow()-Date.parse(rate.rateDate))<=4*86400000];
  }));
  return {runtimeSha:process.env.AVTOCENA_RELEASE_SHA||'',day:new Date(catalogPricingNow()).toISOString().slice(0,10),
   editorial,calculationDigest:readCalculationIndex()?.digest??null,configuration,rates,knowledge,previews};
 };
 return createAjesCountPricingContext(snapshot,{read,price:priceAjesCountOffers});
}
