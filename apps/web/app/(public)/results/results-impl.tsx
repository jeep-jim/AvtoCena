import Link from "next/link";
import { getSearchInputFromParams, money } from "@/lib/avtocena";
import { searchOffers } from "@/lib/catalog/storage";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { CatalogCard } from "@/components/catalog/CatalogCard";

function firstParam(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }
function safeParams(params: Record<string, string | string[] | undefined>) { return { ...params, yearFrom: params.yearFrom ?? params.year, market: params.market ?? params.country }; }
function SummaryItem({ label, value }: { label: string; value: string }) { return <div className="ac-summary-item min-w-0 rounded-2xl bg-white/[0.04] p-4"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-red-500">{label}</div><div className="mt-1 break-words text-base font-black">{value}</div></div>; }
const markets = [{id:"korea",label:"Корея"},{id:"china",label:"Китай"},{id:"japan",label:"Япония"},{id:"uae",label:"ОАЭ"},{id:"europe",label:"Европа"}];

export default async function ResultsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) || {};
  const input = getSearchInputFromParams(safeParams(params));
  const budgetFrom = Number(firstParam(params.budgetFrom)) || undefined;
  const yearTo = Number(firstParam(params.yearTo)) || undefined;
  const powerTo = Number(firstParam(params.powerTo)) || undefined;
  const marketList = input.market && input.market !== "any" ? markets.filter((market) => market.id === input.market) : markets;
  const exactGroups = await Promise.all(marketList.map(async (market) => {
    const result = await searchOffers({ budgetFrom, budgetTo: input.budgetRub, market: market.id, make: input.brand, model: input.model, yearFrom: input.yearFrom, yearTo, bodyType: input.body, powerTo, pageSize: 8, sort: "updatedAt" });
    return { ...market, items: result.items, total: result.total };
  }));
  const exactTotal = exactGroups.reduce((sum, group) => sum + group.total, 0);
  const relaxed = exactTotal === 0;
  const grouped = relaxed ? await Promise.all(marketList.map(async (market) => {
    const result = await searchOffers({ budgetFrom, budgetTo: input.budgetRub, market: market.id, powerTo, pageSize: 8, sort: "updatedAt" });
    return { ...market, items: result.items, total: result.total };
  })) : exactGroups;
  const foundCount = grouped.reduce((sum, group) => sum + group.total, 0);
  const budgetLabel = budgetFrom ? `от ${money(budgetFrom)} ₽` : input.budgetRub ? `до ${money(input.budgetRub)} ₽` : "любой бюджет";
  const editParams = new URLSearchParams();
  editParams.set("advanced", "1");
  if (budgetFrom) editParams.set("budgetFrom", String(budgetFrom));
  if (input.budgetRub) editParams.set("budget", String(input.budgetRub));
  if (input.brand) editParams.set("make", input.brand);
  if (input.model) editParams.set("model", input.model);
  if (input.market && input.market !== "any") editParams.set("market", input.market);
  if (input.yearFrom) editParams.set("yearFrom", String(input.yearFrom));
  if (yearTo) editParams.set("yearTo", String(yearTo));
  if (input.body) editParams.set("bodyType", input.body);
  if (powerTo) editParams.set("powerTo", String(powerTo));

  return <main className="ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
    <PublicHeader backHref="/" backLabel="К подбору" />
    <section className="mx-auto w-full max-w-[1450px] px-4 py-7 md:px-8 md:py-10">
      <div className="ac-result-summary rounded-[1.8rem] bg-white/[0.055] p-5 md:p-7"><div className="grid gap-6 xl:grid-cols-[minmax(260px,.72fr)_minmax(0,1.7fr)_250px] xl:items-center"><div><div className="text-xs font-black uppercase tracking-[0.19em] text-red-500">Ваша АвтоЦена</div><h1 className="mt-2 text-4xl font-black leading-[.95] tracking-[-0.045em] md:text-5xl">{budgetLabel}</h1></div><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><SummaryItem label="Марка" value={input.brand || "любая"} /><SummaryItem label="Модель" value={input.model || "любая"} /><SummaryItem label="Мощность" value={powerTo === 160 ? "до 160 л.с." : "любая"} /><SummaryItem label="Год" value={yearTo ? "старше 2018" : input.yearFrom ? `от ${input.yearFrom}` : "любой"} /><SummaryItem label="Найдено" value={String(foundCount)} /></div><Link href={`/cars?${editParams.toString()}`} className="avto-button rounded-2xl px-5 py-4 text-center font-black">Изменить параметры</Link></div></div>
      <section className="mt-9 min-w-0"><div className="grid min-w-0 grid-cols-[minmax(0,1fr)_82px] items-start gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_112px] md:gap-x-6"><h2 className="min-w-0 text-[36px] font-black leading-[.94] tracking-[-0.045em] md:text-6xl">Актуальные автомобили</h2><Link href="/cars" className="flex min-h-16 w-[82px] items-center justify-center self-start rounded-2xl bg-white/[0.06] px-2 py-2 text-center text-sm font-black leading-[1.05] md:w-[112px] md:px-4 md:text-base"><span>Весь<br />каталог</span></Link><p className="col-span-2 max-w-3xl text-sm font-bold leading-6 text-white/55 md:text-base">{relaxed ? "Точного совпадения нет — показываем реальные варианты в бюджете по каждому рынку." : "Показываем реальные совпадения по выбранным параметрам."}</p></div>
        <div className="mt-8 grid min-w-0 gap-10">{grouped.map((group) => <section key={group.id} className="min-w-0"><div className="mb-4 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3"><h3 className="min-w-0 text-3xl font-black">{group.label}</h3><Link href={`/cars?market=${group.id}${powerTo ? `&powerTo=${powerTo}` : ""}`} className="justify-self-end whitespace-nowrap rounded-xl bg-white/[0.045] px-3 py-2 text-sm font-black text-red-500">Все →</Link></div>{group.items.length ? <div className="ac-result-rail ac-hide-scrollbar">{group.items.map((offer:any) => <CatalogCard key={offer.id} offer={offer} compact />)}</div> : <div className="rounded-2xl bg-white/[0.035] p-5 text-sm font-bold text-white/45">Варианты этого рынка ещё загружаются.</div>}</section>)}</div>
      </section>
    </section>
  </main>;
}
