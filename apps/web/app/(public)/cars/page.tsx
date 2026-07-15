import Link from "next/link";
import { searchOffers } from "@/lib/catalog/storage";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { CatalogFilterForm } from "@/components/catalog/CatalogFilterForm";

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value || "";
}

const marketOrder = [
  { id: "korea", label: "Корея" },
  { id: "china", label: "Китай" },
  { id: "japan", label: "Япония" },
  { id: "uae", label: "ОАЭ" },
  { id: "europe", label: "Европа" },
] as const;

export default async function CarsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) || {};
  const page = Math.max(1, Number(first(params.page)) || 1);
  const selectedMarket = first(params.market);
  const budget = Number(first(params.budget) || first(params.budgetTo)) || undefined;

  const commonSearch = {
    make: first(params.make) || first(params.brand),
    model: first(params.model),
    budgetTo: budget,
    hasPrice: first(params.hasPrice),
    yearFrom: Number(first(params.yearFrom)) || undefined,
    mileageTo: Number(first(params.mileageTo)) || undefined,
    engineFrom: Number(first(params.engineFrom)) || undefined,
    powerFrom: Number(first(params.powerFrom)) || undefined,
    fuel: first(params.fuel),
    drive: first(params.drive),
    bodyType: first(params.bodyType),
    sort: first(params.sort) || "updatedAt",
  };

  const visibleMarkets = selectedMarket
    ? marketOrder.filter((market) => market.id === selectedMarket)
    : marketOrder;

  const marketResults = await Promise.all(
    visibleMarkets.map(async (market) => ({
      ...market,
      result: await searchOffers({
        ...commonSearch,
        market: market.id,
        page: selectedMarket ? page : 1,
        pageSize: selectedMarket ? 36 : 12,
      }),
    })),
  );

  const allVisibleItems = marketResults.flatMap((market) => market.result.items as any[]);
  const makes = [...new Set(allVisibleItems.map((offer) => String(offer.make || "").trim()).filter(Boolean))];
  const modelsByMake: Record<string, string[]> = {};
  for (const offer of allVisibleItems) {
    const make = String(offer.make || "").trim();
    const model = String(offer.model || "").trim();
    if (!make || !model) continue;
    modelsByMake[make] = [...new Set([...(modelsByMake[make] || []), model])];
  }

  const total = marketResults.reduce((sum, market) => sum + market.result.total, 0);
  const selectedResult = selectedMarket ? marketResults[0]?.result : null;
  const totalPages = selectedResult ? Math.max(1, Math.ceil(selectedResult.total / selectedResult.pageSize)) : 1;

  const buildPageHref = (nextPage: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const text = first(value);
      if (text && key !== "page") query.set(key, text);
    }
    query.set("page", String(nextPage));
    return `/cars?${query.toString()}`;
  };

  const initialFilters = {
    budget: first(params.budget) || first(params.budgetTo),
    market: selectedMarket,
    make: first(params.make) || first(params.brand),
    model: first(params.model),
    yearFrom: first(params.yearFrom),
    hasPrice: first(params.hasPrice),
    bodyType: first(params.bodyType),
    mileageTo: first(params.mileageTo),
    engineFrom: first(params.engineFrom),
    powerFrom: first(params.powerFrom),
    fuel: first(params.fuel),
    drive: first(params.drive),
  };

  return (
    <main className="ac-page-copy min-h-screen bg-[#07080d] text-white">
      <PublicHeader backHref="/" backLabel="На главную" />

      <section className="mx-auto w-full max-w-[1500px] px-4 py-7 md:px-8 md:py-10">
        <div className="max-w-4xl">
          <h1 className="text-4xl font-black leading-[.98] tracking-[-0.04em] md:text-6xl">Каталог автомобилей</h1>
          <p className="mt-3 text-sm font-bold leading-6 text-white/52 md:text-base">
            Найдено предложений: {total}. Каждый рынок показан отдельным блоком — на телефоне листайте карточки вправо.
          </p>
        </div>

        <CatalogFilterForm initial={initialFilters} makes={makes} modelsByMake={modelsByMake} />

        <div className="mt-8 grid gap-11 md:mt-10 md:gap-14">
          {marketResults.map((market) => (
            <section key={market.id} className="min-w-0">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-red-300/75">Рынок поставки</div>
                  <h2 className="mt-1 text-3xl font-black tracking-[-0.04em] md:text-4xl">{market.label}</h2>
                </div>
                {!selectedMarket ? (
                  <Link href={`/cars?market=${market.id}`} className="ac-market-all flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-black text-white/62 transition hover:text-white">
                    Все <span className="text-red-300" aria-hidden="true">→</span>
                  </Link>
                ) : null}
              </div>

              {market.result.items.length ? (
                <div className="ac-market-rail ac-hide-scrollbar">
                  {market.result.items.map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact />)}
                </div>
              ) : (
                <div className="ac-market-empty rounded-[1.45rem] px-5 py-7 text-sm font-bold text-white/48">
                  Предложения по этому рынку сейчас обновляются.
                </div>
              )}
            </section>
          ))}
        </div>

        {selectedResult && totalPages > 1 ? (
          <nav className="mt-10 flex flex-wrap items-center justify-center gap-3" aria-label="Страницы каталога">
            {page > 1 ? <Link href={buildPageHref(page - 1)} className="rounded-2xl bg-white/[0.06] px-5 py-3 font-black">← Назад</Link> : null}
            <span className="rounded-2xl bg-white/[0.035] px-4 py-3 text-sm font-black text-white/52">{page} из {totalPages}</span>
            {page < totalPages ? <Link href={buildPageHref(page + 1)} className="avto-button rounded-2xl px-5 py-3 font-black">Следующая →</Link> : null}
          </nav>
        ) : null}
      </section>
    </main>
  );
}
