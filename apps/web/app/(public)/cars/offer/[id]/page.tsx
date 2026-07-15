import Link from "next/link";
import { getOffer, publicOffer, searchOffers } from "@/lib/catalog/storage";
import { money } from "@/lib/avtocena";
import { OfferLeadForm } from "@/components/catalog/OfferLeadForm";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { FavoriteToggle } from "@/components/catalog/FavoriteToggle";
import { VehicleGallery } from "@/components/catalog/VehicleGallery";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { presentCatalogOffer } from "@/lib/catalog/presentation";

function SpecItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="ac-spec-item min-w-0 rounded-2xl bg-white/[0.04] p-3.5">
      <div className="ac-muted-label text-[10px] font-black uppercase tracking-[0.15em] text-white/38">{label}</div>
      <div className="mt-1.5 break-words text-[15px] font-black text-white">{value}</div>
    </div>
  );
}

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const offer = await getOffer(id);

  if (!offer) {
    return (
      <main className="ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
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
  const similarResult = await searchOffers({ market: raw.market, make: raw.make, budgetTo: raw.totalRub ? Math.round(raw.totalRub * 1.25) : undefined, pageSize: 8, sort: "updatedAt" });
  const similar = similarResult.items.filter((item: any) => item.id !== raw.id).slice(0, 6);

  return (
    <main className="ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
      <PublicHeader backHref="/cars" backLabel="В каталог" />

      <section className="mx-auto w-full max-w-[1450px] overflow-x-hidden px-4 py-7 md:px-8 md:py-10">
        <header className="mb-5 max-w-6xl md:mb-7">
          <div className="ac-muted-label text-xs font-black uppercase tracking-[0.17em] text-white/42">{o.marketLabel}</div>
          <div className="mt-2 flex min-w-0 items-start gap-1.5">
            <FavoriteToggle
              offerId={o.id}
              plain
              className="mt-0.5"
              snapshot={{ id: o.id, title: o.title, price: o.totalRub, imageUrl: o.images[0], year: o.year, mileageKm: o.mileageKm, marketLabel: o.marketLabel, href: `/cars/offer/${o.id}` }}
            />
            <h1 className="min-w-0 break-words text-3xl font-black leading-[1.02] tracking-[-0.04em] md:text-5xl">{o.title}</h1>
          </div>
        </header>

        <div className="grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1.25fr)_430px] xl:items-start">
          <div className="min-w-0 max-w-full overflow-hidden">
            <VehicleGallery images={o.images} title={o.title} />
          </div>

          <aside className="ac-offer-panel min-w-0 max-w-full rounded-[1.8rem] bg-white/[0.05] p-5 md:p-7 xl:sticky xl:top-24">
            <div className="min-w-0 rounded-[1.35rem] bg-red-500/[0.075] p-4">
              <div className="ac-muted-label text-[10px] font-black uppercase tracking-[0.16em] text-white/42">Ориентир стоимости</div>
              <div className="mt-1 break-words text-3xl font-black tracking-[-0.04em] text-red-300 md:text-4xl">
                {o.totalRub ? `${money(o.totalRub)} ₽` : "Запросить точный расчёт"}
              </div>
            </div>

            {o.priceMode === "auction_start" ? (
              <p className="mt-3 rounded-2xl bg-amber-400/10 p-3 text-sm font-bold text-amber-200">Расчёт сделан от стартовой цены. Финальная стоимость аукциона может измениться.</p>
            ) : null}

            <div className="mt-5 grid min-w-0 grid-cols-2 gap-3">
              <SpecItem label="Год" value={String(o.year)} />
              <SpecItem label="Пробег" value={o.mileageKm ? `${money(o.mileageKm)} км` : "уточняется"} />
              <SpecItem label="Двигатель" value={o.engineCc ? `${o.engineCc} см³` : "уточняется"} />
              <SpecItem label="Топливо" value={o.fuelLabel} />
              <SpecItem label="Мощность" value={o.powerHp ? `${o.powerHp} л.с.` : "уточняется"} />
              <SpecItem label="Коробка" value={o.transmissionLabel} />
              <SpecItem label="Привод" value={o.driveLabel} />
              <SpecItem label="Кузов" value={o.bodyLabel} />
            </div>

            <div className="mt-5 rounded-2xl bg-white/[0.025] p-3.5">
              <div className="ac-muted-label text-[10px] font-black uppercase tracking-[0.15em] text-white/32">Статус предложения</div>
              <p className="mt-1.5 text-xs font-bold leading-5 text-white/52">Обновлено {new Date(o.updatedAt).toLocaleString("ru-RU")}. Наличие и финальную стоимость под ключ подтвердит менеджер.</p>
            </div>

            <OfferLeadForm offerId={o.id} />
          </aside>
        </div>

        <section className="mt-12 min-w-0 pt-5 md:mt-16 md:pt-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="ac-muted-label text-xs font-black uppercase tracking-[0.18em] text-white/42">Ещё варианты</div>
              <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] md:text-5xl">Похожие автомобили</h2>
              <p className="mt-2 text-white/52">Тот же рынок и близкий бюджет.</p>
            </div>
            <Link href={`/cars?market=${encodeURIComponent(raw.market)}&make=${encodeURIComponent(raw.make)}`} className="rounded-2xl bg-white/[0.055] px-5 py-3 text-center font-black text-white/72">Смотреть все</Link>
          </div>

          {similar.length ? (
            <div className="ac-market-rail ac-market-rail--similar ac-hide-scrollbar mt-6">
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
