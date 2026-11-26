import {createHash,randomUUID} from 'node:crypto';

export const AJES_READ_DISPOSITIONS=['source','source_recovery','memory_cache','saved_cache','cooldown_recovery','local_recovery','policy_empty','shared_or_cached','rejected','unavailable'] as const;
export const AJES_READ_REASONS=['client_ip_missing','not_configured','market_not_supported','invalid_query','visitor_restricted','request_failed','request_timeout','connect_timeout','response_too_large','query_too_large','empty_response','invalid_response','identity_mismatch','quota_invalid','quota_exhausted','quota_busy','local_busy','directory_unavailable','cursor_expired','source_disabled','operation_failed'] as const;
type Kind='list'|'detail'|'count'|'models'|'makes'|'colors';
type Disposition=typeof AJES_READ_DISPOSITIONS[number];
type Reason=typeof AJES_READ_REASONS[number]|`http_${number}`;
type QueryIdentity={table:'stats'|'main';kind:Kind;page:number;pageSize:number;canonicalQuerySha256:string;wireQuerySha256:string};
type EmptyIdentity={table:null;kind:null;page:null;pageSize:null;canonicalQuerySha256:null;wireQuerySha256:null};
export const AJES_RESPONSE_COLUMNS=['id','year','auction_type','status','finish','marka_name','model_name','grade','pw','auction_date','time','kpp','priv','kuzov','color','eng_v','mileage','rate','serial','lot'] as const;
export const AJES_RESPONSE_FUNCTIONS=['concat_ws','length','trim','count'] as const;
const responseMimes=['json','html','text','other','missing'] as const;
const responseEncodings=['identity','gzip','other','missing'] as const;
const responseClasses=['empty','bot_refusal','ban_refusal','sql_syntax','sql_unknown_column','sql_unsupported_function','json_unclassified','html_unclassified','text_unclassified','binary_unclassified','unclassified'] as const;
const responseStatuses=['complete','limit','chunk_limit','timeout','aborted','read_error','no_body'] as const;
export type AjesResponseEvidence={version:1;mime:typeof responseMimes[number];encoding:typeof responseEncodings[number];bodyClass:typeof responseClasses[number];
 bytesRead:number;truncated:boolean;readStatus:typeof responseStatuses[number];identifier?:typeof AJES_RESPONSE_COLUMNS[number]|typeof AJES_RESPONSE_FUNCTIONS[number]};
type Attempt={startedAt:string;finishedAt:string;httpStatus:number|null;responseEvidence?:AjesResponseEvidence};
export type AjesCooldownOrigin=QueryIdentity&{runtimeSha:string|null;attemptStartedAt:string;attemptFinishedAt:string;httpStatus:number|null;reason:Reason};
export type AjesSourceReadReceipt=(QueryIdentity|EmptyIdentity)&{
 version:1;readId:string;runtimeSha:string|null;readStartedAt:string;readFinishedAt:string;
 disposition:Disposition;sourceAttempted:boolean|null;reason:Reason|null;sourceAttempt:Attempt|null;cooldownOrigin?:AjesCooldownOrigin;emptyValidation?:true;
};

const kinds=['list','detail','count','models','makes','colors'];
const sha=(value:unknown,size:number)=>typeof value==='string'&&new RegExp(`^[a-f0-9]{${size}}$`).test(value);
const runtimeSha=()=>sha(process.env.AVTOCENA_RELEASE_SHA,40)?process.env.AVTOCENA_RELEASE_SHA!:null;
const iso=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const status=(value:unknown)=>value===null||Number.isInteger(value)&&Number(value)>=100&&Number(value)<=599;
/** These categories describe observed response markers, never a proven cause.
 * Snapshot data properties once: even a hostile getter must not reach output. */
