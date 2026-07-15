import Link from "next/link";
import { searchOffers } from "@/lib/catalog/storage";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { CatalogFilters } from "@/components/catalog/CatalogFilters";

function first(value?: string | string[]) { return Array.isArray(value) ? value[0] : value || ""; }

const marketOrder = [
  { id: "korea", label: "Корея" },
  { id: "china", label: "Китай" },
  { id: "japan", label: "Япония" },
  { id: "uae", label: "ОАЭ" },
  { id: "europe", label: "Европа" },
];

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

export default async function CarsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) || {};
  const selectedMarket = first(params.market);
  const requestedPage = Math.max(1, Number(first(params.page)) || 1);
  const common = {
    make: first(params.make) || first(params.brand), model: first(params.model),
    budgetTo: Number(first(params.budget) || first(params.budgetTo)) || undefined,
    hasPrice: first(params.hasPrice), yearFrom: Number(first(params.yearFrom)) || undefined,
    mileageTo: Number(first(params.mileageTo)) || undefined, engineFrom: Number(first(params.engineFrom)) || undefined,
    powerFrom: Number(first(params.powerFrom)) || undefined, bodyType: first(params.bodyType), sort: "updatedAt" as const,
  };

  const markets = selectedMarket ? marketOrder.filter((item) => item.id === selectedMarket) : marketOrder;
  const groupedMarkets = await Promise.all(markets.map(async (market) => {
    const result = await searchOffers({ ...common, market: market.id, page: selectedMarket ? requestedPage : 1, pageSize: selectedMarket ? 48 : 10 });
    return { ...market, items: result.items, total: result.total, page: result.page, pageSize: result.pageSize };
  }));
  const total = groupedMarkets.reduce((sum, market) => sum + market.total, 0);
  const selectedResult = selectedMarket ? groupedMarkets[0] : undefined;
  const totalPages = selectedResult ? Math.max(1, Math.ceil(selectedResult.total / selectedResult.pageSize)) : 1;
  const currentPage = Math.min(requestedPage, totalPages);
  const visibleFrom = selectedResult?.total ? (currentPage - 1) * selectedResult.pageSize + 1 : 0;
  const visibleTo = selectedResult ? Math.min(currentPage * selectedResult.pageSize, selectedResult.total) : 0;
  const initial = Object.fromEntries(["budget","market","make","model","yearFrom","hasPrice","bodyType","mileageTo","engineFrom","powerFrom"].map((key) => [key, first(params[key])])) as Record<string,string>;

  return <main className="ac-page-copy min-h-screen bg-[#07080d] text-white">
    <PublicHeader backHref="/" backLabel="На главную" />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-7 md:px-8 md:py-10">
      <div className="max-w-4xl"><h1 className="text-4xl font-black leading-[.98] tracking-[-0.04em] md:text-6xl">Каталог автомобилей</h1><p className="mt-3 text-sm font-bold leading-6 text-white/52 md:text-base">Найдено предложений: {total}. {selectedMarket ? `Показаны автомобили ${visibleFrom}–${visibleTo} из ${selectedResult?.total || 0}.` : "Каждый рынок показан отдельным блоком."}</p></div>
      <CatalogFilters initial={initial} />
      <div className="mt-9 grid gap-12">
        {groupedMarkets.map((market) => <section key={market.id} className="min-w-0">
          <div className="mb-4 flex items-end justify-between gap-4"><h2 className="text-3xl font-black tracking-[-0.04em] md:text-4xl">{market.label}</h2>{selectedMarket ? <Link href="/cars" className="rounded-xl bg-white/[0.045] px-3 py-2 text-sm font-black">Все рынки →</Link> : <Link href={`/cars?market=${market.id}`} className="rounded-xl bg-white/[0.045] px-3 py-2 text-sm font-black">Все →</Link>}</div>
          {market.items.length ? <div className="ac-market-rail ac-hide-scrollbar">{market.items.map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact />)}</div> : <div className="rounded-[1.5rem] bg-white/[0.035] p-6 text-sm font-bold text-white/48"><strong>Свежие автомобили пока загружаются.</strong> Блок появится автоматически после успешного импорта этого рынка.</div>}
        </section>)}
      </div>

      {selectedResult && totalPages > 1 ? (
        <nav className="mt-10 flex items-center justify-between gap-3" aria-label="Страницы каталога">
          {currentPage > 1 ? <Link href={pageHref(params, currentPage - 1)} className="rounded-2xl bg-white/[0.06] px-4 py-3 text-sm font-black">← Назад</Link> : <span />}
          <span className="text-sm font-black text-white/55">Страница {currentPage} из {totalPages}</span>
          {currentPage < totalPages ? <Link href={pageHref(params, currentPage + 1)} className="rounded-2xl bg-white/[0.06] px-4 py-3 text-sm font-black">Дальше →</Link> : <span />}
        </nav>
      ) : null}
    </section>
  </main>;
}
