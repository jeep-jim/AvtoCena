'use client';
import {useEffect,useState} from 'react';
import {AJES_COUNT_FRESH_MS,ajesVisibleCount,ajesCountLabel,ajesCountExplanation,latestAjesCountSummary,type AjesCountSummary} from '@/lib/catalog/ajes-count-display';
import {CatalogResultCountUpdate,useCatalogLoadedCount,useCatalogResultCount} from './CatalogSelectionContext';
import {MarketResultCount} from './MarketResultCount';
import {cachedJapanCountSummary,japanCountQueryKey,rememberJapanCountSummary,subscribeJapanCount,type JapanCountParams} from './japan-count-request';

/** Count only the displayed membership of this query; a previous filter's
 * streamed count must never become the new selection's inventory total. */
export function JapanCatalogCount({queryKey,summary,initialCount,request,serverPending=false,retryKey=0}:{queryKey:string;summary?:AjesCountSummary|null;initialCount?:number;request?:JapanCountParams;serverPending?:boolean;retryKey?:number}) {
 const loaded=useCatalogLoadedCount();
 const streamed=useCatalogResultCount(queryKey);
 const [,refreshClock]=useState(0);
 const requestKey=request?japanCountQueryKey(request):undefined;
 const [received,setReceived]=useState<{key:string;summary:AjesCountSummary}|null>(null);
 const initial=latestAjesCountSummary(summary,streamed?.summary);
 const cached=requestKey?cachedJapanCountSummary(requestKey):null;
 const current=latestAjesCountSummary(initial,latestAjesCountSummary(cached,received?.key===requestKey?received?.summary:null));
 const currentKey=JSON.stringify(current);
 useEffect(()=>{if(requestKey&&current)rememberJapanCountSummary(requestKey,current);},[requestKey,currentKey]);
 useEffect(()=>{
  // Keep a same-filter cached count during SSR, without duplicating its pending
  // scalar. A completed null result gets one client recovery, never a LIST.
  if(serverPending||!requestKey||current&&!current.stale)return;
  return subscribeJapanCount(JSON.parse(requestKey),value=>setReceived({key:requestKey,summary:value}));
 },[requestKey,serverPending,retryKey]);
 useEffect(()=>{
  if(!current||current.stale)return;
  const expiresAt=Date.parse(current.observedAt)+AJES_COUNT_FRESH_MS;
  if(!Number.isFinite(expiresAt))return;
  const timer=window.setTimeout(()=>refreshClock(value=>value+1),Math.max(1,expiresAt-Date.now()+1));
  return()=>window.clearTimeout(timer);
 },[queryKey,current?.observedAt,current?.stale]);
 const shown=loaded?.queryKey===queryKey?loaded.count:initialCount;
 const count=ajesVisibleCount(current,shown),explanation=ajesCountExplanation(current,shown);
 return <span data-japan-count-status={count.status} data-japan-loaded-count={count.loadedCount} data-japan-source-total={count.status==='bounded'||count.status==='source'?current?.total:undefined} data-japan-count-proof={count.total!==undefined?current?.countProof?.kind:current?.sourceCountProof?.kind} data-japan-count-query-hash={count.total!==undefined?current?.countProof?.requestedQueryHash:current?.sourceCountProof?.requestedQueryHash} data-japan-count-observed-at={current?.observedAt}>
  {current&&<CatalogResultCountUpdate queryKey={queryKey} summary={current} text={count.text} total={count.total}/>}
  <MarketResultCount total={count.total}><span aria-live="polite"><span data-japan-count-label className="font-bold">{ajesCountLabel(current,shown)}</span>{explanation&&<span className="mt-1 block max-w-xl text-xs leading-relaxed">{explanation}</span>}</span></MarketResultCount>
 </span>;
}
