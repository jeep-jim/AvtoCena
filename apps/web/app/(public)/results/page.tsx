import Link from "next/link";
import { LeadForm } from "@/components/results/LeadForm";
import { getSearchInputFromParams, money } from "@/lib/avtocena";
import { BrandMark } from "@/components/brand/BrandMark";
import { searchOffers } from "@/lib/catalog/storage";

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

const marketNames: Record<string, string> = {
  japan: "Япония",
  korea: "Корея",
  china: "Китай",
  uae: "ОАЭ",
  europe: "Европа",
};

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
  const live = await searchOffers({
    budgetTo: input.budgetRub,
    market: input.market,
    make: input.brand,
    model: input.model,
    yearFrom: input.yearFrom,
    bodyType: input.body,
    pageSize: 12,
    sort: "updatedAt",
  });
  const budget = input.budgetRub;
  const attribution = {
    partnerRef: firstParam(params.ref) || "",
    externalClickId: firstParam(params.click_id) || "",
    sub1: firstParam(params.sub1) || firstParam(params.subid) || "",
    sub2: firstParam(params.sub2) || "",
    sub3: firstParam(params.sub3) || "",
    sub4: firstParam(params.sub4) || "",
    sub5: firstParam(params.sub5) || "",
    utmSource: firstParam(params.utm_source) || "",
    utmMedium: firstParam(params.utm_medium) || "",
    utmCampaign: firstParam(params.utm_campaign) || "",
    utmContent: firstParam(params.utm_content) || "",
    utmTerm: firstParam(params.utm_term) || "",
  };

  const searchRequest = {
    budgetRub: input.budgetRub,
    brand: input.brand,
    model: input.model,
    yearFrom: input.yearFrom,
    market: input.market,
    body: input.body,
  };

  return (
    <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden px-4 py-5 pb-24 md:px-8 md:py-6">
      <div className="mx-auto w-full max-w-[1500px]">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5">
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
          </Link>
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
                <SummaryItem label="Найдено" value={String(live.total)} />
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
                Актуальные автомобили
              </h2>
              <p className="mt-1 max-w-2xl text-sm font-bold text-white/52 md:text-base">
                Здесь показываются только реальные предложения из загруженного каталога. Выдуманных автомобилей и расчётных карточек нет.
              </p>
            </div>

            <div className="grid min-w-0 gap-5">
              {live.items.map((offer: any, index: number) => {
                const title = [offer.make, offer.model, offer.trim]
                  .filter(Boolean)
                  .join(" ");
                const marketName = marketNames[offer.market] || offer.market || "Рынок уточняется";
                const bodyName = offer.bodyType || "Автомобиль";
                const car: any = {
                  id: offer.id,
                  title,
                  brand: offer.make,
                  model: offer.model,
                  market: offer.market,
                  marketName,
                  bodyName,
                  year: offer.year,
                  mileageKm: offer.mileageKm,
                  fuel: offer.fuel || "топливо уточняется",
                  powerHp: offer.powerHp || 0,
                  deliveryDays: 30,
                  recommendation:
                    "Актуальное предложение из каталога. Наличие и финальную стоимость подтвердит менеджер.",
                  lines: [],
                  totalRub: offer.totalRub || 0,
                  offerId: offer.id,
                  href: `/cars/offer/${offer.id}`,
                  offerSnapshot: offer,
                };

                return (
                  <article
                    key={offer.id}
                    className="w-full min-w-0 overflow-hidden rounded-[1.7rem] border border-white/10 bg-white/[0.045] md:rounded-[2rem]"
                  >
                    <div className="grid w-full min-w-0 lg:grid-cols-[minmax(300px,34%)_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)]">
                      <div className="relative min-h-[260px] overflow-hidden bg-white/5">
                        {offer.images?.[0]?.url ? (
                          <img
                            src={offer.images[0].url}
                            alt={title}
                            className="h-full min-h-[260px] w-full object-cover"
                          />
                        ) : (
                          <ResultPhoto
                            title={title}
                            marketName={marketName}
                            bodyName={bodyName}
                            year={offer.year}
                            mileageKm={offer.mileageKm}
                          />
                        )}
                      </div>

                      <div className="p-4 md:p-6 lg:p-7">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-red-500 px-3 py-1 text-xs font-black text-white">
                            #{index + 1}
                          </span>
                          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/70">
                            реальный каталог
                          </span>
                          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/70">
                            {marketName}
                          </span>
                        </div>

                        <h3 className="mt-4 text-2xl font-black text-white">{title}</h3>
                        <p className="mt-3 text-sm font-bold text-white/60">
                          {offer.year} · {offer.mileageKm?.toLocaleString("ru-RU") || "—"} км · {bodyName}
                        </p>
                        <div className="mt-5 text-3xl font-black text-red-200">
                          {offer.totalRub ? `${money(offer.totalRub)} ₽` : "Цена уточняется"}
                        </div>
                        <p className="mt-3 text-sm font-bold leading-6 text-white/52">
                          Наличие и итоговую цену под ключ подтвердит менеджер перед оформлением заявки.
                        </p>

                        <div className="mt-6 grid gap-3 sm:grid-cols-2">
                          <Link
                            href={`/cars/offer/${offer.id}`}
                            className="rounded-2xl bg-white/10 px-5 py-4 text-center font-black text-white"
                          >
                            Открыть автомобиль
                          </Link>
                          <LeadForm
                            car={car}
                            budgetRub={budget}
                            attribution={attribution}
                            searchRequest={searchRequest}
                          />
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}

              {!live.items.length && (
                <div className="glass rounded-[2rem] p-8 text-center">
                  <h2 className="text-3xl font-black">По этим параметрам реальных автомобилей пока нет</h2>
                  <p className="mx-auto mt-3 max-w-2xl text-white/58">
                    Мы не подменяем пустую выдачу выдуманными карточками. Измените фильтры, откройте общий каталог или оставьте заявку менеджеру.
                  </p>
                  <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                    <Link
                      href="/"
                      className="rounded-2xl bg-white/10 px-6 py-4 font-black text-white"
                    >
                      Изменить параметры
                    </Link>
                    <Link
                      href="/cars"
                      className="avto-button rounded-2xl px-6 py-4 font-black"
                    >
                      Открыть весь каталог
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
