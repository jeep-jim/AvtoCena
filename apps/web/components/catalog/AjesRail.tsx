import {Suspense} from 'react';
import {assertAjesJapanMarket} from '@/lib/catalog/ajes-access-policy';
import {MARKET_RAIL_CLASS} from './market-rail-layout';
import {CatalogSectionLoading} from './CatalogLoading';
import {JapanCatalogCount} from './JapanCatalogCount';
import {DealerLink as Link} from '@/components/dealers/DealerBrowsingContext';
import {AjesFilterUnavailable} from '@/lib/catalog/ajes-query';
import {readAjesCatalogPage,readAjesCountSummary} from '@/lib/catalog/ajes-catalog';
import {exactAjesCount,latestAjesCountSummary,type AjesCountSummary} from '@/lib/catalog/ajes-count-display';
import {assertCollectionEnabled,CollectionDisabledError} from '@/lib/catalog/collection-controls';
import {publicOffer} from '@/lib/catalog/storage';
import {CatalogCard} from './CatalogCard';
import {JapanRailFrame,japanRailHref,japanSavedPreviewText} from './JapanRailFrame';

function railQuery(market:'japan'|'china'|'korea',params:Record<string,string|string[]|undefined>){assertAjesJapanMarket(market);return {...params,market,page:'1',pageSize:'24'};}
export async function readAjesRailCount(market:'japan'|'china'|'korea',params:Record<string,string|string[]|undefined>){
 assertAjesJapanMarket(market);
 try{await assertCollectionEnabled('ajes_japan_feed');return await readAjesCountSummary(JSON.stringify(railQuery(market,params)));}catch{return null;}
}
async function RailCount({market,params,previous,initialCount,pending}:{market:'japan'|'china'|'korea';params:Record<string,string|string[]|undefined>;previous?:AjesCountSummary|null;initialCount?:number;pending:Promise<AjesCountSummary|null>}){
 const count=latestAjesCountSummary(previous,await pending);
 return <JapanCatalogCount queryKey={JSON.stringify(railQuery(market,params))} summary={count} initialCount={initialCount} request={railQuery(market,params)}/>;
}
export async function readAjesRailData(market:'japan'|'china'|'korea',params:Record<string,string|string[]|undefined>={}){
 assertAjesJapanMarket(market);
 try{await assertCollectionEnabled('ajes_japan_feed');}catch(error){
  // Only an explicit owner switch hides the market. An unreadable settings
  // store must remain fail-closed for the supplier, with a visible outage.
  const disabled=error instanceof CollectionDisabledError;
  return {disabled,items:[],count:null,unavailable:!disabled,unsupported:false,partial:false,stale:false,filteredByPage:false,hasMore:false,observedAt:undefined};
 }
 try{
  // Reuse the normal first catalogue page for this six-card preview. A distinct
  // twelve-row query would need a separate supplier/cache read for the same visit.
  // Keep the separately streamed selection counter from delaying ready cards.
  // A complete single-LIST count from the page is still retained below.
  const page=await readAjesCatalogPage(railQuery(market,params),undefined,{includeCount:false});
  return {disabled:false,items:page.items.slice(0,6),count:page.countSummary,unavailable:false,unsupported:false,partial:Boolean(page.partial),stale:Boolean(page.stale),filteredByPage:page.filteredByPage,hasMore:page.hasMore,observedAt:page.observedAt};
 }catch(error){return {disabled:false,items:[],count:null,unavailable:true,unsupported:error instanceof AjesFilterUnavailable,partial:false,stale:false,filteredByPage:false,hasMore:false,observedAt:undefined};}
}
type RailData=ReturnType<typeof readAjesRailData>;
export async function AjesRail({market='japan',params={},prepared}:{market?:'japan'|'china'|'korea';params?:Record<string,string|string[]|undefined>;prepared?:RailData}={}){
 assertAjesJapanMarket(market);
 const href=japanRailHref(params);
 const pendingCount=readAjesRailCount(market,params);
 const {disabled,items,count,unavailable,unsupported,partial,stale,filteredByPage,hasMore,observedAt}=await (prepared||readAjesRailData(market,params));
 if(disabled)return null;
 const total=exactAjesCount(count);
 return <JapanRailFrame params={params} status={unavailable||unsupported?'unavailable':items.length?'ready':'empty'} count={total!==undefined?<JapanCatalogCount queryKey={JSON.stringify(railQuery(market,params))} summary={count} initialCount={items.length} request={railQuery(market,params)}/>:<Suspense fallback={<JapanCatalogCount queryKey={JSON.stringify(railQuery(market,params))} summary={count} initialCount={items.length} request={railQuery(market,params)} serverPending/>}><RailCount market={market} params={params} previous={count} initialCount={items.length} pending={pendingCount}/></Suspense>}>
  <CatalogSectionLoading/>
  {(partial||stale)&&items.length>0?<p role="status" className="mb-3 text-sm text-[var(--ac-muted)]">{stale?japanSavedPreviewText(observedAt):'Показана доступная часть подборки.'} <Link href={href} className="underline">Открыть каталог</Link></p>:null}
  {unsupported?<p role="status" className="text-sm text-[var(--ac-muted)]">Не удалось применить выбранные условия. <Link href={href} className="underline">Открыть каталог</Link></p>:unavailable?<p role="status" className="rounded-xl border border-[var(--ac-border)] p-4 text-sm">Не удалось загрузить автомобили. <Link href={href} className="underline">Открыть каталог</Link></p>:items.length?<div className={MARKET_RAIL_CLASS}>{items.map(offer=><div key={offer!.id} className="min-w-0"><CatalogCard offer={publicOffer(offer!)} compact dense/></div>)}</div>:<p role="status" className="text-sm text-[var(--ac-muted)]">{filteredByPage||partial||hasMore||stale?'В загруженной подборке совпадений нет.':total===0?'По выбранным параметрам автомобили не найдены.':'В этой подборке автомобили пока не отображаются.'} <Link href={href} className="underline">Продолжить поиск</Link></p>}
 </JapanRailFrame>;
}

export async function CatalogEmptyResults({localTotal,reads}:{localTotal:number;reads:RailData[]}){
 if(localTotal>0)return null;
 const results=await Promise.all(reads);
 if(results.some(r=>r.unavailable||r.items.length||r.partial||r.stale||r.hasMore))return null;
 return <p role="status" className="rounded-2xl bg-[var(--ac-surface)] p-6 text-sm text-[var(--ac-muted)]">По выбранным параметрам автомобили не найдены. Попробуйте изменить условия поиска.</p>;
}
