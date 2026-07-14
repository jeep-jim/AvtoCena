import Link from "next/link";
import { getOffer, publicOffer, searchOffers } from "@/lib/catalog/storage";
import { money } from "@/lib/avtocena";
import { OfferLeadForm } from "@/components/catalog/OfferLeadForm";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { FavoriteToggle } from "@/components/catalog/FavoriteToggle";
import { VehicleGallery } from "@/components/catalog/VehicleGallery";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { presentCatalogOffer } from "@/lib/catalog/presentation";

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const offer = await getOffer(id);

  if (!offer) {
    return (
      <main className="min-h-screen bg-[#07080d] text-white">
        <PublicHeader backHref="/cars" backLabel="В каталог" />
        <section className="mx-auto max-w-4xl px-4 py-20 text-center">
          <h1 className="text-4xl font-black">Предложение не найдено</h1>
          <p className="mt-3 text-white/55">Автомобиль мог быть продан или снят с публикации.</p>
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

  return (
    <main className="min-h-screen bg-[#07080d] text-white">
      <PublicHeader backHref="/cars" backLabel="В каталог" />

      <section className="mx-auto w-full max-w-[1450px] px-4 py-7 md:px-8 md:py-10">
        <div className="grid gap-7 xl:grid-cols-[minmax(0,1.25fr)_430px] xl:items-start">
          <VehicleGallery images={o.images} title={o.title} />

          <aside className="rounded-[1.8rem] border border-white/9 bg-white/[0.05] p-5 shadow-[0_24px_90px_rgba(0,0,0,.3)] md:p-7 xl:sticky xl:top-24">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-[0.17em] text-red-300">{o.marketLabel}</div>
                <h1 className="mt-2 text-3xl font-black leading-[1.02] tracking-[-0.04em] md:text-4xl">{o.title}</h1>
              </div>
              <FavoriteToggle
                offerId={o.id}
                snapshot={{ id: o.id, title: o.title, price: o.totalRub, imageUrl: o.images[0], year: o.year, mileageKm: o.mileageKm, marketLabel: o.marketLabel, href: `/cars/offer/${o.id}` }}
              />
            </div>

            <div className="mt-5 text-3xl font-black tracking-[-0.04em] text-red-300 md:text-4xl">
              {o.totalRub ? `${money(o.totalRub)} ₽` : "Запросить точный расчёт"}
            </div>

            {o.priceMode === "auction_start" ? (
              <p className="mt-3 rounded-2xl bg-amber-400/10 p-3 text-sm font-bold text-amber-200">Расчёт сделан от стартовой цены. Финальная стоимость аукциона может измениться.</p>
            ) : null}

            <div className="mt-6 grid grid-cols-2 gap-3 text-sm font-bold">
              <div className="rounded-2xl bg-white/[0.045] p-3"><div className="text-white/38">Год</div><div className="mt-1 text-white">{o.year}</div></div>
              <div className="rounded-2xl bg-white/[0.045] p-3"><div className="text-white/38">Пробег</div><div className="mt-1 text-white">{o.mileageKm ? `${money(o.mileageKm)} км` : "уточняется"}</div></div>
              <div className="rounded-2xl bg-white/[0.045] p-3"><div className="text-white/38">Двигатель</div><div className="mt-1 text-white">{o.engineCc ? `${o.engineCc} см³` : "уточняется"}</div></div>
              <div className="rounded-2xl bg-white/[0.045] p-3"><div className="text-white/38">Топливо</div><div className="mt-1 text-white">{o.fuelLabel}</div></div>
              <div className="rounded-2xl bg-white/[0.045] p-3"><div className="text-white/38">Мощность</div><div className="mt-1 text-white">{o.powerHp ? `${o.powerHp} л.с.` : "уточняется"}</div></div>
              <div className="rounded-2xl bg-white/[0.045] p-3"><div className="text-white/38">Коробка</div><div className="mt-1 text-white">{o.transmissionLabel}</div></div>
              <div className="rounded-2xl bg-white/[0.045] p-3"><div className="text-white/38">Привод</div><div className="mt-1 text-white">{o.driveLabel}</div></div>
              <div className="rounded-2xl bg-white/[0.045] p-3"><div className="text-white/38">Кузов</div><div className="mt-1 text-white">{o.bodyLabel}</div></div>
            </div>

            <p className="mt-5 text-xs font-bold leading-5 text-white/42">Обновлено: {new Date(o.updatedAt).toLocaleString("ru-RU")}. Наличие и финальную стоимость под ключ подтвердит менеджер.</p>
            <OfferLeadForm offerId={o.id} />
          </aside>
        </div>

        <section className="mt-12 border-t border-white/9 pt-9 md:mt-16 md:pt-12">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-red-300">Ещё варианты</div>
              <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] md:text-5xl">Похожие автомобили</h2>
              <p className="mt-2 text-white/52">Тот же рынок и близкий бюджет.</p>
            </div>
            <Link href={`/cars?market=${encodeURIComponent(raw.market)}&make=${encodeURIComponent(raw.make)}`} className="rounded-2xl bg-white/[0.06] px-5 py-3 text-center font-black text-white/75">Смотреть все</Link>
          </div>

          {similar.length ? (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {similar.map((item: any) => <CatalogCard key={item.id} offer={item} compact />)}
            </div>
          ) : (
            <div className="mt-6 rounded-[1.7rem] bg-white/[0.04] p-6 text-white/55">Похожие варианты сейчас обновляются. Откройте общий каталог.</div>
          )}
        </section>
      </section>
    </main>
  );
}
