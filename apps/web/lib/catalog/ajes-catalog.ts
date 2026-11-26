import {assertAjesJapanMarket,assertAjesJapanTable} from './ajes-access-policy';
import {sortCatalogRows} from './market-page';
import {japanPreviewParameters} from './japan-preview-parameters';
import {readFilteredAjesPage} from './ajes-filtered-page';
import {resolveAjesMakeNames} from './ajes-make-resolution';
import 'server-only';
import {resolveAjesQueryModels} from './ajes-model-resolution';
import {ajesResultFilter} from './ajes-result-filter';
import {japanPowerFilterSummary} from './japan-source-power';
import {applyActiveBusinessPricingBatch} from './live-business-pricing';
import {hasEncyclopediaCalculationEvidence} from '../encyclopedia/calculation-evidence';
import {assertCollectionEnabled} from './collection-controls';
import {headers} from 'next/headers';
import {cache} from 'react';
import {DetailReadCache} from './detail-read-cache';
import {ajesClient} from './ajes-runtime';
import {AjesUnavailable,readAjesModelDirectory,readAjesMakeDirectory} from './ajes-client';
import {readAjesPublic,cappedAjesQuery} from './ajes-public';
import {ajesCatalogQuery} from './ajes-query';
export {ajesCatalogQuery,AjesFilterUnavailable} from './ajes-query';
import {publicOffer} from './storage';
import type {AjesCountSummary} from './ajes-count-display';

