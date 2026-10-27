import {applyJapanOwnerSpecifications} from './japan-owner-specifications';
import {enrichJapanDrive} from './japan-drive';
import {applyJapanFactoryFuel} from '../encyclopedia/japan-fuel-reference';
import {newerKoreaDetail} from './ajes-korea-detail-cache';
import {DetailReadCache} from './detail-read-cache';
import {getJsonStorage} from '../data';
import {applyEncyclopediaCalculation,readCalculationIndex} from '../encyclopedia/calculation-index';
const openedKoreaDetails=new DetailReadCache<any>({maxEntries:100,maxBytes:4*1024*1024,ttlMs:15000,concurrency:4});
import 'server-only';
import {ajesChinaPriceAllowed,ajesChinaSourceCeiling} from './ajes-price-policy';
import {headers} from 'next/headers';
import {ajesClient} from './ajes-runtime';
import {AjesUnavailable} from './ajes-client';
import {ajesOffer,ajesOfferId} from './ajes-offer';
import {convertToRub} from './rates';
import type {ajesLot,AjesQuery} from './ajes-query';
import {applyCatalogEditorial,editorialHidden,readCatalogEditorial} from './editorial';
import {catalogInventoryAgeDecision,catalogVehicleExcluded} from './inventory-admission';
export async function cappedAjesQuery(query:AjesQuery):Promise<AjesQuery>{
 if(query.table!=='china'||query.id)return query;
 const rate=await convertToRub(1,'CNY');
 if(!rate)throw Error('ajes_currency_unavailable');
 return {...query,sourcePriceTo:ajesChinaSourceCeiling(rate.effectiveRate)};
}
export async function readAjesPublic(query:AjesQuery,options:{editorial?:boolean;measure?:(stage:string,ms:number)=>void}={}){
 query=await cappedAjesQuery(query);
 const ip=(await headers()).get('x-real-ip')||'';
 const sourceStart=performance.now();
 const result=await ajesClient.read(query,ip).catch(error=>{
  // Fixed local error codes only: never log visitor IPs, SQL, URLs or supplier bodies.
  const allowed=new Set(['client_ip_missing','not_configured','invalid_response','visitor_restricted','request_failed','request_timeout','connect_timeout','response_too_large','empty_response','identity_mismatch','quota_invalid','quota_exhausted','quota_busy','query_too_large']);
  const reason=error instanceof AjesUnavailable&&allowed.has(error.reason)?error.reason:'operation_failed';
  console.warn('AJES_PUBLIC_FAILURE',reason);
  throw error;
 });
 options.measure?.('supplier-read',performance.now()-sourceStart);
 const indexStart=performance.now();const index=await readCatalogEditorial();options.measure?.('editorial-read',performance.now()-indexStart);
 const items=await Promise.all(result.items.map(async(lot:NonNullable<ReturnType<typeof ajesLot>>)=>{
  const detailStart=performance.now();
  if(lot.table==='korea'&&!query.id){
   const saved=await openedKoreaDetails.get(lot.id,()=>getJsonStorage().readJson('catalog/partner-cache/ajes/korea/'+lot.id+'.json',null)).catch(()=>null);
   lot=newerKoreaDetail(lot,result.observedAt,saved);
  }
  options.measure?.('detail-cache-sum',performance.now()-detailStart);
  const enrichStart=performance.now();
  const rate=await convertToRub(lot.finalPriceJpy||lot.sourcePrice,lot.currency as 'JPY'|'KRW'|'CNY');
  if(!rate)throw Error('ajes_currency_unavailable');
  let offer=ajesOffer(lot,rate,result.observedAt);
  // Exact local release facts also cover auction records. No supplier/detail
  // request or legacy approximate matching is needed for this lookup.
  offer=applyJapanFactoryFuel(applyEncyclopediaCalculation(enrichJapanDrive(offer,readCalculationIndex())));
  if(lot.table==='china'||lot.table==='korea'){
   const [{enrichOfferWithKnowledgeCore},{normalizeVehicleOfferSpecs}]=await Promise.all([import('./knowledge-core'),import('./spec-normalization')]);
   offer=normalizeVehicleOfferSpecs(await enrichOfferWithKnowledgeCore(offer));
  }
  options.measure?.('enrichment-sum',performance.now()-enrichStart);
  if(options.editorial!==false&&editorialHidden(offer,index))return null;
  return applyJapanOwnerSpecifications(options.editorial===false?offer:applyCatalogEditorial(offer,index));
 }));
 const {sourceEvidence: _privateEvidence,sourceEvidenceById: _privateListEvidence,...publicResult}=result;
 return {...publicResult,items:items.filter(offer=>offer&&ajesChinaPriceAllowed(offer)&&catalogInventoryAgeDecision(offer).eligible&&!catalogVehicleExcluded(offer))};
}
export async function getAjesOffer(id:string,options:{editorial?:boolean}={}){if(!ajesOfferId(id))return null;const match=id.match(/^ajes-(stats|korea|china)-(.+)$/)!;const result=await readAjesPublic({table:match[1] as 'stats'|'korea'|'china',id:match[2]},options);return result.items[0]||null;}
