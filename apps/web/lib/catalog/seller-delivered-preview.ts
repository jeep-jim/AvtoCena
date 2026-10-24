import {DetailReadCache} from "./detail-read-cache";
import {offerParameterDraft} from "./offer-parameter-draft";
import {validateCustomerParameters} from "./customer-parameters";
import {calculateOfferWithCustomerParametersDetailed} from "./customs-pricing";
import type {VehicleOffer} from "./types";

// Six bounded workers overlap independent detail reads on the dedicated server.
// The shared detail loader separately limits decoded blocks to four in flight.
const quotes=new DetailReadCache<any>({maxEntries:256,maxBytes:2*1024*1024,ttlMs:60_000,concurrency:6});
/** Only visible cards, shared bounded work; never invent missing specifications. */
export async function attachSellerDeliveredPreviews<T extends Partial<VehicleOffer>>(offers:T[],configuration:unknown,options:{projectionOnly?:boolean}={}):Promise<T[]> {
 const result=[...offers];let cursor=0;
 await Promise.all(Array.from({length:Math.min(6,offers.length)},async()=>{
  while(cursor<offers.length){
   const i=cursor++,offer=offers[i] as T & {savedCalculationPreview?:unknown};
   if(!offer.id||(offer.market==="japan"||offer.market==="uae")||offer.catalogPricingMode!=="seller"||offer.savedCalculationPreview)continue;
   try{
    const key=JSON.stringify([options.projectionOnly,offerParameterDraft(offer as VehicleOffer),offer.id,offer.updatedAt,offer.sourcePrice,offer.sourceCurrency,offer.calculationSnapshot?.currencyRate,configuration,new Date().toISOString().slice(0,10)]);
    const quote=await quotes.get(key,async()=>{
     // AJES lists already use SELECT * and are mapped through the same verified
     // enrichment as details. Avoid a second supplier request per visible card.
     const ajes=offer.sourceId==='ajes_korea_feed'||offer.sourceId==='ajes_china_feed';
     let full=options.projectionOnly?{...offer,sourceId:offer.sourceId||(offer as any).sourceGroup} as VehicleOffer:ajes?offer as VehicleOffer:await (await import("./offer-page-data")).getOfferForPage(offer.id!);
     if(!full||full.market!==offer.market||full.sourcePrice!==offer.sourcePrice||full.sourceCurrency!==offer.sourceCurrency)return null;
     const parameters=validateCustomerParameters(offerParameterDraft(full));
     const calculated=await calculateOfferWithCustomerParametersDetailed(full,parameters);
     if(!calculated.ok||!(Number(calculated.calculation.totalRub)>0))return null;
     const c=calculated.calculation;
     return {totalRub:c.totalRub,currencyRate:c.currencyRate,deliveryPricingBasis:c.deliveryPricingBasis};
    });
    if(quote)result[i]={...offer,deliveredCalculationPreview:quote};
   }catch{/* Keep the explicitly labelled seller price when inputs are incomplete. */}
  }
 }));
 return result;
}
