/** Owner 18.10.2026: all Dubicars, including old/unpriced/unphotographed rows. */
export function isAllDubicarsOffer(offer:any):boolean {
 return offer?.market==='uae'&&(offer?.sourceId||offer?.sourceGroup)==='dubicars_uae_exact';
}
export function isUnpricedDubicarsOffer(offer:any):boolean {
 return isAllDubicarsOffer(offer)&&offer.calculationStatus==='needs_data'
  &&(offer.sourcePrice===undefined||offer.sourcePrice===null)&&!(Number(offer.totalRub)>0);
}