const sourceMakes=cache(async(table:any)=>{
 assertAjesJapanTable(table);
 await assertCollectionEnabled('ajes_japan_feed');
 return readAjesMakeDirectory(ajesClient,await cappedAjesQuery({table}),(await headers()).get('x-real-ip')||'');
});
async function resolveMake(query:ReturnType<typeof ajesCatalogQuery>){
 if(query.make){try{const directory=await sourceMakes(query.table);query.make=resolveAjesMakeNames(query.make,directory.makes);}catch{/* Preserve direct queries and their saved results when the directory is unavailable. */}}
 return query;
}
const resolvedCatalogQuery=cache(async(key:string)=>{
 const params=JSON.parse(key);
 assertAjesJapanMarket(params.market);
 const query=await resolveMake(ajesCatalogQuery(params));
 return resolveAjesQueryModels(query,()=>readAjesDirectory({market:params.market,make:query.make}));
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
 if(resolved.modelDirectoryUnavailable)throw new AjesUnavailable('directory_unavailable');
 const q={...resolved.query};delete q.page;delete q.pageSize;delete q.sort;
 const result=await ajesClient.read(await cappedAjesQuery({...q,aggregate:'count'}),(await headers()).get('x-real-ip')||'');
 if(!Number.isSafeInteger(result.total)||result.total<0)throw Error('ajes_count_invalid');
 return {total:result.total,stale:Boolean(result.stale),observedAt:result.observedAt,upperBound:filter.active};
});
export const readAjesCount=cache(async(key='{}'):Promise<number> => (await readAjesCountSummary(key)).total);
const directories=new DetailReadCache<any>({maxEntries:16,maxBytes:4*1024*1024,ttlMs:30*60000,concurrency:2,shouldCache:value=>!value.stale});
export const readAjesMakes=cache(async(key='{}')=>{
 const params=JSON.parse(key);assertAjesJapanMarket(params.market);
 const q=await resolveMake(ajesCatalogQuery(params));delete q.page;delete q.pageSize;delete q.sort;
 return readAjesMakeDirectory(ajesClient,await cappedAjesQuery(q),(await headers()).get('x-real-ip')||'');
});
export async function readAjesDirectory(params:Record<string,unknown>={}){
 assertAjesJapanMarket(params.market);
 const q=await resolveMake(ajesCatalogQuery(params));delete q.page;delete q.pageSize;delete q.sort;
 await assertCollectionEnabled('ajes_japan_feed');
 const ip=(await headers()).get('x-real-ip')||'',key=JSON.stringify(q);
 return directories.get(key,async()=>readAjesModelDirectory(ajesClient,await cappedAjesQuery(q),ip),ip+'\0'+key) as Promise<Awaited<ReturnType<typeof readAjesModelDirectory>>>;
}
export async function readAjesCatalogPage(params:Record<string,unknown>,measure?:(stage:string,ms:number)=>void,options:{includeCount?:boolean}={}){
 assertAjesJapanMarket(params.market);
 const resolveStarted=performance.now();
 const filter=ajesResultFilter(params);
 const {query,modelDirectoryUnavailable}=await resolvedCatalogQuery(JSON.stringify(params));
 measure?.('query-resolution',performance.now()-resolveStarted);
 const startedAt=Date.now();
 const countStarted=performance.now();
 let readyCount:AjesCountSummary|null=null;
 // Counts are optional metadata. Keep their bounded, shared request independent
 // of ready cards; a pending count must never occupy the list's critical path.
 // Pagination changes only the offset. Recounting here competes with the
 // requested list in the same two-slot supplier queue. The independent count
 // endpoint/header owns aggregate refresh; continuations need only their rows.
 if(options.includeCount!==false&&(query.page||1)===1&&!params.after&&!filter.powerFilter)void readAjesCountSummary(JSON.stringify(params)).then(value=>{readyCount=value;}).catch(()=>{}).finally(()=>measure?.('count',performance.now()-countStarted));
 const read=async(sourcePage:number)=>{
  const received=await readAjesPublic({...query,page:sourcePage},{measure});
  if(modelDirectoryUnavailable&&!received.items.length)throw new AjesUnavailable('directory_unavailable');
  // Apply local/manual and supplier discovery filters before delivered-price previews.
  // Non-matching cars never enter the expensive customs/management pipeline.
  const candidates=filter.powerFilter?received.items.filter(filter.matchesPower):received.items;
  const page={...received,items:candidates,...(modelDirectoryUnavailable?{partial:true}:{})};
  const pricingStarted=performance.now();
  let priced=page.items;
  if(filter.priceFilter)priced=await applyActiveBusinessPricingBatch(page.items);
  else {
   // Only newly attested auction cards need the existing delivered-preview path.
   // Leave unmatched supplier rows on their current inexpensive path.
   const matched=page.items.filter(v=>{if(v.powerHp!=null&&hasEncyclopediaCalculationEvidence(v))return true;try{const parameters=japanPreviewParameters(v);return parameters.powerHp!=null||parameters.vehicleCategory==='N1';}catch{return false;}});
   if(matched.length){const updated=new Map((await applyActiveBusinessPricingBatch(matched)).map(v=>[v.id,v]));priced=page.items.map(v=>updated.get(v.id)||v);}
  }
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
 const initial=params.after?undefined:await read(query.page||1);
 const total=readyCount as AjesCountSummary|null;
 let first:Awaited<ReturnType<typeof read>>|undefined=initial;
 const page=await readFilteredAjesPage<Awaited<ReturnType<typeof read>>['items'][number]>({startedAt,page:query.page||1,pageSize:query.pageSize||24,after:params.after,
  minimumReads:2,cursorKey:cursorQuery,itemKey:offer=>offer.id,
  // Read the optional count only after its own request has completed. It is
  // never a prerequisite for a visible page or its next continuation.
  sourceTotal:total&&!total.stale?total.total:undefined,
  read:async sourcePage=>{if(initial&&sourcePage===(query.page||1))return initial;const value=await read(sourcePage);first??=value;return value;}});
 const observedAt=page.observedAt??first!.observedAt;
 const exact=(query.page||1)===1&&!params.after&&!page.hasMore&&!page.partial&&!page.stale?page.items.length:null;
 const countSummary=exact!==null?{total:exact,upperBound:false,stale:false,observedAt}:total;
 const items=(query.sort&&query.sort!=="updatedAt"?sortCatalogRows(page.items,query.sort,String(params.city||"")):page.items).map((v:any)=>publicOffer(v));
 return {...first,...page,page:query.page||1,observedAt,filteredByPage:filter.active,total:exact,countSummary,...(filter.powerFilter?{powerFilterSummary:japanPowerFilterSummary(items)}:{}),items,generationId:observedAt};
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
