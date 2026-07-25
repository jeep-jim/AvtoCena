import Link from "next/link";
import { readCatalogFacets, readMarketOffers, publicOffer, searchOffers } from "@/lib/catalog/storage";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { BrandLogoRail } from "@/components/catalog/BrandLogoRail";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { CatalogFilters } from "@/components/catalog/CatalogFilters";
import { CurrencyRatesStrip } from "@/components/catalog/CurrencyRatesStrip";
import { isCrediblePublicOffer } from "@/lib/catalog/offer-quality";
import { CATALOG_MARKET_FLAGS, CATALOG_MARKET_LABELS, PUBLIC_CATALOG_MARKETS } from "@/lib/catalog/runtime-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function first(value?: string | string[]) { return Array.isArray(value) ? value[0] : value || ""; }
function numeric(value?: string | string[]) { const result = Number(first(value)); return Number.isFinite(result) && result > 0 ? result : undefined; }

const marketOrder = PUBLIC_CATALOG_MARKETS.map((id) => ({
  id,
  label: CATALOG_MARKET_LABELS[id],
  flag: CATALOG_MARKET_FLAGS[id],
}));
const OVERVIEW_CARDS = 6;
const MARKET_PAGE_SIZE = 48;

function pageHref(params: Record<string, string | string[] | undefined>, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) { const resolved = first(value); if (resolved && key !== "page") query.set(key, resolved); }
  if (page > 1) query.set("page", String(page));
  const suffix = query.toString();
  return suffix ? `/cars?${suffix}` : "/cars";
}

function paginationItems(currentPage: number, totalPages: number) {
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  return [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
}

function offerFreshness(offer: any) {
  return Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.firstSeenAt || offer?.updatedAt || "")) || 0;
}

