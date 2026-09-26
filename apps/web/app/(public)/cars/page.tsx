import { JapanSectionTabs } from "@/components/catalog/JapanSectionTabs";
import { GreenCornerRail } from "@/components/catalog/GreenCornerRail";
import { filterGreenCorner, greenCornerFacets } from "@/lib/catalog/green-corner-search";
import { readGreenCorner, publicGreenOffer, currentGreenCornerPrices } from "@/lib/catalog/green-corner";
import { parseEngineCc } from "@/lib/catalog/engine-input";
import { formatCatalogCount } from "@/lib/catalog/count-format";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readCatalogFacets, searchOffers } from "@/lib/catalog/storage";
import { readCatalogOverview } from "@/lib/catalog/overview";
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

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
const OVERVIEW_CARDS = 10;
const MARKET_PAGE_SIZE = 24;
const SUPPORTED_SORTS = new Set(["updatedAt", "totalRub", "totalRubDesc", "year", "yearAsc", "mileage"]);
type MarketGroup = { id: string; label: string; items: any[]; total: number; page: number; pageSize: number };

function requestedSort(value?: string | string[]) {
  const sort = first(value);
  return SUPPORTED_SORTS.has(sort) ? sort : "updatedAt";
}

function pageHref(params: Record<string, string | string[] | undefined>, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) { const resolved = first(value); if (resolved && key !== "page") query.set(key, resolved); }
  if (page > 1) query.set("page", String(page));
  const suffix = query.toString();
  return suffix ? `/cars?${suffix}` : "/cars";
}

