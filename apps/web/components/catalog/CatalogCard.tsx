import { presentCatalogOffer } from "@/lib/catalog/presentation";
import { rankedCatalogImageUrls } from "@/lib/catalog/image-quality";
import { normalizeVehicleOfferSpecs } from "@/lib/catalog/spec-normalization";
import { catalogMarketLabel } from "@/lib/catalog/runtime-config";
import { catalogPowerDisplay } from "@/lib/catalog/power-display";
import { catalogOfferVisibleRub } from "@/lib/catalog/public-priority";
import { FavoriteToggle } from "@/components/catalog/FavoriteToggle";
import { CatalogPrice } from "@/components/catalog/CatalogPrice";
import { CatalogMarketFlag } from "@/components/catalog/CatalogMarketFlag";
import { IntentPrefetchLink } from "@/components/catalog/IntentPrefetchLink";

function MileageIcon({ dense = false }: { dense?: boolean }) {
  return <svg className={dense ? "h-3 w-3 sm:h-3.5 sm:w-3.5" : "h-3.5 w-3.5"} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 17a7 7 0 1 1 14 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /><path d="M12 17l3.4-4.1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /><path d="M6.5 17h11" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>;
}

function EngineIcon({ dense = false, fuel = false, electric = false }: { dense?: boolean; fuel?: boolean; electric?: boolean }) {
  const className = dense ? "h-3 w-3 sm:h-3.5 sm:w-3.5" : "h-3.5 w-3.5";
  if (electric) return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="6" width="14" height="12" rx="3" stroke="currentColor" strokeWidth="1.8" /><path d="M18 10h2v4h-2M8 10h6M8 14h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="m12.5 8.5-3 4h2l-.5 3 3.5-4.5h-2z" fill="currentColor" /></svg>;
  if (fuel) return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 3h8v18H6V3Zm8 4h2.2L19 10v7.2a1.8 1.8 0 0 0 3.6 0V9.5L20 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M8.5 6h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 8h12l2 3v6H5V8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M2 11h3M19 12h3M8 5v3M15 5v3M8 17v2M16 17v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function PowerIcon({ dense = false }: { dense?: boolean }) {
  return <svg className={dense ? "h-3 w-3 sm:h-3.5 sm:w-3.5" : "h-3.5 w-3.5"} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13.5 2.8 5.8 13h5.1l-.7 8.2L18.3 11h-5.1z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>;
}

function ThirtyMinuteIcon({ dense = false }: { dense?: boolean }) {
  return <svg className={dense ? "h-3 w-3 sm:h-3.5 sm:w-3.5" : "h-3.5 w-3.5"} viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="6" width="12" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.8" /><path d="M15.5 10h2v4h-2M7.5 9.5h4M7.5 14.5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="18" cy="18" r="4" fill="var(--ac-surface, #11141c)" stroke="currentColor" strokeWidth="1.7" /><path d="M18 15.8V18l1.4 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function CatalogCard({ offer, compact = false, dense = false, eagerPrefetch = false }: { offer: any; compact?: boolean; dense?: boolean; eagerPrefetch?: boolean }) {
  const normalizedOffer = normalizeVehicleOfferSpecs(offer);
  const projectedCover = String((offer as any)?.cardImageUrl || "").trim();
  const rankedImages = projectedCover ? [projectedCover] : rankedCatalogImageUrls(normalizedOffer);
  const presented = presentCatalogOffer(normalizedOffer);
  const o = { ...presented, marketLabel: catalogMarketLabel(normalizedOffer.market), images: rankedImages };
  const powerDisplay = catalogPowerDisplay(normalizedOffer);
  const powertrainKind = String(normalizedOffer.powertrainKind || "").toLowerCase();
  const fuelKind = String(normalizedOffer.fuel || o.fuelLabel || "").toLowerCase();
  const isElectric = powertrainKind === "electric" || ["electric", "электро", "электромобиль", "bev"].includes(fuelKind);
  const isElectrified = isElectric || ["series_hybrid", "other_hybrid"].includes(powertrainKind) || /hybrid|гибрид|phev|hev/.test(fuelKind);
  const href = `/cars/offer/${o.id}`;
  const imageUrl = o.images[0] || "";

  /* Never render raw totalRub directly. It becomes public only after the full
     calculation and public sanity limits pass in catalogOfferVisibleRub(). */
  const visibleRub = catalogOfferVisibleRub(normalizedOffer);
  const displayOffer = {
    ...o,
    totalRub: visibleRub || null,
    previousTotalRub: visibleRub ? o.previousTotalRub : null,
    priceDeltaRub: visibleRub ? o.priceDeltaRub : null,
  };
  const snapshot = {
    id: o.id, title: o.title, price: visibleRub || null, totalRub: visibleRub || null, previousTotalRub: displayOffer.previousTotalRub,
    priceDeltaRub: displayOffer.priceDeltaRub, priceChangedAt: o.priceChangedAt, sourcePrice: o.sourcePrice,
    sourceCurrency: o.sourceCurrency, calculationSnapshot: o.calculationSnapshot, imageUrl, year: o.year,
    mileageKm: o.mileageKm, market: normalizedOffer.market, marketLabel: o.marketLabel, auctionDate: o.auctionDate, href,
  };
  const mediaHeight = dense ? "h-24 sm:h-40 md:h-44" : compact ? "h-36 sm:h-44" : "h-44 sm:h-52";
  const tagClass = dense ? "flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white/[0.05] px-1.5 py-1 sm:gap-1.5 sm:px-2.5 sm:py-1.5" : "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-white/[0.05] px-2.5 py-1.5";
  const priceLabel = o.year ? `${o.year} г.` : "Год уточняется";
  const engineLabel = o.engineCc ? `${o.engineCc} см³` : isElectric ? "Электромотор" : o.fuelLabel;

  return (
    <article className="ac-catalog-card group relative min-w-0 overflow-visible rounded-[1.35rem] bg-white/[0.045] transition-colors hover:bg-white/[0.06]">
      <IntentPrefetchLink href={href} eager={eagerPrefetch} className="block overflow-hidden rounded-[1.35rem]">
        <div className={`relative overflow-hidden bg-white/[0.04] ${mediaHeight}`}>
          {imageUrl ? <img src={imageUrl} alt={o.title} className="h-full w-full object-cover object-[center_42%]" loading="lazy" decoding="async" fetchPriority="low" /> : <div className="flex h-full items-center justify-center text-xs font-black text-white/35 sm:text-sm">Фото загружается</div>}
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/90 via-black/42 to-transparent sm:h-24" />
          <div className={`ac-on-image absolute font-black uppercase tracking-[0.12em] text-white/90 ${dense ? "left-2 top-2 text-[8px] sm:left-3 sm:top-3 sm:text-[10px]" : "left-3 top-3 text-[10px]"}`}><span className="md:hidden">{o.marketLabel}</span><span className="hidden items-center gap-2 md:inline-flex"><CatalogMarketFlag market={normalizedOffer.market} className="h-4 w-6" /><span>{o.marketLabel}</span></span></div>
          <div className="ac-on-image absolute bottom-2 left-2 right-2 text-white sm:bottom-3 sm:left-3 sm:right-3">
            <div className={`line-clamp-2 min-w-0 font-black leading-[1.04] tracking-[-0.03em] text-white drop-shadow-[0_2px_15px_rgba(0,0,0,.7)] ${dense ? "text-[12px] sm:text-[17px] sm:leading-[1.08]" : "text-[16px] leading-[1.08]"}`}>{o.title}</div>
          </div>
        </div>
        <div className={dense ? "p-2.5 sm:p-3.5" : "p-3.5"}>
          <CatalogPrice offer={displayOffer} label={priceLabel} dense={dense} priceClassName={dense ? "text-[15px] sm:text-[20px] md:text-[22px]" : "text-[20px] sm:text-[22px]"} />
          <div className={`flex flex-nowrap overflow-x-auto whitespace-nowrap font-bold text-white/58 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${dense ? "mt-2 gap-1 text-[8px] sm:mt-3 sm:gap-2 sm:text-[11px]" : "mt-3 gap-2 text-[11px]"}`}>
            {o.mileageKm ? <span className={tagClass}><MileageIcon dense={dense} /><span>{new Intl.NumberFormat("ru-RU").format(o.mileageKm)} км</span></span> : null}
            <span className={tagClass}><EngineIcon dense={dense} fuel={!o.engineCc && !isElectric} electric={isElectric} /><span>{engineLabel}</span></span>
            {o.powerHp
              ? <span className={tagClass}><PowerIcon dense={dense} /><span>{o.powerHp} л.с.</span></span>
              : !isElectrified ? <span className={tagClass}><PowerIcon dense={dense} /><span>Мощность уточняется</span></span> : null}
            {powerDisplay ? <span className={tagClass} title={powerDisplay.sourceLabel}><ThirtyMinuteIcon dense={dense} /><span>{powerDisplay.thirtyMinuteLabel}</span></span> : null}
            {powerDisplay?.utilizationLabel ? <span className={tagClass} title="Мощность, по которой рассчитывается утилизационный сбор"><ThirtyMinuteIcon dense={dense} /><span>{powerDisplay.utilizationLabel}</span></span> : null}
          </div>
        </div>
      </IntentPrefetchLink>
      <FavoriteToggle offerId={o.id} compact snapshot={snapshot} className={`ac-on-image absolute z-20 bg-black/52 text-red-400 backdrop-blur-md hover:bg-black/68 ${dense ? "right-2 top-2 h-8 w-8 sm:right-3 sm:top-3 sm:h-10 sm:w-10 [&>svg]:h-5 [&>svg]:w-5 sm:[&>svg]:h-[22px] sm:[&>svg]:w-[22px]" : "right-3 top-3"}`} />
    </article>
  );
}
