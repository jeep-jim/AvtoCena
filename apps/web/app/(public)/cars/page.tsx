import Link from "next/link";
import { searchOffers } from "@/lib/catalog/storage";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { CatalogFilters } from "@/components/catalog/CatalogFilters";

function first(value?: string | string[]) { return Array.isArray(value) ? value[0] : value || ""; }
function numeric(value?: string | string[]) { const result = Number(first(value)); return Number.isFinite(result) && result > 0 ? result : undefined; }

const marketOrder = [
  { id: "korea", label: "Корея" },
  { id: "china", label: "Китай" },
  { id: "japan", label: "Япония" },
  { id: "uae", label: "ОАЭ" },
  { id: "europe", label: "Европа" },
];

const OVERVIEW_CARDS = 4;
const MARKET_PAGE_SIZE = 48;

function pageHref(params: Record<string, string | string[] | undefined>, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const resolved = first(value);
    if (resolved && key !== "page") query.set(key, resolved);
  }
  if (page > 1) query.set("page", String(page));
  const suffix = query.toString();
  return suffix ? `/cars?${suffix}` : "/cars";
}

function paginationItems(currentPage: number, totalPages: number) {
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  return [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
}

export default async function CarsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) || {};
  const selectedMarket = first(params.market);
  const requestedPage = Math.max(1, Number(first(params.page)) || 1);
  const common = {
    make: first(params.make) || first(params.brand),
    model: first(params.model),
    budgetFrom: numeric(params.budgetFrom),
    budgetTo: numeric(params.budget) || numeric(params.budgetTo),
    hasPrice: first(params.hasPrice),
    yearFrom: numeric(params.yearFrom),
    yearTo: numeric(params.yearTo),
    mileageTo: numeric(params.mileageTo),
    engineFrom: numeric(params.engineFrom),
    engineTo: numeric(params.engineTo),
    powerFrom: numeric(params.powerFrom),
    fuel: first(params.fuel),
    transmission: first(params.transmission),
    drive: first(params.drive),
    bodyType: first(params.bodyType),
    sort: "updatedAt" as const,
  };

  const markets = selectedMarket ? marketOrder.filter((item) => item.id === selectedMarket) : marketOrder;
  const groupedMarkets = await Promise.all(markets.map(async (market) => {
    const result = await searchOffers({
      ...common,
      market: market.id,
      page: selectedMarket ? requestedPage : 1,
      pageSize: selectedMarket ? MARKET_PAGE_SIZE : OVERVIEW_CARDS,
    });
    return { ...market, items: result.items, total: result.total, page: result.page, pageSize: result.pageSize };
  }));
  const total = groupedMarkets.reduce((sum, market) => sum + market.total, 0);
  const selectedResult = selectedMarket ? groupedMarkets[0] : undefined;
  const totalPages = selectedResult ? Math.max(1, Math.ceil(selectedResult.total / selectedResult.pageSize)) : 1;
  const currentPage = Math.min(requestedPage, totalPages);
  const visibleFrom = selectedResult?.total ? (currentPage - 1) * selectedResult.pageSize + 1 : 0;
  const visibleTo = selectedResult ? Math.min(currentPage * selectedResult.pageSize, selectedResult.total) : 0;
  const pages = paginationItems(currentPage, totalPages);
  const initialKeys = ["budget", "budgetFrom", "market", "make", "model", "yearFrom", "yearTo", "hasPrice", "bodyType", "mileageFrom", "mileageTo", "engineFrom", "engineTo", "powerFrom", "fuel", "transmission", "drive"];
  const initial = Object.fromEntries(initialKeys.map((key) => [key, first(params[key])])) as Record<string, string>;

  return <main className="ac-page-copy min-h-screen bg-[#07080d] text-white">
    <PublicHeader backHref="/" backLabel="На главную" />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-7 md:px-8 md:py-10">
      <div className="max-w-4xl"><h1 className="text-4xl font-black leading-[.98] tracking-[-0.04em] md:text-6xl">Каталог автомобилей</h1><p className="mt-3 text-sm font-bold leading-6 text-white/52 md:text-base">Найдено предложений: {total}.{selectedMarket ? ` Показаны автомобили ${visibleFrom}–${visibleTo}.` : ""}</p></div>
      <CatalogFilters initial={initial} />
      <div className="mt-9 grid gap-12">
        {groupedMarkets.map((market) => <section key={market.id} className="min-w-0">
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 className="text-3xl font-black tracking-[-0.04em] md:text-4xl">{market.label}</h2>
            {!selectedMarket ? <Link href={`/cars?market=${market.id}`} className="rounded-xl bg-white/[0.045] px-3 py-2 text-sm font-black">Все →</Link> : null}
          </div>
          {market.items.length ? (
            selectedMarket ? (
              <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">
                {market.items.map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact dense />)}
              </div>
            ) : (
              <div className="ac-hide-scrollbar -mr-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-2 pr-4 sm:gap-3 md:mr-0 md:grid md:grid-cols-4 md:overflow-visible md:pr-0">
                {market.items.map((offer: any) => (
                  <div key={offer.id} className="w-[47%] shrink-0 snap-start md:w-auto md:shrink md:snap-none">
                    <CatalogCard offer={offer} compact dense />
                  </div>
                ))}
              </div>
            )
          ) : <div className="rounded-[1.5rem] bg-white/[0.035] p-6 text-sm font-bold text-white/48"><strong>Свежие автомобили пока загружаются.</strong> Блок появится автоматически после успешного импорта этого рынка.</div>}
        </section>)}
      </div>

      {selectedResult && totalPages > 1 ? (
        <nav className="mt-10 flex flex-wrap items-center justify-center gap-2 rounded-[1.4rem] bg-white/[0.04] p-3" aria-label="Страницы каталога">
          {currentPage > 1 ? <Link href={pageHref(params, currentPage - 1)} className="rounded-xl bg-white/[0.07] px-3 py-2 text-sm font-black">← Назад</Link> : null}
          {pages.map((page, index) => {
            const previous = pages[index - 1];
            return <span key={page} className="contents">
              {previous && page - previous > 1 ? <span className="px-1 text-sm font-black text-white/40">…</span> : null}
              <Link href={pageHref(params, page)} aria-current={page === currentPage ? "page" : undefined} className={`flex h-10 min-w-10 items-center justify-center rounded-xl px-3 text-sm font-black ${page === currentPage ? "bg-red-500 text-white" : "bg-white/[0.07]"}`}>{page}</Link>
            </span>;
          })}
          {currentPage < totalPages ? <Link href={pageHref(params, currentPage + 1)} className="rounded-xl bg-white/[0.07] px-3 py-2 text-sm font-black">Дальше →</Link> : null}
        </nav>
      ) : null}
    </section>
  </main>;
}
