import {DealerLink as Link} from '@/components/dealers/DealerBrowsingContext';
import {AjesFilterUnavailable} from '@/lib/catalog/ajes-query';
import {readAjesCountSummary,readAjesCatalogPage} from '@/lib/catalog/ajes-catalog';
import {ajesCountText,exactAjesCount} from '@/lib/catalog/ajes-count-display';
import {readAjesPublic} from '@/lib/catalog/ajes-public';
import {assertCollectionEnabled} from '@/lib/catalog/collection-controls';
import {publicOffer} from '@/lib/catalog/storage';
import {CatalogCard} from './CatalogCard';
import {CatalogMarketFlag} from './CatalogMarketFlag';

export async function AjesRail({market='japan',params={}}:{market?:'japan'|'china'|'korea';params?:Record<string,string|string[]|undefined>}={}){
 const label=market==='korea'?'Корея':market==='china'?'Китай':'Япония';
 const linkParams=new URLSearchParams(Object.entries(params).flatMap(([key,value])=>value?[[key,Array.isArray(value)?value[0]:value]]:[]));linkParams.set('market',market);linkParams.delete('page');linkParams.delete('source');
 const href='/cars?'+linkParams.toString();
 try{await assertCollectionEnabled(`ajes_${market}_feed`);}catch{return null;}
 const query={...params,market};
 const totalPromise=readAjesCountSummary(JSON.stringify(query)).catch(()=>null);
 let items:Awaited<ReturnType<typeof readAjesPublic>>['items']=[],unavailable=false,unsupported=false,partial=false,stale=false,filteredByPage=false,hasMore=false;
 try{const page=await readAjesCatalogPage(query);items=page.items.slice(0,6);partial=Boolean(page.partial);stale=Boolean(page.stale);filteredByPage=page.filteredByPage;hasMore=page.hasMore;}catch(error){unavailable=true;unsupported=error instanceof AjesFilterUnavailable;}
 const count=await totalPromise;const total=exactAjesCount(count);
 return <section aria-label={label} className="min-w-0">
  <div className="mb-3 flex items-end justify-between gap-3">
   <h2 className="flex items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><CatalogMarketFlag market={market} className="h-5 w-7 md:h-6 md:w-9"/><span>{label}</span><span className="whitespace-nowrap text-sm text-[var(--ac-muted)] md:text-base" data-catalog-market-count={total??undefined}>· {ajesCountText(count)}</span></h2>
   <Link href={href} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link>
  </div>

  {market!=='japan'&&(partial||stale)&&items.length>0&&<p role="status" className="mb-3 text-sm text-[var(--ac-muted)]">Показана доступная часть предложений.</p>}
  {unsupported?<p role="status" className="text-sm text-[var(--ac-muted)]">Отбор по мощности доступен в <Link href={href+'&stock=green'} className="underline">Зелёном углу</Link>.</p>:unavailable?<p role="status" className="rounded-xl border border-[var(--ac-border)] p-4 text-sm">Не удалось загрузить автомобили. <Link href={href} className="underline">Открыть каталог</Link></p>:items.length?<div className="ac-catalog-market-rail -mr-4 grid grid-flow-col auto-cols-[47%] gap-2.5 overflow-x-auto pr-4 [scrollbar-width:none] md:mr-0 md:grid-flow-row md:auto-cols-auto md:grid-cols-5 md:overflow-visible md:pr-0">{items.map(offer=><div key={offer!.id} className="min-w-0"><CatalogCard offer={publicOffer(offer!)} compact dense/></div>)}</div>:<p className="text-sm text-[var(--ac-muted)]">{filteredByPage||partial||hasMore?'В загруженной подборке совпадений нет.':'Подходящих автомобилей пока нет.'} {(filteredByPage||partial||hasMore)&&<Link href={href} className="underline">Продолжить поиск</Link>}</p>}
 </section>;
}
