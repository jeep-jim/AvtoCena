import Link from "next/link";
import { getSearchInputFromParams } from "@/lib/avtocena";
import { readCatalogFacets, searchOffers } from "@/lib/catalog/storage";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { CatalogCard } from "@/components/catalog/CatalogCard";

function firstParam(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }
function safeParams(params: Record<string, string | string[] | undefined>) { return { ...params, yearFrom: params.yearFrom ?? params.year, market: params.market ?? params.country }; }
function unique(values: Array<string | undefined>) { return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]; }

const markets = [{id:"korea",label:"Корея"},{id:"china",label:"Китай"},{id:"japan",label:"Япония"},{id:"uae",label:"ОАЭ"},{id:"europe",label:"Европа"}];
const bodyOptions = [
  { value: "", label: "Любой кузов" },
  { value: "suv", label: "Кроссовер" },
  { value: "offroad", label: "Внедорожник" },
  { value: "sedan", label: "Седан" },
  { value: "hatchback", label: "Хэтчбек" },
  { value: "wagon", label: "Универсал" },
  { value: "minivan", label: "Минивэн" },
  { value: "coupe", label: "Купе" },
  { value: "convertible", label: "Кабриолет" },
  { value: "pickup", label: "Пикап" },
  { value: "van", label: "Фургон" },
];
const controlClass = "ac-native-select h-14 w-full rounded-2xl bg-[var(--ac-surface-2)] px-4 text-sm font-black text-[var(--ac-text)] outline-none";
const inputClass = "h-14 w-full rounded-2xl bg-[var(--ac-surface-2)] px-4 text-sm font-black text-[var(--ac-text)] outline-none placeholder:text-[var(--ac-muted)]";

