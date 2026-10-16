import {DealerLink as Link} from '@/components/dealers/DealerBrowsingContext';
import {PublicHeader} from '@/components/layout/PublicHeader';
import {CatalogCard} from './CatalogCard';
import {CatalogFilters} from './CatalogFilters';
import {CatalogLoadMore} from './CatalogLoadMore';
import {BrandLogoRail} from './BrandLogoRail';
import {JapanSectionTabs} from './JapanSectionTabs';
import {CatalogMarketFlag} from './CatalogMarketFlag';
import {readAjesCatalogPage,readAjesDirectory,AjesFilterUnavailable} from '@/lib/catalog/ajes-catalog';
import {AjesInputError} from '@/lib/catalog/ajes-query';
import {AjesUnavailable} from '@/lib/catalog/ajes-client';
import {formatCatalogCount} from '@/lib/catalog/count-format';
type Params=Record<string,string|string[]|undefined>;
export async function AjesCatalog({params,embedded=false}:{params:Params;embedded?:boolean}){
 const initial=Object.fromEntries(Object.entries(params).map(([k,v])=>[k,Array.isArray(v)?v[0]||'':v||'']));initial.market='japan';if(!initial.make&&initial.brand)initial.make=initial.brand;
 let result:Awaited<ReturnType<typeof readAjesCatalogPage>>|undefined,error='';
 const directoryPromise=readAjesDirectory().catch(()=>null);
 try{result=await readAjesCatalogPage(initial);}catch(e){error=e instanceof AjesFilterUnavailable?'Для этих результатов пока нельзя точно отобрать автомобили по цене с доставкой, мощности или типу кузова. Снимите эти условия; расчёт доступен в карточке.':e instanceof AjesInputError?'Проверьте условия и диапазоны поиска.':e instanceof AjesUnavailable&&e.reason==='visitor_restricted'?'Источник отклонил подключение. Сохранённых результатов этого поиска пока нет. Попробуйте позже.':'Не удалось обновить автомобили. Попробуйте позже.';}
 const directory=await directoryPromise;
 const models=directory?.models||[...new Map((result?.items||[]).map((item:any)=>[`${item.make}|${item.model}`,{make:String(item.make),model:String(item.model),total:0}])).values()];
 const makes=[...new Set([...models.map(m=>m.make),...(initial.make||'').split(',').filter(Boolean)])];
 const facets={makes,models,markets:['japan'],bodyTypes:[],fuels:['petrol','diesel','hybrid','electric','lpg'],transmissions:['automatic','manual','cvt','dct'],drives:['fwd','rwd','awd']};
 const Container=embedded?'div':'main';
 return <Container className={`ac-catalog-page ac-page-copy ac-ajes-catalog ${embedded?'dealer-shared-catalog':'min-h-screen text-[var(--ac-text)]'}`}>
 {!embedded&&<PublicHeader backHref="/" backLabel="На главную"/>}
 <section className={embedded?'w-full py-5':'mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10'}>
 <JapanSectionTabs active="auction" params={initial}/>

 <h1 className="flex items-center gap-3 text-[30px] font-black leading-none tracking-[-0.04em] sm:text-4xl md:text-6xl"><CatalogMarketFlag market="japan" className="h-6 w-9"/>Япония <span className="text-sm text-[var(--ac-muted)] md:text-base" data-catalog-market-count={result?.total??undefined}>· {formatCatalogCount(result?.total??NaN)}</span></h1>
 <p className="mt-4 text-sm text-[var(--ac-muted)]">Цены завершённых торгов — ориентир для покупки похожего автомобиля. Доставка и оформление рассчитываются в карточке.</p>
 <p role="status" className="ac-catalog-result-count mt-3 flex items-center gap-2 text-sm text-[var(--ac-muted)]" data-catalog-result-count={result?.total??undefined}><span className="ac-pulse-dot ac-pulse-dot--status"><span/></span>{result?.total!=null?`Найдено: ${formatCatalogCount(result.total)}`:'Количество уточняется'}</p>
 <CatalogFilters initial={initial} facets={facets} resultCount={result?.total??undefined} auctionResults/>
 {makes.length>0&&<BrandLogoRail brands={makes} resultCount={result?.total??undefined}/>}
 {error&&<p role="status" className="my-6 rounded-2xl bg-[var(--ac-surface)] p-5">{error} <Link className="underline" href="/cars?market=japan">Сбросить условия</Link></p>}
 {result&&<div className="mt-8">{result.stale&&<p className="mb-4 text-sm text-[var(--ac-muted)]">Сохранённые результаты от {new Date(result.observedAt).toLocaleDateString('ru-RU')}. Обновление временно недоступно.</p>}
 <CatalogLoadMore key={JSON.stringify(initial)} query={{...initial,market:'japan'} as any} initialPage={result.page} initialTotal={result.total} initialCount={result.items.length} initialCards={result.items.map((offer:any)=><CatalogCard key={offer.id} offer={offer} compact dense/>)} initialHasMore={result.received===result.pageSize}/>
 </div>}
 </section>
 <style dangerouslySetInnerHTML={{__html:'html body .ac-catalog-page.ac-ajes-catalog{background:var(--ac-page-bg)!important;background-image:none!important}'}}/>
 </Container>;
}
