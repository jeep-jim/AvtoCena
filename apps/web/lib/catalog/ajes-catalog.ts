import 'server-only';
import {assertCollectionEnabled} from './collection-controls';
import {headers} from 'next/headers';
import {cache} from 'react';
import {ajesClient} from './ajes-runtime';
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
export async function readAjesDirectory(params:Record<string,unknown>={}){
 const q=ajesCatalogQuery(params);delete q.page;delete q.pageSize;delete q.sort;
 const result=await ajesClient.read({...q,aggregate:'models'},(await headers()).get('x-real-ip')||'');
 return {models:result.models as Array<{make:string;model:string;total:number}>,observedAt:result.observedAt};
}
export async function readAjesCatalogPage(params:Record<string,unknown>){
 const query=ajesCatalogQuery(params);
 const [page,total]=await Promise.all([readAjesPublic(query),readAjesCount(JSON.stringify(params)).catch(()=>null)]);
 return {...page,total,items:page.items.map((v:any)=>publicOffer(v)),generationId:page.observedAt};
}
/** Add once to totals built from the separate local inventory. A failure is not zero inventory. */
export async function withAjesCount<T extends {total:number;marketCounts?:Record<string,number>}>(value:T,params:Record<string,unknown>={}):Promise<T & {countIncomplete?:boolean}>{
 if(params.market&&params.market!=='japan')return value;
 try{await assertCollectionEnabled('ajes_japan_feed');}catch{return value;}
 try{const total=await readAjesCount(JSON.stringify(params));return {...value,total:value.total+total,marketCounts:{...value.marketCounts,japan:(value.marketCounts?.japan||0)+total}};}
 catch{return {...value,countIncomplete:true};}
}