export function copyAjesResponseEvidence(value:unknown):AjesResponseEvidence|undefined {
 try{
  if(!value||typeof value!=='object'||Array.isArray(value))return;
  const required=['version','mime','encoding','bodyClass','bytesRead','truncated','readStatus'];
  const descriptors=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(descriptors);
  if(required.some(key=>!Object.hasOwn(descriptors,key))||names.some(key=>typeof key!=='string'||!required.includes(key)&&key!=='identifier')
   ||names.some(key=>!Object.hasOwn(descriptors[key as string],'value')))return;
  const v=Object.fromEntries(names.map(key=>[key,descriptors[key as string].value]));
  if(v.version!==1||!(responseMimes as readonly unknown[]).includes(v.mime)||!(responseEncodings as readonly unknown[]).includes(v.encoding)
   ||!(responseClasses as readonly unknown[]).includes(v.bodyClass)||!(responseStatuses as readonly unknown[]).includes(v.readStatus)
   ||!Number.isSafeInteger(v.bytesRead)||v.bytesRead<0||v.bytesRead>4096||typeof v.truncated!=='boolean')return;
  if(v.readStatus==='limit'&&(v.bytesRead!==4096||v.truncated!==true)
   ||v.readStatus==='complete'&&v.truncated!==false
   ||v.readStatus==='no_body'&&(v.bytesRead!==0||v.truncated!==false||v.bodyClass!=='empty')
   ||['chunk_limit','timeout','aborted','read_error'].includes(v.readStatus)&&v.truncated!==true)return;
  if(v.identifier!==undefined&&(v.truncated||!(v.bodyClass==='sql_unknown_column'?(AJES_RESPONSE_COLUMNS as readonly unknown[]).includes(v.identifier)
   :v.bodyClass==='sql_unsupported_function'&&(AJES_RESPONSE_FUNCTIONS as readonly unknown[]).includes(v.identifier))))return;
  return {version:1,mime:v.mime,encoding:v.encoding,bodyClass:v.bodyClass,bytesRead:v.bytesRead,truncated:v.truncated,readStatus:v.readStatus,
   ...(v.identifier===undefined?{}:{identifier:v.identifier})};
 }catch{return undefined;}
}
export function ajesReadReason(value:unknown):Reason|null {
 return typeof value==='string'&&((AJES_READ_REASONS as readonly string[]).includes(value)||/^http_[1-5]\d{2}$/.test(value))?value as Reason:null;
}
function queryIdentity(value:any):QueryIdentity|EmptyIdentity|undefined {
 const keys=['table','kind','page','pageSize','canonicalQuerySha256','wireQuerySha256'];
 if(keys.every(key=>value?.[key]===null))return {table:null,kind:null,page:null,pageSize:null,canonicalQuerySha256:null,wireQuerySha256:null};
 if(!value||!['stats','main'].includes(value.table)||!kinds.includes(value.kind)||!Number.isSafeInteger(value.page)||value.page<1||value.page>1000000||!Number.isSafeInteger(value.pageSize)
  ||(value.kind==='list'?value.pageSize<1||value.pageSize>48:['detail','count'].includes(value.kind)?value.pageSize!==1:value.pageSize!==500)
  ||!sha(value.canonicalQuerySha256,64)||!sha(value.wireQuerySha256,64))return;
 return {table:value.table,kind:value.kind,page:value.page,pageSize:value.pageSize,canonicalQuerySha256:value.canonicalQuerySha256,wireQuerySha256:value.wireQuerySha256};
}
function copyOrigin(value:any):AjesCooldownOrigin|undefined {
 const query=queryIdentity(value),reason=ajesReadReason(value?.reason);
 if(!query?.table||!(value.runtimeSha===null||sha(value.runtimeSha,40))||!iso(value.attemptStartedAt)||!iso(value.attemptFinishedAt)||value.attemptFinishedAt<value.attemptStartedAt||!status(value.httpStatus)||!reason)return;
 return {...query,runtimeSha:value.runtimeSha,attemptStartedAt:value.attemptStartedAt,attemptFinishedAt:value.attemptFinishedAt,httpStatus:value.httpStatus,reason};
}
/** Copy only the public receipt contract. No request object, SQL, visitor key,
 * arbitrary error text or persisted supplier diagnostic can cross this boundary. */
