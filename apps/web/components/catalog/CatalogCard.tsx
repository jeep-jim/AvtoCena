import Link from "next/link";
import { presentCatalogOffer } from "@/lib/catalog/presentation";
import { normalizeVehicleOfferSpecs } from "@/lib/catalog/spec-normalization";
import { FavoriteToggle } from "@/components/catalog/FavoriteToggle";
import { PriceTrend } from "@/components/catalog/PriceTrend";

function MileageIcon({ dense = false }: { dense?: boolean }) {
  return <svg className={dense ? "h-3 w-3 sm:h-3.5 sm:w-3.5" : "h-3.5 w-3.5"} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 17a7 7 0 1 1 14 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /><path d="M12 17l3.4-4.1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /><path d="M6.5 17h11" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>;
}

function EngineIcon({ dense = false, fuel = false }: { dense?: boolean; fuel?: boolean }) {
  if (fuel) return <svg className={dense ? "h-3 w-3 sm:h-3.5 sm:w-3.5" : "h-3.5 w-3.5"} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 3h8v18H6V3Zm8 4h2.2L19 10v7.2a1.8 1.8 0 0 0 3.6 0V9.5L20 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M8.5 6h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  return <svg className={dense ? "h-3 w-3 sm:h-3.5 sm:w-3.5" : "h-3.5 w-3.5"} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 8h12l2 3v6H5V8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M2 11h3M19 12h3M8 5v3M15 5v3M8 17v2M16 17v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

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
  const tagClass = dense ? "flex items-center gap-1 rounded-full bg-white/[0.05] px-1.5 py-1 sm:gap-1.5 sm:px-2.5 sm:py-1.5" : "flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2.5 py-1.5";
  const yearLabel = o.year ? `${o.year} г.` : "Год уточняется";

  return (
    <article className="ac-catalog-card group relative min-w-0 overflow-visible rounded-[1.35rem] bg-white/[0.045] transition-colors hover:bg-white/[0.06]">
      <Link href={href} className="block overflow-hidden rounded-[1.35rem]">
        <div className={`relative overflow-hidden bg-white/[0.04] ${mediaHeight}`}>
          {imageUrl ? <img src={imageUrl} alt={o.title} className="h-full w-full object-cover object-[center_42%]" loading="lazy" decoding="async" fetchPriority="low" /> : <div className="flex h-full items-center justify-center text-xs font-black text-white/35 sm:text-sm">Фото загружается</div>}
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/90 via-black/42 to-transparent sm:h-24" />
          <div className={`ac-on-image absolute font-black uppercase tracking-[0.12em] text-white/90 ${dense ? "left-2 top-2 text-[8px] sm:left-3 sm:top-3 sm:text-[10px]" : "left-3 top-3 text-[10px]"}`}>{o.marketLabel}</div>
          <div className={`ac-on-image absolute bottom-2 left-2 right-2 text-white sm:bottom-3 sm:left-3 sm:right-3`}>
            <div className={`line-clamp-2 min-w-0 font-black leading-[1.04] tracking-[-0.03em] text-white drop-shadow-[0_2px_15px_rgba(0,0,0,.7)] ${dense ? "text-[12px] sm:text-[17px] sm:leading-[1.08]" : "text-[16px] leading-[1.08]"}`}>{o.title}</div>
          </div>
        </div>
        <div className={dense ? "p-2.5 sm:p-3.5" : "p-3.5"}>
          <PriceTrend offer={o} label={yearLabel} dense={dense} priceClassName={dense ? "text-[15px] sm:text-[20px] md:text-[22px]" : "text-[20px] sm:text-[22px]"} />
          <div className={`flex flex-wrap font-bold text-white/58 ${dense ? "mt-2 gap-1 text-[8px] sm:mt-3 sm:gap-2 sm:text-[11px]" : "mt-3 gap-2 text-[11px]"}`}>
            <span className={tagClass}><MileageIcon dense={dense} /><span>{o.mileageKm ? `${new Intl.NumberFormat("ru-RU").format(o.mileageKm)} км` : "Пробег уточняется"}</span></span>
            <span className={tagClass}><EngineIcon dense={dense} fuel={!o.engineCc} /><span>{o.engineCc ? `${o.engineCc} см³` : o.fuelLabel}</span></span>
          </div>
        </div>
      </Link>
      <FavoriteToggle offerId={o.id} compact snapshot={snapshot} className={`ac-on-image absolute z-20 bg-black/52 text-red-400 backdrop-blur-md hover:bg-black/68 ${dense ? "right-2 top-2 h-8 w-8 sm:right-3 sm:top-3 sm:h-10 sm:w-10 [&>svg]:h-5 [&>svg]:w-5 sm:[&>svg]:h-[22px] sm:[&>svg]:w-[22px]" : "right-3 top-3"}`} />
    </article>
  );
}
