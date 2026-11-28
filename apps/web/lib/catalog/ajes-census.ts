import {createHash} from 'node:crypto';
import {ajesLot,ajesQuery,AJES_CENSUS_FIELDS,type AjesCensusField,type AjesQuery} from './ajes-query';
import {AjesUnavailable} from './ajes-access-policy';
import {applyAjesLotAdmission,type AjesAdmissionSnapshot} from './ajes-admission';
export {applyAjesLotAdmission,type AjesAdmissionSnapshot} from './ajes-admission';
import {safePublicPricing} from './safe-public-pricing';
import {ajesResultFilter} from './ajes-result-filter';
import {japanUnknownPower} from './japan-source-power';
import type {CurrencyRateSnapshot} from './rates';

export const AJES_CENSUS_PREDICATE_VERSION='japan-admitted-census-zero-v2';
import type {AjesCensusGroup} from './ajes-census-protocol';
export {parseAjesCensusGroups,type AjesCensusGroup} from './ajes-census-protocol';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(reason:string):never=>{throw new AjesUnavailable('census_'+reason);};
const nonnegative=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
const fresh=(value:any,now:number)=>!value?.stale&&!value?.partial&&!value?.upperBound&&Number.isFinite(Date.parse(value?.observedAt))
 &&now-Date.parse(value.observedAt)>=0&&now-Date.parse(value.observedAt)<30*60000;

/** Public query binding can be independently reproduced by browser acceptance.
 * Source aliases have an additional private binding in countProof.queryHash. */
export function ajesRequestedCountQuery(params:Record<string,unknown>){
 const ignored=new Set(['sort','page','pageSize','after','view','marketPage','countOnly','source']);
 const normalized:Record<string,string>={};
 for(const [key,input] of Object.entries(params)){
  if(ignored.has(key))continue;
  const value=String(Array.isArray(input)?input[0]??'':input??'').trim();
  if(value)normalized[key]=value;
 }
 if(!normalized.make&&normalized.brand)normalized.make=normalized.brand;
 if(!normalized.bodyType&&normalized.body)normalized.bodyType=normalized.body;
 if(!normalized.budgetTo&&normalized.budget)normalized.budgetTo=normalized.budget;
 delete normalized.brand;delete normalized.body;delete normalized.budget;
 normalized.market='japan';
 return Object.fromEntries(Object.entries(normalized).sort(([a],[b])=>a.localeCompare(b)));
}
export const ajesRequestedCountQueryHash=(params:Record<string,unknown>)=>hash(ajesRequestedCountQuery(params));

/** These source restrictions can discard a row before its final local/manual
 * value is known. Until their candidate predicates are proven supersets, even
 * a source zero or one exhausted LIST cannot prove the complete UI selection.
 * Power and price filters do not narrow source candidates and stay eligible.
 */
export function ajesSourceScopeSupportsExactCount(query:AjesQuery):boolean{
 return !query.color&&!query.fuel&&!query.drive&&!query.transmission&&!query.pickup
  &&query.engineFrom===undefined&&query.engineTo===undefined;
}

export function ajesCensusFields(schema:unknown):AjesCensusField[]{
 if(!Array.isArray(schema)||schema.some(field=>typeof field!=='string'))return fail('schema_unavailable');
 const names=new Set(schema.map(field=>field.toUpperCase()));
 // An omitted key in one JSON page is not proof that a table column is absent.
 // Until a complete table-schema contract supplies that evidence, require all
 // membership inputs to have been observed; never silently omit a dimension.
 if(!names.has('ID')||AJES_CENSUS_FIELDS.some(field=>!names.has(field)))return fail('schema_unavailable');
 return AJES_CENSUS_FIELDS.filter(field=>names.has(field));
}


export type AjesCountProof={
 version:1;kind:'japan-admitted-census';predicateVersion:string;requestedQueryHash:string;queryHash:string;evidenceEpoch:string;
 sourceQueryHash:string;coverageHash:string;complete:true;sourceObservedAt:string;sourceCompletedAt:string;
 sourceTotal:number;sourceDistinctTotal:number;groupedTotal:number;groupCount:number;pages:number;baseAdmittedTotal:number;
 correctionCount:number;correctionDelta:number;admittedTotal:number;knownTotal:number;unknownTotal:number;
};
export type AjesExactCountSummary={total:number;stale:false;observedAt:string;upperBound:false;countProof:AjesCountProof};
type CensusPage={groups:AjesCensusGroup[];received:number;page:number;pageSize:number;observedAt:string;stale?:boolean;partial?:boolean};
export type AjesCountPricingContext={digest:string;correctionIds:readonly string[];run<T>(work:()=>Promise<T>):Promise<T>;price(offers:any[]):Promise<any[]>;assertCurrent():Promise<void>};

