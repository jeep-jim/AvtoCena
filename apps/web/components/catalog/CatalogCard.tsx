import Link from "next/link";
import { presentCatalogOffer } from "@/lib/catalog/presentation";
import { rankedCatalogImageUrls } from "@/lib/catalog/image-quality";
import { normalizeVehicleOfferSpecs } from "@/lib/catalog/spec-normalization";
import { catalogMarketLabel } from "@/lib/catalog/runtime-config";
import { catalogPowerDisplay } from "@/lib/catalog/power-display";
import { FavoriteToggle } from "@/components/catalog/FavoriteToggle";
import { PriceTrend } from "@/components/catalog/PriceTrend";

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

function moneyRub(value: number) {
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(value))} ₽`;
}

function sourceMoney(value: number, currency: string) {
  const amount = new Intl.NumberFormat("ru-RU").format(Math.round(value));
  const symbols: Record<string, string> = { JPY: "¥", RUB: "₽", USD: "$", EUR: "€", GBP: "£", KRW: "₩", CNY: "¥", RMB: "¥", AED: "AED", GEL: "₾", KGS: "сом" };
  return `${amount} ${symbols[currency] || currency}`;
}

function sourcePriceRub(offer: any) {
  const sourcePrice = Number(offer?.sourcePrice || 0);
  if (!sourcePrice) return 0;
  const currency = String(offer?.sourceCurrency || "").toUpperCase();
  if (currency === "RUB") return sourcePrice;
  const rate = offer?.calculationSnapshot?.currencyRate || {};
  const explicit = Number(rate.sourcePriceRub || offer?.calculationSnapshot?.sourcePriceRub || 0);
  if (explicit > 0) return explicit;
  const effectiveRate = Number(rate.effectiveRate || 0);
  return effectiveRate > 0 ? Math.round(sourcePrice * effectiveRate) : 0;
}

function shortDate(value: string | undefined) {
  if (!value) return "";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("ru-RU");
}

export function CatalogCard({ offer, compact = false, dense = false }: { offer: any; compact?: boolean; dense?: boolean }) {
  const normalizedOffer = normalizeVehicleOfferSpecs(offer);
  const rankedImages = rankedCatalogImageUrls(normalizedOffer);
  const presented = presentCatalogOffer(normalizedOffer);
  const o = { ...presented, marketLabel: catalogMarketLabel(normalizedOffer.market), images: rankedImages };
  const powerDisplay = catalogPowerDisplay(normalizedOffer);
  const powertrainKind = String(normalizedOffer.powertrainKind || "").toLowerCase();
  const fuelKind = String(normalizedOffer.fuel || o.fuelLabel || "").toLowerCase();
  const isElectric = powertrainKind === "electric" || ["electric", "электро", "электромобиль", "bev"].includes(fuelKind);
  const isAuctionResult = o.catalogKind === "auction_result" || (o.offerType === "auction" && o.auctionResult === "sold");
  const href = `/cars/offer/${o.id}`;
  const imageUrl = o.images[0] || "";
  const convertedSourceRub = sourcePriceRub(o);
  const exactTotalRub = Number(o.totalRub || 0);
  const visibleRub = exactTotalRub || convertedSourceRub;
  const snapshot = {
    id: o.id, title: o.title, price: visibleRub || null, totalRub: visibleRub || null, previousTotalRub: o.previousTotalRub,
    priceDeltaRub: o.priceDeltaRub, priceChangedAt: o.priceChangedAt, sourcePrice: o.sourcePrice,
    sourceCurrency: o.sourceCurrency, calculationSnapshot: o.calculationSnapshot, imageUrl, year: o.year,
    mileageKm: o.mileageKm, marketLabel: o.marketLabel, href,
  };
  const mediaHeight = dense ? "h-24 sm:h-40 md:h-44" : compact ? "h-36 sm:h-44" : "h-44 sm:h-52";
  const tagClass = dense ? "flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white/[0.05] px-1.5 py-1 sm:gap-1.5 sm:px-2.5 sm:py-1.5" : "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-white/[0.05] px-2.5 py-1.5";
  const yearLabel = o.year ? `${o.year} г.` : "Год уточняется";
  const estimated = o.calculationStatus === "estimated" || o.calculationSnapshot?.pricingConfidence === "estimated";
  const priceLabel = isAuctionResult
    ? ([o.auctionDate ? `Продан ${shortDate(o.auctionDate)}` : "Результат торгов", o.auctionGrade ? `оценка ${o.auctionGrade}` : ""].filter(Boolean).join(" · "))
    : !exactTotalRub
      ? `${yearLabel} · цена автомобиля в рублях`
      : estimated
        ? `${yearLabel} · ориентир под ключ`
        : `${yearLabel} · цена под ключ`;
  const engineLabel = o.engineCc ? `${o.engineCc} см³` : isElectric ? "Электромотор" : o.fuelLabel;
  const hasSourcePrice = Number(o.sourcePrice || 0) > 0 && Boolean(o.sourceCurrency);
  const sourcePriceLine = hasSourcePrice
    ? `${isAuctionResult ? "Цена торгов" : "Цена в объявлении"}: ${sourceMoney(Number(o.sourcePrice), String(o.sourceCurrency).toUpperCase())}`
    : "";

  return (
    <article className="ac-catalog-card group relative min-w-0 overflow-visible rounded-[1.35rem] bg-white/[0.045] transition-colors hover:bg-white/[0.06]">
      <Link href={href} className="block overflow-hidden rounded-[1.35rem]">
        <div className={`relative overflow-hidden bg-white/[0.04] ${mediaHeight}`}>
          {imageUrl ? <img src={imageUrl} alt={o.title} className="h-full w-full object-cover object-[center_42%]" loading="lazy" decoding="async" fetchPriority="low" /> : <div className="flex h-full items-center justify-center text-xs font-black text-white/35 sm:text-sm">Фото загружается</div>}
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/90 via-black/42 to-transparent sm:h-24" />
          <div className={`ac-on-image absolute font-black uppercase tracking-[0.12em] text-white/90 ${dense ? "left-2 top-2 text-[8px] sm:left-3 sm:top-3 sm:text-[10px]" : "left-3 top-3 text-[10px]"}`}>{isAuctionResult ? "Япония · результат торгов" : o.marketLabel}</div>
          <div className="ac-on-image absolute bottom-2 left-2 right-2 text-white sm:bottom-3 sm:left-3 sm:right-3">
            <div className={`line-clamp-2 min-w-0 font-black leading-[1.04] tracking-[-0.03em] text-white drop-shadow-[0_2px_15px_rgba(0,0,0,.7)] ${dense ? "text-[12px] sm:text-[17px] sm:leading-[1.08]" : "text-[16px] leading-[1.08]"}`}>{o.title}</div>
          </div>
        </div>
        <div className={dense ? "p-2.5 sm:p-3.5" : "p-3.5"}>
          {exactTotalRub ? <div>
            <PriceTrend offer={o} label={priceLabel} dense={dense} priceClassName={dense ? "text-[15px] sm:text-[20px] md:text-[22px]" : "text-[20px] sm:text-[22px]"} />
            {sourcePriceLine ? <div className={`${dense ? "mt-1 text-[8px] sm:text-[10px]" : "mt-1.5 text-[10px]"} truncate font-bold text-white/48`} title={sourcePriceLine}>{sourcePriceLine}</div> : null}
          </div> : <div>
            <div className={`${dense ? "text-[8px] sm:text-[10px]" : "text-[10px]"} font-black uppercase tracking-[0.16em] text-white/58`}>{priceLabel}</div>
            <div className={`${dense ? "mt-1 text-[15px] sm:text-[20px] md:text-[22px]" : "mt-1.5 text-[20px] sm:text-[22px]"} whitespace-nowrap font-black leading-none tracking-[-0.05em] text-[var(--ac-text)]`}>{visibleRub ? moneyRub(visibleRub) : "Цена в рублях уточняется"}</div>
            {sourcePriceLine ? <div className={`${dense ? "mt-1 text-[8px] sm:text-[10px]" : "mt-1.5 text-[10px]"} truncate font-bold text-white/48`} title={sourcePriceLine}>{sourcePriceLine}</div> : null}
            <div className={`${dense ? "mt-1 text-[9px] sm:text-[11px]" : "mt-1.5 text-[11px]"} font-bold text-white/52`}>Расчёт под ключ уточняется</div>
          </div>}
          <div className={`flex flex-nowrap overflow-x-auto whitespace-nowrap font-bold text-white/58 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${dense ? "mt-2 gap-1 text-[8px] sm:mt-3 sm:gap-2 sm:text-[11px]" : "mt-3 gap-2 text-[11px]"}`}>
            <span className={tagClass}><MileageIcon dense={dense} /><span>{o.mileageKm ? `${new Intl.NumberFormat("ru-RU").format(o.mileageKm)} км` : "Пробег уточняется"}</span></span>
            <span className={tagClass}><EngineIcon dense={dense} fuel={!o.engineCc && !isElectric} electric={isElectric} /><span>{engineLabel}</span></span>
            <span className={tagClass}><PowerIcon dense={dense} /><span>{o.powerHp ? `${o.powerHp} л.с.` : "Мощность уточняется"}</span></span>
            {powerDisplay ? <span className={tagClass} title={powerDisplay.sourceLabel}><ThirtyMinuteIcon dense={dense} /><span>{powerDisplay.thirtyMinuteLabel}</span></span> : null}
            {powerDisplay?.utilizationLabel ? <span className={tagClass} title="Мощность, по которой рассчитывается утилизационный сбор"><ThirtyMinuteIcon dense={dense} /><span>{powerDisplay.utilizationLabel}</span></span> : null}
          </div>
        </div>
      </Link>
      <FavoriteToggle offerId={o.id} compact snapshot={snapshot} className={`ac-on-image absolute z-20 bg-black/52 text-red-400 backdrop-blur-md hover:bg-black/68 ${dense ? "right-2 top-2 h-8 w-8 sm:right-3 sm:top-3 sm:h-10 sm:w-10 [&>svg]:h-5 [&>svg]:w-5 sm:[&>svg]:h-[22px] sm:[&>svg]:w-[22px]" : "right-3 top-3"}`} />
    </article>
  );
}
