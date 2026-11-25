import {assertAjesJapanMarket} from '@/lib/catalog/ajes-access-policy';
import {catalogSearchHeading} from '@/lib/catalog/catalog-routes';
import {Suspense} from 'react';
import {CatalogResultCountUpdate} from './CatalogSelectionContext';
import {MarketResultCount} from './MarketResultCount';
import {CatalogCountLabel} from './CatalogCountLabel';
import type {DealerBrowsingContext} from '@/lib/dealers/browsing-context';
import {CatalogSidebar} from './CatalogSidebar';
import {DealerLink as Link} from '@/components/dealers/DealerBrowsingContext';
import {PublicHeader} from '@/components/layout/PublicHeader';
import {CatalogCard} from './CatalogCard';
import {CatalogFilters} from './CatalogFilters';
import {CatalogLoadMore} from './CatalogLoadMore';
import {BrandLogoRail} from './BrandLogoRail';
import {JapanSectionTabs} from './JapanSectionTabs';
import {CatalogMarketFlag} from './CatalogMarketFlag';
import {readAjesCatalogPage,readAjesCountSummary,readAjesMakes,AjesFilterUnavailable} from '@/lib/catalog/ajes-catalog';
import {AjesInputError} from '@/lib/catalog/ajes-query';
import {AjesUnavailable} from '@/lib/catalog/ajes-client';
import {ajesCountText,exactAjesCount,ajesPaginationCountText} from '@/lib/catalog/ajes-count-display';
import {formatCatalogCount} from '@/lib/catalog/count-format';
import {JAPAN_POWER_FILTER_NOTICE} from '@/lib/catalog/ajes-power-estimate';
type Params=Record<string,string|string[]|undefined>;
export async function AjesCatalog({params,embedded=false,dealer}:{params:Params;embedded?:boolean;dealer?:DealerBrowsingContext|null}){
 const initial=Object.fromEntries(Object.entries(params).map(([k,v])=>[k,Array.isArray(v)?v[0]||'':v||'']));assertAjesJapanMarket(initial.market);const market='japan';const label='Япония';initial.market=market;if(!initial.make&&initial.brand)initial.make=initial.brand;
 let result:Awaited<ReturnType<typeof readAjesCatalogPage>>|undefined,error='';
 // The independent streamed count below starts after the visible page. Two
 // concurrent category visits must not fill both supplier slots with counts.
 try{result=await readAjesCatalogPage(initial,undefined,{includeCount:false});}catch(e){error=e instanceof AjesFilterUnavailable?'Это условие поиска пока не поддерживается для выбранного рынка. Снимите его; уточнить параметры и рассчитать доставку можно в карточке.':e instanceof AjesInputError?'Проверьте условия и диапазоны поиска.':e instanceof AjesUnavailable&&e.reason==='visitor_restricted'?'Источник отклонил подключение. Сохранённых результатов этого поиска пока нет. Попробуйте позже.':'Не удалось обновить автомобили. Попробуйте позже.';}
 // Complete brand/model directories are optional navigation metadata. The
 // controls already fetch them on opening; never hold visible cards behind them.
 // The AJ count is unfiltered by locally resolved horsepower. Never present a
 // supplier-wide count as if it were the exact result of powerTo=160.
 const powerSelected=Boolean(initial.powerFrom||initial.powerTo);
 const sourceTotal=powerSelected?null:result?.countSummary;
 const verifiedTotal=powerSelected&&result?.total!==null&&result?.total!==undefined&&!result.partial&&!result.stale&&!result.scanLimited
   ? result.total : undefined;
 const displayTotal=powerSelected?verifiedTotal:exactAjesCount(sourceTotal);
 const countText=powerSelected
   ? displayTotal!==undefined?formatCatalogCount(displayTotal):`Показано ${result?.items.length??0} · всего уточняется`
   :ajesCountText(sourceTotal);
 const models=[...new Map<string,{make:string;model:string;total:number}>((result?.items||[]).map((item:any)=>[`${item.make}|${item.model}`,{make:String(item.make),model:String(item.model),total:0}])).values()];
 const makes=[...new Set([...models.map(m=>m.make),...(initial.make||'').split(',').filter(Boolean)])];
 const facets={makes,models,markets:[market],bodyTypes:[],fuels:['petrol','diesel','hybrid','electric','lpg'],transmissions:['automatic','manual','cvt','dct'],drives:['fwd','rwd','awd']};
 const Container=embedded?'div':'main';
 return <Container className={`ac-catalog-page ac-page-copy ac-ajes-catalog ${embedded?'dealer-shared-catalog':'min-h-screen text-[var(--ac-text)]'}`}>
 {!embedded&&<PublicHeader backHref="/" backLabel="На главную"/>}
 <section className={embedded?'ac-catalog-shell w-full py-5':'ac-catalog-shell mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10'}>
 <CatalogSidebar dealerLayout={embedded} resultScope={`ajes:${market}:${embedded}`} resultError={error||undefined} filters={<CatalogFilters initial={initial} facets={facets} resultCount={displayTotal??undefined} auctionResults/>} header={<div className={embedded?"ac-dealer-catalog-title":"contents"}>


 {!embedded&&<nav aria-label="Хлебные крошки" className="ac-catalog-breadcrumbs mb-4 flex items-center gap-2 text-xs font-black text-[var(--ac-muted)]"><Link href="/">Главная</Link><span>/</span><Link href="/cars">Каталог</Link><span>/</span><span aria-current="page">{label}</span></nav>}
 <div className={embedded?"ac-dealer-catalog-title-line":"contents"}>
 <h1 className="text-[30px] font-black leading-none tracking-[-0.04em] sm:text-4xl md:text-6xl">{embedded?"Авто под заказ":catalogSearchHeading(initial)}</h1>
 {embedded&&<p className="ac-catalog-result-count hidden md:flex items-center gap-2 text-[var(--ac-muted)]" role="status">
  <span className="ac-pulse-dot ac-pulse-dot--status shrink-0" aria-hidden="true"><span/></span>
  <CatalogCountLabel total={displayTotal??0} countIncomplete={displayTotal===undefined}/>
 </p>}
 </div>
 </div>}>
 <Suspense fallback={<BrandLogoRail initial={initial} brands={makes.filter(make=>!initial.make||initial.make.split(',').some(value=>value.toLowerCase()===make.toLowerCase()))} resultCount={displayTotal??undefined}/>}>
  <AjesBrandRail initial={initial} fallbackBrands={makes} resultCount={displayTotal??undefined}/>
 </Suspense>
 <div className="mb-4 mt-8 flex flex-wrap items-center justify-between gap-3 md:mt-9">
 <h2 className="flex flex-wrap items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><CatalogMarketFlag market={market} className="h-5 w-7 md:h-6 md:w-9"/><span>{label}</span><Suspense fallback={<MarketResultCount>{ajesCountText(sourceTotal)}</MarketResultCount>}>{powerSelected?<><CatalogResultCountUpdate queryKey={JSON.stringify(initial)} text={countText} total={displayTotal}/><MarketResultCount total={displayTotal}>{countText}</MarketResultCount></>:sourceTotal?<><CatalogResultCountUpdate queryKey={JSON.stringify(initial)} text={ajesCountText(sourceTotal)} total={exactAjesCount(sourceTotal)}/><MarketResultCount total={displayTotal??undefined}>{ajesCountText(sourceTotal)}</MarketResultCount></>:<AjesIndependentCount initial={initial}/>}</Suspense></h2>
 {market==='japan'&&<JapanSectionTabs active="auction" params={initial}/>}
 </div>
 {result&&<div>
 {powerSelected&&<p role="status" className="mb-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-[var(--ac-muted)]">{JAPAN_POWER_FILTER_NOTICE} Неизвестная мощность не считается подходящей; число машин уточняется по разрешённым запросам AJ System.</p>}
 {!result.items.length&&(result.partial||result.stale||result.scanLimited||result.hasMore)&&<p role="status" className="mb-3 rounded-xl border border-[var(--ac-border)] p-4 text-sm text-[var(--ac-muted)]">Пока нет подтверждённых совпадений в загруженной части японского каталога. Это не означает отсутствие подходящих автомобилей; уточните модель или повторите поиск.</p>}
 {String(initial.sort||'').split(',').some(term=>term.startsWith('totalRub'))&&<p className="mb-3 text-sm text-[var(--ac-muted)]">По рассчитанной цене в загруженной подборке. На следующих страницах могут быть более дешёвые автомобили.</p>}
 {!result.items.length&&!result.hasMore&&!result.partial&&!result.stale&&<p role="status" className="rounded-2xl bg-[var(--ac-surface)] p-6 text-sm text-[var(--ac-muted)]">По выбранным параметрам автомобили не найдены. Попробуйте изменить условия поиска.</p>}
 <CatalogLoadMore resultQueryKey={JSON.stringify(initial)} key={JSON.stringify(initial)} query={{...initial,market} as any} initialPage={result.page} initialTotal={result.total} initialCount={result.items.length} initialCards={result.items.map((offer:any)=><CatalogCard key={offer.id} offer={offer} compact dense/>)} initialIncomplete={Boolean(result.partial||result.stale||result.scanLimited)} initialHasMore={result.hasMore} initialNextCursor={result.nextCursor} resultCountLabel={ajesPaginationCountText(sourceTotal)}/>
 </div>}
</CatalogSidebar>
 </section>
 <style dangerouslySetInnerHTML={{__html:'html body .ac-catalog-page.ac-ajes-catalog{background:var(--ac-page-bg)!important;background-image:none!important}'}}/>
 </Container>;
}

async function AjesBrandRail({initial,fallbackBrands,resultCount}:{initial:Record<string,string>;fallbackBrands:string[];resultCount?:number}){
 const directory=await readAjesMakes(JSON.stringify(initial)).catch(()=>null);
 const brands=directory?directory.makes.filter(row=>row.total>0).map(row=>row.make):fallbackBrands;
 return <BrandLogoRail initial={initial} brands={brands.filter(make=>!initial.make||initial.make.split(',').some(value=>value.toLowerCase()===make.toLowerCase()))} resultCount={resultCount}/>;
}

async function AjesIndependentCount({initial}:{initial:Record<string,string>}){
 const summary=await readAjesCountSummary(JSON.stringify(initial)).catch(()=>null);
 return <><CatalogResultCountUpdate queryKey={JSON.stringify(initial)} text={ajesCountText(summary)} total={exactAjesCount(summary)}/><MarketResultCount total={exactAjesCount(summary)??undefined}>{ajesCountText(summary)}</MarketResultCount></>;
}
