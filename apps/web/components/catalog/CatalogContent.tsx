import {catalogBrandFilter} from '@/lib/catalog/brands';
import {MARKET_RAIL_CLASS} from './market-rail-layout';
import {filterSelections} from "@/lib/catalog/filter-selections";
import {CatalogBreadcrumbs} from "./CatalogBreadcrumbs";
import {CatalogCountLabel} from "./CatalogCountLabel";
import {MarketResultCount} from './MarketResultCount';
import {normalizedCatalogSort} from '@/lib/catalog/catalog-sort';
import {CatalogSidebar} from './CatalogSidebar';
import {GreenCornerCatalog} from "./GreenCornerCatalog";
import {usesAjesMarket} from '@/lib/catalog/ajes-market-selection';
import {exactAjesCount} from '@/lib/catalog/ajes-count-display';
import {AjesCatalog} from './AjesCatalog';
import {AjesRail,readAjesRailData,readAjesRailCount,CatalogEmptyResults} from './AjesRail';
import {Suspense} from 'react';
import { JapanSectionTabs } from "@/components/catalog/JapanSectionTabs";
import { GreenCornerRail } from "@/components/catalog/GreenCornerRail";
import { greenCornerFacets } from "@/lib/catalog/green-corner-search";
import { readGreenCorner, publicGreenOffer, readGreenCornerPage } from "@/lib/catalog/green-corner";
import { parseEngineCc } from "@/lib/catalog/engine-input";
import { formatCatalogCount } from "@/lib/catalog/count-format";
import {DealerLink as Link} from "@/components/dealers/DealerBrowsingContext";
import type {DealerBrowsingContext} from "@/lib/dealers/browsing-context";
import { redirect } from "next/navigation";
import { readCatalogFacets, searchOffers } from "@/lib/catalog/storage";
import {CatalogSectionLoading} from "./CatalogLoading";
import { readPublicCatalogOverview } from "@/lib/catalog/editorial-overview";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { BrandLogoRail } from "@/components/catalog/BrandLogoRail";
import { readCatalogMarketPage, balanceBusinessRows, businessOrder, sortCatalogRows } from "@/lib/catalog/market-page";
import { CatalogLoadMore } from "@/components/catalog/CatalogLoadMore";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { CatalogMarketFlag } from "@/components/catalog/CatalogMarketFlag";
import { CatalogFilters } from "@/components/catalog/CatalogFilters";
import { CurrencyRatesStrip } from "@/components/catalog/CurrencyRatesStrip";
import { applyActiveBusinessPricingBatch } from "@/lib/catalog/live-business-pricing";
import { isRenderablePublicCatalogOffer } from "@/lib/catalog/offer-quality";
import { CATALOG_MARKET_LABELS, PUBLIC_CATALOG_MARKETS, PUBLIC_CATALOG_MARKET_SET } from "@/lib/catalog/runtime-config";
import type { CatalogMarket } from "@/lib/catalog/types";


function first(value?: string | string[]) { return Array.isArray(value) ? value[0] : value || ""; }
function numeric(value?: string | string[]) { const result = Number(first(value)); return Number.isFinite(result) && result > 0 ? result : undefined; }

function catalogBreadcrumbHref(filters: { market?: string; make?: string; model?: string }) {
  const query = new URLSearchParams();
  if (filters.market) query.set("market", filters.market);
  if (filters.make) query.set("make", filters.make);
  if (filters.model) query.set("model", filters.model);
  const suffix = query.toString();
  return suffix ? `/cars?${suffix}` : "/cars";
}

const marketOrder = PUBLIC_CATALOG_MARKETS.map((id) => ({ id, label: CATALOG_MARKET_LABELS[id] }));
const OVERVIEW_CARDS = 6;
const MARKET_PAGE_SIZE = 24;
type MarketGroup = { id: string; label: string; items: any[]; total: number; page: number; pageSize: number };

