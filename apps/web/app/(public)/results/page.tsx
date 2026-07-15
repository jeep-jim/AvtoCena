import Link from "next/link";
import { getSearchInputFromParams, money } from "@/lib/avtocena";
import { searchOffers } from "@/lib/catalog/storage";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { CatalogCard } from "@/components/catalog/CatalogCard";

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function safeParams(params: Record<string, string | string[] | undefined>) {
  return { ...params, yearFrom: params.yearFrom ?? params.year, market: params.market ?? params.country };
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="ac-summary-item min-w-0 rounded-2xl bg-white/[0.04] p-4">
      <div className="ac-muted-label text-[10px] font-black uppercase tracking-[0.16em] text-white/38">{label}</div>
      <div className="mt-1 break-words text-base font-black text-white/88">{value}</div>
    </div>
  );
}

export default async function ResultsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) || {};
  const input = getSearchInputFromParams(safeParams(params));
  const budgetFrom = Number(firstParam(params.budgetFrom)) || undefined;
  const yearTo = Number(firstParam(params.yearTo)) || undefined;

  const exact = await searchOffers({
    budgetFrom,
    budgetTo: input.budgetRub,
    market: input.market,
    make: input.brand,
    model: input.model,
    yearFrom: input.yearFrom,
    yearTo,
    bodyType: input.body,
    pageSize: 12,
    sort: "updatedAt",
  });

  const alternatives = exact.items.length
    ? { items: [] as any[], total: 0 }
    : await searchOffers({ budgetFrom, budgetTo: input.budgetRub, market: input.market, pageSize: 12, sort: "updatedAt" });

  const shownItems = exact.items.length ? exact.items : alternatives.items;
  const isAlternativeMode = !exact.items.length && alternatives.items.length > 0;
  const budgetLabel = budgetFrom ? `от ${money(budgetFrom)} ₽` : input.budgetRub ? `до ${money(input.budgetRub)} ₽` : "под ваш запрос";

  return (
    <main className="ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
      <PublicHeader backHref="/" backLabel="К подбору" />

      <section className="mx-auto w-full max-w-[1450px] px-4 py-7 md:px-8 md:py-10">
        <div className="ac-result-summary rounded-[1.8rem] bg-white/[0.055] p-5 md:p-7">
          <div className="grid gap-6 xl:grid-cols-[minmax(260px,.72fr)_minmax(0,1.7fr)_250px] xl:items-center">
            <div>
              <div className="ac-muted-label text-xs font-black uppercase tracking-[0.19em] text-white/42">Ваша АвтоЦена</div>
              <h1 className="mt-2 text-4xl font-black leading-[.95] tracking-[-0.045em] md:text-5xl">{budgetLabel}</h1>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
              <SummaryItem label="Марка" value={input.brand || "любая"} />
              <SummaryItem label="Модель" value={input.model || "любая"} />
              <SummaryItem label="Год" value={yearTo ? "старше 2018" : input.yearFrom ? `от ${input.yearFrom}` : "любой"} />
              <SummaryItem label="Найдено" value={String(exact.total)} />
            </div>

            <Link href="/#form" className="avto-button rounded-2xl px-5 py-4 text-center font-black">Изменить параметры</Link>
          </div>
        </div>

        <section className="mt-9">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-4xl font-black tracking-[-0.045em] md:text-6xl">Актуальные автомобили</h2>
              <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-white/55 md:text-base">
                {isAlternativeMode ? "Точного совпадения нет, поэтому сразу показываем другие реальные варианты в выбранном диапазоне." : "Показываем только реальные предложения из загруженного каталога."}
              </p>
            </div>
            <Link href="/cars" className="rounded-2xl bg-white/[0.06] px-5 py-3 text-center font-black text-white/75">Весь каталог</Link>
          </div>

          {isAlternativeMode ? (
            <div className="ac-alternative-note mt-5 rounded-2xl bg-amber-300/[0.07] p-4 text-sm font-bold leading-6 text-amber-100">
              Мы ослабили марку, модель и год, но сохранили выбранный бюджетный диапазон{input.market && input.market !== "any" ? " и страну" : ""}.
            </div>
          ) : null}

          {shownItems.length ? (
            <div className="ac-results-grid mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {shownItems.map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact />)}
            </div>
          ) : (
            <div className="mt-7 rounded-[2rem] bg-white/[0.045] p-8 text-center md:p-12">
              <h3 className="text-3xl font-black">Сейчас подходящих вариантов нет</h3>
              <p className="mx-auto mt-3 max-w-2xl text-white/55">Каталог обновляется. Откройте все автомобили или оставьте более широкий запрос.</p>
              <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                <Link href="/cars" className="avto-button rounded-2xl px-6 py-4 font-black">Открыть весь каталог</Link>
                <Link href="/#form" className="rounded-2xl bg-white/[0.07] px-6 py-4 font-black">Новый подбор</Link>
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
