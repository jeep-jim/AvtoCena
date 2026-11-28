import {assertAjesJapanMarket,assertAjesJapanTable} from './ajes-access-policy';
import {createHash} from 'node:crypto';
import {readAjesCensusCount,ajesRequestedCountQuery,ajesRequestedCountQueryHash,ajesSourceScopeSupportsExactCount,AJES_CENSUS_PREDICATE_VERSION,type AjesExactCountSummary} from './ajes-census';
import {captureAjesCountPricingContext} from './ajes-count-pricing-context';
import {getJsonStorage} from '../data';
import {sortCatalogRows} from './market-page';
import {parseCatalogSort} from './catalog-sort';
import {japanPreviewParameters} from './japan-preview-parameters';
import {readFilteredAjesPage,readPowerOrderedAjesPage,ajesPowerEvidenceEpoch,assertAjesPowerCursorEpoch} from './ajes-filtered-page';
import {resolveAjesMakeSelection} from './ajes-make-resolution';
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
import {ajesCatalogQuery,ajesQuery,AjesCursorRefreshRequired} from './ajes-query';
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
  return {query:{...query,...resolveAjesMakeSelection(query.make,directory.makes)},makeDirectoryUnavailable:Boolean(directory.stale)};
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
const exactCounts=new DetailReadCache<AjesExactCountSummary>({maxEntries:128,maxBytes:512*1024,ttlMs:30*60000,expiresAt:value=>Date.parse(value.observedAt)+30*60000,concurrency:2,
 shouldCache:value=>!value.stale&&value.total===0&&value.countProof.sourceTotal===0&&value.countProof.complete&&value.countProof.predicateVersion===AJES_CENSUS_PREDICATE_VERSION});
