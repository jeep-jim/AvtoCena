type HistoryOffer = {market?:string;sourceId?:string;sourceOfferId?:string;lotNumber?:string;
  operational?:Record<string,unknown>};

/** Reports use the supplier's real listing identity, never an invented AJ alias. */
export function koreaHistoryIdentity(offer:HistoryOffer,offerId:string,retro:boolean) {
  if(retro||offer.market!=='korea')return undefined;
  if(offer.sourceId==='encar_direct'&&offer.operational?.provider==='auto_api_encar'
    &&/^[a-f0-9]{24}$/.test(offerId)&&/^\d{6,10}$/.test(offer.sourceOfferId||'')){
    return {offerId,lot:offer.sourceOfferId!};
  }
  const lot=String(offer.lotNumber||'');
  if(offer.sourceId==='ajes_korea_feed'&&/^ajes-korea-[A-Za-z0-9_-]{1,64}$/.test(offerId)&&/^\d{6,10}$/.test(lot))return {offerId,lot};
  return undefined;
}
