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

export default async function CarsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) || {};
  const selectedMarket = first(params.market);
  const common = {
    make: first(params.make) || first(params.brand), model: first(params.model),
    budgetTo: Number(first(params.budget) || first(params.budgetTo)) || undefined,
    hasPrice: first(params.hasPrice), yearFrom: Number(first(params.yearFrom)) || undefined,
    mileageTo: Number(first(params.mileageTo)) || undefined, engineFrom: Number(first(params.engineFrom)) || undefined,
    powerFrom: Number(first(params.powerFrom)) || undefined, bodyType: first(params.bodyType), sort: "updatedAt" as const,
  };

  const markets = selectedMarket ? marketOrder.filter((item) => item.id === selectedMarket) : marketOrder;
  const groupedMarkets = await Promise.all(markets.map(async (market) => {
    const result = await searchOffers({ ...common, market: market.id, page: 1, pageSize: 10 });
    return { ...market, items: result.items, total: result.total };
  }));
  const total = groupedMarkets.reduce((sum, market) => sum + market.total, 0);
  const initial = Object.fromEntries(["budget","market","make","model","yearFrom","hasPrice","bodyType","mileageTo","engineFrom","powerFrom"].map((key) => [key, first(params[key])])) as Record<string,string>;

  return <main className="ac-page-copy min-h-screen bg-[#07080d] text-white">
    <PublicHeader backHref="/" backLabel="На главную" />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-7 md:px-8 md:py-10">
      <div className="max-w-4xl"><h1 className="text-4xl font-black leading-[.98] tracking-[-0.04em] md:text-6xl">Каталог автомобилей</h1><p className="mt-3 text-sm font-bold leading-6 text-white/52 md:text-base">Найдено предложений: {total}. Каждый рынок показан отдельным блоком.</p></div>
      <CatalogFilters initial={initial} />
      <div className="mt-9 grid gap-12">
        {groupedMarkets.map((market) => <section key={market.id} className="min-w-0">
          <div className="mb-4 flex items-end justify-between gap-4"><h2 className="text-3xl font-black tracking-[-0.04em] md:text-4xl">{market.label}</h2><Link href={`/cars?market=${market.id}`} className="rounded-xl bg-white/[0.045] px-3 py-2 text-sm font-black">Все →</Link></div>
          {market.items.length ? <div className="ac-market-rail ac-hide-scrollbar">{market.items.map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact />)}</div> : <div className="rounded-[1.5rem] bg-white/[0.035] p-6 text-sm font-bold text-white/48"><strong>Свежие автомобили пока загружаются.</strong> Блок появится автоматически после успешного импорта этого рынка.</div>}
        </section>)}
      </div>
    </section>
  </main>;
}
