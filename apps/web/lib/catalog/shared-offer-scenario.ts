import {cache} from 'react';
import type {VehicleOffer} from './types';
import {validateCustomerParameters} from './customer-parameters';
import {calculateOfferWithCustomerParametersDetailed} from './customs-pricing';
import {decodeShareDraft} from './offer-share';
// Only vehicle parameters travel in a link. Prices are always calculated on the server.
const calculateScenario=async(offer:VehicleOffer,encoded:string)=>{
 try{
  const draft=decodeShareDraft(encoded);
  if(!draft)return null;
  const result=await calculateOfferWithCustomerParametersDetailed(offer,validateCustomerParameters(draft));
  return result.ok?{draft,calculation:result.calculation}:null;
 }catch{return null;}
};
export const sharedOfferScenario=typeof cache==='function'?cache(calculateScenario):calculateScenario;
