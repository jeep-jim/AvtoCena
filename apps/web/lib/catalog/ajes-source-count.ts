export const AJES_SOURCE_COUNT_PREDICATE_VERSION='japan-source-candidates-v1';
export const AJES_SOURCE_COUNT_FRESH_MS=30*60*1000;
export const AJES_SOURCE_COUNT_RETAINED_MS=7*24*60*60*1000;

/** This is the scalar result of the actual source candidate SQL, before local
 * admission, enrichment and delivered-price filtering. It is not an admitted
 * census. A restricted source scope may also omit locally matching offers. */
export type AjesSourceCountProof={
 version:1;kind:'japan-source-count';predicateVersion:typeof AJES_SOURCE_COUNT_PREDICATE_VERSION;
 requestedQueryHash:string;sourceQueryHash:string;evidenceEpoch:string;
 sourceTotal:number;sourceObservedAt:string;sourceScopeComplete:boolean;directoryComplete:boolean;
};
export type AjesSourceCountSummary={
 total:number;stale:boolean;observedAt:string;upperBound:true;
 precision:'source-upper-bound';selectionScope:'source-candidates';sourceScopeComplete:boolean;
 sourceCountProof:AjesSourceCountProof;
};
export type AjesSourceCountBinding={
 requestedQueryHash:string;sourceQueryHash:string;evidenceEpoch:string;
 sourceScopeComplete:boolean;directoryComplete:boolean;
};
type SourceCount={total?:unknown;stale?:unknown;partial?:unknown;upperBound?:unknown;observedAt?:unknown};
const hash64=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const bindingValid=(binding:AjesSourceCountBinding)=>hash64(binding.requestedQueryHash)&&hash64(binding.sourceQueryHash)
 &&hash64(binding.evidenceEpoch)&&typeof binding.sourceScopeComplete==='boolean'&&typeof binding.directoryComplete==='boolean'
 &&(!binding.sourceScopeComplete||binding.directoryComplete);

/** Cache readers may supply their expected binding. UI callers can validate the
 * self-contained evidence without receiving SQL, editorial entries or secrets. */
export function isAjesSourceCountSummary(value:unknown,expected:Partial<AjesSourceCountBinding>={},now=Date.now()):value is AjesSourceCountSummary {
 if(!value||typeof value!=='object')return false;
 const summary=value as AjesSourceCountSummary,proof=summary.sourceCountProof;
 if(!proof||typeof proof!=='object'||proof.version!==1||proof.kind!=='japan-source-count'
  ||proof.predicateVersion!==AJES_SOURCE_COUNT_PREDICATE_VERSION||!bindingValid(proof))return false;
 if(!Number.isSafeInteger(summary.total)||summary.total<0||typeof summary.stale!=='boolean'
  ||summary.upperBound!==true||summary.precision!=='source-upper-bound'||summary.selectionScope!=='source-candidates'
  ||summary.sourceScopeComplete!==proof.sourceScopeComplete||summary.total!==proof.sourceTotal
  ||typeof summary.observedAt!=='string'||summary.observedAt!==proof.sourceObservedAt)return false;
 const age=now-Date.parse(summary.observedAt);
 if(!Number.isFinite(now)||!Number.isFinite(age)||age<0||age>=(summary.stale?AJES_SOURCE_COUNT_RETAINED_MS:AJES_SOURCE_COUNT_FRESH_MS))return false;
 for(const key of ['requestedQueryHash','sourceQueryHash','evidenceEpoch','sourceScopeComplete','directoryComplete'] as const)
  if(expected[key]!==undefined&&proof[key]!==expected[key])return false;
 return true;
}

export function createAjesSourceCountSummary(source:SourceCount,binding:AjesSourceCountBinding,now=Date.now()):AjesSourceCountSummary {
 if(!source||typeof source!=='object'||!bindingValid(binding)||source.partial===true||source.upperBound===true
  ||typeof source.stale!=='boolean'||!Number.isSafeInteger(source.total)||Number(source.total)<0||typeof source.observedAt!=='string')
  throw Error('ajes_source_count_invalid');
 const proof:AjesSourceCountProof={
  version:1,kind:'japan-source-count',predicateVersion:AJES_SOURCE_COUNT_PREDICATE_VERSION,
  ...binding,sourceTotal:source.total as number,sourceObservedAt:source.observedAt,
 };
 const result:AjesSourceCountSummary={total:proof.sourceTotal,stale:source.stale,observedAt:proof.sourceObservedAt,
  upperBound:true,precision:'source-upper-bound',selectionScope:'source-candidates',sourceScopeComplete:proof.sourceScopeComplete,
  sourceCountProof:proof,
 };
 if(!isAjesSourceCountSummary(result,binding,now))throw Error('ajes_source_count_invalid');
 Object.freeze(result.sourceCountProof);
 return Object.freeze(result);
}