export async function evaluateAjesCensusGroup(group:AjesCensusGroup,options:{params:Record<string,unknown>;snapshot:AjesAdmissionSnapshot;observedAt:string;
 rate:(amount:number)=>Promise<CurrencyRateSnapshot|null>;price?:(offers:any[])=>Promise<any[]>;identity?:string}){
 if(group.validIds!==group.total)return fail('identity_unproven');
 if(group.validFinishes!==group.total)return fail('finish_unproven');
 if(ajesResultFilter(options.params).priceFilter)return fail('price_count_unavailable');
 const id=options.identity??'census_'+hash(group.values).slice(0,48);
 // Positive source-price validity was aggregated without transporting prices.
 // A neutral internal value only satisfies the unchanged offer constructor;
 // no price filter/calculation/publication may consume this representative.
 const lot=ajesLot({...group.values,ID:id,AUCTION_TYPE:2,FINISH:1},'stats',false);
 if(!lot)return {admitted:false,known:false};
 const rate=await options.rate(lot.finalPriceJpy!);
 if(!rate)return fail('currency_unavailable');
 let offer=applyAjesLotAdmission(lot,rate,options.observedAt,options.snapshot,Boolean(options.identity));
 if(!offer)return {admitted:false,known:false};
 const filter=ajesResultFilter(options.params);
 if(filter.powerFilter)offer=safePublicPricing(offer);
 if(!filter.matchesPower(offer))return {admitted:false,known:false};
 return {admitted:filter.matches(offer),known:!japanUnknownPower(offer)};
}

/** An authoritative empty source selection proves zero without enrichment.
 * Positive GROUP pages and later ID corrections have no shared provider
 * snapshot contract. Equal weights, fresh dates and local hashes cannot prove
 * that those observations describe one inventory, so do not start that walk.
 * The pure group evaluator above remains usable for controlled local evidence.
 */
export async function readAjesCensusCount(options:{
 params:Record<string,unknown>;query:AjesQuery;fields:readonly AjesCensusField[];snapshot:AjesAdmissionSnapshot;evidenceEpoch:string;
 sourceCount:{total:number;distinctTotal?:number;observedAt:string;stale?:boolean;partial?:boolean};
 read:(query:AjesQuery)=>Promise<CensusPage>;rate:(amount:number)=>Promise<CurrencyRateSnapshot|null>;
 pricing?:AjesCountPricingContext;assertCurrent:()=>Promise<void>;now?:()=>number;
}):Promise<AjesExactCountSummary>{
 const now=options.now??Date.now;
 const {sourceCount,snapshot,params}=options;
 if(!ajesSourceScopeSupportsExactCount(options.query))return fail('source_scope_unproven');
 if(!nonnegative(sourceCount.total)||!fresh(sourceCount,now()))return fail('source_count_unavailable');
 if(sourceCount.distinctTotal!==undefined&&sourceCount.distinctTotal!==sourceCount.total)return fail('identity_uniqueness_unproven');
 if(!/^[a-f0-9]{64}$/.test(options.evidenceEpoch))return fail('context_unavailable');
 if(sourceCount.total>0)return fail('source_snapshot_unavailable');
 // Ordinary COUNT(*)=0 also proves that the number of distinct IDs is zero.
 // No DISTINCT/BINARY projection or positive-count uniqueness claim is needed.
 const sourceQuery={...options.query};delete sourceQuery.page;delete sourceQuery.pageSize;delete sourceQuery.sort;delete sourceQuery.aggregate;delete sourceQuery.countIdentity;
 const sourceQueryHash=createHash('sha256').update(ajesQuery({...sourceQuery,aggregate:'count'},snapshot.calculationIndex).sql).digest('hex');
 const requestedQueryHash=ajesRequestedCountQueryHash(params),queryHash=hash([ajesRequestedCountQuery(params),sourceQuery,options.fields]);
 const observedAt=sourceCount.observedAt;
 const current=async()=>{await options.assertCurrent();await options.pricing?.assertCurrent();};
 const work=async()=>{
  await current();
  if(!fresh({observedAt},now()))return fail('expired');
  const countProof:AjesCountProof={version:1,kind:'japan-admitted-census',predicateVersion:AJES_CENSUS_PREDICATE_VERSION,
   requestedQueryHash,queryHash,evidenceEpoch:options.evidenceEpoch,sourceQueryHash,coverageHash:hash([sourceQueryHash,0,observedAt]),complete:true,
   sourceObservedAt:observedAt,sourceCompletedAt:new Date(now()).toISOString(),sourceTotal:0,sourceDistinctTotal:0,groupedTotal:0,groupCount:0,pages:0,
   baseAdmittedTotal:0,correctionCount:0,correctionDelta:0,admittedTotal:0,knownTotal:0,unknownTotal:0};
  return {total:0,stale:false as const,observedAt,upperBound:false as const,countProof};
 };
 return options.pricing?options.pricing.run(work):work();
}
