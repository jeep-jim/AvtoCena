import {assertAjesJapanMarket} from '@/lib/catalog/ajes-access-policy';
import {catalogSearchHeading} from '@/lib/catalog/catalog-routes';
import {Suspense} from 'react';
import {CatalogResultCountUpdate} from './CatalogSelectionContext';
import {JapanCatalogCount} from './JapanCatalogCount';
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
import {AjesInputError,AjesCursorRefreshRequired} from '@/lib/catalog/ajes-query';
import {AjesUnavailable} from '@/lib/catalog/ajes-client';
import {ajesSsrReadEvidence} from '@/lib/catalog/ajes-ssr-read-evidence';
import {ajesCountText,ajesVisibleCount,ajesPaginationCountText,latestAjesCountSummary,type AjesCountSummary} from '@/lib/catalog/ajes-count-display';
type Params=Record<string,string|string[]|undefined>;
export async function AjesCatalog({params,embedded=false,dealer}:{params:Params;embedded?:boolean;dealer?:DealerBrowsingContext|null}){
 const initial=Object.fromEntries(Object.entries(params).map(([k,v])=>[k,Array.isArray(v)?v[0]||'':v||'']));assertAjesJapanMarket(initial.market);const market='japan';const label='Япония';initial.market=market;if(!initial.make&&initial.brand)initial.make=initial.brand;
 let result:Awaited<ReturnType<typeof readAjesCatalogPage>>|undefined,error='',failedReceipt:unknown,refreshRequired=false;
 // Start the independent aggregate alongside LIST; neither a slow count nor
 // a slow page delays starting the other. Preserve a complete single-LIST count.
 const count=readAjesCountSummary(JSON.stringify(initial)).catch(()=>null);
 try{result=await readAjesCatalogPage(initial,undefined,{includeCount:false});}catch(e){if(e instanceof AjesUnavailable)failedReceipt=Object.getOwnPropertyDescriptor(e,'sourceReceipt')?.value;refreshRequired=e instanceof AjesCursorRefreshRequired;error=refreshRequired?'Данные подбора обновились. Откройте первую страницу — выбранные фильтры сохранены.':e instanceof AjesFilterUnavailable?'Это условие поиска пока не поддерживается для выбранного рынка. Снимите его; уточнить параметры и рассчитать доставку можно в карточке.':e instanceof AjesInputError?'Проверьте условия и диапазоны поиска.':e instanceof AjesUnavailable&&e.reason==='visitor_restricted'?'Источник отклонил подключение. Сохранённых результатов этого поиска пока нет. Попробуйте позже.':'Не удалось обновить автомобили. Попробуйте позже.';}
 // A failed/partial empty read is not a successful replacement of the previous
 // visible query. Keep its cards through the existing labelled recovery path.
 // A fresh scan-limited page alone still has a valid explicit continuation.
 if(result&&!result.items.length&&(result.partial||result.stale||result.interrupted))error='Не удалось обновить автомобили. Попробуйте позже.';
 // Complete brand/model directories are optional navigation metadata. The
 // controls already fetch them on opening; never hold visible cards behind them.
 const sourceTotal=result?.countSummary;
 const loadedCount=result?.items.length;
 const displayTotal=ajesVisibleCount(sourceTotal,loadedCount).total;
 const models=[...new Map<string,{make:string;model:string;total:number}>((result?.items||[]).map((item:any)=>[`${item.make}|${item.model}`,{make:String(item.make),model:String(item.model),total:0}])).values()];
 const makes=[...new Set([...models.map(m=>m.make),...(initial.make||'').split(',').filter(Boolean)])];
 const facets={makes,models,markets:[market],bodyTypes:[],fuels:['petrol','diesel','hybrid','electric','lpg'],transmissions:['automatic','manual','cvt','dct'],drives:['fwd','rwd','awd']};
 const restartParams=new URLSearchParams(Object.entries(initial).filter(([key,value])=>key!=='after'&&key!=='page'&&value!==''));
 const restartHref='/cars?'+restartParams;
 const Container=embedded?'div':'main';
 const readEvidence=embedded?undefined:ajesSsrReadEvidence(result?.page??(initial.page||1),initial.after,
  result?.sourceReceipts??(failedReceipt?[failedReceipt]:[]));
 return <Container data-japan-source-receipts={readEvidence} className={`ac-catalog-page ac-page-copy ac-ajes-catalog ${embedded?'dealer-shared-catalog':'min-h-screen text-[var(--ac-text)]'}`}>
 {!embedded&&<PublicHeader backHref="/" backLabel="На главную"/>}
 <section className={embedded?'ac-catalog-shell w-full py-5':'ac-catalog-shell mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10'}>
 <CatalogSidebar dealerLayout={embedded} resultScope={`ajes:${market}:${embedded}`} resultError={error||undefined} filters={<CatalogFilters initial={initial} facets={facets} resultCount={displayTotal??undefined} auctionResults/>} header={<div className={embedded?"ac-dealer-catalog-title":"contents"}>


 {!embedded&&<nav aria-label="Хлебные крошки" className="ac-catalog-breadcrumbs mb-4 flex items-center gap-2 text-xs font-black text-[var(--ac-muted)]"><Link href="/">Главная</Link><span>/</span><Link href="/cars">Каталог</Link><span>/</span><span aria-current="page">{label}</span></nav>}
 <div className={embedded?"ac-dealer-catalog-title-line":"contents"}>
 <h1 className="text-[30px] font-black leading-none tracking-[-0.04em] sm:text-4xl md:text-6xl">{embedded?"Авто под заказ":catalogSearchHeading(initial)}</h1>
 {embedded&&displayTotal!==undefined&&<p className="ac-catalog-result-count hidden md:flex items-center gap-2 text-[var(--ac-muted)]" role="status">
  <span className="ac-pulse-dot ac-pulse-dot--status shrink-0" aria-hidden="true"><span/></span>
  <CatalogCountLabel total={displayTotal??0} countIncomplete={displayTotal===undefined}/>
 </p>}
 </div>
 </div>}>
 <Suspense fallback={<BrandLogoRail initial={initial} brands={makes.filter(make=>!initial.make||initial.make.split(',').some(value=>value.toLowerCase()===make.toLowerCase()))} resultCount={displayTotal??undefined} sourceDirectoryState="loading"/>}>
  <AjesBrandRail initial={initial} fallbackBrands={makes} resultCount={displayTotal??undefined}/>
 </Suspense>
 <div className="mb-4 mt-8 flex flex-wrap items-center justify-between gap-3 md:mt-9">
 <h2 className="flex flex-wrap items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><CatalogMarketFlag market={market} className="h-5 w-7 md:h-6 md:w-9"/><span>{label}</span><Suspense fallback={<JapanCatalogCount queryKey={JSON.stringify(initial)} summary={sourceTotal} initialCount={loadedCount} request={initial} serverPending/>}>{displayTotal!==undefined?<><CatalogResultCountUpdate queryKey={JSON.stringify(initial)} text={ajesCountText(sourceTotal)} total={displayTotal} summary={sourceTotal}/><JapanCatalogCount queryKey={JSON.stringify(initial)} summary={sourceTotal} initialCount={loadedCount} request={initial}/></>:<AjesIndependentCount initial={initial} initialCount={loadedCount} previous={sourceTotal} count={count}/>}</Suspense></h2>
 {market==='japan'&&<JapanSectionTabs active="auction" params={initial}/>}
 </div>
 {!result&&error&&(refreshRequired||initial.after||Number(initial.page)>1)&&<Link href={restartHref} className="mb-3 inline-block text-sm font-bold underline">Открыть первую страницу</Link>}
 {result&&<div>
 {!result.items.length&&!result.hasMore&&!result.partial&&!result.stale&&!result.interrupted&&!result.scanLimited&&<p role="status" className="rounded-2xl bg-[var(--ac-surface)] p-6 text-sm text-[var(--ac-muted)]">По выбранным параметрам автомобили не найдены. Попробуйте изменить условия поиска.</p>}
 <CatalogLoadMore resultQueryKey={JSON.stringify(initial)} key={JSON.stringify(initial)} query={{...initial,market} as any} initialPage={result.page} initialTotal={result.total} initialCount={result.items.length} initialCards={result.items.map((offer:any)=><CatalogCard key={offer.id} offer={offer} compact dense/>)} initialPageKey={JSON.stringify([result.generationId,result.items.map(offer=>offer.id),result.nextCursor])} initialIncomplete={Boolean(result.partial||result.stale||result.interrupted||result.scanLimited)} initialHasMore={result.hasMore} initialNextCursor={result.nextCursor} resultCountLabel={displayTotal!==undefined?ajesPaginationCountText(sourceTotal):undefined}/>
 </div>}
</CatalogSidebar>
 </section>
 <style dangerouslySetInnerHTML={{__html:'html body .ac-catalog-page.ac-ajes-catalog{background:var(--ac-page-bg)!important;background-image:none!important}'}}/>
 </Container>;
}

