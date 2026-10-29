import {Suspense} from 'react';
import {CatalogResultCountUpdate} from './CatalogSelectionContext';
import {MarketResultCount} from './MarketResultCount';
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
type Params=Record<string,string|string[]|undefined>;
export async function AjesCatalog({params,embedded=false}:{params:Params;embedded?:boolean}){
 const initial=Object.fromEntries(Object.entries(params).map(([k,v])=>[k,Array.isArray(v)?v[0]||'':v||'']));const market=initial.market==='china'?'china':initial.market==='korea'?'korea':'japan';const label=market==='china'?'Китай':market==='korea'?'Корея':'Япония';initial.market=market;if(market!=='japan')initial.source='ajes';if(!initial.make&&initial.brand)initial.make=initial.brand;
 let result:Awaited<ReturnType<typeof readAjesCatalogPage>>|undefined,error='';
 // The independent streamed count below starts after the visible page. Two
 // concurrent category visits must not fill both supplier slots with counts.
 try{result=await readAjesCatalogPage(initial,undefined,{includeCount:false});}catch(e){error=e instanceof AjesFilterUnavailable?'Это условие поиска пока не поддерживается для выбранного рынка. Снимите его; уточнить параметры и рассчитать доставку можно в карточке.':e instanceof AjesInputError?'Проверьте условия и диапазоны поиска.':e instanceof AjesUnavailable&&e.reason==='visitor_restricted'?'Источник отклонил подключение. Сохранённых результатов этого поиска пока нет. Попробуйте позже.':'Не удалось обновить автомобили. Попробуйте позже.';}
 // Complete brand/model directories are optional navigation metadata. The
 // controls already fetch them on opening; never hold visible cards behind them.
 const sourceTotal=result?.countSummary;
 const displayTotal=exactAjesCount(sourceTotal);
 const models=[...new Map<string,{make:string;model:string;total:number}>((result?.items||[]).map((item:any)=>[`${item.make}|${item.model}`,{make:String(item.make),model:String(item.model),total:0}])).values()];
 const makes=[...new Set([...models.map(m=>m.make),...(initial.make||'').split(',').filter(Boolean)])];
 const facets={makes,models,markets:[market],bodyTypes:[],fuels:['petrol','diesel','hybrid','electric','lpg'],transmissions:['automatic','manual','cvt','dct'],drives:['fwd','rwd','awd']};
 const Container=embedded?'div':'main';
 return <Container className={`ac-catalog-page ac-page-copy ac-ajes-catalog ${embedded?'dealer-shared-catalog':'min-h-screen text-[var(--ac-text)]'}`}>
 {!embedded&&<PublicHeader backHref="/" backLabel="На главную"/>}
 <section className={embedded?'ac-catalog-shell w-full py-5':'ac-catalog-shell mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10'}>
 <CatalogSidebar resultScope={`ajes:${market}:${embedded}`} resultError={error||undefined} filters={<CatalogFilters initial={initial} facets={facets} resultCount={displayTotal??undefined} auctionResults/>} header={<>


 <nav aria-label="Хлебные крошки" className="ac-catalog-breadcrumbs mb-4 flex items-center gap-2 text-xs font-black text-[var(--ac-muted)]"><Link href="/">Главная</Link><span>/</span><Link href="/cars">Каталог</Link><span>/</span><span aria-current="page">{label}</span></nav>
 <h1 className="text-[30px] font-black leading-none tracking-[-0.04em] sm:text-4xl md:text-6xl">{embedded?"Авто под заказ":"Каталог автомобилей"}</h1>

 </>}>
 <Suspense fallback={<BrandLogoRail initial={initial} brands={makes.filter(make=>!initial.make||initial.make.split(',').some(value=>value.toLowerCase()===make.toLowerCase()))} resultCount={displayTotal??undefined}/>}>
  <AjesBrandRail initial={initial} fallbackBrands={makes} resultCount={displayTotal??undefined}/>
 </Suspense>
 <div className="mb-4 mt-8 flex flex-wrap items-center justify-between gap-3 md:mt-9">
 <h2 className="flex flex-wrap items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><CatalogMarketFlag market={market} className="h-5 w-7 md:h-6 md:w-9"/><span>{label}</span><Suspense fallback={<MarketResultCount>{ajesCountText(sourceTotal)}</MarketResultCount>}>{sourceTotal?<><CatalogResultCountUpdate queryKey={JSON.stringify(initial)} text={ajesCountText(sourceTotal)}/><MarketResultCount total={displayTotal??undefined}>{ajesCountText(sourceTotal)}</MarketResultCount></>:<AjesIndependentCount initial={initial}/>}</Suspense></h2>
 {market==='japan'&&<JapanSectionTabs active="auction" params={initial}/>}
 </div>
 {result&&<div>
 {String(initial.sort||'').split(',').some(term=>term.startsWith('totalRub'))&&<p className="mb-3 text-sm text-[var(--ac-muted)]">По рассчитанной цене в загруженной подборке. На следующих страницах могут быть более дешёвые автомобили.</p>}
 {!result.items.length&&!result.hasMore&&!result.partial&&!result.stale&&<p role="status" className="rounded-2xl bg-[var(--ac-surface)] p-6 text-sm text-[var(--ac-muted)]">По выбранным параметрам автомобили не найдены. Попробуйте изменить условия поиска.</p>}
 <CatalogLoadMore key={JSON.stringify(initial)} query={{...initial,market} as any} initialPage={result.page} initialTotal={result.total} initialCount={result.items.length} initialCards={result.items.map((offer:any)=><CatalogCard key={offer.id} offer={offer} compact dense/>)} initialIncomplete={Boolean(result.partial||result.stale)} initialHasMore={result.hasMore} initialNextCursor={result.nextCursor} resultCountLabel={ajesPaginationCountText(sourceTotal)}/>
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
 return <><CatalogResultCountUpdate queryKey={JSON.stringify(initial)} text={ajesCountText(summary)}/><MarketResultCount total={exactAjesCount(summary)??undefined}>{ajesCountText(summary)}</MarketResultCount></>;
}
