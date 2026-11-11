import type {VehicleOffer} from './types';
import {attachManagementKnowledge,invalidateManagementPrice} from './management-knowledge';
import {offerPrecedentParameterDraft} from './power30-precedent';
import {validateCustomerParameters} from './customer-parameters';
import {calculateOfferWithCustomerParametersDetailed} from './customs-pricing';
import {DetailReadCache} from './detail-read-cache';
const quotes=new DetailReadCache<any>({maxEntries:256,maxBytes:4*1024*1024,ttlMs:60_000,concurrency:4});
/** Reuse saved knowledge for present and future listings, never a donor's price or city. */
export async function attachManagementPreviews<T extends Partial<VehicleOffer>>(input:T[],configuration:unknown):Promise<T[]>{
 const offers=await attachManagementKnowledge(input);
 return Promise.all(offers.map(async offer=>{
  const learned=(offer.operational as any)?.managementKnowledge;
  if(!offer.id||!learned||(offer as any).savedCalculationPreview)return offer;
  // AJES SELECT * rows already passed the same enrichment/editorial path as
  // their detail route. Keep that complete, listing-bound record local instead
  // of issuing one more supplier read for each visible learned calculation.
  // Compact/public rows lack this private context and retain the detail check.
  const table=offer.market==='japan'?'stats':offer.market;
  const inline=Boolean(['japan','korea','china'].includes(String(offer.market))
   &&offer.sourceId===`ajes_${offer.market}_feed`&&offer.sourceOfferId
   &&offer.id===`ajes-${table}-${offer.sourceOfferId}`
   &&!(offer as any).cardProjectionVersion&&offer.operational?.raw);
  const key=JSON.stringify([inline,offer.market,offer.sourceId,offer.sourceOfferId,offer.id,offer.sourcePrice,offer.sourceCurrency,offer.updatedAt,offerPrecedentParameterDraft(offer as VehicleOffer),learned,configuration]);
  const preview=await quotes.get(key,async()=>{
   const full=inline?offer as VehicleOffer:await (await import('./offer-page-data')).getOfferForPage(offer.id!);
   if(!full||full.market!==offer.market||full.sourcePrice!==offer.sourcePrice||full.sourceCurrency!==offer.sourceCurrency)return null;
   const parameters={...validateCustomerParameters(offerPrecedentParameterDraft(full)),...Object.fromEntries(Object.entries((full.operational as any)?.managementKnowledge?.parameters||{}).filter(([key])=>['drive','bodyType','transmission'].includes(key)))};
   const result=await calculateOfferWithCustomerParametersDetailed(full,parameters);
   if(!result.ok||!(Number(result.calculation.totalRub)>0))return null;
   const c=result.calculation;
   return {version:'management:'+learned.revision,managementLearned:true,totalRub:c.totalRub,parameters,deliveryCity:'',currencyRate:c.currencyRate,deliveryPricingBasis:c.deliveryPricingBasis,utilizationPowerKw:c.customs?.utilizationPowerKw,power30Precedent:c.power30Precedent};
  }).catch(()=>null);
  return preview?{...offer,savedCalculationPreview:preview}:invalidateManagementPrice(offer);
 }));
}
