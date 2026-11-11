/** Owner 18.10.2026: all Dubicars, including old/unpriced/unphotographed rows. */
export function isAllDubicarsOffer(offer:any):boolean {
 return offer?.market==='uae'&&(offer?.sourceId||offer?.sourceGroup)==='dubicars_uae_exact';
}
export function isUnpricedDubicarsOffer(offer:any):boolean {
 return isAllDubicarsOffer(offer)&&offer.calculationStatus==='needs_data'
  &&(offer.sourcePrice===undefined||offer.sourcePrice===null)&&!(Number(offer.totalRub)>0);
}

/** Display the admitted price-on-request inventory without accepting stale money/previews. */
export function isPriceOnRequestDubicarsOffer(offer:any):boolean {
 return isUnpricedDubicarsOffer(offer)
  && [offer.totalRub,offer.sellerPriceRub,offer.publicVisibleRub].every(value=>value==null||value===0)
  && !offer.deliveredCalculationPreview && !offer.japanDeliveredPreview && !offer.savedCalculationPreview;
}
