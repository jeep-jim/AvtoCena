import 'server-only';
import {headers} from 'next/headers';
import {ajesClient} from './ajes-runtime';
import {AjesUnavailable} from './ajes-client';
import {ajesOffer,ajesOfferId} from './ajes-offer';
import {convertToRub} from './rates';
import type {ajesLot,AjesQuery} from './ajes-query';
import {applyCatalogEditorial,editorialHidden,readCatalogEditorial} from './editorial';
import {catalogInventoryAgeDecision,catalogHeavyVehicleExcluded} from './inventory-admission';
export async function readAjesPublic(query:AjesQuery){
 const ip=(await headers()).get('x-real-ip')||'';
 const result=await ajesClient.read(query,ip).catch(error=>{
  // Fixed local error codes only: never log visitor IPs, SQL, URLs or supplier bodies.
  const allowed=new Set(['client_ip_missing','not_configured','invalid_response','visitor_restricted','request_failed','request_timeout','connect_timeout','response_too_large','empty_response','identity_mismatch','quota_invalid','quota_exhausted','quota_busy']);
  const reason=error instanceof AjesUnavailable&&allowed.has(error.reason)?error.reason:'operation_failed';
  console.warn('AJES_PUBLIC_FAILURE',reason);
  throw error;
 });
 const index=await readCatalogEditorial();
 const items=await Promise.all(result.items.map(async(lot:NonNullable<ReturnType<typeof ajesLot>>)=>{
  const rate=await convertToRub(lot.finalPriceJpy||lot.sourcePrice,lot.currency as 'JPY'|'KRW'|'CNY');
  if(!rate)throw Error('ajes_currency_unavailable');
  const offer=ajesOffer(lot,rate,result.observedAt);
  return editorialHidden(offer,index)?null:applyCatalogEditorial(offer,index);
 }));
 const {sourceEvidence: _privateEvidence,sourceEvidenceById: _privateListEvidence,...publicResult}=result;
 return {...publicResult,items:items.filter(offer=>offer&&catalogInventoryAgeDecision(offer).eligible&&!catalogHeavyVehicleExcluded(offer))};
}
export async function getAjesOffer(id:string){if(!ajesOfferId(id))return null;const match=id.match(/^ajes-(stats|korea|china)-(.+)$/)!;const result=await readAjesPublic({table:match[1] as 'stats'|'korea'|'china',id:match[2]});return result.items[0]||null;}