export default async function CarsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) || {};
  const selectedMarket = first(params.market);
  const requestedPage = Math.max(1, Number(first(params.page)) || 1);
  const common = {
    make: first(params.make) || first(params.brand), model: first(params.model), budgetFrom: numeric(params.budgetFrom), budgetTo: numeric(params.budget) || numeric(params.budgetTo), hasPrice: first(params.hasPrice),
    yearFrom: numeric(params.yearFrom), yearTo: numeric(params.yearTo), mileageFrom: numeric(params.mileageFrom), mileageTo: numeric(params.mileageTo), engineFrom: numeric(params.engineFrom), engineTo: numeric(params.engineTo), powerFrom: numeric(params.powerFrom), powerTo: numeric(params.powerTo),
    fuel: first(params.fuel), transmission: first(params.transmission), drive: first(params.drive), bodyType: first(params.bodyType), sort: "updatedAt" as const,
  };
  const hasFilters = Boolean(common.make || common.model || common.budgetFrom || common.budgetTo || common.hasPrice
    || common.yearFrom || common.yearTo || common.mileageFrom || common.mileageTo || common.engineFrom || common.engineTo
    || common.powerFrom || common.powerTo || common.fuel || common.transmission || common.drive || common.bodyType);
  const markets = selectedMarket ? marketOrder.filter((item) => item.id === selectedMarket) : marketOrder;
  const [facets, groupedMarkets] = await Promise.all([
    readCatalogFacets({ market: selectedMarket || undefined, make: common.make || undefined }),
    Promise.all(markets.map(async (market) => {
      const pageSize = selectedMarket ? MARKET_PAGE_SIZE : OVERVIEW_CARDS;
      const page = selectedMarket ? requestedPage : 1;
      if (!hasFilters) {
        const rows = (await readMarketOffers(market.id))
          .filter((offer) => offer.status === "active" && Boolean(offer.totalRub) && isCrediblePublicOffer(offer))
          .sort((left, right) => offerFreshness(right) - offerFreshness(left));
        const start = (page - 1) * pageSize;
        return {
          ...market,
          items: rows.slice(start, start + pageSize).map(publicOffer),
          total: rows.length,
          page,
          pageSize,
        };
      }
      const result = await searchOffers({ ...common, market: market.id, page, pageSize });
      return { ...market, items: result.items, total: result.total, page: result.page, pageSize: result.pageSize };
    })),
  ]);
  const visibleMarkets = selectedMarket ? groupedMarkets : groupedMarkets.filter((market) => market.total > 0);
  const total = groupedMarkets.reduce((sum, market) => sum + market.total, 0);
  const selectedResult = selectedMarket ? groupedMarkets[0] : undefined;
  const totalPages = selectedResult ? Math.max(1, Math.ceil(selectedResult.total / selectedResult.pageSize)) : 1;
  const currentPage = Math.min(requestedPage, totalPages);
  const visibleFrom = selectedResult?.total ? (currentPage - 1) * selectedResult.pageSize + 1 : 0;
  const visibleTo = selectedResult ? Math.min(currentPage * selectedResult.pageSize, selectedResult.total) : 0;
  const pages = paginationItems(currentPage, totalPages);
  const initialKeys = ["advanced", "budget", "budgetTo", "budgetFrom", "market", "make", "model", "yearFrom", "yearTo", "hasPrice", "bodyType", "mileageFrom", "mileageTo", "engineFrom", "engineTo", "powerFrom", "powerTo", "fuel", "transmission", "drive"];
  const initial = Object.fromEntries(initialKeys.map((key) => [key, first(params[key])])) as Record<string, string>;
  const brandNames = facets.makes || [];

  return <main className="ac-catalog-page ac-page-copy min-h-screen bg-[#07080d] text-white">
    <PublicHeader backHref="/" backLabel="На главную" />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10">
      <div className="max-w-4xl">
        <h1 className="whitespace-nowrap text-[30px] font-black leading-none tracking-[-0.04em] sm:text-4xl md:text-6xl">Каталог автомобилей</h1>
        <p className="mt-3 hidden text-sm font-bold leading-6 text-white/52 md:text-base lg:block">7 рынков: Корея, Китай, Япония, ОАЭ, Европа, Грузия и Кыргызстан. Найдено предложений: {total}.{selectedMarket ? ` Показаны автомобили ${visibleFrom}–${visibleTo}.` : ""}</p>
        <div className="lg:hidden"><BrandLogoRail brands={brandNames} /></div>
      </div>
      <CatalogFilters initial={initial} facets={facets} />
      <div className="hidden lg:block"><BrandLogoRail brands={brandNames} /></div>
      <CurrencyRatesStrip variant="mobile" className="mt-5 lg:hidden" />
      <div className="mt-8 grid gap-10 md:mt-9 md:gap-12">{visibleMarkets.map((market) => <section key={market.id} className="min-w-0"><div className="mb-4 flex items-end justify-between gap-4"><h2 className="flex min-w-0 items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><span aria-hidden="true">{market.flag}</span><span>{market.label}</span><span className="text-sm text-[var(--ac-muted)] md:text-base">· {market.total}</span></h2>{!selectedMarket ? <Link href={`/cars?market=${market.id}`} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link> : null}</div>{market.items.length ? selectedMarket ? <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">{market.items.map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact dense />)}</div> : <div className="ac-catalog-market-rail -mr-4 grid grid-flow-col auto-cols-[47%] gap-2.5 overflow-x-auto pr-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:mr-0 md:grid-flow-row md:grid-cols-4 md:auto-cols-auto md:overflow-visible md:pr-0">{market.items.map((offer: any, index: number) => <div key={offer.id} className={index >= 4 ? "md:hidden" : ""}><CatalogCard offer={offer} compact dense /></div>)}</div> : <div className="rounded-[1.5rem] bg-white/[0.04] px-6 py-7 text-sm font-bold text-white/55">Подходящих предложений сейчас нет.</div>}</section>)}</div>
      {selectedMarket && totalPages > 1 ? <nav className="ac-catalog-pagination ac-hide-scrollbar mt-10 flex flex-nowrap items-center justify-center gap-1 overflow-x-auto whitespace-nowrap px-1" aria-label="Страницы каталога">
        {currentPage > 1 ? <Link href={pageHref(params, currentPage - 1)} className="flex h-11 min-w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.055] px-2 text-base font-black" aria-label="Предыдущая страница">←</Link> : null}
        {pages.map((page, index) => <span key={page} className="contents">{index > 0 && page - pages[index - 1] > 1 ? <span className="shrink-0 px-1 text-white/35">…</span> : null}<Link href={pageHref(params, page)} aria-current={page === currentPage ? "page" : undefined} className={`flex h-11 min-w-10 shrink-0 items-center justify-center rounded-xl px-2 text-sm font-black ${page === currentPage ? "ac-pagination-current bg-red-500 text-white" : "bg-white/[0.055]"}`} style={page === currentPage ? { color: "#ffffff", WebkitTextFillColor: "#ffffff" } : undefined}>{page}</Link></span>)}
        {currentPage < totalPages ? <Link href={pageHref(params, currentPage + 1)} className="flex h-11 min-w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.055] px-2 text-base font-black" aria-label="Следующая страница">→</Link> : null}
      </nav> : null}
    </section>
    <style dangerouslySetInnerHTML={{ __html: `
      @media(min-width:1024px){
        .ac-catalog-page .ac-catalog-filter-panel:has(.ac-advanced-fields)>div:first-child{grid-template-columns:repeat(3,minmax(0,1fr))!important}
        .ac-catalog-page .ac-catalog-filter-panel:has(.ac-advanced-fields)>div:first-child>button{display:none!important}
        .ac-catalog-page .ac-advanced-fields{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:.75rem!important}
        .ac-catalog-page .ac-advanced-fields>div{display:contents!important}
        .ac-catalog-page .ac-advanced-fields>button{grid-column:3!important;margin-top:0!important;width:100%!important}
      }
      @media(max-width:767px){
        .ac-catalog-page .ac-catalog-card,.ac-catalog-page .ac-catalog-card *,.ac-catalog-page .ac-catalog-market-rail,.ac-catalog-page .ac-catalog-market-rail>*{box-shadow:none!important}
        .ac-catalog-page .ac-catalog-card,.ac-catalog-page .ac-catalog-market-rail{filter:none!important}
        .ac-catalog-page .ac-catalog-pagination{justify-content:center!important}
        .ac-catalog-page .ac-pagination-current{color:#fff!important;-webkit-text-fill-color:#fff!important}
      }
    ` }} />
  </main>;
}
