import { LeadForm } from "@/components/results/LeadForm";
import {
  getAvtocenaResults,
  getSearchInputFromParams,
  money,
} from "@/lib/avtocena";
import { BrandMark } from "@/components/brand/BrandMark";

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function safeParams(params: Record<string, string | string[] | undefined>) {
  return {
    ...params,
    yearFrom: params.yearFrom ?? params.year,
    market: params.market ?? params.country,
  };
}

function ResultPhoto({
  title,
  marketName,
  bodyName,
  year,
  mileageKm,
}: {
  title: string;
  marketName: string;
  bodyName: string;
  year: number;
  mileageKm?: number;
}) {
  return (
    <div className="relative min-h-[260px] min-w-0 overflow-hidden bg-[radial-gradient(circle_at_22%_18%,rgba(239,68,68,0.42),transparent_38%),radial-gradient(circle_at_82%_14%,rgba(255,255,255,0.12),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.14),rgba(255,255,255,0.025))] sm:min-h-[320px] lg:min-h-full">
      <div className="absolute inset-0 flex items-center justify-center opacity-[0.13]">
        <BrandMark className="h-44 w-44 md:h-56 md:w-56" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-[#11131a] via-[#11131a]/18 to-transparent" />

      <div className="absolute left-4 top-4 flex flex-wrap gap-2">
        <span className="rounded-full bg-red-500 px-3 py-1 text-xs font-black text-white">
          {marketName}
        </span>
        <span className="rounded-full border border-white/16 bg-black/30 px-3 py-1 text-xs font-black text-white/76 backdrop-blur">
          {bodyName}
        </span>
      </div>

      <div className="absolute bottom-4 left-4 right-4">
        <h3 className="max-w-[92%] text-[28px] font-black leading-[0.96] tracking-[-0.045em] text-white drop-shadow-[0_2px_20px_rgba(0,0,0,0.6)] md:text-[36px]">
          {title}
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full border border-white/12 bg-black/32 px-3 py-1 text-xs font-black text-white/82 backdrop-blur">
            {year}
          </span>
          {mileageKm ? (
            <span className="rounded-full border border-white/12 bg-black/32 px-3 py-1 text-xs font-black text-white/82 backdrop-blur">
              {money(mileageKm)} км
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ResultCostLines({
  lines,
}: {
  lines: { id: string; title: string; amountRub: number }[];
}) {
  return (
    <div className="grid w-full min-w-0 gap-2.5 text-[13px] font-bold leading-6 text-white/68 md:text-sm">
      {lines.slice(0, 6).map((line) => (
        <div
          key={line.id}
          className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-2 overflow-hidden"
        >
          <span className="shrink-0 text-red-300/80">·</span>

          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 break-words text-white/76">{line.title}</span>
            <span className="mb-[4px] hidden min-w-4 flex-1 border-b border-dotted border-white/22 sm:block" />
          </span>

          <span className="shrink-0 whitespace-nowrap text-right font-black text-white">
            {money(line.amountRub)} ₽
          </span>
        </div>
      ))}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-white/38">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-black text-white/82 md:text-base">
        {value}
      </div>
    </div>
  );
}

export default async function ResultsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const input = getSearchInputFromParams(safeParams(params));
  const results = getAvtocenaResults(input);
  const budget = input.budgetRub;
  const partnerRef = firstParam(params.ref);

  return (
    <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden px-4 py-5 pb-24 md:px-8 md:py-6">
      <div className="mx-auto w-full max-w-[1500px]">
        <header className="flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2.5">
            <BrandMark className="h-10 w-10 shrink-0" />
            <div>
              <div className="font-black leading-none">
                <span className="text-red-500">Авто</span>
                <span className="text-white">Цена</span>
              </div>
              <div className="mt-1 text-xs font-bold text-white/45">
                назад к подбору
              </div>
            </div>
          </a>
        </header>

        <section className="mt-6">
          <div className="glass rounded-[1.6rem] p-5 md:rounded-[2rem] md:p-6">
            <div className="grid min-w-0 items-center gap-6 lg:grid-cols-[minmax(230px,0.78fr)_minmax(0,1.45fr)_220px] xl:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.55fr)_240px]">
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-red-300 md:text-sm">
                  Ваша АвтоЦена
                </div>
                <h1 className="mt-2 text-3xl font-black leading-none tracking-[-0.04em] md:text-4xl">
                  {budget ? `до ${money(budget)} ₽` : "под ваш запрос"}
                </h1>
              </div>

              <div className="grid min-w-0 grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                <SummaryItem label="Марка" value={input.brand || "любая"} />
                <SummaryItem label="Модель" value={input.model || "любая"} />
                <SummaryItem
                  label="Год от"
                  value={input.yearFrom ? String(input.yearFrom) : "не указан"}
                />
                <SummaryItem label="Найдено" value={String(results.length)} />
              </div>

              <a
                href="/#form"
                className="avto-button block rounded-2xl px-5 py-4 text-center font-black"
              >
                Уточнить АвтоЦену
              </a>
            </div>
          </div>

          <section className="mt-7 min-w-0">
            <div className="mb-5">
              <h2 className="text-3xl font-black tracking-[-0.04em] md:text-4xl">
                Лучшие варианты
              </h2>
              <p className="mt-1 max-w-2xl text-sm font-bold text-white/52 md:text-base">
                Сначала показываем варианты в бюджете и близко к бюджету.
              </p>
            </div>

            <div className="grid min-w-0 gap-5">
              {results.map((car, index) => (
                <article
                  key={car.id}
                  className="w-full min-w-0 overflow-hidden rounded-[1.7rem] border border-white/10 bg-white/[0.045] shadow-[0_20px_90px_rgba(0,0,0,0.18)] md:rounded-[2rem]"
                >
                  <div className="grid w-full min-w-0 lg:grid-cols-[minmax(300px,34%)_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)] 2xl:grid-cols-[460px_minmax(0,1fr)]">
                    <ResultPhoto
                      title={car.title}
                      marketName={car.marketName}
                      bodyName={car.bodyName}
                      year={car.year}
                      mileageKm={car.mileageKm}
                    />

                    <div className="min-w-0 p-4 md:p-6 lg:p-7">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-red-500 px-3 py-1 text-xs font-black text-white">
                          #{index + 1}
                        </span>
                        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/70">
                          {car.deliveryDays} дней
                        </span>
                        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/70">
                          {car.fuel}
                        </span>
                        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/70">
                          {car.powerHp} л.с.
                        </span>
                      </div>

                      <p className="mt-4 max-w-3xl text-sm font-medium leading-6 text-white/64 md:text-base md:leading-7">
                        {car.recommendation}
                      </p>

                      <div className="mt-5 min-w-0">
                        <ResultCostLines lines={car.lines} />
                      </div>

                      <div className="mt-6 grid min-w-0 gap-4 border-t border-white/10 pt-5 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-end">
                        <div className="min-w-0">
                          <div className="text-xs font-black uppercase tracking-[0.18em] text-white/42 md:text-sm">
                            Итого ориентир
                          </div>
                          <div className="mt-2 text-3xl font-black tracking-[-0.05em] md:text-4xl">
                            {money(car.totalRub)} ₽
                          </div>

                          {typeof car.budgetDeltaRub === "number" && (
                            <div
                              className={`mt-2 text-sm font-black ${
                                car.isInBudget ? "text-green-300" : "text-red-200"
                              }`}
                            >
                              {car.isInBudget
                                ? `Остаётся ${money(car.budgetDeltaRub)} ₽`
                                : `Выше бюджета на ${money(
                                    Math.abs(car.budgetDeltaRub),
                                  )} ₽`}
                            </div>
                          )}
                        </div>

                        <div className="min-w-0">
                          <LeadForm
                            car={car}
                            budgetRub={budget}
                            partnerRef={partnerRef}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              ))}

              {!results.length && (
                <div className="glass rounded-[2rem] p-8 text-center">
                  <h2 className="text-3xl font-black">
                    Пока нет готового варианта
                  </h2>
                  <p className="mx-auto mt-3 max-w-xl text-white/58">
                    Попробуйте изменить бюджет, год, марку или страну поставки.
                  </p>
                  <a
                    href="/"
                    className="avto-button mt-6 inline-block rounded-2xl px-6 py-4 font-black"
                  >
                    Вернуться на главную
                  </a>
                </div>
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
