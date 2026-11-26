import type {ReactNode} from 'react';
import {DealerLink as Link} from '@/components/dealers/DealerBrowsingContext';
import {CatalogMarketFlag} from './CatalogMarketFlag';
import {CatalogSectionLoading} from './CatalogLoading';
import {MarketResultCount} from './MarketResultCount';

export type JapanRailParams=Record<string,string|string[]|undefined>;

const observedDate=new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Krasnoyarsk',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
export function japanSavedPreviewText(observedAt:unknown) {
 const time=typeof observedAt==='string'?Date.parse(observedAt):NaN;
 return `Показана сохранённая подборка${Number.isFinite(time)?' от '+observedDate.format(time):''}. Обновить её пока не удалось.`;
}

/** Preview pagination is not a catalogue filter. Keep the visitor's conditions. */
export function japanRailHref(params:JapanRailParams={}) {
 const query=new URLSearchParams(Object.entries(params).flatMap(([key,value])=>value?[[key,Array.isArray(value)?value[0]:value]]:[]));
 for(const key of ['market','page','pageSize','after','source','countOnly'])query.delete(key);
 return '/cars/japan'+(query.size?'?'+query.toString():'');
}

export function JapanRailFrame({params={},count,children,busy=false,status='ready'}:{params?:JapanRailParams;count?:ReactNode;children:ReactNode;busy?:boolean;status?:'loading'|'ready'|'empty'|'unavailable'}) {
 return <section aria-label="Япония" aria-busy={busy||undefined} data-japan-auction-rail="true" data-status={status} className="min-w-0">
  <div className="mb-3 flex items-end justify-between gap-3">
   <h2 className="flex flex-wrap items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><CatalogMarketFlag market="japan" className="h-5 w-7 md:h-6 md:w-9"/><span>Япония</span>{count??<MarketResultCount>Количество уточняется</MarketResultCount>}</h2>
   <Link href={japanRailHref(params)} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link>
  </div>
  {children}
 </section>;
}

export function JapanRailLoading({params={}}:{params?:JapanRailParams}) {
 return <JapanRailFrame params={params} busy status="loading"><CatalogSectionLoading active/></JapanRailFrame>;
}
