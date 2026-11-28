'use client';
import {ajesVisibleCount,type AjesCountSummary} from '@/lib/catalog/ajes-count-display';
import {useCatalogLoadedCount} from './CatalogSelectionContext';
import {MarketResultCount} from './MarketResultCount';

/** Count only the displayed membership of this query; a previous filter's
 * streamed count must never become the new selection's inventory total. */
export function JapanCatalogCount({queryKey,summary,initialCount}:{queryKey:string;summary?:AjesCountSummary|null;initialCount?:number}) {
 const loaded=useCatalogLoadedCount();
 const count=ajesVisibleCount(summary,loaded?.queryKey===queryKey?loaded.count:initialCount);
 return <span data-japan-count-status={count.status} data-japan-loaded-count={count.loadedCount}>
  <MarketResultCount total={count.total}>{count.text}</MarketResultCount>
 </span>;
}
