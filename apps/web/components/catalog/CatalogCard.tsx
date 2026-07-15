import Link from "next/link";
import { money } from "@/lib/avtocena";
import { presentCatalogOffer } from "@/lib/catalog/presentation";
import { FavoriteToggle } from "@/components/catalog/FavoriteToggle";
import { PriceTrend } from "@/components/catalog/PriceTrend";

export function CatalogCard({ offer, compact = false }: { offer: any; compact?: boolean }) {
  const o = presentCatalogOffer(offer);
  const href = `/cars/offer/${o.id}`;
  const imageUrl = o.images[0] || "";
  const snapshot = { id: o.id, title: o.title, price: o.totalRub, imageUrl, year: o.year, mileageKm: o.mileageKm, marketLabel: o.marketLabel, href };

  return (
    <article className="ac-catalog-card group relative min-w-0 overflow-hidden rounded-[1.35rem] bg-white/[0.045] shadow-[0_18px_70px_rgba(0,0,0,.22)] transition hover:-translate-y-1 hover:bg-white/[0.06]">
      <Link href={href} className="block">
        <div className={`relative overflow-hidden bg-white/[0.04] ${compact ? "h-40 sm:h-44" : "h-52"}`}>
          {imageUrl ? <img src={imageUrl} alt={o.title} className="h-full w-full object-cover object-[center_42%] transition duration-500 group-hover:scale-[1.025]" /> : <div className="flex h-full items-center justify-center text-sm font-black text-white/35">Фото загружается</div>}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/90 via-black/42 to-transparent" />
          <div className="ac-on-image absolute left-3 top-3 text-[10px] font-black uppercase tracking-[0.12em] text-white/90">{o.marketLabel}</div>
          <div className="ac-on-image absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3 text-white">
            <div className="line-clamp-2 min-w-0 text-[17px] font-black leading-[1.08] tracking-[-0.03em] text-white drop-shadow-[0_2px_15px_rgba(0,0,0,.7)]">{o.title}</div>
            <span className="shrink-0 rounded-full bg-black/48 px-2.5 py-1 text-[11px] font-black text-white/88 backdrop-blur">{o.year}</span>
          </div>
        </div>

        <div className="p-3.5">
          <PriceTrend offer={o} priceClassName="text-[20px] sm:text-[22px]" />
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-white/58">
            <span className="rounded-full bg-white/[0.05] px-2.5 py-1.5">{o.mileageKm ? `${money(o.mileageKm)} км` : "Пробег уточняется"}</span>
            <span className="rounded-full bg-white/[0.05] px-2.5 py-1.5">{o.engineCc ? `${o.engineCc} см³` : o.fuelLabel}</span>
          </div>
          <p className="mt-3 text-[11px] font-bold leading-5 text-white/46">Наличие и итоговую стоимость под ключ подтвердит менеджер.</p>
        </div>
      </Link>
      <FavoriteToggle offerId={o.id} compact snapshot={snapshot} className="ac-on-image absolute right-3 top-3 z-20 bg-black/52 text-red-400 shadow-[0_8px_24px_rgba(0,0,0,.28)] backdrop-blur-md hover:bg-black/68" />
    </article>
  );
}
