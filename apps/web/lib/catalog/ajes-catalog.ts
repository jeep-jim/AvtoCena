import {assertAjesJapanMarket,assertAjesJapanTable} from './ajes-access-policy';
import {sortCatalogRows} from './market-page';
import {parseCatalogSort} from './catalog-sort';
import {japanPreviewParameters} from './japan-preview-parameters';
import {readFilteredAjesPage,readPowerOrderedAjesPage,ajesPowerEvidenceEpoch,assertAjesPowerCursorEpoch} from './ajes-filtered-page';
import {resolveAjesMakeNames} from './ajes-make-resolution';
import 'server-only';
import {resolveAjesQueryModels} from './ajes-model-resolution';
import {ajesResultFilter} from './ajes-result-filter';
import {japanPowerFilterSummary,japanUnknownPower,japanLocalPowerHp,japanSupplierPower} from './japan-source-power';
import {safePublicPricing} from './safe-public-pricing';
import {withCatalogEditorialSnapshot} from './editorial';
import {applyActiveBusinessPricingBatch} from './live-business-pricing';
import {hasEncyclopediaCalculationEvidence} from '../encyclopedia/calculation-evidence';
import {assertCollectionEnabled} from './collection-controls';
import {headers} from 'next/headers';
import {cache} from 'react';
import {DetailReadCache} from './detail-read-cache';
import {ajesClient} from './ajes-runtime';
import {AjesUnavailable,readAjesModelDirectory,readAjesMakeDirectory} from './ajes-client';
import {readAjesPublic,cappedAjesQuery,readAjesPublicEvidenceSnapshot} from './ajes-public';
import {ajesCatalogQuery,AjesCursorRefreshRequired} from './ajes-query';
export {ajesCatalogQuery,AjesFilterUnavailable} from './ajes-query';
import {publicOffer} from './storage';
import type {AjesCountSummary} from './ajes-count-display';

const sourceMakes=cache(async(table:any)=>{
 assertAjesJapanTable(table);
 await assertCollectionEnabled('ajes_japan_feed');
 return readAjesMakeDirectory(ajesClient,await cappedAjesQuery({table}),(await headers()).get('x-real-ip')||'');
});
async function resolveMake(query:ReturnType<typeof ajesCatalogQuery>){
 if(!query.make)return {query,makeDirectoryUnavailable:false};
 try{
  const directory=await sourceMakes(query.table);
  return {query:{...query,make:resolveAjesMakeNames(query.make,directory.makes)},makeDirectoryUnavailable:Boolean(directory.stale)};
 }catch{
  // An exact source selection can still return useful saved/live rows. A legacy
  // display alias cannot establish zero inventory when its directory is missing.
  return {query,makeDirectoryUnavailable:true};
 }
}
const resolvedCatalogQuery=cache(async(key:string)=>{
 const params=JSON.parse(key);
 assertAjesJapanMarket(params.market);
 const {query,makeDirectoryUnavailable}=await resolveMake(ajesCatalogQuery(params));
 return {...await resolveAjesQueryModels(query,()=>readAjesDirectory({market:params.market,make:query.make})),makeDirectoryUnavailable};
});
export const readAjesCountSummary=cache(async(key='{}'):Promise<AjesCountSummary>=>{
 const params=JSON.parse(key);
 assertAjesJapanMarket(params.market);
 const filter=ajesResultFilter(params);
 if(filter.powerFilter){
  // Supplier COUNT cannot apply local overrides and the explicit unknown-power
  // inclusion rule. Do not spend a supplier request on an inexact power total.
  return {total:0,stale:false,observedAt:new Date().toISOString(),upperBound:true};
 }
 const resolved=await resolvedCatalogQuery(key);
 if(resolved.modelDirectoryUnavailable||resolved.makeDirectoryUnavailable)throw new AjesUnavailable('directory_unavailable');
 const q={...resolved.query};delete q.page;delete q.pageSize;delete q.sort;
 const result=await ajesClient.read(await cappedAjesQuery({...q,aggregate:'count'}),(await headers()).get('x-real-ip')||'');
 if(!Number.isSafeInteger(result.total)||result.total<0)throw Error('ajes_count_invalid');
 // Source COUNT precedes listing-bound admission (for example a verified bus
 // body or gross mass). Only a complete admitted page can establish an exact
 // visible total; the source aggregate remains a useful upper bound.
 return {total:result.total,stale:Boolean(result.stale),observedAt:result.observedAt,upperBound:result.total!==0};
});
export const readAjesCount=cache(async(key='{}'):Promise<number> => (await readAjesCountSummary(key)).total);
const directories=new DetailReadCache<any>({maxEntries:16,maxBytes:4*1024*1024,ttlMs:30*60000,concurrency:2,shouldCache:value=>!value.stale});
export const readAjesMakes=cache(async(key='{}')=>{
 const params=JSON.parse(key);assertAjesJapanMarket(params.market);
 const {query:q,makeDirectoryUnavailable}=await resolveMake(ajesCatalogQuery(params));delete q.page;delete q.pageSize;delete q.sort;
 const result=await readAjesMakeDirectory(ajesClient,await cappedAjesQuery(q),(await headers()).get('x-real-ip')||'');
 return makeDirectoryUnavailable?{...result,stale:true}:result;
});
export async function readAjesDirectory(params:Record<string,unknown>={}){
 assertAjesJapanMarket(params.market);
 const {query:q,makeDirectoryUnavailable}=await resolveMake(ajesCatalogQuery(params));delete q.page;delete q.pageSize;delete q.sort;
 await assertCollectionEnabled('ajes_japan_feed');
 const ip=(await headers()).get('x-real-ip')||'',key=JSON.stringify(q);
 const result=await directories.get(key,async()=>{
  const result=await readAjesModelDirectory(ajesClient,await cappedAjesQuery(q),ip);
  return makeDirectoryUnavailable?{...result,stale:true}:result;
 },ip+'\0'+key) as Awaited<ReturnType<typeof readAjesModelDirectory>>;
 return makeDirectoryUnavailable?{...result,stale:true}:result;
}
/** Related Japanese offers use the same source names as the catalogue. Keep
 * the full records here so admission/pricing can run before public projection.
 */
