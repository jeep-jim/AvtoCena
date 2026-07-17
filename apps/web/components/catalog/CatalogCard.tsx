import Link from "next/link";
import { presentCatalogOffer } from "@/lib/catalog/presentation";
import { normalizeVehicleOfferSpecs } from "@/lib/catalog/spec-normalization";
import { FavoriteToggle } from "@/components/catalog/FavoriteToggle";
import { PriceTrend } from "@/components/catalog/PriceTrend";

export function CatalogCard({ offer, compact = false, dense = false }: { offer: any; compact?: boolean; dense?: boolean }) {
  const o = presentCatalogOffer(normalizeVehicleOfferSpecs(offer));
  const href = `/cars/offer/${o.id}`;
  const imageUrl = o.images[0] || "";
  const snapshot = {
    id: o.id, title: o.title, price: o.totalRub, totalRub: o.totalRub, previousTotalRub: o.previousTotalRub,
    priceDeltaRub: o.priceDeltaRub, priceChangedAt: o.priceChangedAt, sourcePrice: o.sourcePrice,
    sourceCurrency: o.sourceCurrency, calculationSnapshot: o.calculationSnapshot, imageUrl, year: o.year,
    mileageKm: o.mileageKm, marketLabel: o.marketLabel, href,
  };
  const mediaHeight = dense ? "h-24 sm:h-40 md:h-44" : compact ? "h-36 sm:h-44" : "h-44 sm:h-52";

  return (
    <article className="ac-catalog-card group relative min-w-0 overflow-visible rounded-[1.35rem] bg-white/[0.045] shadow-[0_18px_70px_rgba(0,0,0,.22)] transition hover:-translate-y-1 hover:bg-white/[0.06]">
      <Link href={href} className="block rounded-[1.35rem]">
        <div className={`relative overflow-hidden rounded-t-[1.35rem] bg-white/[0.04] ${mediaHeight}`}>
          {imageUrl ? <img src={imageUrl} alt={o.title} className="h-full w-full object-cover object-[center_42%] transition duration-500 group-hover:scale-[1.025]" /> : <div className="flex h-full items-center justify-center text-xs font-black text-white/35 sm:text-sm">Фото загружается</div>}
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/90 via-black/42 to-transparent sm:h-24" />
          <div className={`ac-on-image absolute font-black uppercase tracking-[0.12em] text-white/90 ${dense ? "left-2 top-2 text-[8px] sm:left-3 sm:top-3 sm:text-[10px]" : "left-3 top-3 text-[10px]"}`}>{o.marketLabel}</div>
          <div className={`ac-on-image absolute flex items-end justify-between text-white ${dense ? "bottom-2 left-2 right-2 gap-1.5 sm:bottom-3 sm:left-3 sm:right-3 sm:gap-3" : "bottom-3 left-3 right-3 gap-3"}`}>
            <div className={`line-clamp-2 min-w-0 font-black leading-[1.04] tracking-[-0.03em] text-white drop-shadow-[0_2px_15px_rgba(0,0,0,.7)] ${dense ? "text-[12px] sm:text-[17px] sm:leading-[1.08]" : "text-[16px] leading-[1.08]"}`}>{o.title}</div>
            <span className={`shrink-0 rounded-full bg-black/48 font-black text-white/88 backdrop-blur ${dense ? "px-1.5 py-0.5 text-[8px] sm:px-2.5 sm:py-1 sm:text-[11px]" : "px-2.5 py-1 text-[11px]"}`}>{o.year}</span>
          </div>
        </div>
        <div className={`${dense ? "p-2.5 sm:p-3.5" : "p-3.5"} rounded-b-[1.35rem]`}>
          <PriceTrend offer={o} dense={dense} priceClassName={dense ? "text-[15px] sm:text-[20px] md:text-[22px]" : "text-[20px] sm:text-[22px]"} />
          <div className={`flex flex-wrap font-bold text-white/58 ${dense ? "mt-2 gap-1 text-[8px] sm:mt-3 sm:gap-2 sm:text-[11px]" : "mt-3 gap-2 text-[11px]"}`}>
            <span className={dense ? "rounded-full bg-white/[0.05] px-1.5 py-1 sm:px-2.5 sm:py-1.5" : "rounded-full bg-white/[0.05] px-2.5 py-1.5"}>{o.mileageKm ? `${new Intl.NumberFormat("ru-RU").format(o.mileageKm)} км` : "Пробег уточняется"}</span>
            <span className={dense ? "rounded-full bg-white/[0.05] px-1.5 py-1 sm:px-2.5 sm:py-1.5" : "rounded-full bg-white/[0.05] px-2.5 py-1.5"}>{o.engineCc ? `${o.engineCc} см³` : o.fuelLabel}</span>
          </div>
        </div>
      </Link>
      <FavoriteToggle offerId={o.id} compact snapshot={snapshot} className={`ac-on-image absolute z-20 bg-black/52 text-red-400 shadow-[0_8px_24px_rgba(0,0,0,.28)] backdrop-blur-md hover:bg-black/68 ${dense ? "right-2 top-2 h-8 w-8 sm:right-3 sm:top-3 sm:h-10 sm:w-10 [&>svg]:h-5 [&>svg]:w-5 sm:[&>svg]:h-[22px] sm:[&>svg]:w-[22px]" : "right-3 top-3"}`} />
    </article>
  );
}
