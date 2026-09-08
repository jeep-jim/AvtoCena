/** A source price is never a delivered price or proof of technical completeness. */
export function isSellerPricedOffer(offer: any): boolean {
  const rate = offer?.calculationSnapshot?.currencyRate;
  return offer?.catalogPricingMode === "seller"
    && offer?.calculationStatus === "needs_data"
    && !(Number(offer?.totalRub) > 0)
    && Number.isFinite(offer?.sellerPriceRub) && offer.sellerPriceRub > 0
    && Number(offer?.sourcePrice) > 0 && /^[A-Z]{3}$/.test(String(offer?.sourceCurrency || ""))
    && ["cbr", "cbr_live"].includes(rate?.rateSource)
    && rate.currency === offer.sourceCurrency && Number(rate.sourcePrice) === Number(offer.sourcePrice)
    && Number.isFinite(rate.effectiveRate) && rate.effectiveRate > 0
    && Math.round(Number(offer.sourcePrice) * rate.effectiveRate) === offer.sellerPriceRub;
}
export function sellerPriceLabel(offer: any) {
  return offer?.catalogKind === "auction_result" ? "Цена на завершённых торгах" : "Цена продавца";
}
