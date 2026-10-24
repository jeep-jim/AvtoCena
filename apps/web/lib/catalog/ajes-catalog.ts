import {japanPreviewParameters} from './japan-preview-parameters';
import {readFilteredAjesPage} from './ajes-filtered-page';
import {resolveAjesMakeNames} from './ajes-make-resolution';
import 'server-only';
import {resolveAjesModelSelection} from './ajes-model-resolution';
import {ajesResultFilter} from './ajes-result-filter';
import {applyActiveBusinessPricingBatch} from './live-business-pricing';
import {hasEncyclopediaCalculationEvidence} from '../encyclopedia/calculation-evidence';
import {assertCollectionEnabled} from './collection-controls';
import {headers} from 'next/headers';
import {cache} from 'react';
import {DetailReadCache} from './detail-read-cache';
import {ajesClient} from './ajes-runtime';
import {readAjesModelDirectory,readAjesMakeDirectory} from './ajes-client';
import {ajesChinaPriceAllowed} from './ajes-price-policy';
import {readAjesPublic,cappedAjesQuery} from './ajes-public';
import {ajesCatalogQuery} from './ajes-query';
export {ajesCatalogQuery,AjesFilterUnavailable} from './ajes-query';
import {publicOffer} from './storage';
import {exactAjesCount,type AjesCountSummary} from './ajes-count-display';

