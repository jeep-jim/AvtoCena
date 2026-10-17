import {DealerLink as Link} from '@/components/dealers/DealerBrowsingContext';
import {readAjesCount} from '@/lib/catalog/ajes-catalog';
import {formatCatalogCount} from '@/lib/catalog/count-format';
import {readAjesPublic} from '@/lib/catalog/ajes-public';
import {assertCollectionEnabled} from '@/lib/catalog/collection-controls';
import {publicOffer} from '@/lib/catalog/storage';
import {CatalogCard} from './CatalogCard';
import {CatalogMarketFlag} from './CatalogMarketFlag';

export async function AjesRail(){
 try{await assertCollectionEnabled('ajes_japan_feed');}catch{return null;}
 const totalPromise=readAjesCount().catch(()=>null);
 let items:Awaited<ReturnType<typeof readAjesPublic>>['items']=[],unavailable=false;
 try{items=(await readAjesPublic({table:'stats',pageSize:24})).items.slice(0,10);}catch{unavailable=true;}
 const total=await totalPromise;
 return <section aria-label="Аукционы Японии" className="min-w-0">
  <div className="mb-3 flex items-end justify-between gap-3">
   <h2 className="flex items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><CatalogMarketFlag market="japan" className="h-5 w-7 md:h-6 md:w-9"/><span>Япония</span><span className="whitespace-nowrap text-sm text-[var(--ac-muted)] md:text-base" data-catalog-market-count={total??undefined}>· {formatCatalogCount(total??NaN)}</span></h2>
   <Link href="/cars?market=japan" className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link>
  </div>
  {unavailable?<p role="status" className="rounded-xl border border-[var(--ac-border)] p-4 text-sm">Не удалось загрузить результаты торгов. <Link href="/cars?market=japan" className="underline">Открыть поиск по Японии</Link></p>:items.length?<div className="ac-catalog-market-rail -mr-4 grid grid-flow-col auto-cols-[47%] gap-2.5 overflow-x-auto pr-4 [scrollbar-width:none] md:mr-0 md:grid-flow-row md:auto-cols-auto md:grid-cols-5 md:overflow-visible md:pr-0">{items.map(offer=><div key={offer!.id} className="min-w-0"><CatalogCard offer={publicOffer(offer!)} compact dense/></div>)}</div>:<p className="text-sm text-[var(--ac-muted)]">Результатов торгов пока нет.</p>}
 </section>;
}
