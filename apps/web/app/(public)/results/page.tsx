import { LeadForm } from "@/components/results/LeadForm";
import { getAvtocenaResults, getSearchInputFromParams, money } from "@/lib/avtocena";

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ResultsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const input = getSearchInputFromParams(params);
  const results = getAvtocenaResults(input);
  const budget = input.budgetRub;
  const partnerRef = firstParam(params.ref);

  return (
    <main className="min-h-screen px-4 py-5 pb-24 md:px-8 md:py-6">
      <div className="mx-auto max-w-7xl">
        <header className="flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-base font-black text-black">AC</div>
            <div>
              <div className="font-black">АвтоЦена</div>
              <div className="text-xs font-bold text-white/45">назад к подбору</div>
            </div>
          </a>
          <a href="/" className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white/70">Новый расчёт</a>
        </header>

        <section className="mt-6 grid gap-5 lg:grid-cols-[380px_1fr]">
          <aside className="glass h-fit rounded-[1.7rem] p-5 md:rounded-[2rem] md:p-6">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-red-300 md:text-sm">Ваша АвтоЦена</div>
            <h1 className="mt-3 text-3xl font-black leading-none tracking-[-0.04em] md:text-4xl">
              {budget ? `до ${money(budget)} ₽` : "под ваш запрос"}
            </h1>
            <p className="mt-4 text-sm font-medium leading-6 text-white/58">
              Первая выдача на базе JSON-знаний TopAvto. Дальше добавим точные фильтры по мощности, пробегу, приводу, топливу и стране поставки.
            </p>

            <div className="mt-5 grid gap-2 text-sm font-bold">
              <div className="rounded-2xl bg-white/7 p-4">
                Марка: <span className="text-white/55">{input.brand || "любая"}</span>
              </div>
              <div className="rounded-2xl bg-white/7 p-4">
                Модель: <span className="text-white/55">{input.model || "любая"}</span>
              </div>
              <div className="rounded-2xl bg-white/7 p-4">
                Год от: <span className="text-white/55">{input.yearFrom || "не указан"}</span>
              </div>
              <div className="rounded-2xl bg-white/7 p-4">
                Найдено: <span className="text-white/55">{results.length}</span>
              </div>
            </div>

            <a href="/#form" className="avto-button mt-5 block rounded-2xl px-5 py-4 text-center font-black">
              Уточнить АвтоЦену
            </a>
          </aside>

          <section>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black tracking-[-0.04em] md:text-3xl">Лучшие варианты</h2>
                <p className="mt-1 text-sm font-bold text-white/48">Сначала показываем варианты в бюджете и близко к бюджету.</p>
              </div>
              <div className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm font-black text-white/65">MVP выдача</div>
            </div>

            <div className="grid gap-5">
              {results.map((car, index) => (
                <article key={car.id} className="glass rounded-[1.7rem] p-4 md:rounded-[2rem] md:p-6">
                  <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-red-500 px-3 py-1 text-xs font-black">#{index + 1}</span>
                        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/70">{car.marketName}</span>
                        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/70">{car.deliveryDays} дней</span>
                        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/70">{car.bodyName}</span>
                      </div>

                      <h3 className="mt-4 text-2xl font-black tracking-[-0.04em] md:text-4xl">{car.title}</h3>
                      <p className="mt-2 text-sm font-bold text-white/55">
                        {car.year} · {car.fuel} · {car.transmission} · {car.drive} · {car.powerHp} л.с.
                        {car.mileageKm ? ` · ${money(car.mileageKm)} км` : ""}
                      </p>

                      <p className="mt-4 max-w-3xl text-sm leading-6 text-white/62 md:text-base md:leading-7">{car.recommendation}</p>

                      <div className="mt-5 grid gap-2 md:grid-cols-2">
                        {car.lines.slice(0, 6).map((line) => (
                          <div key={line.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/7 px-4 py-3 text-sm">
                            <span className="font-bold text-white/58">{line.title}</span>
                            <span className="whitespace-nowrap font-black">{money(line.amountRub)} ₽</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-[1.6rem] border border-white/12 bg-black/22 p-5">
                      <div className="text-xs font-black uppercase tracking-[0.18em] text-white/45 md:text-sm">Итого под ключ</div>
                      <div className="mt-3 text-3xl font-black tracking-[-0.05em] md:text-4xl">{money(car.totalRub)} ₽</div>

                      {typeof car.budgetDeltaRub === "number" && (
                        <div className={`mt-2 text-sm font-black ${car.isInBudget ? "text-green-300" : "text-red-200"}`}>
                          {car.isInBudget ? `Остаётся ${money(car.budgetDeltaRub)} ₽` : `Выше бюджета на ${money(Math.abs(car.budgetDeltaRub))} ₽`}
                        </div>
                      )}

                      <div className="mt-5 space-y-2">
                        {car.process.slice(0, 4).map((step) => (
                          <div key={step} className="flex gap-2 text-sm font-bold text-white/62">
                            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                            {step}
                          </div>
                        ))}
                      </div>

                      <LeadForm car={car} budgetRub={budget} partnerRef={partnerRef} />

                      <a
                        href={`/api/avtocena?case=${car.id}`}
                        className="mt-3 block rounded-2xl bg-white/8 px-5 py-3 text-center text-sm font-black text-white/55"
                      >
                        Смотреть JSON
                      </a>
                    </div>
                  </div>
                </article>
              ))}

              {!results.length && (
                <div className="glass rounded-[2rem] p-8 text-center">
                  <h2 className="text-3xl font-black">Пока нет готового варианта в JSON</h2>
                  <p className="mx-auto mt-3 max-w-xl text-white/58">
                    Это нормальное состояние для MVP. Нужно добавить новые кейсы в data/examples/avtocena-cases.json, и выдача начнёт расширяться без переписывания интерфейса.
                  </p>
                  <a href="/" className="avto-button mt-6 inline-block rounded-2xl px-6 py-4 font-black">Вернуться на главную</a>
                </div>
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
