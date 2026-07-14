import Link from "next/link";
import { searchOffers } from "@/lib/catalog/storage";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { CatalogCard } from "@/components/catalog/CatalogCard";

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value || "";
}

function SelectField({ name, defaultValue, children, ariaLabel }: { name: string; defaultValue?: string; children: React.ReactNode; ariaLabel: string }) {
  return (
    <label className="relative min-w-0">
      <span className="sr-only">{ariaLabel}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="soft-input h-14 w-full appearance-none rounded-2xl bg-[#181a21] px-4 pr-11 text-sm font-bold text-white outline-none"
      >
        {children}
      </select>
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/55" aria-hidden="true">⌄</span>
    </label>
  );
}

export default async function CarsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) || {};
  const page = Math.max(1, Number(first(params.page)) || 1);
  const budget = Number(first(params.budget) || first(params.budgetTo)) || undefined;
  const result = await searchOffers({
    market: first(params.market),
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
    page,
    pageSize: 24,
  });

  const buildPageHref = (nextPage: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const text = first(value);
      if (text) query.set(key, text);
    }
    query.set("page", String(nextPage));
    return `/cars?${query.toString()}`;
  };

  return (
    <main className="min-h-screen bg-[#07080d] text-white">
      <PublicHeader backHref="/" backLabel="На главную" />

      <section className="mx-auto w-full max-w-[1500px] px-4 py-8 md:px-8 md:py-10">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-4xl font-black tracking-[-0.04em] md:text-6xl">Каталог автомобилей</h1>
            <p className="mt-2 text-sm font-bold text-white/55 md:text-base">
              Найдено предложений: {result.total}. Показываем только машины с сохранёнными фотографиями и расчётом.
            </p>
          </div>
          <Link href="/favorites" className="inline-flex items-center gap-2 self-start rounded-2xl bg-white/[0.055] px-4 py-3 text-sm font-black text-white/75 lg:self-auto">
            <span className="text-red-400">♥</span> Избранное
          </Link>
        </div>

        <form className="mt-7 rounded-[1.7rem] border border-white/8 bg-white/[0.045] p-3 md:p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <input name="budget" defaultValue={first(params.budget)} inputMode="numeric" placeholder="Бюджет ₽" className="soft-input h-14 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none" />

            <SelectField name="market" defaultValue={first(params.market)} ariaLabel="Рынок">
              <option value="">Все рынки</option>
              <option value="japan">Япония</option>
              <option value="korea">Корея</option>
              <option value="china">Китай</option>
              <option value="uae">ОАЭ</option>
              <option value="europe">Европа</option>
            </SelectField>

            <input name="make" defaultValue={first(params.make) || first(params.brand)} placeholder="Марка" className="soft-input h-14 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none" />
            <input name="model" defaultValue={first(params.model)} placeholder="Модель" className="soft-input h-14 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none" />
            <input name="yearFrom" defaultValue={first(params.yearFrom)} inputMode="numeric" placeholder="Год от" className="soft-input h-14 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none" />

            <SelectField name="hasPrice" defaultValue={first(params.hasPrice)} ariaLabel="Наличие цены">
              <option value="">С ценой и без</option>
              <option value="yes">Только с ценой</option>
              <option value="no">Цена уточняется</option>
            </SelectField>

            <input name="mileageTo" defaultValue={first(params.mileageTo)} inputMode="numeric" placeholder="Пробег до" className="soft-input h-14 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none" />
            <input name="engineFrom" defaultValue={first(params.engineFrom)} inputMode="numeric" placeholder="Двигатель от, см³" className="soft-input h-14 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none" />
            <input name="powerFrom" defaultValue={first(params.powerFrom)} inputMode="numeric" placeholder="Мощность от" className="soft-input h-14 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none" />
            <input name="fuel" defaultValue={first(params.fuel)} placeholder="Топливо" className="soft-input h-14 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none" />
            <input name="drive" defaultValue={first(params.drive)} placeholder="Привод" className="soft-input h-14 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none" />

            <button className="avto-button h-14 rounded-2xl px-5 text-base font-black">Показать</button>
          </div>
        </form>

        {result.items.length ? (
          <div className="mt-7 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {result.items.map((offer: any) => <CatalogCard key={offer.id} offer={offer} />)}
          </div>
        ) : (
          <div className="mt-8 rounded-[2rem] border border-white/10 bg-white/[0.045] p-8 text-center">
            <h2 className="text-2xl font-black">Свежие автомобили пока загружаются</h2>
            <p className="mt-2 text-white/55">Попробуйте изменить фильтры или вернуться немного позже.</p>
          </div>
        )}

        <div className="mt-9 flex items-center justify-center gap-3">
          {page > 1 ? <Link href={buildPageHref(page - 1)} className="rounded-2xl bg-white/[0.07] px-5 py-3 font-black">← Назад</Link> : null}
          <span className="rounded-2xl bg-white/[0.04] px-4 py-3 text-sm font-black text-white/55">Страница {page}</span>
          {page * result.pageSize < result.total ? <Link href={buildPageHref(page + 1)} className="rounded-2xl bg-white/[0.07] px-5 py-3 font-black">Дальше →</Link> : null}
        </div>
      </section>
    </main>
  );
}
