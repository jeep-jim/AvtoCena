import {isUnpricedDubicarsOffer} from '../../apps/web/lib/catalog/dubicars-owner-policy.ts';

// The owner explicitly admits unpriced Dubicars. Keep them in needs-data
// coverage, separate from seller-price and calculated cars, without any quote.
export function isVerifiedPriceOnRequestForAudit(offer) {
 return isUnpricedDubicarsOffer(offer)
  && Number(offer.cardProjectionVersion)>=3
  && [offer.totalRub,offer.sellerPriceRub,offer.publicVisibleRub].every(value=>value==null||value===0);
}
