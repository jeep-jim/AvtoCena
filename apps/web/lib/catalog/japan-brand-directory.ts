import {canonicalCatalogBrand} from './brands';

export type JapanBrandDirectory={makes:string[];observedAt:string;stale:boolean;complete:true};
export function isJapanBrandDirectoryContext(query:string){
 const params=new URLSearchParams(query);
 return params.get('market')==='japan'&&params.get('stock')!=='green';
}

/** Names come from the complete make aggregate, never the current car page. */
export function parseJapanBrandDirectory(payload:any):JapanBrandDirectory{
 if(payload?.directoryComplete!==true||!Array.isArray(payload.makes)||!Number.isFinite(Date.parse(payload.generationId||'')))throw Error('japan_brand_directory_invalid');
 const names=new Map<string,string>();
 for(const raw of payload.makes){
  if(typeof raw!=='string'||!raw.trim()||raw.length>80||/[\u0000-\u001f<>]/.test(raw))throw Error('japan_brand_directory_invalid');
  const name=canonicalCatalogBrand(raw.trim());
  if(!name)throw Error('japan_brand_directory_invalid');
  names.set(name.toLocaleLowerCase('en-US'),name);
 }
 return {makes:[...names.values()].sort((a,b)=>a.localeCompare(b,'ru')),observedAt:payload.generationId,stale:payload.stale===true,complete:true};
}

const cacheMs=30_000;
let request:{at:number;promise:Promise<JapanBrandDirectory>}|undefined;
const listeners=new Set<(value:JapanBrandDirectory)=>void>();
/** A successful explicit retry updates the other already-open directory views. */
export function subscribeJapanBrandDirectory(listener:(value:JapanBrandDirectory)=>void){
 listeners.add(listener);return()=>{listeners.delete(listener);};
}
/** One requested, bounded directory shared by the rail and both filter views. */
export function loadJapanBrandDirectory():Promise<JapanBrandDirectory>{
 if(request&&Date.now()-request.at<cacheMs)return request.promise;
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30_000);
 const promise=fetch('/api/catalog/brand-counts?market=japan&directory=1',{cache:'no-store',signal:controller.signal})
  .then(async response=>{if(!response.ok)throw Error('japan_brand_directory_unavailable');return parseJapanBrandDirectory(await response.json());})
  .then(value=>{for(const listener of listeners)listener(value);return value;})
  .catch(error=>{if(request?.promise===promise)request=undefined;throw error;})
  .finally(()=>clearTimeout(timeout));
 request={at:Date.now(),promise};return promise;
}
