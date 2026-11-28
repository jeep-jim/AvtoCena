import {latestAjesCountSummary,type AjesCountSummary} from '../../lib/catalog/ajes-count-display';
import {CATALOG_PAGE_REQUEST_TIMEOUT_MS} from './page-request-error';

export type JapanCountParams=Record<string,string|string[]|undefined>;
const countCache=new Map<string,AjesCountSummary>();
const countReads=new Map<string,Promise<AjesCountSummary>>();

/** Match the public COUNT identity; page, presentation and sorting do not
 * change membership. Keep every actual filter, including the selected city. */
export function japanCountQueryKey(params:JapanCountParams):string {
 const ignored=new Set(['sort','page','pageSize','after','view','marketPage','countOnly','source']);
 const query:Record<string,string>={};
 for(const [key,input] of Object.entries(params)){
  if(ignored.has(key))continue;
  const value=String(Array.isArray(input)?input[0]??'':input??'').trim();
  if(value)query[key]=value;
 }
 if(!query.make&&query.brand)query.make=query.brand;
 if(!query.bodyType&&query.body)query.bodyType=query.body;
 if(!query.budgetTo&&query.budget)query.budgetTo=query.budget;
 delete query.brand;delete query.body;delete query.budget;
 query.market='japan';
 return JSON.stringify(Object.fromEntries(Object.entries(query).sort(([a],[b])=>a.localeCompare(b))));
}
export function cachedJapanCountSummary(key:string):AjesCountSummary|null {
 return latestAjesCountSummary(countCache.get(key));
}
export function rememberJapanCountSummary(key:string,summary?:AjesCountSummary|null):AjesCountSummary|null {
 const retained=latestAjesCountSummary(countCache.get(key),summary);
 if(!retained){countCache.delete(key);return null;}
 countCache.delete(key);countCache.set(key,retained);
 while(countCache.size>6)countCache.delete(countCache.keys().next().value!);
 return retained;
}

/** One independent scalar read, shared by consumers of the same full filter.
 * A failed read neither removes a useful count nor renews its source date. */
export function readJapanCountSummary(params:JapanCountParams):Promise<AjesCountSummary> {
 const key=japanCountQueryKey(params),retained=rememberJapanCountSummary(key);
 if(retained&&!retained.stale)return Promise.resolve(retained);
 const pending=countReads.get(key);if(pending)return pending;
 const request=(async()=>{
  const query=new URLSearchParams(JSON.parse(key));query.set('countOnly','1');
  const response=await fetch('/api/catalog/search?'+query.toString(),{cache:'no-store',signal:AbortSignal.timeout(CATALOG_PAGE_REQUEST_TIMEOUT_MS)});
  const result=await response.json().catch(()=>null);
  const summary=latestAjesCountSummary(null,result?.countSummary);
  if(!response.ok||result?.ok!==true||!summary)throw Error('japan_count_unavailable');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
  const expected=Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
  const proof=summary.sourceCountProof??summary.countProof;
  if(proof?.requestedQueryHash!==expected)throw Error('japan_count_query_mismatch');
  return rememberJapanCountSummary(key,summary)!;
 })();
 countReads.set(key,request);
 const release=()=>{if(countReads.get(key)===request)countReads.delete(key);};
 void request.then(release,release);
 return request;
}

/** Changing a filter detaches its subscriber; an older response may populate
 * only its own cache entry and cannot overwrite the currently displayed count. */
export function subscribeJapanCount(params:JapanCountParams,receive:(summary:AjesCountSummary)=>void):()=>void {
 let active=true;
 void readJapanCountSummary(params).then(summary=>{if(active)receive(summary);},()=>{});
 return ()=>{active=false;};
}
