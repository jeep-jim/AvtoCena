import { isSellerPricedOffer } from "./seller-price-contract";
import { catalogOfferVisibleRub } from "./public-priority";
export function isVerifiedSellerOnlyForAudit(offer:any) {
 return isSellerPricedOffer(offer) && catalogOfferVisibleRub(offer)<=0;
}

/** Count incomplete seller prices separately; never erase the coverage deficit. */
export function summarizePendingCalculationsForAudit(offers:any[]) {
 let needsData=0,verifiedSellerNeedsData=0;
 for(const offer of offers) {
  if (!["needs_data","needs_power_data","preliminary_power_pending"].includes(String(offer.calculationStatus))) continue;
  needsData++;
  if(isVerifiedSellerOnlyForAudit(offer)) verifiedSellerNeedsData++;
 }
 return {needsData,verifiedSellerNeedsData,blockingNeedsData:needsData-verifiedSellerNeedsData};
}