export default async function ResultsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) || {};
  const input = getSearchInputFromParams(safeParams(params));
  const budgetFrom = Number(firstParam(params.budgetFrom)) || undefined;
  const yearTo = Number(firstParam(params.yearTo)) || undefined;
  const powerTo = Number(firstParam(params.powerTo)) || undefined;
  const marketList = input.market && input.market !== "any" ? markets.filter((market) => market.id === input.market) : markets;
  const [facets, exactGroups] = await Promise.all([
    readCatalogFacets({ market: input.market && input.market !== "any" ? input.market : undefined }),
    Promise.all(marketList.map(async (market) => {
      const result = await searchOffers({ budgetFrom, budgetTo: input.budgetRub, market: market.id, make: input.brand, model: input.model, yearFrom: input.yearFrom, yearTo, bodyType: input.body, powerTo, pageSize: 8, sort: "updatedAt" });
      return { ...market, items: result.items, total: result.total };
    })),
  ]);
  const exactTotal = exactGroups.reduce((sum, group) => sum + group.total, 0);
  const relaxed = exactTotal === 0;
  const grouped = relaxed ? await Promise.all(marketList.map(async (market) => {
    const result = await searchOffers({ budgetFrom, budgetTo: input.budgetRub, market: market.id, powerTo, pageSize: 8, sort: "updatedAt" });
    return { ...market, items: result.items, total: result.total };
  })) : exactGroups;
  const foundCount = grouped.reduce((sum, group) => sum + group.total, 0);
  const makeOptions = unique([input.brand, ...(facets.makes || [])]).sort((a, b) => a.localeCompare(b, "ru"));
  const modelOptions = unique([
    input.model,
    ...(facets.models || []).filter((item) => !input.brand || String(item.make) === input.brand).map((item) => String(item.model || "")),
  ]).sort((a, b) => a.localeCompare(b, "ru"));

  return <main className="ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
    <PublicHeader backHref="/" backLabel="К подбору" />
    <section className="mx-auto w-full max-w-[1450px] px-4 py-7 md:px-8 md:py-10">
      <details className="ac-results-edit group">
        <summary className="avto-button flex min-h-14 w-full cursor-pointer items-center justify-center gap-3 rounded-2xl px-5 text-center text-base font-black md:max-w-[360px]">
          <span>Изменить параметры</span><span className="text-xl leading-none transition group-open:rotate-45">+</span>
        </summary>
        <form method="get" action="/results" className="ac-results-edit-form mt-3 grid gap-3 rounded-[1.5rem] bg-[var(--ac-surface)] p-4 sm:grid-cols-2 lg:grid-cols-4">
          <input name="budgetFrom" defaultValue={budgetFrom || ""} inputMode="numeric" placeholder="Цена от, ₽" className={inputClass} />
          <input name="budget" defaultValue={input.budgetRub || ""} inputMode="numeric" placeholder="Цена до, ₽" className={inputClass} />
          <select name="brand" defaultValue={input.brand || ""} className={controlClass}><option value="">Любая марка</option>{makeOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <select name="model" defaultValue={input.model || ""} className={controlClass}><option value="">Любая модель</option>{modelOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <select name="market" defaultValue={input.market && input.market !== "any" ? input.market : ""} className={controlClass}><option value="">Все рынки</option>{markets.map((market) => <option key={market.id} value={market.id}>{market.label}</option>)}</select>
          <select name="body" defaultValue={input.body || ""} className={controlClass}>{bodyOptions.map((option) => <option key={option.value || "any"} value={option.value}>{option.label}</option>)}</select>
          <input name="yearFrom" defaultValue={input.yearFrom || ""} inputMode="numeric" placeholder="Год от" className={inputClass} />
          <input name="yearTo" defaultValue={yearTo || ""} inputMode="numeric" placeholder="Год до" className={inputClass} />
          <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl bg-[var(--ac-surface-2)] px-4 text-sm font-black"><input type="checkbox" name="powerTo" value="160" defaultChecked={powerTo === 160} className="h-5 w-5 accent-[#ff353d]" /><span>До 160 л.с.</span></label>
          <button className="avto-button flex min-h-14 items-center justify-center rounded-2xl px-5 text-center text-base font-black sm:col-span-2 lg:col-span-3">Показать автомобили</button>
        </form>
      </details>

      <section className="mt-9 min-w-0">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_82px] items-start gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_112px] md:gap-x-6">
          <h1 className="min-w-0 text-[36px] font-black leading-[.94] tracking-[-0.045em] md:text-6xl">Актуальные автомобили</h1>
          <Link href="/cars" className="ac-results-catalog-link flex min-h-16 w-[82px] items-center justify-center self-start rounded-2xl px-2 py-2 text-center text-sm font-black leading-[1.05] md:w-[112px] md:px-4 md:text-base"><span>Весь<br />каталог</span></Link>
          <p className="col-span-2 max-w-3xl text-sm font-bold leading-6 text-white/55 md:text-base">{relaxed ? "Точного совпадения нет — показываем реальные варианты в бюджете по каждому рынку." : "Показываем реальные совпадения по выбранным параметрам."} Найдено: {foundCount}.</p>
        </div>
        <div className="mt-8 grid min-w-0 gap-10">{grouped.map((group) => <section key={group.id} className="min-w-0"><div className="mb-4 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3"><h2 className="min-w-0 text-3xl font-black">{group.label}</h2><Link href={`/cars?market=${group.id}${powerTo ? `&powerTo=${powerTo}` : ""}`} className="ac-results-market-link justify-self-end whitespace-nowrap rounded-xl px-3 py-2 text-sm font-black text-red-500">Все →</Link></div>{group.items.length ? <div className="ac-result-rail ac-hide-scrollbar">{group.items.map((offer:any) => <CatalogCard key={offer.id} offer={offer} compact />)}</div> : <div className="rounded-2xl bg-white/[0.035] p-5 text-sm font-bold text-white/45">Варианты этого рынка ещё загружаются.</div>}</section>)}</div>
      </section>
    </section>
  </main>;
}
