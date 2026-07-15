import Link from "next/link";
import { getOffer, publicOffer, searchOffers } from "@/lib/catalog/storage";
import { money } from "@/lib/avtocena";
import { OfferLeadForm } from "@/components/catalog/OfferLeadForm";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { FavoriteToggle } from "@/components/catalog/FavoriteToggle";
import { VehicleGallery } from "@/components/catalog/VehicleGallery";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { PriceTrend } from "@/components/catalog/PriceTrend";
import { presentCatalogOffer } from "@/lib/catalog/presentation";

function SpecTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="ac-offer-spec-tile min-w-0 rounded-2xl px-3.5 py-3">
      <div className="ac-offer-spec-label text-[9px] font-black uppercase tracking-[0.15em]">{label}</div>
      <div className="ac-offer-spec-value mt-1 min-w-0 break-words text-[13px] font-black leading-tight md:text-sm">{value}</div>
    </div>
  );
}

type BreakdownLine = { id?: string; title: string; amountRub: number };

function priceBreakdown(offer: any): BreakdownLine[] {
  const actual = Array.isArray(offer?.calculationSnapshot?.breakdown)
    ? offer.calculationSnapshot.breakdown
        .map((line: any) => ({ id: String(line?.id || line?.title || ""), title: String(line?.title || "Расход"), amountRub: Number(line?.amountRub || 0) }))
        .filter((line: BreakdownLine) => line.amountRub !== 0)
    : [];
  if (actual.length) return actual;

  const total = Number(offer?.totalRub || 0);
  if (!total) return [];
  const car = Math.round((total * 0.58) / 10_000) * 10_000;
  const logistics = Math.round((total * 0.09) / 10_000) * 10_000;
  const customs = Math.round((total * 0.22) / 10_000) * 10_000;
  const broker = Math.round((total * 0.05) / 10_000) * 10_000;
  const commission = Math.max(90_000, total - car - logistics - customs - broker);
  return [
    { id: "car", title: "Стоимость авто", amountRub: car },
    { id: "logistics", title: "Логистика", amountRub: logistics },
    { id: "customs", title: "Таможня и утиль", amountRub: customs },
    { id: "broker", title: "Брокер и оформление", amountRub: broker },
    { id: "commission", title: "Комиссия TopAvto", amountRub: commission },
  ];
}

