import {applyJapanOwnerSpecifications} from './japan-owner-specifications';
import {enrichJapanDrive} from './japan-drive';
import {applyJapanFactoryFuel} from '../encyclopedia/japan-fuel-reference';
import {applyEncyclopediaCalculation,readCalculationIndex} from '../encyclopedia/calculation-index';
import 'server-only';
import {createHash} from 'node:crypto';
import {assertAjesJapanTable} from './ajes-access-policy';
import {headers} from 'next/headers';
import {ajesClient} from './ajes-runtime';
import {AjesUnavailable} from './ajes-client';
import {ajesOffer} from './ajes-offer';
import {convertToRub} from './rates';
import type {ajesLot,AjesQuery} from './ajes-query';
import {applyCatalogEditorial,editorialHidden,readCatalogEditorial} from './editorial';
import {catalogInventoryAgeDecision,catalogVehicleExcluded} from './inventory-admission';
import {japanVehicleExcluded} from './japan-vehicle-policy';
import type {JapanPowerQueryContext,JapanPowerSnapshot} from './japan-power-query';
export async function cappedAjesQuery(query:AjesQuery):Promise<AjesQuery>{
 assertAjesJapanTable(query.table);
 return query;
}
export async function readAjesPublic(query:AjesQuery,options:{editorial?:boolean;measure?:(stage:string,ms:number)=>void;powerContext?:JapanPowerQueryContext;snapshot?:JapanPowerSnapshot}={}){
 query=await cappedAjesQuery(query);
 const ip=(await headers()).get('x-real-ip')||'';
 const sourceStart=performance.now();
 const result=await ajesClient.read(query,ip,options.powerContext).catch(error=>{
  // Fixed local error codes only: never log visitor IPs, SQL, URLs or supplier bodies.
  const allowed=new Set(['client_ip_missing','not_configured','invalid_response','visitor_restricted','request_failed','request_timeout','connect_timeout','response_too_large','empty_response','identity_mismatch','quota_invalid','quota_exhausted','quota_busy','local_busy','query_too_large']);
  const reason=error instanceof AjesUnavailable&&allowed.has(error.reason)?error.reason:'operation_failed';
  console.warn('AJES_PUBLIC_FAILURE',reason);
  throw error;
 });
 options.measure?.('supplier-read',performance.now()-sourceStart);
 // Bind continuation to the observed source rows, before rates, editorial
 // display data or delivered-preview timestamps are attached.
 const sourceFingerprint=createHash('sha256').update(JSON.stringify([result.observedAt,result.received,result.items])).digest('hex');
 const snapshot=options.powerContext?.snapshot??options.snapshot;
 const indexStart=performance.now();const index=snapshot?.editorial??await readCatalogEditorial();options.measure?.('editorial-read',performance.now()-indexStart);
 const calculationIndex=snapshot?snapshot.index:readCalculationIndex();
 const items=await Promise.all(result.items.map(async(lot:NonNullable<ReturnType<typeof ajesLot>>)=>{
  // Old exact/detail/partial snapshots predate current source admission. Apply
  // the same product policy before currency work and again after local facts.
  if(japanVehicleExcluded(lot))return null;
  const enrichStart=performance.now();
  const rate=await convertToRub(lot.finalPriceJpy||lot.sourcePrice,lot.currency as 'JPY'|'KRW'|'CNY');
  if(!rate)throw Error('ajes_currency_unavailable');
  let offer=ajesOffer(lot,rate,result.observedAt);
  // Exact local release facts also cover auction records. No supplier/detail
  // request or legacy approximate matching is needed for this lookup.
  offer=applyJapanFactoryFuel(applyEncyclopediaCalculation(enrichJapanDrive(offer,calculationIndex),calculationIndex));
  options.measure?.('enrichment-sum',performance.now()-enrichStart);
  if(options.editorial!==false&&editorialHidden(offer,index))return null;
  return applyJapanOwnerSpecifications(options.editorial===false?offer:applyCatalogEditorial(offer,index));
 }));
 const {sourceEvidence: _privateEvidence,sourceEvidenceById: _privateListEvidence,emptyPageEvidence: _privateEmptyEvidence,...publicResult}=result;
 return {...publicResult,sourceFingerprint,items:items.filter(offer=>offer&&catalogInventoryAgeDecision(offer).eligible&&!catalogVehicleExcluded(offer)&&!japanVehicleExcluded(offer))};
}
export async function getAjesOffer(id:string,options:{editorial?:boolean}={}){
 const match=id.match(/^ajes-stats-([A-Za-z0-9_-]{1,64})$/);
 if(!match)return null;
 const result=await readAjesPublic({table:'stats',id:match[1]},options);
 return result.items[0]||null;
}
