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
  const exact = await searchOffers({ budgetFrom, budgetTo: input.budgetRub, market: input.market, make: input.brand, model: input.model, yearFrom: input.yearFrom, yearTo, bodyType: input.body, pageSize: 12, sort: "updatedAt" });
  const relaxed = !exact.items.length;
  const marketList = input.market && input.market !== "any" ? markets.filter((market) => market.id === input.market) : markets;
  const grouped = await Promise.all(marketList.map(async (market) => {
    const items = exact.items.length ? exact.items.filter((offer:any) => offer.market === market.id) : (await searchOffers({ budgetFrom, budgetTo: input.budgetRub, market: market.id, pageSize: 8, sort: "updatedAt" })).items;
    return { ...market, items };
  }));
  const foundCount = grouped.reduce((sum, group) => sum + group.items.length, 0);
  const budgetLabel = budgetFrom ? `от ${money(budgetFrom)} ₽` : input.budgetRub ? `до ${money(input.budgetRub)} ₽` : "под ваш запрос";

  return <main className="ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
    <PublicHeader backHref="/" backLabel="К подбору" />
    <section className="mx-auto w-full max-w-[1450px] px-4 py-7 md:px-8 md:py-10">
      <div className="ac-result-summary rounded-[1.8rem] bg-white/[0.055] p-5 shadow-[0_24px_90px_rgba(0,0,0,.28)] md:p-7"><div className="grid gap-6 xl:grid-cols-[minmax(260px,.72fr)_minmax(0,1.7fr)_250px] xl:items-center"><div><div className="text-xs font-black uppercase tracking-[0.19em] text-red-500">Ваша АвтоЦена</div><h1 className="mt-2 text-4xl font-black leading-[.95] tracking-[-0.045em] md:text-5xl">{budgetLabel}</h1></div><div className="grid gap-3 grid-cols-2 lg:grid-cols-4"><SummaryItem label="Марка" value={input.brand || "любая"} /><SummaryItem label="Модель" value={input.model || "любая"} /><SummaryItem label="Год" value={yearTo ? "старше 2018" : input.yearFrom ? `от ${input.yearFrom}` : "любой"} /><SummaryItem label="Найдено" value={String(foundCount)} /></div><Link href="/#form" className="avto-button rounded-2xl px-5 py-4 text-center font-black">Изменить параметры</Link></div></div>
      <section className="mt-9">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 md:gap-x-6">
          <h2 className="text-[36px] font-black leading-[.94] tracking-[-0.045em] md:text-6xl">Актуальные автомобили</h2>
          <Link href="/cars" className="self-start rounded-2xl bg-white/[0.06] px-4 py-3 text-center text-sm font-black md:px-5 md:text-base">Весь каталог</Link>
          <p className="col-span-2 max-w-3xl text-sm font-bold leading-6 text-white/55 md:text-base">{relaxed ? "Точного совпадения нет — показываем реальные варианты в бюджете по каждому рынку." : "Показываем реальные совпадения по выбранным параметрам."}</p>
        </div>
        <div className="mt-8 grid gap-10">{grouped.map((group) => <section key={group.id}><div className="mb-4 flex items-end justify-between"><h3 className="text-3xl font-black">{group.label}</h3><Link href={`/cars?market=${group.id}`} className="font-black text-red-500">Все →</Link></div>{group.items.length ? <div className="ac-result-rail ac-hide-scrollbar">{group.items.map((offer:any) => <CatalogCard key={offer.id} offer={offer} compact />)}</div> : <div className="rounded-2xl bg-white/[0.035] p-5 text-sm font-bold text-white/45">Варианты этого рынка ещё загружаются.</div>}</section>)}</div>
      </section>
    </section>
  </main>;
}
