'use client';
import {useEffect,useState} from 'react';
import {AJES_COUNT_FRESH_MS,ajesVisibleCount,latestAjesCountSummary,type AjesCountSummary} from '@/lib/catalog/ajes-count-display';
import {CatalogResultCountUpdate,useCatalogLoadedCount,useCatalogResultCount} from './CatalogSelectionContext';
import {MarketResultCount} from './MarketResultCount';

/** Count only the displayed membership of this query; a previous filter's
 * streamed count must never become the new selection's inventory total. */
export function JapanCatalogCount({queryKey,summary,initialCount}:{queryKey:string;summary?:AjesCountSummary|null;initialCount?:number}) {
 const loaded=useCatalogLoadedCount();
 const streamed=useCatalogResultCount(queryKey);
 const [,refreshClock]=useState(0);
 const current=latestAjesCountSummary(summary,streamed?.summary);
 useEffect(()=>{
  if(!current||current.stale)return;
  const expiresAt=Date.parse(current.observedAt)+AJES_COUNT_FRESH_MS;
  if(!Number.isFinite(expiresAt))return;
  const timer=window.setTimeout(()=>refreshClock(value=>value+1),Math.max(1,expiresAt-Date.now()+1));
  return()=>window.clearTimeout(timer);
 },[queryKey,current?.observedAt,current?.stale]);
 const count=ajesVisibleCount(current,loaded?.queryKey===queryKey?loaded.count:initialCount);
 return <span data-japan-count-status={count.status} data-japan-loaded-count={count.loadedCount} data-japan-count-proof={count.total!==undefined?current?.countProof?.kind:undefined} data-japan-count-query-hash={count.total!==undefined?current?.countProof?.requestedQueryHash:undefined} data-japan-count-observed-at={count.status==='stale'?current?.observedAt:undefined}>
  {count.status==='stale'&&<CatalogResultCountUpdate queryKey={queryKey} summary={current} text={count.text}/>}
  <MarketResultCount total={count.total}>{count.text}</MarketResultCount>
 </span>;
}