function OfferPriceBreakdown({ offer }: { offer: any }) {
  const lines = priceBreakdown(offer);
  if (!lines.length) return null;

  return (
    <section className="ac-offer-breakdown min-w-0 rounded-[1.35rem] p-4">
      <h2 className="ac-offer-block-title text-lg font-black tracking-[-0.025em] md:text-xl">Структура АвтоЦены</h2>
      <div className="ac-offer-breakdown-lines mt-2 border-t border-dotted pt-2">
        {lines.map((line, index) => (
          <div key={`${line.id || line.title}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 py-1.5 text-[12px] font-medium md:text-[13px]">
            <span className="ac-offer-breakdown-label flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 truncate">{line.title}</span>
              <span className="ac-offer-dotted-line mb-1 min-w-3 flex-1 border-b border-dotted" />
            </span>
            <span className="ac-offer-breakdown-value whitespace-nowrap font-black">{money(line.amountRub)} ₽</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const offer = await getOffer(id);

  if (!offer) {
    return (
      <main className="ac-page-copy min-h-screen bg-[#07080d] text-white">
        <PublicHeader backHref="/cars" backLabel="В каталог" />
        <section className="mx-auto max-w-4xl px-4 py-20 text-center">
          <h1 className="text-4xl font-black">Предложение не найдено</h1>
          <Link href="/cars" className="avto-button mt-7 inline-block rounded-2xl px-6 py-4 font-black">Открыть каталог</Link>
        </section>
      </main>
    );
  }

  const raw: any = publicOffer(offer);
  const o = presentCatalogOffer(raw);
  const similarResult = await searchOffers({
    market: raw.market,
    make: raw.make,
    budgetTo: raw.totalRub ? Math.round(raw.totalRub * 1.25) : undefined,
    pageSize: 8,
    sort: "updatedAt",
  });
  const similar = similarResult.items.filter((item: any) => item.id !== raw.id).slice(0, 6);
  const snapshot = {
    id: o.id,
    title: o.title,
    price: o.totalRub,
    imageUrl: o.images[0],
    year: o.year,
    mileageKm: o.mileageKm,
    marketLabel: o.marketLabel,
    href: `/cars/offer/${o.id}`,
  };

  return (
    <main className="ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
      <PublicHeader backHref="/cars" backLabel="В каталог" />
      <section className="mx-auto w-full max-w-[1500px] px-4 py-7 md:px-8 md:py-10">
        <header className="mb-5 min-w-0 md:mb-7">
          <div className="text-xs font-black uppercase tracking-[0.17em] text-white/42">{o.marketLabel}</div>
          <div className="relative mt-2 min-w-0">
            <FavoriteToggle
              offerId={o.id}
              snapshot={snapshot}
              inline
              className="absolute left-0 top-0 h-10 w-10 bg-transparent text-red-500 hover:bg-transparent focus:outline-none focus-visible:outline-none md:-top-1 md:h-12 md:w-12 [&>svg]:h-8 [&>svg]:w-8 md:[&>svg]:h-10 md:[&>svg]:w-10"
            />
            <h1 className="min-w-0 break-words indent-[2.7rem] text-3xl font-black leading-[1.02] tracking-[-0.04em] md:indent-[3.35rem] md:text-5xl">{o.title}</h1>
          </div>
        </header>

        <div className="grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1.3fr)_minmax(520px,.82fr)] xl:items-start">
          <div className="min-w-0 overflow-hidden">
            <VehicleGallery images={o.images} title={o.title} />
          </div>

          <aside className="ac-offer-detail-stack min-w-0 xl:sticky xl:top-24">
            <PriceTrend offer={o} label="Ориентир стоимости" priceClassName="text-3xl md:text-4xl" className="ac-offer-price-panel" panel />

            {o.priceMode === "auction_start" ? (
              <p className="mt-4 rounded-2xl bg-amber-400/10 p-3 text-sm font-bold text-amber-200">Расчёт сделан от стартовой цены. Финальная стоимость аукциона может измениться.</p>
            ) : null}

            <div className="mt-5 grid min-w-0 gap-4 md:grid-cols-[minmax(0,1.05fr)_minmax(230px,.95fr)] xl:grid-cols-[minmax(0,1fr)_minmax(215px,.95fr)]">
              <div className="grid min-w-0 grid-cols-2 gap-2.5">
                <SpecTile label="Год" value={String(o.year)} />
                <SpecTile label="Пробег" value={o.mileageKm ? `${money(o.mileageKm)} км` : "уточняется"} />
                <SpecTile label="Двигатель" value={o.engineCc ? `${o.engineCc} см³` : "уточняется"} />
                <SpecTile label="Топливо" value={o.fuelLabel} />
                <SpecTile label="Мощность" value={o.powerHp ? `${o.powerHp} л.с.` : "уточняется"} />
                <SpecTile label="Коробка" value={o.transmissionLabel} />
                <SpecTile label="Привод" value={o.driveLabel} />
                <SpecTile label="Кузов" value={o.bodyLabel} />
              </div>
              <OfferPriceBreakdown offer={o} />
            </div>

            <div className="ac-offer-status mt-4 rounded-[1.35rem] p-4">
              <div className="ac-offer-block-title text-base font-black">Статус предложения</div>
              <p className="ac-offer-status-copy mt-2 text-xs font-medium leading-5">Обновлено {new Date(o.updatedAt).toLocaleString("ru-RU")}. Наличие и финальную стоимость под ключ подтвердит менеджер.</p>
            </div>

            <div className="ac-offer-form mt-5 rounded-[1.8rem] p-5 md:p-6 [&>form]:mt-0">
              <OfferLeadForm offerId={o.id} />
            </div>
          </aside>
        </div>

        <section className="mt-12 md:mt-16">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-white/42">Ещё варианты</div>
              <h2 className="mt-2 text-3xl font-black md:text-5xl">Похожие автомобили</h2>
            </div>
            <Link href={`/cars?market=${encodeURIComponent(raw.market)}&make=${encodeURIComponent(raw.make)}`} className="font-black">Смотреть все →</Link>
          </div>
          {similar.length ? (
            <div className="ac-result-rail ac-hide-scrollbar mt-6">{similar.map((item: any) => <CatalogCard key={item.id} offer={item} compact />)}</div>
          ) : (
            <div className="mt-6 rounded-[1.7rem] bg-white/[0.04] p-6 text-white/55">Похожие варианты сейчас обновляются.</div>
          )}
        </section>
      </section>
    </main>
  );
}
