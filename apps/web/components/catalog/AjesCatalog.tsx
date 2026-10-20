import {Suspense} from 'react';
import {KoreaExistingMatches} from './KoreaExistingMatches';
import {DealerLink as Link} from '@/components/dealers/DealerBrowsingContext';
import {PublicHeader} from '@/components/layout/PublicHeader';
import {CatalogCard} from './CatalogCard';
import {CatalogFilters} from './CatalogFilters';
import {CatalogLoadMore} from './CatalogLoadMore';
import {BrandLogoRail} from './BrandLogoRail';
import {JapanSectionTabs} from './JapanSectionTabs';
import {CatalogMarketFlag} from './CatalogMarketFlag';
import {readAjesCatalogPage,readAjesCountSummary,readAjesMakes,readAjesDirectory,AjesFilterUnavailable} from '@/lib/catalog/ajes-catalog';
import {AjesInputError} from '@/lib/catalog/ajes-query';
import {readSavedAjesFacets} from '@/lib/catalog/ajes-runtime';
import {AjesUnavailable} from '@/lib/catalog/ajes-client';
import {ajesCountText,exactAjesCount} from '@/lib/catalog/ajes-count-display';
type Params=Record<string,string|string[]|undefined>;
export async function AjesCatalog({params,embedded=false}:{params:Params;embedded?:boolean}){
 const initial=Object.fromEntries(Object.entries(params).map(([k,v])=>[k,Array.isArray(v)?v[0]||'':v||'']));const market=initial.market==='china'?'china':initial.market==='korea'?'korea':'japan';const label=market==='china'?'Китай':market==='korea'?'Корея':'Япония';initial.market=market;if(market!=='japan')initial.source='ajes';if(!initial.make&&initial.brand)initial.make=initial.brand;
 let result:Awaited<ReturnType<typeof readAjesCatalogPage>>|undefined,error='';
 const countPromise=readAjesCountSummary(JSON.stringify(initial)).catch(()=>null);
 const makesPromise=readAjesMakes(JSON.stringify({market})).catch(()=>null);
 const directoryPromise=initial.make?readAjesDirectory({market,make:initial.make}).catch(()=>null):Promise.resolve(null);
 try{result=await readAjesCatalogPage(initial);}catch(e){error=e instanceof AjesFilterUnavailable?'Это условие поиска пока не поддерживается для выбранного рынка. Снимите его; уточнить параметры и рассчитать доставку можно в карточке.':e instanceof AjesInputError?'Проверьте условия и диапазоны поиска.':e instanceof AjesUnavailable&&e.reason==='visitor_restricted'?'Источник отклонил подключение. Сохранённых результатов этого поиска пока нет. Попробуйте позже.':'Не удалось обновить автомобили. Попробуйте позже.';}
 const directory=await directoryPromise;
 // Count is independently verified; a partial or failed list must not erase it.
 const sourceTotal=result?.countSummary??await countPromise;
 const displayTotal=exactAjesCount(sourceTotal);
 const makeDirectory=await makesPromise;
 const savedFacets=market==='japan'&&(!makeDirectory||!directory)?await readSavedAjesFacets().catch(()=>({makes:[],models:[]})):{makes:[],models:[]};
 const models=directory?.models||[...savedFacets.models,...new Map((result?.items||[]).map((item:any)=>[`${item.make}|${item.model}`,{make:String(item.make),model:String(item.model),total:0}])).values()];
 const makes=[...new Set([...(makeDirectory?.makes.map(m=>m.make)||savedFacets.makes),...models.map(m=>m.make),...(initial.make||'').split(',').filter(Boolean)])];
 const facets={makes,models,markets:[market],bodyTypes:[],fuels:['petrol','diesel','hybrid','electric','lpg'],transmissions:['automatic','manual','cvt','dct'],drives:['fwd','rwd','awd']};
 const Container=embedded?'div':'main';
 return <Container className={`ac-catalog-page ac-page-copy ac-ajes-catalog ${embedded?'dealer-shared-catalog':'min-h-screen text-[var(--ac-text)]'}`}>
 {!embedded&&<PublicHeader backHref="/" backLabel="На главную"/>}
 <section className={embedded?'w-full py-5':'mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10'}>
 {market==='japan'&&<JapanSectionTabs active="auction" params={initial}/>}

 <nav aria-label="Хлебные крошки" className="ac-catalog-breadcrumbs mb-4 flex items-center gap-2 text-xs font-black text-[var(--ac-muted)]"><Link href="/">Главная</Link><span>/</span><Link href="/cars">Каталог</Link><span>/</span><span aria-current="page">{label}</span></nav>
 <h1 className="text-[30px] font-black leading-none tracking-[-0.04em] sm:text-4xl md:text-6xl">{embedded?"Авто под заказ":"Каталог автомобилей"}</h1>
 <p role="status" className="ac-catalog-result-count mt-3 flex items-center gap-2 text-sm text-[var(--ac-muted)]" data-catalog-result-count={displayTotal??undefined}><span className="ac-pulse-dot ac-pulse-dot--status"><span/></span><span>Найдено: {ajesCountText(sourceTotal)}</span></p>
 <CatalogFilters initial={initial} facets={facets} resultCount={displayTotal??undefined} auctionResults/>
 {makes.length>0&&<BrandLogoRail initial={initial} brands={makes} resultCount={displayTotal??undefined}/>}
 {market==='korea'&&<Suspense fallback={null}><KoreaExistingMatches params={initial}/></Suspense>}
 {error&&<p role="status" className="my-6 rounded-2xl bg-[var(--ac-surface)] p-5">{error} <Link className="underline" href={`/cars?market=${market}&source=ajes`}>Сбросить условия</Link></p>}
 {result&&<div className="mt-8 md:mt-9">
 <h2 className="mb-4 flex items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><CatalogMarketFlag market={market} className="h-5 w-7 md:h-6 md:w-9"/><span>{label}</span>{sourceTotal&&<span className="whitespace-nowrap text-sm text-[var(--ac-muted)] md:text-base" data-catalog-market-count={displayTotal}>· {ajesCountText(sourceTotal)}</span>}</h2>
 {result.filteredByPage&&result.total===null&&<p role="status" className="mb-4 text-sm text-[var(--ac-muted)]">Показываем автомобили, подходящие под выбранные условия. Точное количество уточняется по мере загрузки.</p>}
 {result.interrupted&&<p role="status" className="mb-4 text-sm text-[var(--ac-muted)]">Часть автомобилей пока не удалось загрузить. Найденные варианты сохранены; продолжить можно кнопкой «Показать ещё».</p>}
 {market!=='japan'&&(result.partial||result.stale)&&<p role="status" className="mb-4 text-sm text-[var(--ac-muted)]">Показана доступная часть предложений.</p>}
 <CatalogLoadMore key={JSON.stringify(initial)} query={{...initial,market} as any} initialPage={result.page} initialTotal={result.total} initialCount={result.items.length} initialCards={result.items.map((offer:any)=><CatalogCard key={offer.id} offer={offer} compact dense/>)} initialHasMore={result.hasMore} initialNextCursor={result.nextCursor}/>
 </div>}
 </section>
 <style dangerouslySetInnerHTML={{__html:'html body .ac-catalog-page.ac-ajes-catalog{background:var(--ac-page-bg)!important;background-image:none!important}'}}/>
 </Container>;
}
