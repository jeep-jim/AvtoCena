import {readCalculationIndex,type CalculationIndex} from '../encyclopedia/calculation-index';
import 'server-only';
import {assertAjesJapanTable} from './ajes-access-policy';
import {headers} from 'next/headers';
import {ajesClient} from './ajes-runtime';
import {AjesUnavailable} from './ajes-client';
import {convertToRub} from './rates';
import type {ajesLot,AjesQuery} from './ajes-query';
import {readCatalogEditorial,type CatalogEditorialIndex} from './editorial';
import {applyAjesLotAdmission} from './ajes-admission';
export async function cappedAjesQuery(query:AjesQuery):Promise<AjesQuery>{
 assertAjesJapanTable(query.table);
 return query;
}
export type AjesPublicEvidenceSnapshot=Readonly<{editorial:CatalogEditorialIndex;calculationIndex:CalculationIndex|null}>;
/** Use the same five-second reader as the existing pricing path. The caller
 * rechecks its epoch around pricing; a fresh-only read would bypass that cache
 * and allow pricing to reapply a different editorial revision.
 */
export async function readAjesPublicEvidenceSnapshot():Promise<AjesPublicEvidenceSnapshot>{
 return Object.freeze({editorial:await readCatalogEditorial(),calculationIndex:readCalculationIndex()});
}
export async function readAjesPublic(query:AjesQuery,options:{editorial?:boolean;evidenceSnapshot?:AjesPublicEvidenceSnapshot;measure?:(stage:string,ms:number)=>void}={}){
 query=await cappedAjesQuery(query);
 const ip=(await headers()).get('x-real-ip')||'';
 const sourceStart=performance.now();
 const result=await ajesClient.read(query,ip).catch(error=>{
  // Fixed local error codes only: never log visitor IPs, SQL, URLs or supplier bodies.
  const allowed=new Set(['client_ip_missing','not_configured','invalid_response','visitor_restricted','request_failed','request_timeout','connect_timeout','response_too_large','empty_response','identity_mismatch','quota_invalid','quota_exhausted','quota_busy','local_busy','query_too_large']);
  const reason=error instanceof AjesUnavailable&&allowed.has(error.reason)?error.reason:'operation_failed';
  console.warn('AJES_PUBLIC_FAILURE',reason);
  throw error;
 });
 options.measure?.('supplier-read',performance.now()-sourceStart);
 const indexStart=performance.now();const index=options.evidenceSnapshot?.editorial??await readCatalogEditorial();
 const calculationIndex=options.evidenceSnapshot?options.evidenceSnapshot.calculationIndex:readCalculationIndex();
 options.measure?.('editorial-read',performance.now()-indexStart);
 const items=await Promise.all(result.items.map(async(lot:NonNullable<ReturnType<typeof ajesLot>>)=>{
  const enrichStart=performance.now();
  const rate=await convertToRub(lot.finalPriceJpy||lot.sourcePrice,lot.currency as 'JPY'|'KRW'|'CNY');
  if(!rate)throw Error('ajes_currency_unavailable');
  const offer=applyAjesLotAdmission(lot,rate,result.observedAt,{editorial:index,calculationIndex},options.editorial!==false);
  options.measure?.('enrichment-sum',performance.now()-enrichStart);
  return offer;
 }));
 const {sourceEvidence: _privateEvidence,sourceEvidenceById: _privateListEvidence,emptyPageEvidence: _privateEmptyEvidence,sourceFields:_privateSchema,...publicResult}=result;
 return {...publicResult,items:items.filter((offer):offer is NonNullable<typeof offer>=>Boolean(offer))};
}
export async function getAjesOffer(id:string,options:{editorial?:boolean}={}){
 const match=id.match(/^ajes-stats-([A-Za-z0-9_-]{1,64})$/);
 if(!match)return null;
 const result=await readAjesPublic({table:'stats',id:match[1]},options);
 return result.items[0]||null;
}
