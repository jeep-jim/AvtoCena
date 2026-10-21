import type {ReactNode} from 'react';

/** Same typography as the catalog total, independent of the market heading. */
export function MarketResultCount({children,total}:{children:ReactNode;total?:number}) {
 return <span role="status" className="ac-market-result-count inline-flex items-center gap-2 text-sm font-normal tracking-normal text-[var(--ac-muted)]" data-catalog-market-count={total}>
  <span className="ac-pulse-dot ac-pulse-dot--status shrink-0" aria-hidden="true"><span/></span>
  <span><span className="hidden md:inline">Найдено: </span>{children}</span>
 </span>;
}
