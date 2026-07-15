import Link from "next/link";
import { money } from "@/lib/avtocena";
import { presentCatalogOffer } from "@/lib/catalog/presentation";
import { FavoriteToggle } from "@/components/catalog/FavoriteToggle";

export function CatalogCard({ offer, compact = false }: { offer: any; compact?: boolean }) {
  const o = presentCatalogOffer(offer);
  const href = `/cars/offer/${o.id}`;
  const imageUrl = o.images[0] || "";

  return (
    <article className={`ac-catalog-card group relative min-w-0 overflow-hidden rounded-[1.35rem] bg-white/[0.045] transition hover:-translate-y-0.5 hover:bg-white/[0.06] ${compact ? "ac-catalog-card--compact" : ""}`}>
      <Link href={href} className="block h-full">
        <div className={`relative overflow-hidden bg-white/[0.04] ${compact ? "h-40 sm:h-44" : "h-56"}`}>
          {imageUrl ? (
            <img src={imageUrl} alt={o.title} className="h-full w-full object-cover object-[center_42%] transition duration-500 group-hover:scale-[1.025]" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs font-black text-white/35">Фото загружается</div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/92 via-black/46 to-transparent" />
          <div className="ac-on-image absolute left-3 top-3 rounded-full bg-black/42 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.11em] text-white/90 backdrop-blur">
            {o.marketLabel}
          </div>
          <div className="ac-on-image absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2 text-white">
            <div className="min-w-0 flex-1">
              <div className={`${compact ? "text-[15px] sm:text-[17px]" : "text-[19px]"} line-clamp-2 font-black leading-[1.06] tracking-[-0.03em] text-white drop-shadow-[0_2px_15px_rgba(0,0,0,.7)]`}>
                {o.title}
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-black/48 px-2 py-1 text-[10px] font-black text-white/88 backdrop-blur">{o.year}</span>
          </div>
        </div>

        <div className={compact ? "p-3" : "p-4"}>
          <div className="min-w-0">
            <div className="text-[9px] font-black uppercase tracking-[0.16em] text-red-300/75">Ориентир</div>
            <div className={`${compact ? "text-[20px]" : "text-[25px]"} mt-1 break-words font-black leading-none tracking-[-0.045em] text-red-300`}>
              {o.totalRub ? `${money(o.totalRub)} ₽` : "Цена уточняется"}
            </div>
          </div>

          <div className={`flex flex-wrap gap-1.5 text-[10px] font-bold text-white/58 ${compact ? "mt-2" : "mt-3 text-xs"}`}>
            <span className="rounded-full bg-white/[0.05] px-2.5 py-1.5">{o.mileageKm ? `${money(o.mileageKm)} км` : "Пробег уточняется"}</span>
            <span className="rounded-full bg-white/[0.05] px-2.5 py-1.5">{o.engineCc ? `${o.engineCc} см³` : o.fuelLabel}</span>
            {!compact && o.powerHp ? <span className="rounded-full bg-white/[0.05] px-3 py-1.5">{o.powerHp} л.с.</span> : null}
          </div>

          {!compact ? (
            <p className="mt-3 rounded-2xl bg-white/[0.035] p-3 text-xs font-bold leading-5 text-white/48">
              Наличие и итоговую стоимость под ключ подтвердит менеджер.
            </p>
          ) : null}
        </div>
      </Link>

      <FavoriteToggle
        offerId={o.id}
        compact
        className="absolute right-2.5 top-2.5 z-20"
        snapshot={{ id: o.id, title: o.title, price: o.totalRub, imageUrl, year: o.year, mileageKm: o.mileageKm, marketLabel: o.marketLabel, href }}
      />
    </article>
  );
}
