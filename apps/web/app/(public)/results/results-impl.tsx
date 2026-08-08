import Link from "next/link";
import { redirect } from "next/navigation";
import { getSearchInputFromParams } from "@/lib/avtocena";
import { readCatalogFacets, searchOffers } from "@/lib/catalog/storage";
import { CATALOG_MARKET_LABELS, PUBLIC_CATALOG_MARKETS } from "@/lib/catalog/runtime-config";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { CatalogMarketFlag } from "@/components/catalog/CatalogMarketFlag";
import { CatalogFilters } from "@/components/catalog/CatalogFilters";

function firstParam(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }
function numberParam(value?: string | string[]) { const parsed = Number(firstParam(value)); return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined; }
function safeParams(params: Record<string, string | string[] | undefined>) { return { ...params, yearFrom: params.yearFrom ?? params.year, market: params.market ?? params.country }; }
function withoutCity(params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "city" || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item)); else query.set(key, value);
  }
  return query.toString();
}

const markets = PUBLIC_CATALOG_MARKETS.map((id) => ({
  id,
  label: CATALOG_MARKET_LABELS[id],
}));

export default async function ResultsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) || {};
  const input = getSearchInputFromParams(safeParams(params));
  const make = String(firstParam(params.make) || input.brand || "").trim();
  const model = String(firstParam(params.model) || input.model || "").trim();
  const market = String(firstParam(params.market) || (input.market !== "any" ? input.market : "") || "").trim();
  const bodyType = String(firstParam(params.bodyType) || (input.body && input.body !== "any" ? input.body : "") || "").trim();
  const budgetFrom = numberParam(params.budgetFrom);
  const budgetTo = numberParam(params.budget) || numberParam(params.budgetTo) || input.budgetRub || undefined;
  const yearFrom = numberParam(params.yearFrom) || input.yearFrom || undefined;
  const yearTo = numberParam(params.yearTo);
  const mileageFrom = numberParam(params.mileageFrom);
  const mileageTo = numberParam(params.mileageTo);
  const engineFrom = numberParam(params.engineFrom);
  const engineTo = numberParam(params.engineTo);
  const powerFrom = numberParam(params.powerFrom);
  const powerTo = numberParam(params.powerTo);
  const fuel = String(firstParam(params.fuel) || "").trim();
  const transmission = String(firstParam(params.transmission) || "").trim();
  const drive = String(firstParam(params.drive) || "").trim();
  const electricOnly = fuel === "electric";
  const city = String(firstParam(params.city) || "").trim();
  if (electricOnly && city) {
    const query = withoutCity(params);
    redirect(`/results${query ? `?${query}` : ""}`);
  }

  const marketList = market ? markets.filter((item) => item.id === market) : markets;
  const searchInput = {
    budgetFrom,
    budgetTo,
    make: make || undefined,
    model: model || undefined,
    yearFrom,
    yearTo,
    mileageFrom,
    mileageTo,
    engineFrom,
    engineTo,
    powerFrom,
    powerTo,
    fuel: fuel || undefined,
    transmission: transmission || undefined,
    drive: drive || undefined,
    bodyType: bodyType || undefined,
    sort: "updatedAt" as const,
  };
  const [facets, exactGroups] = await Promise.all([
    readCatalogFacets({ market: market || undefined, make: make || undefined }),
    Promise.all(marketList.map(async (item) => {
      const result = await searchOffers({ ...searchInput, market: item.id, pageSize: 12 });
      return { ...item, items: result.items, total: result.total };
    })),
  ]);
  const exactTotal = exactGroups.reduce((sum, group) => sum + group.total, 0);
  const relaxed = exactTotal === 0;
  const grouped = relaxed ? await Promise.all(marketList.map(async (item) => {
    const result = await searchOffers({ budgetFrom, budgetTo, market: item.id, powerTo, fuel: fuel || undefined, pageSize: 12, sort: "updatedAt" });
    return { ...item, items: result.items, total: result.total };
  })) : exactGroups;
  const foundCount = grouped.reduce((sum, group) => sum + group.total, 0);
  const filterInitial: Record<string, string> = {
    make,
    model,
    market,
    bodyType,
    budgetFrom: budgetFrom ? String(budgetFrom) : "",
    budget: budgetTo ? String(budgetTo) : "",
    yearFrom: yearFrom ? String(yearFrom) : "",
    yearTo: yearTo ? String(yearTo) : "",
    mileageFrom: mileageFrom ? String(mileageFrom) : "",
    mileageTo: mileageTo ? String(mileageTo) : "",
    engineFrom: engineFrom ? String(engineFrom) : "",
    engineTo: engineTo ? String(engineTo) : "",
    powerFrom: powerFrom ? String(powerFrom) : "",
    powerTo: powerTo ? String(powerTo) : "",
    fuel,
    transmission,
    drive,
  };

  return <main className="ac-results-page ac-page-copy min-h-screen overflow-x-hidden bg-[#0f172a] text-white">
    <PublicHeader backHref="/" backLabel="К подбору" />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-7 md:px-8 md:py-10">
      <CatalogFilters initial={filterInitial} facets={facets} />

      <section className="mt-9 min-w-0">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_82px] items-start gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_112px] md:gap-x-6">
          <h1 className="min-w-0 text-[36px] font-black leading-[.94] tracking-[-0.045em] md:text-6xl">{electricOnly ? "Электромобили" : "Актуальные автомобили"}</h1>
          <Link href={`/cars${electricOnly ? "?fuel=electric" : ""}`} className="ac-results-catalog-link flex min-h-16 w-[82px] items-center justify-center self-start rounded-2xl px-2 py-2 text-center text-sm font-black leading-[1.05] md:w-[112px] md:px-4 md:text-base"><span>Весь<br />каталог</span></Link>
          <p className="col-span-2 max-w-3xl text-sm font-bold leading-6 text-white/55 md:text-base">{relaxed ? "Точного совпадения нет — показываем реальные варианты в бюджете по каждому рынку." : "Показываем реальные совпадения по выбранным параметрам."} Найдено: {foundCount}.</p>
        </div>
        <div className="mt-8 grid min-w-0 gap-10 md:gap-12">{grouped.map((group) => {
          const query = new URLSearchParams({ market: group.id });
          if (powerTo) query.set("powerTo", String(powerTo));
          if (electricOnly) query.set("fuel", "electric");
          return <section key={group.id} className="min-w-0"><div className="mb-4 flex min-w-0 items-end justify-between gap-3"><h2 className="flex min-w-0 items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><CatalogMarketFlag market={group.id} className="h-5 w-7 md:h-6 md:w-9" /><span>{group.label}</span><span className="text-sm text-[var(--ac-muted)] md:text-base">· {group.total}</span></h2><Link href={`/cars?${query}`} className="ac-market-all-link shrink-0 whitespace-nowrap text-sm font-black">Все →</Link></div>{group.items.length ? <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">{group.items.map((offer:any) => <CatalogCard key={offer.id} offer={offer} compact dense />)}</div> : <div className="rounded-2xl bg-white/[0.035] p-5 text-sm font-bold text-white/45">Варианты этого рынка ещё загружаются.</div>}</section>;
        })}</div>
      </section>
    </section>
  </main>;
}
