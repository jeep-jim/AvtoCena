"use client";
import { isGreenCornerOffer } from "../../lib/catalog/green-corner-contract";
import { isElectrifiedPrice } from "../../lib/catalog/electrified-price";
import { useSelectedCity } from "../../lib/location/selected-city";
import { priceCardForCity } from "../../lib/catalog/card-city-delivery";
import { isSellerPricedOffer } from "@/lib/catalog/seller-price-contract";
import { AuctionCardPrice } from "@/components/catalog/AuctionCardPrice";
import { PreliminaryPrice } from "@/components/catalog/PreliminaryPrice";
import { PriceTrend } from "@/components/catalog/PriceTrend";
import { isCatalogPowerScenario } from "@/lib/catalog/power-scenario";
import { SellerPrice } from "./SellerPrice";

function CatalogPriceContent({
  offer,
  label,
  dense = false,
  priceClassName = "text-[22px]",
  deliveryCity = "",
}: {
  offer: any;
  label: string;
  dense?: boolean;
  priceClassName?: string;
  deliveryCity?: string;
}) {
  if (isGreenCornerOffer(offer)) {
    const preview = !offer.savedCalculationPreview && Number(offer.japanDeliveredPreview?.totalRub) > 0 ? offer.japanDeliveredPreview : null;
    if (preview || offer.savedCalculationPreview || !isSellerPricedOffer(offer) && Number(offer.totalRub) > 0) {
      const stock = preview ? {...offer, totalRub:preview.totalRub, calculationSnapshot:{...offer.calculationSnapshot, currencyRate:preview.currencyRate || offer.calculationSnapshot?.currencyRate}} : offer;
      return <PriceTrend offer={stock} label={label} statusLabel="В наличии" dense={dense} priceClassName={priceClassName} />;
    }
  }
  if (offer.savedCalculationPreview) return offer.market === "japan" && !isGreenCornerOffer(offer)
    ? <AuctionCardPrice offer={offer} label={label} dense={dense} priceClassName={priceClassName} />
    : <PriceTrend offer={offer} label={label} dense={dense} priceClassName={priceClassName} />;
  if (offer.market === "japan" && !isGreenCornerOffer(offer) && Number(offer.japanDeliveredPreview?.totalRub) > 0) return <div title="Предварительная стоимость под ключ по данным аукциона"><AuctionCardPrice offer={{...offer, totalRub: offer.japanDeliveredPreview.totalRub}} label={label} dense={dense} priceClassName={priceClassName} /></div>;
  if (isSellerPricedOffer(offer)) return <SellerPrice deliveryCity={deliveryCity} offer={offer} panel={false} dense={dense} label={label} priceClassName={priceClassName} />;
  const totalRub = Number(offer?.totalRub || 0);
  const japanAuction = !isGreenCornerOffer(offer) && (String(offer?.market || "").toLowerCase() === "japan"
    || /япони/i.test(String(offer?.marketLabel || "")));
  const highlightElectrified = isElectrifiedPrice(offer);

  if (totalRub > 0) {
    if (japanAuction) return <AuctionCardPrice offer={offer} label={label} dense={dense} priceClassName={priceClassName} />;
    const preliminary = isCatalogPowerScenario(offer)
      || String(offer?.calculationStatus || "") === "preliminary_power_pending"
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

export function CatalogPrice(props: Parameters<typeof CatalogPriceContent>[0]) {
 const city = useSelectedCity();
 const saved = props.offer.savedCalculationPreview;
 const priced = saved ? {offer:props.offer} : priceCardForCity(props.offer,city);
 const estimated = Number(props.offer?.japanDeliveredPreview?.totalRub) > 0 || (!isSellerPricedOffer(props.offer) && Number(props.offer?.totalRub) > 0);
 return <div><CatalogPriceContent {...props} offer={priced.offer} deliveryCity={city} />{!isGreenCornerOffer(props.offer) && !saved?.deliveryCity && (saved || estimated && !city) ? <p className="mt-1 text-[10px] font-medium text-[var(--ac-muted)]">Без доставки</p> : null}</div>;
}
