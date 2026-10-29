import {Suspense} from 'react';
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

function railQuery(market:'japan'|'china'|'korea',params:Record<string,string|string[]|undefined>){return {...params,market,page:'1',pageSize:market==='japan'?'12':'6'};}
export function readAjesRailCount(market:'japan'|'china'|'korea',params:Record<string,string|string[]|undefined>){return readAjesCountSummary(JSON.stringify(railQuery(market,params))).catch(()=>null);}
async function RailCount({market,params}:{market:'japan'|'china'|'korea';params:Record<string,string|string[]|undefined>}){
 const count=await readAjesRailCount(market,params);
 return <MarketResultCount total={exactAjesCount(count)??undefined}>{ajesCountText(count)}</MarketResultCount>;
}
export async function readAjesRailData(market:'japan'|'china'|'korea',params:Record<string,string|string[]|undefined>={}){
 try{await assertCollectionEnabled(`ajes_${market}_feed`);}catch{return {disabled:true,items:[],count:null,unavailable:false,unsupported:false,partial:false,stale:false,filteredByPage:false,hasMore:false};}
 try{
  // A supplier page may contain rejected rows. One bounded extra row of candidates
  // fills the six-card preview without pagination scans or bypassing admission.
  // The overview starts Japan and Korea together. Their two optional counts
  // must not take both supplier slots before the visible lists can run.
  // RailCount and the overview total already read counts after these rows.
  const page=await readAjesCatalogPage(railQuery(market,params),undefined,{includeCount:false});
  return {disabled:false,items:page.items.slice(0,6),count:page.countSummary,unavailable:false,unsupported:false,partial:Boolean(page.partial),stale:Boolean(page.stale),filteredByPage:page.filteredByPage,hasMore:page.hasMore};
 }catch(error){return {disabled:false,items:[],count:null,unavailable:true,unsupported:error instanceof AjesFilterUnavailable,partial:false,stale:false,filteredByPage:false,hasMore:false};}
}
type RailData=ReturnType<typeof readAjesRailData>;
export async function AjesRail({market='japan',params={},prepared}:{market?:'japan'|'china'|'korea';params?:Record<string,string|string[]|undefined>;prepared?:RailData}={}){
 const label=market==='korea'?'Корея':market==='china'?'Китай':'Япония';
 const linkParams=new URLSearchParams(Object.entries(params).flatMap(([key,value])=>value?[[key,Array.isArray(value)?value[0]:value]]:[]));linkParams.set('market',market);linkParams.delete('page');linkParams.delete('source');
 const href='/cars?'+linkParams.toString();
 const {disabled,items,count,unavailable,unsupported,partial,stale,filteredByPage,hasMore}=await (prepared||readAjesRailData(market,params));
 if(disabled||(!unavailable&&!items.length&&!partial&&!stale&&!hasMore))return null;
 const total=exactAjesCount(count);
 return <section aria-label={label} className="min-w-0">
  <div className="mb-3 flex items-end justify-between gap-3">
   <h2 className="flex flex-wrap items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><CatalogMarketFlag market={market} className="h-5 w-7 md:h-6 md:w-9"/><span>{label}</span>{count||unavailable?<MarketResultCount total={total??undefined}>{ajesCountText(count)}</MarketResultCount>:<Suspense fallback={<MarketResultCount>{ajesCountText(null)}</MarketResultCount>}><RailCount market={market} params={params}/></Suspense>}</h2>
   <Link href={href} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link>
  </div>

  <CatalogSectionLoading/>
  {String(params.sort||'').split(',').some(term=>term.startsWith('totalRub'))&&<p className="mb-3 text-sm text-[var(--ac-muted)]">По рассчитанной цене в загруженной подборке.</p>}
  {unsupported?<p role="status" className="text-sm text-[var(--ac-muted)]">Отбор по мощности доступен в <Link href={href+'&stock=green'} className="underline">Зелёном углу</Link>.</p>:unavailable?<p role="status" className="rounded-xl border border-[var(--ac-border)] p-4 text-sm">Не удалось загрузить автомобили. <Link href={href} className="underline">Открыть каталог</Link></p>:items.length?<div className={MARKET_RAIL_CLASS}>{items.map(offer=><div key={offer!.id} className="min-w-0"><CatalogCard offer={publicOffer(offer!)} compact dense/></div>)}</div>:<p className="text-sm text-[var(--ac-muted)]">{filteredByPage||partial||hasMore?'В загруженной подборке совпадений нет.':'Подходящих автомобилей пока нет.'} {(filteredByPage||partial||hasMore)&&<Link href={href} className="underline">Продолжить поиск</Link>}</p>}
 </section>;
}

export async function CatalogEmptyResults({localTotal,reads}:{localTotal:number;reads:RailData[]}){
 if(localTotal>0)return null;
 const results=await Promise.all(reads);
 if(results.some(r=>r.unavailable||r.items.length||r.partial||r.stale||r.hasMore))return null;
 return <p role="status" className="rounded-2xl bg-[var(--ac-surface)] p-6 text-sm text-[var(--ac-muted)]">По выбранным параметрам автомобили не найдены. Попробуйте изменить условия поиска.</p>;
}
