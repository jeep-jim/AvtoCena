import {assertAjesJapanMarket,assertAjesJapanTable} from './ajes-access-policy';
import {sortCatalogRows} from './market-page';
import {japanPreviewParameters} from './japan-preview-parameters';
import {readPowerAjesPage,japanPowerSnapshot} from './ajes-power-page';
import type {JapanPowerQueryContext} from './japan-power-query';
import {readCalculationIndex} from '../encyclopedia/calculation-index';
import {readCatalogEditorial} from './editorial';
import {resolveAjesMakeNames} from './ajes-make-resolution';
import 'server-only';
import {resolveAjesQueryModels} from './ajes-model-resolution';
import {ajesResultFilter} from './ajes-result-filter';
import {japanPowerFilterSummary,japanUnknownPower} from './japan-source-power';
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
import {exactAjesCount,type AjesCountSummary} from './ajes-count-display';
import {randomUUID} from 'node:crypto';
import {copyAjesSourceReadReceipt,ajesSourceReadReceiptFromError,type AjesSourceReadReceipt} from './ajes-read-evidence';

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
 // Source SQL prunes explicit identities; local categories, bound mass and
 // editorial visibility can remove further rows. That source COUNT is a ceiling.
 return {total:result.total,stale:Boolean(result.stale),observedAt:result.observedAt,upperBound:true};
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
 const readId=randomUUID(),readStartedAt=new Date(Date.now()).toISOString();
 const runtimeSha=/^[a-f0-9]{40}$/.test(process.env.AVTOCENA_RELEASE_SHA||'')?process.env.AVTOCENA_RELEASE_SHA!:null;
 const sourceReadReceipts:AjesSourceReadReceipt[]=[];
 let sourceReadCalls=0,sourceReadReceiptsLimited=false;
 const collectReceipt=(value:unknown)=>{
  const receipt=copyAjesSourceReadReceipt(value);
  if(receipt&&sourceReadReceipts.length<8)sourceReadReceipts.push(receipt);
  else sourceReadReceiptsLimited=true;
 };
 // A receipt describes this invocation, never the first source page retained
 // by a cursor. Optional aggregate refresh is outside the list's evidence.
 const readEvidence=()=>({catalogReadReceipt:{version:1 as const,readId,runtimeSha,readStartedAt,
  readFinishedAt:new Date(Date.now()).toISOString(),sourceReadCalls:Math.min(8,sourceReadCalls)},
  sourceReadReceipts,sourceReadReceiptsLimited:sourceReadReceiptsLimited||sourceReadCalls>8});
 assertAjesJapanMarket(params.market);
 const resolveStarted=performance.now();
 const filter=ajesResultFilter(params);
 const {query,modelDirectoryUnavailable}=await resolvedCatalogQuery(JSON.stringify(params));
 measure?.('query-resolution',performance.now()-resolveStarted);
 const countStarted=performance.now();
 let readyCount:AjesCountSummary|null=null;
 // Counts are optional metadata. Keep their bounded, shared request independent
 // of ready cards; a pending count must never occupy the list's critical path.
 // Pagination changes only the offset. Recounting here competes with the
 // requested list in the same two-slot supplier queue. The independent count
 // endpoint/header owns aggregate refresh; continuations need only their rows.
 if(options.includeCount!==false&&(query.page||1)===1&&!params.after&&!filter.powerFilter)void readAjesCountSummary(JSON.stringify(params)).then(value=>{readyCount=value;}).catch(()=>{}).finally(()=>measure?.('count',performance.now()-countStarted));
 const snapshot=japanPowerSnapshot(readCalculationIndex(),await readCatalogEditorial());
 const read=async(sourcePage:number,powerContext?:JapanPowerQueryContext,pageSize=query.pageSize)=>{
  sourceReadCalls++;
  const received=await readAjesPublic({...query,page:sourcePage,pageSize},{measure,powerContext,snapshot}).then(value=>{
   collectReceipt(value.sourceReadReceipt);return value;
  },error=>{collectReceipt(ajesSourceReadReceiptFromError(error));throw error;});
  const {sourceReadReceipt: _sourceReceipt,sourceReadReceipts: _savedReceipts,catalogReadReceipt: _savedCatalogReceipt,
   sourceReadReceiptsLimited: _savedReceiptsLimited,...source}=received;
  if(modelDirectoryUnavailable&&!received.items.length)throw new AjesUnavailable('directory_unavailable');
  // Apply local/manual and supplier discovery filters before delivered-price previews.
  // Non-matching cars never enter the expensive customs/management pipeline.
  const candidates=filter.powerFilter?received.items.filter(v=>filter.matchesPower(v)&&(!powerContext||(powerContext.phase==='unknown')===japanUnknownPower(v))):received.items;
  const page={...source,items:candidates,...(modelDirectoryUnavailable?{partial:true}:{})};
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
  if(snapshot.revision!==japanPowerSnapshot(readCalculationIndex(),await readCatalogEditorial()).revision)throw new AjesUnavailable('cursor_expired');
  return {...page,items:priced.filter(v=>v&&filter.matches(v)&&(!powerContext||(powerContext.phase==='unknown')===japanUnknownPower(v)))};
 };
 const page=await readPowerAjesPage({query:{...params,...query,market:'japan'},revision:snapshot.revision,page:query.page||1,pageSize:query.pageSize||24,after:params.after,partitioned:filter.powerFilter,
  read:(phase,sourcePage,pageSize)=>read(sourcePage,filter.powerFilter?{phase,snapshot}:undefined,pageSize)});
 if(filter.powerFilter){
  // Source order is preserved within both phases. The existing delivered-price
  // sort remains explicitly local to this visible batch and cannot mix groups.
  const ordered=query.sort&&query.sort!=="updatedAt"?[...sortCatalogRows(page.items.filter(v=>!japanUnknownPower(v)),query.sort,String(params.city||"")),...sortCatalogRows(page.items.filter(japanUnknownPower),query.sort,String(params.city||""))]:page.items;
  const items=ordered.map((v:any)=>publicOffer(v));
  const exact=page.page===1&&!page.hasMore&&!page.partial&&!page.stale?items.length:null;
  const countSummary=exact!==null?{total:exact,upperBound:false,stale:false,observedAt:page.observedAt}:null;
  return {...page,filteredByPage:true,total:exact,countSummary,items,powerFilterSummary:japanPowerFilterSummary(items),...readEvidence()};
 }
 const total=readyCount as AjesCountSummary|null;
 const exact=page.page===1&&!page.hasMore&&!page.partial&&!page.stale?page.items.length:null;
 const countSummary=exact!==null?{total:exact,upperBound:false,stale:false,observedAt:page.observedAt}:total;
 const items=(query.sort&&query.sort!=="updatedAt"?sortCatalogRows(page.items,query.sort,String(params.city||"")):page.items).map((v:any)=>publicOffer(v));
 return {...page,filteredByPage:filter.active,total:exact??(!filter.active&&!page.partial?exactAjesCount(total)??null:null),countSummary,items,...readEvidence()};
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
