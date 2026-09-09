import { isSellerPricedOffer } from "./seller-price-contract";
import { catalogOfferVisibleRub } from "./public-priority";
export function isVerifiedSellerOnlyForAudit(offer:any) {
 return isSellerPricedOffer(offer) && catalogOfferVisibleRub(offer)<=0;
}
