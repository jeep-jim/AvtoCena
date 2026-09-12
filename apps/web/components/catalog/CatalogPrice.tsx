import { isSellerPricedOffer } from "@/lib/catalog/seller-price-contract";
import { AuctionCardPrice } from "@/components/catalog/AuctionCardPrice";
import { PreliminaryPrice } from "@/components/catalog/PreliminaryPrice";
import { PriceTrend } from "@/components/catalog/PriceTrend";
import { isCatalogPowerScenario } from "@/lib/catalog/power-scenario";
import { SellerPrice } from "./SellerPrice";

const M1_PREFERENTIAL_MAX_KW = 117.68;

function utilizationThresholdKw(offer: any) {
  const powerKw = Number(offer?.powerKw || offer?.enginePowerKw || 0);
  const powerHp = Number(offer?.powerHp || 0);
  const category = String(offer?.vehicleCategory || "M1").toUpperCase();
  const powertrainKind = String(offer?.powertrainKind || "").toLowerCase();
  const fuel = String(offer?.fuel || "").toLowerCase();
  const combustionM1 = category !== "N1"
    && !["electric", "series_hybrid", "other_hybrid"].includes(powertrainKind)
    && !/(?:electric|battery|\bbev\b|\bev\b|hybrid|phev|hev|mhev|электро|гибрид)/i.test(fuel);
  // The warning is intentionally narrow: it resolves the misleading case where
  // rounded horsepower still reads 160 hp while the source kW has crossed the
  // statutory M1 preferential threshold. Never derive documentary kW from hp.
  return combustionM1 && powerKw > M1_PREFERENTIAL_MAX_KW && powerHp > 0 && powerHp <= 160 ? powerKw : 0;
}

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
  if (isSellerPricedOffer(offer)) return <SellerPrice offer={offer} panel={false} dense={dense} label={label} priceClassName={priceClassName} />;
  const totalRub = Number(offer?.totalRub || 0);
  const japanAuction = String(offer?.market || "").toLowerCase() === "japan"
    || /япони/i.test(String(offer?.marketLabel || ""));
  const powertrainKind = String(offer?.powertrainKind || "").toLowerCase();
  const fuel = String(offer?.fuel || "").toLowerCase();
  const highlightElectrified = ["electric", "series_hybrid", "other_hybrid"].includes(powertrainKind)
    || /(?:electric|battery|\bbev\b|\bev\b|hybrid|phev|hev|mhev|электро|гибрид)/i.test(fuel);
  const thresholdKw = utilizationThresholdKw(offer);

  if (totalRub > 0) {
    if (japanAuction) return <AuctionCardPrice offer={offer} label={label} dense={dense} priceClassName={priceClassName} />;
    const preliminary = isCatalogPowerScenario(offer)
      || String(offer?.calculationStatus || "") === "preliminary_power_pending"
      || offer?.calculationSnapshot?.pricingConfidence === "preliminary";
    if (preliminary) return <PreliminaryPrice offer={offer} label={label} dense={dense} priceClassName={priceClassName} highlightElectrified={highlightElectrified} />;
    if (thresholdKw) {
      // Do not compete with the important utilization warning by showing the
      // exchange-rate trend arrow in the same small card slot.
      const withoutTrend = {
        ...offer,
        previousTotalRub: null,
        priceDeltaRub: null,
        calculationSnapshot: offer?.calculationSnapshot ? {
          ...offer.calculationSnapshot,
          currencyRate: offer.calculationSnapshot.currencyRate ? {
            ...offer.calculationSnapshot.currencyRate,
            previousEffectiveRate: undefined,
            rateDelta: undefined,
          } : undefined,
        } : undefined,
      };
      return <div className="relative">
        <PriceTrend offer={withoutTrend} label={label} dense={dense} priceClassName={priceClassName} highlightElectrified={highlightElectrified} />
        <span className={`absolute right-0 top-1/2 -translate-y-1/2 rounded-lg border border-amber-400/35 bg-amber-400/10 font-black text-amber-300 ${dense ? "px-1.5 py-1 text-[8px] sm:text-[10px]" : "px-2 py-1 text-[10px]"}`} title={`Повышенный утильсбор: ${thresholdKw.toLocaleString("ru-RU")} кВт выше льготного порога 117,68 кВт`}>
          ⚠ {thresholdKw.toLocaleString("ru-RU")} кВт
        </span>
      </div>;
    }
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
