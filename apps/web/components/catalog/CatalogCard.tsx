import Link from "next/link";
import { money } from "@/lib/avtocena";
import { presentCatalogOffer } from "@/lib/catalog/presentation";
import { FavoriteToggle } from "@/components/catalog/FavoriteToggle";

export function CatalogCard({ offer, compact = false }: { offer: any; compact?: boolean }) {
  const o = presentCatalogOffer(offer);
  const href = `/cars/offer/${o.id}`;
  const imageUrl = o.images[0] || "";

  return (
    <article className="ac-catalog-card group relative min-w-0 overflow-hidden rounded-[1.55rem] bg-white/[0.045] shadow-[0_18px_70px_rgba(0,0,0,.22)] transition hover:-translate-y-1 hover:bg-white/[0.06]">
      <Link href={href} className="block">
        <div className={`relative overflow-hidden bg-white/[0.04] ${compact ? "h-48" : "h-56"}`}>
          {imageUrl ? (
            <img src={imageUrl} alt={o.title} className="h-full w-full object-cover object-[center_42%] transition duration-500 group-hover:scale-[1.025]" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm font-black text-white/35">Фото загружается</div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/90 via-black/42 to-transparent" />
          <div className="absolute left-3 top-3 rounded-full bg-black/42 px-3 py-1 text-[11px] font-black uppercase tracking-[0.11em] text-white/90 backdrop-blur">
            {o.marketLabel}
          </div>
          <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="line-clamp-2 text-[19px] font-black leading-[1.1] tracking-[-0.03em] text-white drop-shadow-[0_2px_15px_rgba(0,0,0,.7)]">
                {o.title}
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-black/48 px-3 py-1 text-xs font-black text-white/88 backdrop-blur">{o.year}</span>
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-red-300/75">Ориентир</div>
              <div className="mt-1 text-[25px] font-black tracking-[-0.045em] text-red-300">
                {o.totalRub ? `${money(o.totalRub)} ₽` : "Цена уточняется"}
              </div>
            </div>
            <span className="rounded-xl bg-white/[0.065] px-3 py-2 text-xs font-black text-white/72">Подробнее</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-white/58">
            <span className="rounded-full bg-white/[0.05] px-3 py-1.5">{o.mileageKm ? `${money(o.mileageKm)} км` : "Пробег уточняется"}</span>
            <span className="rounded-full bg-white/[0.05] px-3 py-1.5">{o.engineCc ? `${o.engineCc} см³` : o.fuelLabel}</span>
            {o.powerHp ? <span className="rounded-full bg-white/[0.05] px-3 py-1.5">{o.powerHp} л.с.</span> : null}
          </div>

          <p className="mt-3 rounded-2xl bg-white/[0.035] p-3 text-xs font-bold leading-5 text-white/48">
            Наличие и итоговую стоимость под ключ подтвердит менеджер.
          </p>
        </div>
      </Link>

      <FavoriteToggle
        offerId={o.id}
        compact
        className="absolute right-3 top-3 z-20"
        snapshot={{
          id: o.id,
          title: o.title,
          price: o.totalRub,
          imageUrl,
          year: o.year,
          mileageKm: o.mileageKm,
          marketLabel: o.marketLabel,
          href,
        }}
      />
    </article>
  );
}