function requestedSort(value?: string | string[]) {
  const sort = first(value);
  return normalizedCatalogSort(sort) || "updatedAt";
}

function pageHref(params: Record<string, string | string[] | undefined>, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) { const resolved = first(value); if (resolved && key !== "page") query.set(key, resolved); }
  if (page > 1) query.set("page", String(page));
  const suffix = query.toString();
  return suffix ? `/cars?${suffix}` : "/cars";
}

type CatalogContentProps={params?:Record<string,string|string[]|undefined>;dealer?:DealerBrowsingContext|null;embedded?:boolean};
export async function CatalogContent(props:CatalogContentProps){
 try{return await ReadCatalogContent(props);}catch(error){
  // Redirects and framework navigation signals must retain their semantics.
  if(error&&typeof error==='object'&&'digest' in error&&String(error.digest).startsWith('NEXT_'))throw error;
  console.error('catalog_page_unavailable');
  const {params={},dealer=null,embedded=false}=props;
  const initial=Object.fromEntries(Object.entries(params).map(([key,value])=>[key,first(value)]));
  const Container=embedded?'div':'main';
  return <Container className={`ac-catalog-page ac-page-copy ${embedded?'dealer-shared-catalog':'min-h-screen text-[var(--ac-text)]'}`}>
   {!embedded&&<PublicHeader backHref="/" backLabel="На главную"/>}
   <script type="application/ld+json" dangerouslySetInnerHTML={{__html:'{}'}}/>
   <section className={embedded?'ac-catalog-shell w-full py-5':'ac-catalog-shell mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10'}>
    <CatalogSidebar resultScope={catalogResultScope(params,dealer)} resultError="Выбранные условия сохранены. Попробуйте обновить подборку."
     header={<h1 className="text-3xl font-black">Каталог автомобилей</h1>} filters={<CatalogFilters initial={initial}/>}>{null}</CatalogSidebar>
   </section>
  </Container>;
 }
}
function catalogResultScope(params:Record<string,string|string[]|undefined>,dealer:DealerBrowsingContext|null){return JSON.stringify([dealer?.id||'public',Boolean(dealer?.preview),first(params.market),first(params.stock)]);}

