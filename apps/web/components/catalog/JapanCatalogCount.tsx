'use client';
import {useEffect,useState} from 'react';
import {AJES_COUNT_FRESH_MS,ajesVisibleCount,ajesCountLabel,ajesCountExplanation,latestAjesCountSummary,type AjesCountSummary} from '@/lib/catalog/ajes-count-display';
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
 const shown=loaded?.queryKey===queryKey?loaded.count:initialCount;
 const count=ajesVisibleCount(current,shown),explanation=ajesCountExplanation(current,shown);
 return <span data-japan-count-status={count.status} data-japan-loaded-count={count.loadedCount} data-japan-source-total={count.status==='bounded'||count.status==='source'?current?.total:undefined} data-japan-count-proof={count.total!==undefined?current?.countProof?.kind:current?.sourceCountProof?.kind} data-japan-count-query-hash={count.total!==undefined?current?.countProof?.requestedQueryHash:current?.sourceCountProof?.requestedQueryHash} data-japan-count-observed-at={current?.observedAt}>
  {count.status==='stale'&&<CatalogResultCountUpdate queryKey={queryKey} summary={current} text={count.text}/>}
  <MarketResultCount total={count.total}><span aria-live="polite"><span className="font-bold">{ajesCountLabel(current,shown)}</span>{explanation&&<span className="mt-1 block max-w-xl text-xs leading-relaxed">{explanation}</span>}</span></MarketResultCount>
 </span>;
}