async function AjesBrandRail({initial,fallbackBrands,resultCount}:{initial:Record<string,string>;fallbackBrands:string[];resultCount?:number}){
 // The brand rail describes the complete Japan auction inventory, not the
 // currently selected power/model/grade slice. Otherwise valid 24-card power
 // pages can receive an empty makes directory and erase all navigation.
 const directoryQuery=JSON.stringify({market:'japan',...(initial.city?{city:initial.city}:{})});
 const directory=await readAjesMakes(directoryQuery).catch(()=>null);
 const available=directory?.makes.filter(row=>row.total>0).map(row=>row.make)||[];
 // A zero-make directory contradicts visible Japan cards. Keep their verified
 // source identities even when the directory is temporarily empty/unavailable.
 const brands=[...new Set([...available,...fallbackBrands])];
 const complete=Boolean(directory&&!directory.stale&&available.length>0);
 return <BrandLogoRail initial={initial} brands={brands.filter(make=>!initial.make||initial.make.split(',').some(value=>value.toLowerCase()===make.toLowerCase()))} resultCount={resultCount} sourceDirectoryState={complete?'ready':'unavailable'}/>;
}

async function AjesIndependentCount({initial,initialCount,previous,count}:{initial:Record<string,string>;initialCount?:number;previous?:AjesCountSummary|null;count:Promise<AjesCountSummary|null>}){
 const summary=latestAjesCountSummary(previous,await count);
 const total=ajesVisibleCount(summary,initialCount).total;
 return <><CatalogResultCountUpdate queryKey={JSON.stringify(initial)} text={ajesCountText(summary)} total={total} summary={summary}/><JapanCatalogCount queryKey={JSON.stringify(initial)} summary={summary} initialCount={initialCount} request={initial}/></>;
}