export async function readAjesResolvedPublic(params:Record<string,unknown>,options:Parameters<typeof readAjesPublic>[1]={}){
 assertAjesJapanMarket(params.market);
 const {query,modelDirectoryUnavailable,makeDirectoryUnavailable}=await resolvedCatalogQuery(JSON.stringify(params));
 const directoryUnavailable=modelDirectoryUnavailable||makeDirectoryUnavailable;
 const result=await readAjesPublic(query,options);
 if(directoryUnavailable&&!result.items.length)throw Object.assign(new AjesUnavailable('directory_unavailable'),result.sourceReceipt?{sourceReceipt:result.sourceReceipt}:{});
 return {...result,...(directoryUnavailable?{partial:true}:{})};
}
export async function readAjesCatalogPage(params:Record<string,unknown>,measure?:(stage:string,ms:number)=>void,options:{includeCount?:boolean}={}){
 assertAjesJapanMarket(params.market);
 const resolveStarted=performance.now();
 const filter=ajesResultFilter(params);
 const evidenceSnapshot=filter.powerFilter?await readAjesPublicEvidenceSnapshot():undefined;
 const evidenceEpoch=evidenceSnapshot?ajesPowerEvidenceEpoch({runtimeSha:process.env.AVTOCENA_RELEASE_SHA,
  editorialRevision:evidenceSnapshot.editorial.revision,calculationDigest:evidenceSnapshot.calculationIndex?.digest??null}):undefined;
 if(evidenceEpoch){
  const requested=ajesCatalogQuery(params);
  assertAjesPowerCursorEpoch({page:requested.page||1,pageSize:requested.pageSize||24,after:params.after,evidenceEpoch});
 }
 const checkEvidence=async()=>{
  if(!evidenceEpoch)return;
  const current=await readAjesPublicEvidenceSnapshot();
  if(ajesPowerEvidenceEpoch({runtimeSha:process.env.AVTOCENA_RELEASE_SHA,editorialRevision:current.editorial.revision,
   calculationDigest:current.calculationIndex?.digest??null})!==evidenceEpoch)throw new AjesCursorRefreshRequired();
 };
 const powerIdentity=(offer:any)=>JSON.stringify([japanLocalPowerHp(offer)??null,japanSupplierPower(offer)?.hp??null,japanUnknownPower(offer)]);
 const {query,modelDirectoryUnavailable,makeDirectoryUnavailable}=await resolvedCatalogQuery(JSON.stringify(params));
 const directoryUnavailable=modelDirectoryUnavailable||makeDirectoryUnavailable;
 // Delivered-price sorting is explicitly local to the loaded selection. Raw
 // auction FINISH is a different price: sorting that source first can replace
 // a populated power selection with pages of expensive, over-limit cars.
 // Keep the same candidate walk and local/manual power evidence; order its
 // admitted rows by the selected city's delivered price below. Other source
 // sort terms remain intact, and the cursor still binds the full UI query.
 const sourceTerms=filter.powerFilter?parseCatalogSort(query.sort):null;
 const sourceQuery=sourceTerms?.some(term=>term.startsWith('totalRub'))
  ?{...query,sort:sourceTerms.filter(term=>!term.startsWith('totalRub')).join(',')||undefined}:query;
 measure?.('query-resolution',performance.now()-resolveStarted);
 const startedAt=Date.now();
 const countStarted=performance.now();
 const sourceReceipts:unknown[]=[];
 let readyCount:AjesCountSummary|null=null;
 // Counts are optional metadata. Keep their bounded, shared request independent
 // of ready cards; a pending count must never occupy the list's critical path.
 // Pagination changes only the offset. Recounting here competes with the
 // requested list in the same two-slot supplier queue. The independent count
 // endpoint/header owns aggregate refresh; continuations need only their rows.
 if(options.includeCount!==false&&(query.page||1)===1&&!params.after&&!filter.powerFilter)void readAjesCountSummary(JSON.stringify(params)).then(value=>{readyCount=value;}).catch(()=>{}).finally(()=>measure?.('count',performance.now()-countStarted));
 const read=async(sourcePage:number,phase?:'k'|'u')=>{
  await checkEvidence();
  const received=await readAjesPublic({...sourceQuery,page:sourcePage},{measure,...(evidenceSnapshot?{evidenceSnapshot}:{})}).catch(error=>{
   if(error?.sourceReceipt)sourceReceipts.push(error.sourceReceipt);
   throw error;
  });
  if(received.sourceReceipt)sourceReceipts.push(received.sourceReceipt);
  if(directoryUnavailable&&!received.items.length)throw Object.assign(new AjesUnavailable('directory_unavailable'),received.sourceReceipt?{sourceReceipt:received.sourceReceipt}:{});
  // Apply local/manual and supplier discovery filters before delivered-price previews.
  // Non-matching cars never enter the expensive customs/management pipeline.
  // Classify the same safe power that the public projection can display. A
  // rejected legacy/local value must not enter K and turn unknown afterwards.
  const normalized=filter.powerFilter?received.items.map(offer=>safePublicPricing(offer)):received.items;
  const candidates=filter.powerFilter?normalized.filter(offer=>filter.matchesPower(offer)
   &&(!phase||japanUnknownPower(offer)===(phase==='u'))):received.items;
  const page={...received,items:candidates,...(directoryUnavailable?{partial:true}:{})};
  const powerBefore=evidenceSnapshot?new Map(page.items.map(offer=>[offer.id,powerIdentity(offer)])):null;
  const pricingStarted=performance.now();
  let priced=page.items;
  if(filter.priceFilter)priced=await applyActiveBusinessPricingBatch(page.items);
  else {
   // Only newly attested auction cards need the existing delivered-preview path.
   // Leave unmatched supplier rows on their current inexpensive path.
   const matched=page.items.filter(v=>{if(v.powerHp!=null&&hasEncyclopediaCalculationEvidence(v))return true;try{const parameters=japanPreviewParameters(v);return parameters.powerHp!=null||parameters.vehicleCategory==='N1';}catch{return false;}});
   if(matched.length){const updated=new Map((await applyActiveBusinessPricingBatch(matched)).map(v=>[v.id,v]));priced=page.items.map(v=>updated.get(v.id)||v);}
  }
  await checkEvidence();
  if(powerBefore)priced=priced.map(offer=>safePublicPricing(offer));
  if(powerBefore&&(priced.length!==page.items.length||priced.some(offer=>!offer||powerBefore.get(offer.id)!==powerIdentity(offer))))
   throw new AjesCursorRefreshRequired();
  measure?.('pricing',performance.now()-pricingStarted);
  return {...page,items:priced.filter(v=>v&&filter.matches(v))};
 };
 // Preserve the existing 24-row supplier query. Fill only this requested
 // visible page after local admission/filtering, then expose the exact cursor
 // in both numbered navigation and append.
 const cursorQuery=JSON.stringify({
  source:Object.fromEntries(Object.entries(query).filter(([key])=>key!=='page').sort(([a],[b])=>a.localeCompare(b))),
  local:Object.fromEntries(['body','bodyType','budget','budgetFrom','budgetTo','hasPrice','powerFrom','powerTo','city'].map(key=>[key,String(params[key]??'')])),
 });
 const initial=filter.powerFilter||params.after?undefined:await read(query.page||1);
 const total=readyCount as AjesCountSummary|null;
 let first:Awaited<ReturnType<typeof read>>|undefined=initial;
 const readPage=async(sourcePage:number,phase?:'k'|'u')=>{if(initial&&sourcePage===(query.page||1))return initial;const value=await read(sourcePage,phase);first??=value;return value;};
 const page=filter.powerFilter?await readPowerOrderedAjesPage<Awaited<ReturnType<typeof read>>['items'][number]>({
  startedAt,page:query.page||1,pageSize:query.pageSize||24,after:params.after,evidenceEpoch:evidenceEpoch!,
  minimumReads:2,cursorKey:cursorQuery,itemKey:offer=>offer.id,known:offer=>!japanUnknownPower(offer),read:readPage,
 }):await readFilteredAjesPage<Awaited<ReturnType<typeof read>>['items'][number]>({startedAt,page:query.page||1,pageSize:query.pageSize||24,after:params.after,
  minimumReads:2,cursorKey:cursorQuery,itemKey:offer=>offer.id,
  // Read the optional count only after its own request has completed. It is
  // never a prerequisite for a visible page or its next continuation.
  sourceTotal:total&&!total.stale?total.total:undefined,
  read:readPage});
 const observedAt=page.observedAt??first!.observedAt;
 const exact=(query.page||1)===1&&!params.after&&!page.hasMore&&!page.partial&&!page.stale?page.items.length:null;
 const countSummary=exact!==null?{total:exact,upperBound:false,stale:false,observedAt}:total;
 // Preserve the selected batch sort separately within K and U. Sorting a
 // mixed boundary page together would put cheap unknown cars before known K.
 let ordered=page.items;
 if(query.sort&&query.sort!=="updatedAt"){
  const sort=(rows:typeof page.items)=>sortCatalogRows(rows,query.sort!,String(params.city||""));
  ordered=filter.powerFilter?[...sort(page.items.filter(offer=>!japanUnknownPower(offer))),...sort(page.items.filter(japanUnknownPower))]:sort(page.items);
 }
 const items=evidenceSnapshot?await withCatalogEditorialSnapshot(evidenceSnapshot.editorial,async()=>ordered.map((offer:any)=>{
  const projected=publicOffer(offer);
  if(powerIdentity(projected)!==powerIdentity(offer))throw new AjesCursorRefreshRequired();
  return projected;
 })):ordered.map((offer:any)=>publicOffer(offer));
 return {...first,...page,page:query.page||1,observedAt,filteredByPage:filter.active,total:exact,countSummary,...(filter.powerFilter?{powerFilterSummary:japanPowerFilterSummary(items)}:{}),items,generationId:observedAt,sourceReceipts};
}
/** Add once to totals built from the separate local inventory. A failure is not zero inventory. */
export async function withAjesCount<T extends {total:number;marketCounts?:Record<string,number>;independentChina?:boolean}>(value:T,params:Record<string,unknown>={}):Promise<T & {countIncomplete?:boolean;marketCountInfo:Record<string,AjesCountSummary|null>}>{
 let result:T & {countIncomplete?:boolean;marketCountInfo:Record<string,AjesCountSummary|null>}={...value,marketCountInfo:{}};
 if(params.market&&params.market!=='japan')return result;
 try{await assertCollectionEnabled('ajes_japan_feed');}catch{return result;}
 const count=await readAjesCountSummary(JSON.stringify({...params,market:'japan'})).catch(()=>null);
 result.marketCountInfo.japan=count;
 if(count)result={...result,total:result.total+count.total,marketCounts:{...result.marketCounts,japan:(result.marketCounts?.japan||0)+count.total}};
 if(!count||count.stale||count.upperBound)result.countIncomplete=true;
 return result;
}