export default async function CarsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) || {};
  if (first(params.market) === "japan" && first(params.stock) === "green") redirect(`/cars/green?${new URLSearchParams(Object.entries(params).map(([k,v])=>[k,first(v)]))}`);
  const requestedMarket = first(params.market).toLowerCase();
  if (requestedMarket && !PUBLIC_CATALOG_MARKET_SET.has(requestedMarket as CatalogMarket)) redirect("/cars");
  const selectedMarket = requestedMarket;
  const selectedSort = requestedSort(params.sort);
  const customSort = selectedSort !== "updatedAt";
  const requestedPage = Math.max(1, Math.floor(Number(first(params.page)) || 1));
  const common = {
    city: first(params.city),
    make: first(params.make) || first(params.brand), model: first(params.model), budgetFrom: numeric(params.budgetFrom), budgetTo: numeric(params.budget) || numeric(params.budgetTo), hasPrice: first(params.hasPrice),
    yearFrom: numeric(params.yearFrom), yearTo: numeric(params.yearTo), mileageFrom: numeric(params.mileageFrom), mileageTo: numeric(params.mileageTo), engineFrom: parseEngineCc(first(params.engineFrom)), engineTo: parseEngineCc(first(params.engineTo)), powerFrom: numeric(params.powerFrom), powerTo: numeric(params.powerTo),
    auctionGrade: selectedMarket === "japan" ? first(params.auctionGrade) : undefined,
    fuel: first(params.fuel), transmission: first(params.transmission), drive: first(params.drive), bodyType: first(params.bodyType), sort: selectedSort,
  };
  const hasFilters = Boolean(common.make || common.model || common.budgetFrom || common.budgetTo || common.hasPrice
    || common.yearFrom || common.yearTo || common.mileageFrom || common.mileageTo || common.engineFrom || common.engineTo
    || common.auctionGrade || common.powerFrom || common.powerTo || common.fuel || common.transmission || common.drive || common.bodyType);
  const markets = selectedMarket ? marketOrder.filter((item) => item.id === selectedMarket) : marketOrder;
  const overviewEligible = !selectedMarket && !hasFilters && !customSort && requestedPage === 1;
  const japanAll = selectedMarket === "japan" && first(params.stock) === "all";
  // Stock and market snapshots are independent; start both storage reads together.
  const greenRead = overviewEligible || japanAll ? readGreenCorner().catch(()=>null) : Promise.resolve(null);
  const overview = overviewEligible ? await readCatalogOverview().catch((error) => {
    console.error("catalog_overview_read_failed", error);
    return null;
  }) : null;

  let facets: Awaited<ReturnType<typeof readCatalogFacets>>;
  let groupedMarkets: MarketGroup[];
  if (overview) {
    facets = overview.facets;
    groupedMarkets = await Promise.all(marketOrder.map(async (market) => {
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
      readCatalogFacets({ ...common, market: selectedMarket || undefined }),
      Promise.all(markets.map(async (market) => {
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
        const items = customSort ? sortCatalogRows(repriced, selectedSort) : common.model ? repriced.sort(businessOrder) : balanceBusinessRows(repriced);
        return { ...market, items, total: result.total, page: result.page, pageSize: result.pageSize };
      })),
    ]);
  }
  const green = await greenRead;
  const greenMatched = japanAll && green ? filterGreenCorner(await currentGreenCornerPrices(green.items),Object.fromEntries(Object.entries(params).map(([key,value])=>[key,first(value)]))) : green?.items || [];
  const greenItems = japanAll ? greenMatched.slice(0,10).map(publicGreenOffer) : await applyActiveBusinessPricingBatch(greenMatched.slice(0,10).map(publicGreenOffer));
  if (japanAll && green) {
    facets={...facets};
    const stockFacets=greenCornerFacets(green.items);
    for(const key of ['makes','bodyTypes','fuels','transmissions','drives'] as const) facets[key]=[...new Set([...(facets[key]||[]),...stockFacets[key]])];
    const models=new Map([...(facets.models||[]),...stockFacets.models].map(row=>[`${row.make}:${row.model}`,row]));
    facets.models=[...models.values()];
  }
  const visibleMarkets = selectedMarket ? groupedMarkets : groupedMarkets.filter((market) => market.total > 0);
  const total = groupedMarkets.reduce((sum, market) => sum + market.total, 0) + (japanAll ? greenMatched.length : 0);

  const initialKeys = ["stock", "auctionGrade", "advanced", "budget", "budgetTo", "budgetFrom", "market", "make", "model", "yearFrom", "yearTo", "hasPrice", "bodyType", "mileageFrom", "mileageTo", "engineFrom", "engineTo", "powerFrom", "powerTo", "fuel", "transmission", "drive", "sort"];
  const initial = Object.fromEntries(initialKeys.map((key) => [key, first(params[key])])) as Record<string, string>;
  const brandNames = facets.makes || [];
  const japanStatisticsSelected = selectedMarket === "japan" && !japanAll;
  const selectedMake = common.make;
  const selectedModel = common.model;
  const selectedMarketLabel = marketOrder.find((item) => item.id === selectedMarket)?.label || selectedMarket;
  const hasCatalogContext = Boolean(selectedMarket || selectedMake || selectedModel);
  const breadcrumbItems: Array<{ label: string; href: string }> = [
    { label: "Главная", href: "/" },
    { label: hasCatalogContext ? "Каталог" : "Каталог автомобилей", href: "/cars" },
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

  return <main className="ac-catalog-page ac-page-copy min-h-screen bg-[#0f172a] text-white">
    <PublicHeader backHref="/" backLabel="На главную" />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }} />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10">
      <div className="max-w-4xl">
        {selectedMarket === "japan" ? <JapanSectionTabs active={japanAll ? "all" : "auction"} params={Object.fromEntries(Object.entries(params).map(([k,v])=>[k,first(v)]))} /> : null}
        <nav aria-label="Хлебные крошки" className="ac-catalog-breadcrumbs ac-hide-scrollbar -mx-1 mb-4 flex min-w-0 items-center gap-x-2 overflow-x-auto whitespace-nowrap px-1 pb-1 text-[11px] font-black uppercase tracking-[0.14em] text-[var(--ac-muted)] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:mb-5 md:overflow-visible md:text-xs">
          {breadcrumbItems.map((item, index) => <span key={`${item.href}-${item.label}`} className="flex shrink-0 items-center gap-x-2">
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            {index === breadcrumbItems.length - 1 ? <span aria-current="page">{item.label}</span> : <Link href={item.href} className="transition hover:text-red-500">{item.label}</Link>}
          </span>)}
        </nav>
        <h1 className="whitespace-nowrap text-[30px] font-black leading-none tracking-[-0.04em] sm:text-4xl md:text-6xl">{japanStatisticsSelected ? "Аукционная статистика" : "Каталог автомобилей"}</h1>
        <div className="lg:hidden"><BrandLogoRail brands={brandNames} resultCount={total} /></div>
      </div>
      <p className="ac-catalog-result-count mt-3 flex items-center gap-2 text-sm text-[var(--ac-muted)]" role="status" aria-live="polite" aria-atomic="true" data-catalog-result-count={total}>
        <span className="ac-pulse-dot ac-pulse-dot--status shrink-0" aria-hidden="true"><span /></span>
        <span>Найдено: <span className="whitespace-nowrap tabular-nums" data-catalog-result-value>{formatCatalogCount(total)}</span></span>
      </p>
      <CatalogFilters initial={initial} facets={facets} />
      <div className="hidden lg:block"><BrandLogoRail brands={brandNames} resultCount={total} /></div>
      <CurrencyRatesStrip variant="mobile" className="mt-5 lg:hidden" />
      <div className="mt-8 grid gap-10 md:mt-9 md:gap-12">{visibleMarkets.map((market, marketIndex) => <div key={market.id} className="min-w-0"><section><div className="mb-4 flex items-end justify-between gap-4"><h2 className="flex min-w-0 items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><CatalogMarketFlag market={market.id} className="h-5 w-7 md:h-6 md:w-9" /><span>{market.label}</span><span className="whitespace-nowrap text-sm text-[var(--ac-muted)] md:text-base" data-catalog-market-count={market.total}>· {formatCatalogCount(market.total)}</span></h2>{!selectedMarket ? <Link href={pageHref({...params, market: market.id}, 1)} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link> : null}</div>{market.items.length ? selectedMarket ? <CatalogLoadMore key={pageHref(params, requestedPage)} query={{...common, market: market.id}} initialPage={requestedPage} initialTotal={market.total} initialCount={market.items.length} initialCards={market.items.map((offer: any, index: number) => <CatalogCard key={offer.id} offer={offer} compact dense eagerPrefetch={index < 4} />)} /> : <div className="ac-catalog-market-rail -mr-4 grid grid-flow-col auto-cols-[47%] gap-2.5 overflow-x-auto pr-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:mr-0 md:grid-flow-row md:grid-cols-5 md:auto-cols-auto md:overflow-visible md:pr-0">{market.items.map((offer: any, index: number) => <div key={offer.id} className="min-w-0"><CatalogCard offer={offer} compact dense eagerPrefetch={marketIndex === 0 && index < 4} /></div>)}</div> : <div className="rounded-[1.5rem] bg-white/[0.04] px-6 py-7 text-sm font-bold text-white/55">{market.id === "japan" ? "Статистика отыгранных лотов ещё загружается." : "Подходящих предложений сейчас нет."}</div>}</section>{market.id === "japan" && (overviewEligible || japanAll) ? <GreenCornerRail items={greenItems} total={greenMatched.length} href={japanAll ? `/cars/green?${new URLSearchParams({...initial,stock:"green"})}` : undefined} /> : null}</div>)}</div>
    </section>
    <style dangerouslySetInnerHTML={{ __html: `
      @media(max-width:767px){
        .ac-catalog-page .ac-catalog-card,.ac-catalog-page .ac-catalog-card *,.ac-catalog-page .ac-catalog-market-rail,.ac-catalog-page .ac-catalog-market-rail>*{box-shadow:none!important}
        .ac-catalog-page .ac-catalog-card,.ac-catalog-page .ac-catalog-market-rail{filter:none!important}
        .ac-catalog-page .ac-catalog-pagination{justify-content:center!important}
        .ac-catalog-page .ac-pagination-current{color:#fff!important;-webkit-text-fill-color:#fff!important}
      }
    ` }} />
  </main>;
}