const sourceMakes=cache(async(table:any)=>{
 await assertCollectionEnabled(`ajes_${table==='china'||table==='korea'?table:'japan'}_feed`);
 return readAjesMakeDirectory(ajesClient,await cappedAjesQuery({table}),(await headers()).get('x-real-ip')||'');
});
async function resolveMake(query:ReturnType<typeof ajesCatalogQuery>){
 if(query.make){try{const directory=await sourceMakes(query.table);query.make=resolveAjesMakeNames(query.make,directory.makes);}catch{/* Preserve direct queries and their saved results when the directory is unavailable. */}}
 return query;
}
const resolvedCatalogQuery=cache(async(key:string)=>{
 const params=JSON.parse(key),query=await resolveMake(ajesCatalogQuery(params));
 if(query.model&&query.make){
  const directory=await readAjesDirectory({market:params.market,make:query.make});
  const selection=resolveAjesModelSelection(query.model,directory.models,query.make);
  delete query.model;Object.assign(query,selection);
 }else if(query.model){
  query.modelFamilies=query.model;
 }
 return query;
});
export const readAjesCountSummary=cache(async(key='{}'):Promise<AjesCountSummary>=>{
 const params=JSON.parse(key),filter=ajesResultFilter(params);
 const q={...await resolvedCatalogQuery(key)};delete q.page;delete q.pageSize;delete q.sort;
 const result=await ajesClient.read(await cappedAjesQuery({...q,aggregate:'count'}),(await headers()).get('x-real-ip')||'');
 if(!Number.isSafeInteger(result.total)||result.total<0)throw Error('ajes_count_invalid');
 return {total:result.total,stale:Boolean(result.stale),observedAt:result.observedAt,upperBound:q.table==='china'||filter.active};
});
export const readAjesCount=cache(async(key='{}'):Promise<number> => (await readAjesCountSummary(key)).total);
const directories=new DetailReadCache<any>({maxEntries:16,maxBytes:4*1024*1024,ttlMs:30*60000,concurrency:2,shouldCache:value=>!value.stale});
export const readAjesMakes=cache(async(key='{}')=>{
 const q=await resolveMake(ajesCatalogQuery(JSON.parse(key)));delete q.page;delete q.pageSize;delete q.sort;
 return readAjesMakeDirectory(ajesClient,await cappedAjesQuery(q),(await headers()).get('x-real-ip')||'');
});
export async function readAjesDirectory(params:Record<string,unknown>={}){
 const q=await resolveMake(ajesCatalogQuery(params));delete q.page;delete q.pageSize;delete q.sort;
 await assertCollectionEnabled(`ajes_${q.table==='china'||q.table==='korea'?q.table:'japan'}_feed`);
 const ip=(await headers()).get('x-real-ip')||'',key=JSON.stringify(q);
 return directories.get(key,async()=>readAjesModelDirectory(ajesClient,await cappedAjesQuery(q),ip),ip+'\0'+key) as Promise<Awaited<ReturnType<typeof readAjesModelDirectory>>>;
}
export async function readAjesCatalogPage(params:Record<string,unknown>){
 const filter=ajesResultFilter(params);
 const query=await resolvedCatalogQuery(JSON.stringify(params));
 const startedAt=Date.now();
 const totalPromise=readAjesCountSummary(JSON.stringify(params)).catch(()=>null);
 const read=async(sourcePage:number)=>{
  const page=await readAjesPublic({...query,page:sourcePage});
  let priced=page.items;
  if(query.table==='china'||query.table==='korea'||filter.priceFilter)priced=await applyActiveBusinessPricingBatch(page.items);
  else {
   // Only newly attested auction cards need the existing delivered-preview path.
   // Leave unmatched supplier rows on their current inexpensive path.
   const matched=page.items.filter(v=>{if(hasEncyclopediaCalculationEvidence(v))return true;try{japanPreviewParameters(v);return true;}catch{return false;}});
   if(matched.length){const updated=new Map((await applyActiveBusinessPricingBatch(matched)).map(v=>[v.id,v]));priced=page.items.map(v=>updated.get(v.id)||v);}
  }
  return {...page,items:priced.filter(v=>v&&ajesChinaPriceAllowed(v)&&filter.matches(v))};
 };
 const firstPromise=params.after?null:read(query.page||1);
 // Japanese admission can remove rows even without visitor filters. Fill its
 // visible page through a continuation so borrowed rows are not repeated.
 if(query.table!=='china'&&query.table!=='stats'&&!filter.active){
  const [page,total]=await Promise.all([firstPromise??read(query.page||1),totalPromise]);
  return {...page,filteredByPage:false,total:page.partial?null:exactAjesCount(total)??null,countSummary:total,hasMore:!page.partial&&page.received===page.pageSize,items:page.items.map((v:any)=>publicOffer(v)),generationId:page.observedAt,nextCursor:undefined,scanLimited:false,interrupted:false};
 }
 const [initialPage,total]=await Promise.all([firstPromise,totalPromise]);
 // Reuse the first read only when it is the requested continuation's source page.
 let first:Awaited<ReturnType<typeof read>>|undefined=initialPage??undefined;
 const page=await readFilteredAjesPage({startedAt,page:query.page||1,pageSize:query.pageSize||24,after:params.after,sourceTotal:total&&!total.stale?total.total:undefined,
  read:async sourcePage=>{if(firstPromise&&sourcePage===(query.page||1))return first!;const value=await read(sourcePage);first??=value;return value;}});
 const exact=(query.page||1)===1&&!params.after&&!page.hasMore&&!page.partial&&!page.stale?page.items.length:null;
 const countSummary=exact!==null?{total:exact,upperBound:false,stale:false,observedAt:first!.observedAt}:total;
 return {...first,...page,page:query.page||1,filteredByPage:filter.active,total:exact,countSummary,items:page.items.map((v:any)=>publicOffer(v)),generationId:first!.observedAt};
}
/** Add once to totals built from the separate local inventory. A failure is not zero inventory. */
export async function withAjesCount<T extends {total:number;marketCounts?:Record<string,number>}>(value:T,params:Record<string,unknown>={}):Promise<T & {countIncomplete?:boolean;marketCountInfo:Record<string,AjesCountSummary|null>}>{
 let result:T & {countIncomplete?:boolean;marketCountInfo:Record<string,AjesCountSummary|null>}={...value,marketCountInfo:{}};
 const hasRows=Array.isArray((value as any).items);
 const markets=['japan','china','korea'].filter(m=>!params.market||params.market===m);
 const updates=await Promise.all(markets.map(async market=>{
  if(market!=='japan'&&(!value.marketCounts||!Object.prototype.hasOwnProperty.call(value.marketCounts,market)))return null;
  try{await assertCollectionEnabled(`ajes_${market}_feed`);}catch{return market==='korea'?{market,count:null,page:null}:null;}
  const query={...params,market};
  const [count,page]=await Promise.all([
   readAjesCountSummary(JSON.stringify(query)).catch(()=>null),
   hasRows&&market!=='japan'?readAjesCatalogPage(query).catch(()=>null):Promise.resolve(null),
  ]);
  return {market,count,page};
 }));
 for(const update of updates){
  if(!update)continue;
  const {market,count,page}=update;
  result.marketCountInfo[market]=count;
  if(market==='japan'){
   if(count)result={...result,total:result.total+count.total,marketCounts:{...result.marketCounts,japan:(result.marketCounts?.japan||0)+count.total}};
   if(!count||count.stale||count.upperBound)result.countIncomplete=true;
   continue;
  }
  const items=page?.items.slice(0,10)||[];
  const safeCount=market==='china'?items.length:count?.total??items.length;
  result={...result,total:result.total-(value.marketCounts?.[market]||0)+safeCount,marketCounts:{...result.marketCounts,[market]:safeCount}};
  if(hasRows)result={...result,items:[...(result as any).items.filter((v:any)=>v.market!==market),...items]} as typeof result;
  if(!count||count.stale||count.upperBound)result.countIncomplete=true;
 }
 return result;
}
