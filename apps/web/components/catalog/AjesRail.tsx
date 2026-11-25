import {Suspense} from 'react';
import {assertAjesJapanMarket} from '@/lib/catalog/ajes-access-policy';
import {MARKET_RAIL_CLASS} from './market-rail-layout';
import {CatalogSectionLoading} from './CatalogLoading';
import {MarketResultCount} from './MarketResultCount';
import {DealerLink as Link} from '@/components/dealers/DealerBrowsingContext';
import {AjesFilterUnavailable} from '@/lib/catalog/ajes-query';
import {readAjesCatalogPage,readAjesCountSummary} from '@/lib/catalog/ajes-catalog';
import {ajesCountText,exactAjesCount} from '@/lib/catalog/ajes-count-display';
import {assertCollectionEnabled} from '@/lib/catalog/collection-controls';
import {publicOffer} from '@/lib/catalog/storage';
import {CatalogCard} from './CatalogCard';
import {CatalogMarketFlag} from './CatalogMarketFlag';

export function AjesRailPending({market='japan'}:{market?:'japan'}) {
 return <section aria-label="Япония" className="min-w-0" data-japan-rail-pending="true">
   <div className="mb-3 flex items-end justify-between gap-3">
     <h2 className="flex flex-wrap items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl">
       <CatalogMarketFlag market={market} className="h-5 w-7 md:h-6 md:w-9"/><span>Япония</span>
       <MarketResultCount>Количество уточняется</MarketResultCount>
     </h2>
     <Link href="/cars/japan" className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link>
   </div>
   <CatalogSectionLoading active/>
 </section>;
}
function railQuery(market:'japan'|'china'|'korea',params:Record<string,string|string[]|undefined>){assertAjesJapanMarket(market);return {...params,market,page:'1',pageSize:'12'};}
export function readAjesRailCount(market:'japan'|'china'|'korea',params:Record<string,string|string[]|undefined>){return readAjesCountSummary(JSON.stringify(railQuery(market,params))).catch(()=>null);}
async function RailCount({market,params}:{market:'japan'|'china'|'korea';params:Record<string,string|string[]|undefined>}){
 const count=await readAjesRailCount(market,params);
 return <MarketResultCount total={exactAjesCount(count)??undefined}>{ajesCountText(count)}</MarketResultCount>;
}
export async function readAjesRailData(market:'japan'|'china'|'korea',params:Record<string,string|string[]|undefined>={}){
 assertAjesJapanMarket(market);
 try{await assertCollectionEnabled('ajes_japan_feed');}catch{return {disabled:true,items:[],count:null,unavailable:false,unsupported:false,partial:false,stale:false,filteredByPage:false,hasMore:false};}
 try{
  // A supplier page may contain rejected rows. One bounded extra row of candidates
  // fills the six-card preview without pagination scans or bypassing admission.
  // Optional counts must not take supplier slots before the visible list runs.
  // RailCount and the overview total already read counts after these rows.
  const page=await readAjesCatalogPage(railQuery(market,params),undefined,{includeCount:false});
  return {disabled:false,items:page.items.slice(0,6),count:page.countSummary,unavailable:false,unsupported:false,partial:Boolean(page.partial),stale:Boolean(page.stale),filteredByPage:page.filteredByPage,hasMore:page.hasMore,scanLimited:Boolean(page.scanLimited)};
 }catch(error){return {disabled:false,items:[],count:null,unavailable:true,unsupported:error instanceof AjesFilterUnavailable,partial:false,stale:false,filteredByPage:false,hasMore:false};}
}
type RailData=ReturnType<typeof readAjesRailData>;
export async function AjesRail({market='japan',params={},prepared}:{market?:'japan'|'china'|'korea';params?:Record<string,string|string[]|undefined>;prepared?:RailData}={}){
 assertAjesJapanMarket(market);
 const label='Япония';
 const linkParams=new URLSearchParams(Object.entries(params).flatMap(([key,value])=>value?[[key,Array.isArray(value)?value[0]:value]]:[]));linkParams.set('market',market);linkParams.delete('page');linkParams.delete('source');
 const href='/cars?'+linkParams.toString();
 const {disabled,items,count,unavailable,unsupported,partial,stale,filteredByPage,hasMore}=await (prepared||readAjesRailData(market,params));
 // Never hide a configured market merely because its first supplier page has no matches.
 if(disabled)return null;
 const total=exactAjesCount(count);
 return <section aria-label={label} className="min-w-0">
  <div className="mb-3 flex items-end justify-between gap-3">
   <h2 className="flex flex-wrap items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><CatalogMarketFlag market={market} className="h-5 w-7 md:h-6 md:w-9"/><span>{label}</span>{count?<MarketResultCount total={total??undefined}>{ajesCountText(count)}</MarketResultCount>:<Suspense fallback={<MarketResultCount>{ajesCountText(null)}</MarketResultCount>}><RailCount market={market} params={params}/></Suspense>}</h2>
   <Link href={href} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link>
  </div>

  <CatalogSectionLoading/>
  {String(params.sort||'').split(',').some(term=>term.startsWith('totalRub'))&&<p className="mb-3 text-sm text-[var(--ac-muted)]">По рассчитанной цене в загруженной подборке.</p>}
  {unsupported?<p role="status" className="text-sm text-[var(--ac-muted)]">Для выбранных условий проверяем подтверждённые характеристики японских машин. <Link href={href} className="underline">Открыть японский каталог</Link>.</p>:unavailable?<p role="status" className="rounded-xl border border-[var(--ac-border)] p-4 text-sm">Не удалось загрузить японскую подборку. <Link href={href} className="underline">Повторить поиск</Link></p>:items.length?<div className={MARKET_RAIL_CLASS}>{items.map(offer=><div key={offer!.id} className="min-w-0"><CatalogCard offer={publicOffer(offer!)} compact dense/></div>)}</div>:<p role="status" className="text-sm text-[var(--ac-muted)]">{filteredByPage||partial||stale||hasMore?'В текущей загруженной подборке совпадений нет; это не означает, что машин в Японии нет.':'В первой подборке японских автомобилей пока нет. Каталог доступен для поиска.'} <Link href={href} className="underline">Открыть Японию</Link></p>}
 </section>;
}

export async function CatalogEmptyResults({localTotal,reads}:{localTotal:number;reads:RailData[]}){
 if(localTotal>0)return null;
 const results=await Promise.all(reads);
 if(results.some(r=>r.unavailable||r.items.length||r.partial||r.stale||r.hasMore))return null;
 return <p role="status" className="rounded-2xl bg-[var(--ac-surface)] p-6 text-sm text-[var(--ac-muted)]">По выбранным параметрам автомобили не найдены. Попробуйте изменить условия поиска.</p>;
}