const countDigest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const readAjesCountSummary=cache(async(key='{}'):Promise<AjesExactCountSummary>=>{
 const params=JSON.parse(key);
 assertAjesJapanMarket(params.market);
 await assertCollectionEnabled('ajes_japan_feed');
 ajesResultFilter(params);
 if(!ajesSourceScopeSupportsExactCount(ajesCatalogQuery(params)))throw new AjesUnavailable('census_source_scope_unproven');
 const resolved=await resolvedCatalogQuery(key);
 if(resolved.modelDirectoryUnavailable||resolved.makeDirectoryUnavailable)throw new AjesUnavailable('directory_unavailable');
 const q={...resolved.query};delete q.page;delete q.pageSize;delete q.sort;
 const snapshot=await readAjesPublicEvidenceSnapshot();
 const sourceDefinition=ajesQuery({...q,aggregate:'count'},snapshot.calculationIndex).sql;
 const localEpoch=()=>ajesPowerEvidenceEpoch({runtimeSha:process.env.AVTOCENA_RELEASE_SHA,
  editorialRevision:snapshot.editorial.revision,calculationDigest:snapshot.calculationIndex?.digest??null});
 const local=localEpoch(),evidenceEpoch=countDigest([AJES_CENSUS_PREDICATE_VERSION,local,null]);
 const assertCurrent=async()=>{
  const current=await readAjesPublicEvidenceSnapshot();
  if(ajesPowerEvidenceEpoch({runtimeSha:process.env.AVTOCENA_RELEASE_SHA,editorialRevision:current.editorial.revision,
   calculationDigest:current.calculationIndex?.digest??null})!==local)throw new AjesCursorRefreshRequired();
  if(ajesQuery({...q,aggregate:'count'},current.calculationIndex).sql!==sourceDefinition)throw new AjesCursorRefreshRequired();
 };
 const requestedQueryHash=ajesRequestedCountQueryHash(params),cacheKey=countDigest([ajesRequestedCountQuery(params),sourceDefinition,evidenceEpoch]);
 const ip=(await headers()).get('x-real-ip')||'';
 const result=await exactCounts.get(cacheKey,async()=>{
  const path=`catalog/partner-cache/ajes/admitted-counts/${parseInt(cacheKey.slice(0,8),16)%128}.json`;
  const storage=getJsonStorage();
  const usable=(value:any):value is AjesExactCountSummary=>{
   const proof=value?.countProof,age=Date.now()-Date.parse(value?.observedAt);
   return value?.upperBound===false&&value?.stale===false&&value?.total===0&&age>=0&&age<30*60000
    &&proof?.version===1&&proof.kind==='japan-admitted-census'&&proof.predicateVersion===AJES_CENSUS_PREDICATE_VERSION&&proof.complete===true
    &&proof.requestedQueryHash===requestedQueryHash&&proof.evidenceEpoch===evidenceEpoch&&proof.sourceObservedAt===value.observedAt
    &&proof.admittedTotal===value.total&&proof.baseAdmittedTotal+proof.correctionDelta===value.total
    &&proof.knownTotal+proof.unknownTotal===value.total&&proof.sourceTotal===0&&proof.groupedTotal===0&&proof.sourceDistinctTotal===0
    &&proof.sourceQueryHash===createHash('sha256').update(sourceDefinition).digest('hex')
    &&Number.isFinite(Date.parse(proof.sourceCompletedAt))&&Date.parse(proof.sourceCompletedAt)>=Date.parse(proof.sourceObservedAt)&&Date.parse(proof.sourceCompletedAt)<=Date.now()
    &&['groupCount','pages','baseAdmittedTotal','correctionCount','correctionDelta','knownTotal','unknownTotal'].every(k=>proof[k]===0)
    &&['queryHash','sourceQueryHash','coverageHash'].every(k=>/^[a-f0-9]{64}$/.test(proof[k]));
  };
  const saved=await storage.readJson<any>(path,null).catch(()=>null);
  if(saved?.key===cacheKey&&usable(saved.value)){await assertCurrent();return saved.value;}
  const sourceCount=await ajesClient.read(await cappedAjesQuery({...q,aggregate:'count'}),ip);
  if(!Number.isSafeInteger(sourceCount.total)||sourceCount.total<0||sourceCount.stale||sourceCount.partial)throw new AjesUnavailable('census_source_count_unavailable');
  // The real adapter has no coherent source snapshot contract. Its positive
  // count is rejected before any schema LIST, GROUP or per-ID correction read.
  const count=await readAjesCensusCount({params:{...params,market:'japan'},query:q,fields:[],snapshot,evidenceEpoch,sourceCount,
   read:async()=>{throw new AjesUnavailable('census_source_snapshot_unavailable');},rate:async()=>null,assertCurrent});
  // Only a validated zero from one scalar source observation is reusable.
  // Old positive aggregates cannot revive from memory or persisted slots.
  if(count.total===0&&count.countProof.sourceTotal===0)void storage.writeJson(path,{key:cacheKey,value:count}).catch(()=>{});
  return count;
 },ip+'\0'+cacheKey);
 await assertCurrent();
 return result;
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
 let evidenceSnapshot=filter.powerFilter||filter.priceFilter?await readAjesPublicEvidenceSnapshot():undefined;
 const pricingContext=filter.priceFilter?await captureAjesCountPricingContext(evidenceSnapshot!):undefined;
 const evidenceEpoch=evidenceSnapshot?ajesPowerEvidenceEpoch({runtimeSha:process.env.AVTOCENA_RELEASE_SHA,
  editorialRevision:evidenceSnapshot.editorial.revision,calculationDigest:evidenceSnapshot.calculationIndex?.digest??null}):undefined;
 if(evidenceEpoch&&filter.powerFilter){
  const requested=ajesCatalogQuery(params);
  assertAjesPowerCursorEpoch({page:requested.page||1,pageSize:requested.pageSize||24,after:params.after,evidenceEpoch});
 }
 const checkEvidence=async()=>{
  if(!evidenceSnapshot)return;
  const current=await readAjesPublicEvidenceSnapshot();
  const changed=evidenceEpoch?ajesPowerEvidenceEpoch({runtimeSha:process.env.AVTOCENA_RELEASE_SHA,editorialRevision:current.editorial.revision,
   calculationDigest:current.calculationIndex?.digest??null})!==evidenceEpoch
   :current.editorial.revision!==evidenceSnapshot.editorial.revision
    ||(current.calculationIndex?.digest??null)!==(evidenceSnapshot.calculationIndex?.digest??null);
  if(changed)throw new AjesCursorRefreshRequired();
 };
 const powerIdentity=(offer:any)=>JSON.stringify([japanLocalPowerHp(offer)??null,japanSupplierPower(offer)?.hp??null,japanUnknownPower(offer)]);
 const {query,modelDirectoryUnavailable,makeDirectoryUnavailable}=await resolvedCatalogQuery(JSON.stringify(params));
 const selectionIncomplete=modelDirectoryUnavailable||makeDirectoryUnavailable;
 const sourceScopeUnproven=!ajesSourceScopeSupportsExactCount(query);
 if(!evidenceSnapshot&&!selectionIncomplete)evidenceSnapshot=await readAjesPublicEvidenceSnapshot();
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
 // The requested total is a complete admitted counter, including continuation
 // requests. Its context-bound scalar cache is independent of sort/page/cursor.
 // A real source refusal keeps useful cars available, without manufacturing 0.
 const readyCount=selectionIncomplete||options.includeCount===false?null:await readAjesCountSummary(JSON.stringify(params)).catch(()=>null);
 measure?.('count',performance.now()-countStarted);
 if(readyCount?.total===0&&!params.after&&(query.page||1)===1)return {items:[],page:1,pageSize:query.pageSize||24,total:0,countSummary:readyCount,
  received:0,rejected:0,partial:false,stale:false,interrupted:false,hasMore:false,nextCursor:null,scanLimited:false,reads:0,
  observedAt:readyCount.observedAt,generationId:readyCount.observedAt,filteredByPage:filter.active,sourceReceipts,
  ...(filter.powerFilter?{powerFilterSummary:japanPowerFilterSummary([])}:{})};
 const read=async(sourcePage:number,phase?:'k'|'u')=>{
  await checkEvidence();
  const received=await readAjesPublic({...sourceQuery,page:sourcePage},{measure,...(evidenceSnapshot?{evidenceSnapshot}:{})}).catch(error=>{
   if(error?.sourceReceipt)sourceReceipts.push(error.sourceReceipt);
   throw error;
  });
  if(received.sourceReceipt)sourceReceipts.push(received.sourceReceipt);
  // Apply local/manual and supplier discovery filters before delivered-price previews.
  // Non-matching cars never enter the expensive customs/management pipeline.
  // Classify the same safe power that the public projection can display. A
  // rejected legacy/local value must not enter K and turn unknown afterwards.
  const normalized=filter.powerFilter?received.items.map(offer=>safePublicPricing(offer)):received.items;
  const candidates=filter.powerFilter?normalized.filter(offer=>filter.matchesPower(offer)
   &&(!phase||japanUnknownPower(offer)===(phase==='u'))):received.items;
  // Missing aliases make the selection incomplete, not a fresh LIST offset.
  // Only source partial/stale recovery stops its continuation. Keep the old
  // stale stop for an unresolved selection; retained rows cannot advance it.
  const page={...received,items:candidates,...(selectionIncomplete&&received.stale?{partial:true}:{})};
  const powerBefore=filter.powerFilter?new Map(page.items.map(offer=>[offer.id,powerIdentity(offer)])):null;
  const membershipBefore=!filter.priceFilter?new Map(page.items.map(offer=>[offer.id,filter.matches(offer)])):null;
  const pricingStarted=performance.now();
  let priced=page.items;
  if(filter.priceFilter)priced=await pricingContext!.run(()=>pricingContext!.price(page.items));
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
  if(membershipBefore&&(priced.length!==page.items.length||priced.some(offer=>!offer||membershipBefore.get(offer.id)!==filter.matches(offer))))
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
  counter:readyCount?{coverageHash:readyCount.countProof.coverageHash,evidenceEpoch:readyCount.countProof.evidenceEpoch,total:readyCount.total}:null,
 });
 if(readyCount&&(query.page||1)>1&&!params.after)throw new AjesCursorRefreshRequired();
 const initial=filter.powerFilter||params.after?undefined:await read(query.page||1);
 const total=readyCount;
 let first:Awaited<ReturnType<typeof read>>|undefined=initial;
 const readPage=async(sourcePage:number,phase?:'k'|'u')=>{if(initial&&sourcePage===(query.page||1))return initial;const value=await read(sourcePage,phase);first??=value;return value;};
 const page=filter.powerFilter?await readPowerOrderedAjesPage<Awaited<ReturnType<typeof read>>['items'][number]>({
  startedAt,page:query.page||1,pageSize:query.pageSize||24,after:params.after,evidenceEpoch:evidenceEpoch!,
  minimumReads:2,cursorKey:cursorQuery,itemKey:offer=>offer.id,known:offer=>!japanUnknownPower(offer),read:readPage,
  fillRequestedPage:Boolean(total),knownTotal:total?.countProof.knownTotal,
 }):await readFilteredAjesPage<Awaited<ReturnType<typeof read>>['items'][number]>({startedAt,page:query.page||1,pageSize:query.pageSize||24,after:params.after,
  minimumReads:2,cursorKey:cursorQuery,itemKey:offer=>offer.id,
  // Read the optional count only after its own request has completed. It is
  // never a prerequisite for a visible page or its next continuation.
  sourceTotal:total?.countProof.sourceTotal,fillRequestedPage:Boolean(total),
  read:readPage});
 const observedAt=page.observedAt??first!.observedAt;
 const completePage=!page.partial&&!page.stale&&!page.interrupted&&!page.scanLimited;
 if(total&&completePage){
  // The counter is part of the cursor binding above, so an earlier short page
  // from an uncounted search cannot masquerade as a full-page offset here.
  const through=((query.page||1)-1)*(query.pageSize||24)+page.items.length;
  if(through>total.total||!page.hasMore&&through<total.total)throw new AjesCursorRefreshRequired();
  if(through===total.total){page.hasMore=false;page.nextCursor=null;}
 }else if(total){
  // Useful retained rows remain incomplete. No exact ending is inferred from
  // a stale fallback which cannot provide a trustworthy next source offset.
  page.partial=true;page.hasMore=true;page.nextCursor=null;
 }
 const observationAge=Date.now()-Date.parse(observedAt);
 const singleObservation=!selectionIncomplete&&!sourceScopeUnproven&&!filter.powerFilter&&Boolean(evidenceSnapshot)&&(query.page||1)===1&&!params.after
  &&page.reads===1&&completePage&&!page.hasMore&&Number.isSafeInteger(first?.received)&&first!.received>=page.items.length
  &&first!.received<(query.pageSize||24)&&observationAge>=0&&observationAge<30*60000
  &&page.items.every(offer=>typeof offer.id==='string'&&offer.id.length>0)&&new Set(page.items.map(offer=>offer.id)).size===page.items.length;
 // Exhaustion across multiple source responses (including the two power
 // passes) cannot prove one exact inventory. A single complete observation can.
 const exact=total&&completePage?total.total:singleObservation?page.items.length:null;
 const countSummary=total&&completePage?total:exact!==null?{total:exact,upperBound:false,stale:false,observedAt}:null;
 // Preserve the selected batch sort separately within K and U. Sorting a
 // mixed boundary page together would put cheap unknown cars before known K.
 let ordered=page.items;
 if(query.sort&&query.sort!=="updatedAt"){
  const sort=(rows:typeof page.items)=>sortCatalogRows(rows,query.sort!,String(params.city||""));
  ordered=filter.powerFilter?[...sort(page.items.filter(offer=>!japanUnknownPower(offer))),...sort(page.items.filter(japanUnknownPower))]:sort(page.items);
 }
 const items=evidenceSnapshot?await withCatalogEditorialSnapshot(evidenceSnapshot.editorial,async()=>ordered.map((offer:any)=>{
  const projected=publicOffer(offer);
  if(filter.powerFilter&&powerIdentity(projected)!==powerIdentity(offer))throw new AjesCursorRefreshRequired();
  return projected;
 })):ordered.map((offer:any)=>publicOffer(offer));
 // A source-side filter may omit locally enriched matches. Keep its fresh
 // cursor, but do not present this SQL's end as a complete user selection.
 return {...first,...page,partial:page.partial||selectionIncomplete||sourceScopeUnproven,selectionIncomplete,page:query.page||1,observedAt,filteredByPage:filter.active,total:exact,countSummary,...(filter.powerFilter?{powerFilterSummary:japanPowerFilterSummary(items)}:{}),items,generationId:observedAt,sourceReceipts};
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
