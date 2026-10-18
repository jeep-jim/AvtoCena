import {FeedSourceTabs} from './FeedSourceTabs';
import {DealerLink as Link} from '@/components/dealers/DealerBrowsingContext';
import {PublicHeader} from '@/components/layout/PublicHeader';
import {CatalogCard} from './CatalogCard';
import {CatalogFilters} from './CatalogFilters';
import {CatalogLoadMore} from './CatalogLoadMore';
import {BrandLogoRail} from './BrandLogoRail';
import {JapanSectionTabs} from './JapanSectionTabs';
import {CatalogMarketFlag} from './CatalogMarketFlag';
import {readAjesCatalogPage,readAjesCount,readAjesMakes,readAjesDirectory,AjesFilterUnavailable} from '@/lib/catalog/ajes-catalog';
import {AjesInputError} from '@/lib/catalog/ajes-query';
import {readSavedAjesFacets} from '@/lib/catalog/ajes-runtime';
import {AjesUnavailable} from '@/lib/catalog/ajes-client';
import {formatCatalogCount} from '@/lib/catalog/count-format';
type Params=Record<string,string|string[]|undefined>;
export async function AjesCatalog({params,embedded=false}:{params:Params;embedded?:boolean}){
 const initial=Object.fromEntries(Object.entries(params).map(([k,v])=>[k,Array.isArray(v)?v[0]||'':v||'']));const market=initial.market==='china'?'china':initial.market==='korea'?'korea':'japan';const label=market==='china'?'Китай':market==='korea'?'Корея':'Япония';initial.market=market;if(market!=='japan')initial.source='ajes';if(!initial.make&&initial.brand)initial.make=initial.brand;
 let result:Awaited<ReturnType<typeof readAjesCatalogPage>>|undefined,error='';
 const countPromise=readAjesCount(JSON.stringify(initial)).catch(()=>null);
 const makesPromise=readAjesMakes(JSON.stringify({market})).catch(()=>null);
 const directoryPromise=initial.make?readAjesDirectory({market,make:initial.make}).catch(()=>null):Promise.resolve(null);
 try{result=await readAjesCatalogPage(initial);}catch(e){error=e instanceof AjesFilterUnavailable?'Для этих результатов пока нельзя точно отобрать автомобили по цене с доставкой, мощности или типу кузова. Снимите эти условия; расчёт доступен в карточке.':e instanceof AjesInputError?'Проверьте условия и диапазоны поиска.':e instanceof AjesUnavailable&&e.reason==='visitor_restricted'?'Источник отклонил подключение. Сохранённых результатов этого поиска пока нет. Попробуйте позже.':'Не удалось обновить автомобили. Попробуйте позже.';}
 const directory=await directoryPromise;
 // Count is independently verified; a partial or failed list must not erase it.
 const displayTotal=await countPromise;
 const makeDirectory=await makesPromise;
 const savedFacets=market==='japan'&&(!makeDirectory||!directory)?await readSavedAjesFacets().catch(()=>({makes:[],models:[]})):{makes:[],models:[]};
 const models=directory?.models||[...savedFacets.models,...new Map((result?.items||[]).map((item:any)=>[`${item.make}|${item.model}`,{make:String(item.make),model:String(item.model),total:0}])).values()];
 const makes=[...new Set([...(makeDirectory?.makes.map(m=>m.make)||savedFacets.makes),...models.map(m=>m.make),...(initial.make||'').split(',').filter(Boolean)])];
 const facets={makes,models,markets:[market],bodyTypes:[],fuels:['petrol','diesel','hybrid','electric','lpg'],transmissions:['automatic','manual','cvt','dct'],drives:['fwd','rwd','awd']};
 const Container=embedded?'div':'main';
 return <Container className={`ac-catalog-page ac-page-copy ac-ajes-catalog ${embedded?'dealer-shared-catalog':'min-h-screen text-[var(--ac-text)]'}`}>
 {!embedded&&<PublicHeader backHref="/" backLabel="На главную"/>}
 <section className={embedded?'w-full py-5':'mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10'}>
 {market==='japan'?<JapanSectionTabs active="auction" params={initial}/>:<FeedSourceTabs market={market} active="ajes"/>}

 <nav aria-label="Хлебные крошки" className="ac-catalog-breadcrumbs mb-4 flex items-center gap-2 text-xs font-black text-[var(--ac-muted)]"><Link href="/">Главная</Link><span>/</span><Link href="/cars">Каталог</Link><span>/</span><span aria-current="page">{label}</span></nav>
 <h1 className="text-[30px] font-black leading-none tracking-[-0.04em] sm:text-4xl md:text-6xl">Авто под заказ</h1>
 <p role="status" className="ac-catalog-result-count mt-3 flex items-center gap-2 text-sm text-[var(--ac-muted)]" data-catalog-result-count={displayTotal??undefined}><span className="ac-pulse-dot ac-pulse-dot--status"><span/></span>{displayTotal!=null?`Найдено: ${formatCatalogCount(displayTotal!)}`:'Количество уточняется'}</p>
 <CatalogFilters initial={initial} facets={facets} resultCount={displayTotal??undefined} auctionResults/>
 {makes.length>0&&<BrandLogoRail initial={initial} brands={makes} resultCount={displayTotal??undefined}/>}
 {error&&<p role="status" className="my-6 rounded-2xl bg-[var(--ac-surface)] p-5">{error} <Link className="underline" href={`/cars?market=${market}&source=ajes`}>Сбросить условия</Link></p>}
 {result&&<div className="mt-8">
 <h2 className="mb-4 flex items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><CatalogMarketFlag market={market} className="h-5 w-7 md:h-6 md:w-9"/><span>{label}</span>{displayTotal!=null&&<span className="whitespace-nowrap text-sm text-[var(--ac-muted)] md:text-base" data-catalog-market-count={displayTotal}>· {formatCatalogCount(displayTotal!)}</span>}</h2>
 {result.partial&&<p role="status" className="mb-4 text-sm text-[var(--ac-muted)]">Показаны доступные совпадения. Полный поиск временно недоступен.</p>}
 <CatalogLoadMore key={JSON.stringify(initial)} query={{...initial,market} as any} initialPage={result.page} initialTotal={result.total} initialCount={result.items.length} initialCards={result.items.map((offer:any)=><CatalogCard key={offer.id} offer={offer} compact dense/>)} initialHasMore={!result.partial&&result.received===result.pageSize}/>
 </div>}
 </section>
 <style dangerouslySetInnerHTML={{__html:'html body .ac-catalog-page.ac-ajes-catalog{background:var(--ac-page-bg)!important;background-image:none!important}'}}/>
 </Container>;
}