async function ReadCatalogContent({params={},dealer=null,embedded=false}:{params?:Record<string,string|string[]|undefined>;dealer?:DealerBrowsingContext|null;embedded?:boolean}) {
  params={...params,...(params.make?{make:catalogBrandFilter(first(params.make))}:{}),...(params.brand?{brand:catalogBrandFilter(first(params.brand))}:{})};
  if(first(params.stock)==="green"&&(!dealer||dealer.markets.includes("japan")))return <GreenCornerCatalog params={{...Object.fromEntries(Object.entries(params).map(([k,v])=>[k,first(v)])),dealer:dealer?.id}} embedded={embedded}/>;
  const [liveChina,liveKorea]=await Promise.all([usesAjesMarket('china'),usesAjesMarket('korea')]);
  const liveMarket=(id:string)=>id==='china'&&liveChina||id==='korea'&&liveKorea;
  const allowedMarkets=dealer?marketOrder.filter(m=>dealer.markets.includes(m.id)):marketOrder;
  if(dealer&&!allowedMarkets.length)return <p className="py-10 text-[var(--ac-muted)]">Компания пока не указала направления доставки.</p>;
  if ((!dealer||dealer.markets.includes(first(params.market) as any)) && await usesAjesMarket(first(params.market),first(params.source))) return <AjesCatalog params={params} embedded={embedded}/>;
  const requestedMarkets = filterSelections(first(params.market).toLowerCase());
  const requestedMarket = requestedMarkets.length===1 && requestedMarkets[0]!=="green" ? requestedMarkets[0] : "";
  const selectedMarkets=requestedMarkets.filter(m=>m==="green"?(!dealer||dealer.markets.includes("japan")):allowedMarkets.some(a=>a.id===m));
  const showGreen=(!requestedMarkets.length || selectedMarkets.includes("green") || (requestedMarket==="japan"&&first(params.stock)==="all")) && (!dealer||dealer.markets.includes("japan"));
  if (requestedMarkets.some(m=>m!=="green"&&!PUBLIC_CATALOG_MARKET_SET.has(m as CatalogMarket))) redirect(dealer?.href || "/cars");
  const selectedMarket = dealer&&!dealer.markets.includes(requestedMarket as any)?"":requestedMarket;
  const selectedSort = requestedSort(params.sort);
  const customSort = selectedSort !== "updatedAt";
  const requestedPage = Math.max(1, Math.floor(Number(first(params.page)) || 1));
  const common = {
    color:first(params.color), city: first(params.city),
    make: first(params.make) || first(params.brand), model: first(params.model), budgetFrom: numeric(params.budgetFrom), budgetTo: numeric(params.budget) || numeric(params.budgetTo), hasPrice: first(params.hasPrice),
    yearFrom: numeric(params.yearFrom), yearTo: numeric(params.yearTo), mileageFrom: numeric(params.mileageFrom), mileageTo: numeric(params.mileageTo), engineFrom: parseEngineCc(first(params.engineFrom)), engineTo: parseEngineCc(first(params.engineTo)), powerFrom: numeric(params.powerFrom), powerTo: numeric(params.powerTo),
    auctionGrade: selectedMarket === "japan" ? first(params.auctionGrade) : undefined,
    fuel: first(params.fuel), transmission: first(params.transmission), drive: first(params.drive), bodyType: first(params.bodyType), sort: selectedSort,
  };
  const hasFilters = Boolean(common.color || common.make || common.model || common.budgetFrom || common.budgetTo || common.hasPrice
    || common.yearFrom || common.yearTo || common.mileageFrom || common.mileageTo || common.engineFrom || common.engineTo
    || common.auctionGrade || common.powerFrom || common.powerTo || common.fuel || common.transmission || common.drive || common.bodyType);
  const markets = requestedMarkets.length ? allowedMarkets.filter(item=>selectedMarkets.includes(item.id)) : allowedMarkets;
  const overviewEligible = !requestedMarkets.length && !hasFilters && !customSort && requestedPage === 1;
  const japanAll = selectedMarket === "japan" && first(params.stock) === "all";
  // Start supplier previews alongside local indexes instead of after all local work.
  const railReads=new Map<string,ReturnType<typeof readAjesRailData>>(markets.filter(m=>liveMarket(m.id)||m.id==='japan').map(m=>[m.id,readAjesRailData(m.id as 'japan'|'china'|'korea',params)]));
  // Stock and market snapshots are independent; start both storage reads together.
  const greenRead = showGreen ? readGreenCorner().catch(()=>null) : Promise.resolve(null);
  const overview = overviewEligible ? await readPublicCatalogOverview().catch((error) => {
    console.error("catalog_overview_read_failed", error);
    return null;
  }) : null;

  let facets: Awaited<ReturnType<typeof readCatalogFacets>>;
  let groupedMarkets: MarketGroup[];
  if (overview) {
    facets = overview.facets;
    groupedMarkets = await Promise.all(allowedMarkets.map(async (market) => {
      if(liveMarket(market.id)||market.id==='japan')return {...market,items:[],total:0,page:1,pageSize:OVERVIEW_CARDS};
      const snapshot = overview.markets[market.id] || { total: 0, items: [] };
      const snapshotCandidates = balanceBusinessRows((snapshot.items as any[]).filter(isRenderablePublicCatalogOffer));
      // The overview is a replaceable speed cache. If its compact showcase was
      // produced before the active card-projection contract, keep its trustworthy
      // count/facets but recover visible cards from the current market projection.
      const fallback = snapshot.total > 0 && snapshotCandidates.length === 0
        ? await searchOffers({ market: market.id, page: 1, pageSize: 24, sort: "updatedAt" })
        : null;
      const candidates = snapshotCandidates.length
        ? snapshotCandidates
        : balanceBusinessRows(((fallback?.items || []) as any[]).filter(isRenderablePublicCatalogOffer));
      const visible = await applyActiveBusinessPricingBatch(candidates.slice(0, OVERVIEW_CARDS));
      return { ...market, items: balanceBusinessRows(visible), total: snapshot.total, page: 1, pageSize: OVERVIEW_CARDS };
    }));
  } else {
    [facets, groupedMarkets] = await Promise.all([
      // Navigation options come from prepared directories, independently of the selected filter.
      readCatalogFacets(selectedMarket ? {market:selectedMarket} : {}),
      Promise.all(markets.map(async (market) => {
        if(liveMarket(market.id)||market.id==='japan')return {...market,items:[],total:0,page:1,pageSize:OVERVIEW_CARDS};
        const pageSize = selectedMarket ? MARKET_PAGE_SIZE : OVERVIEW_CARDS;
        const page = selectedMarket ? requestedPage : 1;

        if (selectedMarket) {
          const result = await readCatalogMarketPage({...common, market: market.id, page});
          return {...market, ...result};
        }
        if (!hasFilters && !customSort) {
          const indexedPageSize = Math.min(48, Math.max(pageSize * 4, 24));
          const indexed = await searchOffers({ market: market.id, page, pageSize: indexedPageSize, sort: "updatedAt" });
          const candidates = balanceBusinessRows((indexed.items as any[]).filter(isRenderablePublicCatalogOffer));
          const visible = await applyActiveBusinessPricingBatch(candidates.slice(0, pageSize));
          return { ...market, items: balanceBusinessRows(visible), total: indexed.total, page: indexed.page, pageSize };
        }

        const result = await searchOffers({ ...common, market: market.id, page, pageSize });
        const pageRows = common.model || customSort ? (result.items as any[]) : balanceBusinessRows(result.items as any[]);
        const repriced = await applyActiveBusinessPricingBatch(pageRows);
        const items = customSort ? sortCatalogRows(repriced, selectedSort,common.city) : common.model ? repriced.sort(businessOrder) : balanceBusinessRows(repriced);
        return { ...market, items, total: result.total, page: result.page, pageSize: result.pageSize };
      })),
    ]);
  }
  const green = (!dealer||dealer.markets.includes("japan")) ? await greenRead : null;
  const greenSelection = showGreen && green ? await readGreenCornerPage(green.items, {...Object.fromEntries(Object.entries(params).map(([key,value])=>[key,first(value)])),page:"1"},true,OVERVIEW_CARDS) : null;
  const greenItems = (greenSelection?.items || []).map(publicGreenOffer);
  const greenTotal = greenSelection?.total || 0;
  if (showGreen && green) {
    facets={...facets};
    const stockFacets=greenCornerFacets(green.items);
    for(const key of ['makes','bodyTypes','fuels','transmissions','drives'] as const) facets[key]=[...new Set([...(facets[key]||[]),...stockFacets[key]])];
    const models=new Map([...(facets.models||[]),...stockFacets.models].map(row=>[`${row.make}:${row.model}`,row]));
    facets.models=[...models.values()];
  }
  const visibleMarkets = selectedMarket ? groupedMarkets : groupedMarkets.filter((market) => market.total > 0 || liveMarket(market.id) || market.id === "japan");
  const localTotal=groupedMarkets.reduce((sum, market) => sum + market.total, 0) + ((japanAll || !selectedMarket) ? greenTotal : 0);
  const countSummary=Promise.all([...railReads].map(async([market,read])=>{
    const rail=await read;if(rail.disabled)return {total:0,incomplete:false};
    const count=rail.count||await readAjesRailCount(market as 'japan'|'china'|'korea',params);
    const exact=exactAjesCount(count);
    return {total:exact??rail.items.length,incomplete:exact===undefined};
  })).then(counts=>({
    total:localTotal-groupedMarkets.filter(m=>railReads.has(m.id)).reduce((sum,m)=>sum+m.total,0)+counts.reduce((sum,c)=>sum+c.total,0),
    countIncomplete:counts.some(c=>c.incomplete),
  }));
  const total=localTotal,countIncomplete=overviewEligible||groupedMarkets.some(m=>liveMarket(m.id)||m.id==='japan');

  const initialKeys = ["salePeriod","color","source", "stock", "auctionGrade", "advanced", "budget", "budgetTo", "budgetFrom", "market", "make", "model", "yearFrom", "yearTo", "hasPrice", "bodyType", "mileageFrom", "mileageTo", "engineFrom", "engineTo", "powerFrom", "powerTo", "fuel", "transmission", "drive", "sort"];
  const initial = Object.fromEntries(initialKeys.map((key) => [key, first(params[key])])) as Record<string, string>;
  initial.market=selectedMarkets.join("|");
  const brandNames = facets.makes || [];
  const japanStatisticsSelected = selectedMarket === "japan" && !japanAll;
  const selectedMake = common.make;
  const selectedModel = common.model;
  const selectedMarketLabel = marketOrder.find((item) => item.id === selectedMarket)?.label || selectedMarket;
  const hasCatalogContext = Boolean(selectedMarket || selectedMake || selectedModel);
  const breadcrumbItems: Array<{ label: string; href: string }> = [
    { label: "Главная", href: "/" },
    { label: hasCatalogContext ? "Каталог" : embedded ? "Авто под заказ" : "Каталог автомобилей", href: "/cars" },
  ];
  if (selectedMarket) breadcrumbItems.push({ label: selectedMarketLabel, href: catalogBreadcrumbHref({ market: selectedMarket }) });
  if (selectedMake) breadcrumbItems.push({ label: selectedMake, href: catalogBreadcrumbHref({ market: selectedMarket, make: selectedMake }) });
  if (selectedModel) breadcrumbItems.push({ label: selectedModel, href: catalogBreadcrumbHref({ market: selectedMarket, make: selectedMake, model: selectedModel }) });
  const breadcrumbJsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbItems.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      item: `https://avtocena.com${item.href}`,
    })),
  }).replace(/</g, "\\u003c");

  const Container=embedded?"div":"main";
  return <Container className={`ac-catalog-page ac-page-copy ${embedded?"dealer-shared-catalog":"min-h-screen bg-[#0f172a] text-white"}`}>
    {!embedded&&<PublicHeader backHref="/" backLabel="На главную" />}
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }} />
    <section className={embedded?"ac-catalog-shell w-full py-5":"ac-catalog-shell mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10"}>
      <CatalogSidebar resultScope={catalogResultScope(params,dealer)} filters={<CatalogFilters initial={initial} facets={facets} resultCount={countIncomplete?undefined:total} />} header={<>
      <div className="max-w-4xl">
        {selectedMarket === "japan" ? <JapanSectionTabs active={japanAll ? "all" : "auction"} params={Object.fromEntries(Object.entries(params).map(([k,v])=>[k,first(v)]))} /> : null}
        <CatalogBreadcrumbs items={breadcrumbItems}/>
        <h1 className="whitespace-nowrap text-[30px] font-black leading-none tracking-[-0.04em] sm:text-4xl md:text-6xl">{japanStatisticsSelected ? "Аукционная статистика" : embedded ? "Авто под заказ" : "Каталог автомобилей"}</h1>
        <div className="lg:hidden"><BrandLogoRail initial={initial} brands={brandNames} resultCount={countIncomplete?undefined:total} /></div>
      </div>
      {!selectedMarket&&<p className="ac-catalog-result-count mt-3 flex items-center gap-2 text-sm text-[var(--ac-muted)]" role="status" aria-live="polite" aria-atomic="true" data-catalog-result-count={countIncomplete?undefined:total}>
        <span className="ac-pulse-dot ac-pulse-dot--status shrink-0" aria-hidden="true"><span /></span>
        <Suspense fallback={<CatalogCountLabel total={total} countIncomplete={countIncomplete}/>}><ResolvedCatalogCount summary={countSummary}/></Suspense>
      </p>}
      </>}>
      <div className="hidden lg:block"><BrandLogoRail initial={initial} brands={brandNames} resultCount={countIncomplete?undefined:total} /></div>
      <div className="mt-8 grid gap-10 md:mt-9 md:gap-12">{visibleMarkets.map((market, marketIndex) => liveMarket(market.id) ? <Suspense key={market.id} fallback={<CatalogSectionLoading active/>}><AjesRail market={market.id as "china"|"korea"} params={params} prepared={railReads.get(market.id)}/></Suspense> : market.id === "japan" ? <div key="japan" className="min-w-0"><Suspense fallback={<CatalogSectionLoading active/>}><AjesRail params={params} prepared={railReads.get("japan")}/></Suspense>{showGreen&&<GreenCornerRail items={greenItems} total={greenTotal} href={pageHref({...params,stock:"green",market:"japan"},1)} />}</div> : <div key={market.id} className="min-w-0"><section><CatalogSectionLoading/><div className="mb-4 flex items-end justify-between gap-4"><h2 className="flex min-w-0 flex-wrap items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><CatalogMarketFlag market={market.id} className="h-5 w-7 md:h-6 md:w-9" /><span>{market.label}</span><MarketResultCount total={market.total}>{formatCatalogCount(market.total)}</MarketResultCount></h2>{!selectedMarket ? <Link href={pageHref({...params, market: market.id}, 1)} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link> : null}</div>{market.items.length ? selectedMarket ? <CatalogLoadMore key={pageHref(params, requestedPage)} query={{...common, market: market.id}} initialPage={requestedPage} initialTotal={market.total} initialCount={market.items.length} initialCards={market.items.map((offer: any, index: number) => <CatalogCard key={offer.id} offer={offer} compact dense eagerPrefetch={index < 4} />)} /> : <div className={MARKET_RAIL_CLASS}>{market.items.map((offer: any, index: number) => <div key={offer.id} className="min-w-0"><CatalogCard offer={offer} compact dense eagerPrefetch={marketIndex === 0 && index < 4} /></div>)}</div> : <div className="rounded-[1.5rem] bg-white/[0.04] px-6 py-7 text-sm font-bold text-white/55">По выбранным параметрам автомобили не найдены. Попробуйте изменить условия поиска.</div>}</section></div>)}</div>
{showGreen&&!markets.some(m=>m.id==="japan")&&<GreenCornerRail items={greenItems} total={greenTotal} href={pageHref({...params,stock:"green",market:"japan"},1)}/>}
{!selectedMarket&&<Suspense fallback={null}><CatalogEmptyResults localTotal={localTotal} reads={[...railReads.values()]}/></Suspense>}
</CatalogSidebar>
      <CurrencyRatesStrip variant="mobile" className="mt-8 lg:hidden" />
    </section>
    <style dangerouslySetInnerHTML={{ __html: `
      @media(max-width:767px){
        .ac-catalog-page .ac-catalog-card,.ac-catalog-page .ac-catalog-card *,.ac-catalog-page .ac-catalog-market-rail,.ac-catalog-page .ac-catalog-market-rail>*{box-shadow:none!important}
        .ac-catalog-page .ac-catalog-card,.ac-catalog-page .ac-catalog-market-rail{filter:none!important}
        .ac-catalog-page .ac-catalog-pagination{justify-content:center!important}
        .ac-catalog-page .ac-pagination-current{color:#fff!important;-webkit-text-fill-color:#fff!important}
      }
    ` }} />
  </Container>;
}

async function ResolvedCatalogCount({summary}:{summary:{total:number;countIncomplete?:boolean}|Promise<{total:number;countIncomplete?:boolean}>}){
 return <CatalogCountLabel {...await summary}/>;
}
