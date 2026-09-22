export const GREEN_CORNER_SOURCE = "akebono_green_japan_open";
export const GREEN_CORNER_FEE_RUB = 45_000;
export function isGreenCornerOffer(offer: any): boolean {
  return offer?.sourceId === GREEN_CORNER_SOURCE && offer?.market === "japan"
    && /^green-\d+$/.test(String(offer?.id || "")) && offer?.offerType === "fixed";
}
export function greenCornerFeeRub(offer: any): number {
  return isGreenCornerOffer(offer) ? GREEN_CORNER_FEE_RUB : 0;
}
