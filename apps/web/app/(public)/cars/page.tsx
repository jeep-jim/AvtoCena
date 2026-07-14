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
        className="ac-native-select soft-input h-13 w-full rounded-2xl px-4 text-sm font-bold text-white outline-none md:h-14"
      >
        {children}
      </select>
    </label>
  );
}

const marketOrder = [
  { id: "korea", label: "Корея" },
  { id: "china", label: "Китай" },
  { id: "japan", label: "Япония" },
  { id: "uae", label: "ОАЭ" },
  { id: "europe", label: "Европа" },
];

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
    pageSize: 36,
  });

  const buildPageHref = (nextPage: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const text = first(value);
      if (text && key !== "page") query.set(key, text);
    }
    query.set("page", String(nextPage));
    return `/cars?${query.toString()}`;
  };

  const groupedMarkets = marketOrder
    .map((market) => ({
      ...market,
      items: result.items.filter((offer: any) => offer.market === market.id),
    }))
    .filter((market) => market.items.length > 0);

  const knownMarkets = new Set(marketOrder.map((market) => market.id));
  const otherItems = result.items.filter((offer: any) => !knownMarkets.has(offer.market));
  if (otherItems.length) groupedMarkets.push({ id: "other", label: "Другие рынки", items: otherItems });

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const hasPagination = totalPages > 1;

  return (
    <main className="ac-page-copy min-h-screen bg-[#07080d] text-white">
      <PublicHeader backHref="/" backLabel="На главную" />

      <section className="mx-auto w-full max-w-[1500px] px-4 py-7 md:px-8 md:py-10">
        <div className="max-w-4xl">
          <h1 className="text-4xl font-black leading-[.98] tracking-[-0.04em] md:text-6xl">Каталог автомобилей</h1>
          <p className="mt-3 text-sm font-bold leading-6 text-white/52 md:text-base">
            Найдено предложений: {result.total}. Автомобили собраны по рынкам — на телефоне листайте карточки вправо.
          </p>
        </div>

        <form className="ac-filter-panel mt-6 rounded-[1.7rem] p-3 md:p-4">
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
            <input name="budget" defaultValue={first(params.budget)} inputMode="numeric" placeholder="Бюджет ₽" className="ac-filter-input soft-input h-13 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none md:h-14" />

            <SelectField name="market" defaultValue={first(params.market)} ariaLabel="Рынок">
              <option value="">Все рынки</option>
              <option value="korea">Корея</option>
              <option value="china">Китай</option>
              <option value="japan">Япония</option>
              <option value="uae">ОАЭ</option>
              <option value="europe">Европа</option>
            </SelectField>

            <input name="make" defaultValue={first(params.make) || first(params.brand)} placeholder="Марка" className="ac-filter-input soft-input h-13 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none md:h-14" />
            <input name="model" defaultValue={first(params.model)} placeholder="Модель" className="ac-filter-input soft-input h-13 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none md:h-14" />

            <button className="avto-button col-span-2 h-13 rounded-2xl px-7 text-base font-black md:h-14 lg:col-span-1">Показать</button>
          </div>

          <details className="ac-filter-more mt-3 rounded-2xl bg-black/12 px-3 py-2.5">
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-1 text-sm font-black text-white/62">
              <span>Дополнительные фильтры</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.045] text-red-300" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 6L8 11L13 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
            </summary>

            <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-6">
              <input name="yearFrom" defaultValue={first(params.yearFrom)} inputMode="numeric" placeholder="Год от" className="ac-filter-input soft-input h-13 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none" />

              <SelectField name="hasPrice" defaultValue={first(params.hasPrice)} ariaLabel="Наличие цены">
                <option value="">С ценой и без</option>
                <option value="yes">Только с ценой</option>
                <option value="no">Цена уточняется</option>
              </SelectField>

              <SelectField name="bodyType" defaultValue={first(params.bodyType)} ariaLabel="Кузов">
                <option value="">Любой кузов</option>
                <option value="suv">Кроссовер</option>
                <option value="offroad">Внедорожник</option>
                <option value="sedan">Седан</option>
                <option value="hatchback">Хэтчбек</option>
                <option value="wagon">Универсал</option>
                <option value="minivan">Минивэн</option>
                <option value="coupe">Купе</option>
                <option value="pickup">Пикап</option>
              </SelectField>

              <input name="mileageTo" defaultValue={first(params.mileageTo)} inputMode="numeric" placeholder="Пробег до" className="ac-filter-input soft-input h-13 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none" />
              <input name="engineFrom" defaultValue={first(params.engineFrom)} inputMode="numeric" placeholder="Двигатель от" className="ac-filter-input soft-input h-13 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none" />
              <input name="powerFrom" defaultValue={first(params.powerFrom)} inputMode="numeric" placeholder="Мощность от" className="ac-filter-input soft-input h-13 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none" />
              <input name="fuel" defaultValue={first(params.fuel)} placeholder="Топливо" className="ac-filter-input soft-input h-13 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none" />
              <input name="drive" defaultValue={first(params.drive)} placeholder="Привод" className="ac-filter-input soft-input h-13 min-w-0 rounded-2xl bg-[#181a21] px-4 text-sm font-bold text-white outline-none" />
            </div>
          </details>
        </form>

        {groupedMarkets.length ? (
          <div className="mt-8 grid gap-10 md:mt-10 md:gap-12">
            {groupedMarkets.map((market) => (
              <section key={market.id} className="min-w-0">
                <div className="mb-4 flex items-end justify-between gap-4">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-red-300/75">Рынок поставки</div>
                    <h2 className="mt-1 text-3xl font-black tracking-[-0.04em] md:text-4xl">{market.label}</h2>
                  </div>
                  {market.id !== "other" ? (
                    <Link href={`/cars?market=${market.id}`} className="flex items-center gap-2 rounded-xl bg-white/[0.045] px-3 py-2 text-sm font-black text-white/62 transition hover:bg-white/[0.08] hover:text-white">
                      Все <span className="text-red-300" aria-hidden="true">→</span>
                    </Link>
                  ) : null}
                </div>

                <div className="ac-market-rail ac-hide-scrollbar">
                  {market.items.map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact />)}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="mt-8 rounded-[2rem] bg-white/[0.045] p-8 text-center">
            <h2 className="text-2xl font-black">Свежие автомобили пока загружаются</h2>
            <p className="mt-2 text-white/55">Попробуйте изменить фильтры или вернуться немного позже.</p>
          </div>
        )}

        {hasPagination ? (
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