export function copyAjesSourceReadReceipt(value:unknown):AjesSourceReadReceipt|undefined {
 try{
 const v=value as any,query=queryIdentity(v);
 if(!query||v.version!==1||typeof v.readId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v.readId)
  ||!(v.runtimeSha===null||sha(v.runtimeSha,40))||!iso(v.readStartedAt)||!iso(v.readFinishedAt)||v.readFinishedAt<v.readStartedAt
  ||!(AJES_READ_DISPOSITIONS as readonly string[]).includes(v.disposition)||![true,false,null].includes(v.sourceAttempted)
  ||v.reason!==null&&!ajesReadReason(v.reason)||v.emptyValidation!==undefined&&v.emptyValidation!==true)return;
 let sourceAttempt:Attempt|null=null;
 if(v.sourceAttempted===true){
  const a=v.sourceAttempt;
  if(!a||!iso(a.startedAt)||!iso(a.finishedAt)||a.startedAt<v.readStartedAt||a.finishedAt<a.startedAt||a.finishedAt>v.readFinishedAt||!status(a.httpStatus))return;
  sourceAttempt={startedAt:a.startedAt,finishedAt:a.finishedAt,httpStatus:a.httpStatus};
  if(a.responseEvidence!==undefined){
   if(a.httpStatus===null||a.httpStatus>=200&&a.httpStatus<=299)return;
   const responseEvidence=copyAjesResponseEvidence(a.responseEvidence);if(!responseEvidence)return;
   sourceAttempt.responseEvidence=responseEvidence;
  }
 }else if(v.sourceAttempt!==null)return;
 if(v.disposition==='shared_or_cached'?v.sourceAttempted!==null:['source','source_recovery'].includes(v.disposition)?v.sourceAttempted!==true:v.disposition!=='unavailable'&&v.sourceAttempted!==false)return;
 const origin=v.cooldownOrigin===undefined?undefined:copyOrigin(v.cooldownOrigin);
 if(v.cooldownOrigin!==undefined&&!origin)return;
 return {...query,version:1,readId:v.readId,runtimeSha:v.runtimeSha,readStartedAt:v.readStartedAt,readFinishedAt:v.readFinishedAt,disposition:v.disposition,sourceAttempted:v.sourceAttempted,
  reason:v.reason,sourceAttempt,...(origin?{cooldownOrigin:origin}:{}),...(v.emptyValidation===true?{emptyValidation:true}:{})};
 }catch{return undefined;}
}
export function ajesSourceReadReceiptFromError(error:unknown){
 try{return error&&typeof error==='object'?copyAjesSourceReadReceipt((error as any).sourceReadReceipt):undefined;}catch{return undefined;}
}

/** Per invocation only. Never put this mutable recorder or its receipt in a
 * source, prepared, visitor or continuation cache. */
export type AjesReadEvidence={
 readId:string;runtimeSha:string|null;readStartedAt:string;query:QueryIdentity|EmptyIdentity;
 disposition?:Disposition;enteredSourceCache?:boolean;loaderStarted?:boolean;recovery?:boolean;emptyValidation?:true;
 reason:Reason|null;attempt:{startedAt:string;finishedAt:string|null;httpStatus:number|null;responseEvidence?:AjesResponseEvidence}|null;cooldownOrigin?:AjesCooldownOrigin;
};
export function beginAjesReadEvidence():AjesReadEvidence {
 return {readId:randomUUID(),runtimeSha:runtimeSha(),readStartedAt:new Date().toISOString(),query:{table:null,kind:null,page:null,pageSize:null,canonicalQuerySha256:null,wireQuerySha256:null},reason:null,attempt:null};
}
export function ajesReadQueryIdentity(query:{table:'stats'|'main';kind:Kind;page:number;pageSize:number;sql:string},canonicalSql:string):QueryIdentity {
 const hash=(sql:string)=>createHash('sha256').update(sql).digest('hex');
 return {table:query.table,kind:query.kind,page:query.page,pageSize:query.pageSize,canonicalQuerySha256:hash(canonicalSql),wireQuerySha256:hash(query.sql)};
}
export function ajesCooldownOrigin(query:Parameters<typeof ajesReadQueryIdentity>[0],canonicalSql:string,attempt:Attempt,reason:unknown):AjesCooldownOrigin|undefined {
 return copyOrigin({...ajesReadQueryIdentity(query,canonicalSql),runtimeSha:runtimeSha(),attemptStartedAt:attempt.startedAt,attemptFinishedAt:attempt.finishedAt,httpStatus:attempt.httpStatus,reason});
}
export function finishAjesReadEvidence(value:AjesReadEvidence,failed=false,reason?:unknown):AjesSourceReadReceipt|undefined {
 const readFinishedAt=new Date().toISOString();
 const sourceAttempt=value.attempt?{...value.attempt,finishedAt:value.attempt.finishedAt||readFinishedAt}:null;
 const shared=!value.disposition&&value.enteredSourceCache&&!value.loaderStarted&&!sourceAttempt;
 const sourceAttempted=sourceAttempt?true:shared?null:false;
 const disposition:Disposition=failed?'unavailable':sourceAttempt?(value.recovery?'source_recovery':'source'):value.disposition||(shared?'shared_or_cached':value.recovery?'local_recovery':'rejected');
 return copyAjesSourceReadReceipt({...value.query,version:1,readId:value.readId,runtimeSha:value.runtimeSha,readStartedAt:value.readStartedAt,readFinishedAt,
  disposition,sourceAttempted,reason:reason===undefined?value.reason:ajesReadReason(reason)||'operation_failed',sourceAttempt,...(value.cooldownOrigin?{cooldownOrigin:value.cooldownOrigin}:{}),...(value.emptyValidation?{emptyValidation:true}:{})});
}
