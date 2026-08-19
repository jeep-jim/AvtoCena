import { PreliminaryPrice } from "@/components/catalog/PreliminaryPrice";
import { AuctionResultPrice, PriceTrend } from "@/components/catalog/PriceTrend";

export function CatalogPrice({
  offer,
  label,
  dense = false,
  priceClassName = "text-[22px]",
}: {
  offer: any;
  label: string;
  dense?: boolean;
  priceClassName?: string;
}) {
  const totalRub = Number(offer?.totalRub || 0);
  const japanAuction = String(offer?.market || "").toLowerCase() === "japan"
    || /япони/i.test(String(offer?.marketLabel || ""));
  const powertrainKind = String(offer?.powertrainKind || "").toLowerCase();
  const fuel = String(offer?.fuel || "").toLowerCase();
  const highlightElectrified = ["electric", "series_hybrid", "other_hybrid"].includes(powertrainKind)
    || /(?:electric|battery|\bbev\b|\bev\b|hybrid|phev|hev|mhev|электро|гибрид)/i.test(fuel);

  if (totalRub > 0) {
    if (japanAuction) return <AuctionResultPrice offer={offer} label={label} dense={dense} priceClassName={priceClassName} />;
    const preliminary = String(offer?.calculationStatus || "") === "preliminary_power_pending"
      || offer?.calculationSnapshot?.pricingConfidence === "preliminary";
    if (preliminary) return <PreliminaryPrice offer={offer} label={label} dense={dense} priceClassName={priceClassName} highlightElectrified={highlightElectrified} />;
    return <PriceTrend offer={offer} label={label} dense={dense} priceClassName={priceClassName} highlightElectrified={highlightElectrified} />;
  }

  return (
    <div className="ac-price-trend relative min-w-0">
      <div className={`${dense ? "text-[8px] sm:text-[10px]" : "text-[10px]"} ac-price-trend-label min-w-0 font-black uppercase tracking-[0.19em] text-[var(--ac-text)]`}>
        {label}
      </div>
      <div className={`${dense ? "mt-1 sm:mt-1.5" : "mt-1.5"} flex min-w-0 items-end justify-between`}>
        <div className={`ac-price ac-price--flat min-w-0 whitespace-nowrap font-black leading-none tracking-[-0.05em] ${priceClassName}`}>
          Цена по запросу
        </div>
      </div>
    </div>
  );
}
