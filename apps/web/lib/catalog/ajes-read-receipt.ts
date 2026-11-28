import {randomUUID} from 'node:crypto';

const reasons=new Set(['client_ip_missing','visitor_restricted','not_configured','request_failed','request_timeout','connect_timeout','quota_exhausted','quota_busy','quota_invalid','invalid_response','empty_response','response_too_large','identity_mismatch','query_too_large','directory_unavailable','directory_too_large','directory_page_repeated','local_busy','market_not_supported']);
/** Only a fixed application code or an HTTP status may cross the public boundary. */
export function ajesPublicFailureReason(value:unknown):string {
 return typeof value==='string'&&(reasons.has(value)||/^http_[45]\d\d$/.test(value))?value:'operation_failed';
}
type Stage='query'|'access'|'storage'|'supplier'|'empty_verification'|'cooldown'|'queue';
type Kind='list'|'detail'|'count'|'models'|'makes'|'colors'|'census';
type Query={queryHash:string;table:'stats'|'main';kind:Kind;page:number;pageSize:number};
export type AjesReadTrace={requestId:string;startedAt:string;stage:Stage;supplierAttempted:boolean;reason?:string;query?:Query};
export type AjesReadReceipt=Query&{
 version:1;requestId:string;startedAt:string;finishedAt:string;stage:Stage;supplierAttempted:boolean;
 outcome:'fresh'|'stale'|'partial'|'unavailable';reason?:string;observedAt?:string;
};
export function startAjesReadTrace():AjesReadTrace {
 return {requestId:randomUUID(),startedAt:new Date().toISOString(),stage:'query',supplierAttempted:false};
}
/** Receipts describe this read, outside the source caches and their original
 * observation dates. No supplier text, query, address or body is copied. */
export function finishAjesReadReceipt(trace:AjesReadTrace,value?:any):AjesReadReceipt|undefined {
 if(!trace.query)return undefined;
 return {version:1,...trace.query,requestId:trace.requestId,startedAt:trace.startedAt,finishedAt:new Date().toISOString(),
  stage:trace.stage,supplierAttempted:trace.supplierAttempted,
  outcome:value===undefined?'unavailable':value.stale?'stale':value.partial?'partial':'fresh',
  ...(trace.reason?{reason:ajesPublicFailureReason(trace.reason)}:{}),
  ...(typeof value?.observedAt==='string'&&isoDate(value.observedAt)?{observedAt:value.observedAt}:{})};
}
const isoDate=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value));
/** Error objects can come from other layers; project a validated finite shape. */
export function publicAjesReadReceipt(value:unknown):AjesReadReceipt|undefined {
 const r=value as AjesReadReceipt|undefined;
 if(!r||r.version!==1||!/^[a-f0-9-]{36}$/.test(r.requestId)||!/^[a-f0-9]{64}$/.test(r.queryHash)
  ||!['stats','main'].includes(r.table)||!['list','detail','count','models','makes','colors','census'].includes(r.kind)
  ||!Number.isSafeInteger(r.page)||r.page<1||r.page>1000000||!Number.isSafeInteger(r.pageSize)||r.pageSize<1||r.pageSize>500
  ||!isoDate(r.startedAt)||!isoDate(r.finishedAt)||!['query','access','storage','supplier','empty_verification','cooldown','queue'].includes(r.stage)
  ||typeof r.supplierAttempted!=='boolean'||!['fresh','stale','partial','unavailable'].includes(r.outcome))return undefined;
 return {version:1,requestId:r.requestId,queryHash:r.queryHash,table:r.table,kind:r.kind,page:r.page,pageSize:r.pageSize,
  startedAt:r.startedAt,finishedAt:r.finishedAt,stage:r.stage,supplierAttempted:r.supplierAttempted,outcome:r.outcome,
  ...(r.reason?{reason:ajesPublicFailureReason(r.reason)}:{}),...(isoDate(r.observedAt)?{observedAt:r.observedAt}:{})};
}
