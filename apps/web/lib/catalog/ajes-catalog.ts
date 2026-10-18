import 'server-only';
import {applyActiveBusinessPricingBatch} from './live-business-pricing';
import {assertCollectionEnabled} from './collection-controls';
import {headers} from 'next/headers';
import {cache} from 'react';
import {DetailReadCache} from './detail-read-cache';
import {ajesClient} from './ajes-runtime';
import {readAjesModelDirectory,readAjesMakeDirectory} from './ajes-client';
import {readAjesPublic} from './ajes-public';
import {ajesCatalogQuery} from './ajes-query';
export {ajesCatalogQuery,AjesFilterUnavailable} from './ajes-query';
import {publicOffer} from './storage';
export const readAjesCount=cache(async(key='{}'):Promise<number>=>{
 const q=ajesCatalogQuery(JSON.parse(key));delete q.page;delete q.pageSize;delete q.sort;
 const result=await ajesClient.read({...q,aggregate:'count'},(await headers()).get('x-real-ip')||'');
 if(!Number.isSafeInteger(result.total)||result.total<0)throw Error('ajes_count_invalid');
 return result.total;
});
const directories=new DetailReadCache<any>({maxEntries:16,maxBytes:4*1024*1024,ttlMs:30*60000,concurrency:2,shouldCache:value=>!value.stale});
export const readAjesMakes=cache(async(key='{}')=>{
 const q=ajesCatalogQuery(JSON.parse(key));delete q.page;delete q.pageSize;delete q.sort;
 return readAjesMakeDirectory(ajesClient,q,(await headers()).get('x-real-ip')||'');
});
export async function readAjesDirectory(params:Record<string,unknown>={}){
 const q=ajesCatalogQuery(params);delete q.page;delete q.pageSize;delete q.sort;
 await assertCollectionEnabled(`ajes_${q.table==='china'||q.table==='korea'?q.table:'japan'}_feed`);
 const ip=(await headers()).get('x-real-ip')||'',key=JSON.stringify(q);
 return directories.get(key,()=>readAjesModelDirectory(ajesClient,q,ip),ip+'\0'+key) as Promise<Awaited<ReturnType<typeof readAjesModelDirectory>>>;
}
export async function readAjesCatalogPage(params:Record<string,unknown>){
 const query=ajesCatalogQuery(params);
 const [page,total]=await Promise.all([readAjesPublic(query),readAjesCount(JSON.stringify(params)).catch(()=>null)]);
 return {...page,total:page.partial?null:total,items:(query.table==='china'||query.table==='korea'?await applyActiveBusinessPricingBatch(page.items):page.items).map((v:any)=>publicOffer(v)),generationId:page.observedAt};
}
/** Add once to totals built from the separate local inventory. A failure is not zero inventory. */
export async function withAjesCount<T extends {total:number;marketCounts?:Record<string,number>}>(value:T,params:Record<string,unknown>={}):Promise<T & {countIncomplete?:boolean}>{
 let result:T & {countIncomplete?:boolean}={...value};
 if(!params.market||params.market==='japan'){
  let enabled=true;try{await assertCollectionEnabled('ajes_japan_feed');}catch{enabled=false;}
  if(enabled)try{const total=await readAjesCount(JSON.stringify(params));result={...result,total:result.total+total,marketCounts:{...result.marketCounts,japan:(result.marketCounts?.japan||0)+total}};}catch{result={...result,countIncomplete:true};}
 }
 // Replace the active Korea source in overview totals, never add duplicate suppliers.
 if(!params.market&&value.marketCounts&&Object.prototype.hasOwnProperty.call(value.marketCounts,'korea')){
  let enabled=true;try{await assertCollectionEnabled('ajes_korea_feed');}catch{enabled=false;}
  if(enabled)try{
   const count=await readAjesCount(JSON.stringify({market:'korea'}));
   let next={...result,total:result.total-(value.marketCounts.korea||0)+count,marketCounts:{...result.marketCounts,korea:count}};
   if(Array.isArray((value as any).items)){
    const page=await readAjesPublic({table:'korea',pageSize:10});
    next={...next,items:[...(value as any).items.filter((v:any)=>v.market!=='korea'),...page.items]} as typeof next;
   }
   result=next;
  }catch{result={...result,countIncomplete:true};}
 }
 return result;
}
