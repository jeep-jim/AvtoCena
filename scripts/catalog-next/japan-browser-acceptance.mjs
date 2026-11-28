import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {JAPAN_PAGINATION_CODE_SCOPE} from './japan-pagination-code-scope.mjs';
import {JAPAN_STABILITY_CODE_SCOPE} from './japan-stability-code-scope.mjs';
import {JAPAN_STABILITY_GATES, JAPAN_LEGACY_MAZDA_THREE_PAGES, japanStabilityApiAllowed, japanStabilitySearchApi, runJapanStabilityBrowser,
 checkJapanStabilityBrandControl,verifyJapanStabilityBrandRequestCount} from './japan-stability-browser.mjs';
import {JAPAN_PRICE_SORT_GATES, japanPriceSortApiAllowed, verifyJapanPriceSortVisible} from './japan-price-sort-browser.mjs';
import {japanSourcePriceOrderRequirement, japanSourcePriceApiAllowed} from './japan-source-price-order-browser.mjs';
import {JAPAN_EXACT_COUNT_GATES, JAPAN_MODEL_COVERAGE_GATES, JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE,
 japanExactCountRequirement, japanModelCoverageRequirement, japanExactCountApiAllowed, japanModelCoverageApiAllowed,
 verifyJapanExactCount, verifyJapanExactCountStable, runJapanExactCountBrowser, runJapanModelCoverageBrowser} from './japan-exact-count-browser.mjs';
export {japanExactCountRequirement, japanModelCoverageRequirement} from './japan-exact-count-browser.mjs';
import {JAPAN_SOURCE_COUNT_ACCEPTANCE, JAPAN_SOURCE_COUNT_GATES, JAPAN_A4_POWER160_CONTINUATION_GATES,
 japanSourceCountRequirement, japanA4Power160ContinuationRequirement,
 japanSourceCountApiAllowed, verifyJapanSourceCountSummary, runJapanSourceCountBrowser} from './japan-source-count-browser.mjs';
export {japanSourceCountRequirement, japanA4Power160ContinuationRequirement} from './japan-source-count-browser.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const ORIGIN='https://avtocena.com';
const SCOPE='catalog-japan-recovery-v1';
const COMPLETION_SCOPE='catalog-japan-completion-v1';
const COMPLETION_V2_SCOPE='catalog-japan-completion-v2';
const USABILITY_SCOPE='catalog-japan-usability-v1';
const USABILITY_GATES=['japanBrandDirectoryPassed','japanFullPagesPassed','japanKnownPowerOrderPassed','japanVehiclePolicyPassed','japanQuietCatalogPassed'];
const CARD='article.ac-catalog-card,article.ac-catalog-list-row';
const CITY='Новокузнецк';
const QUERY=new URLSearchParams({market:'japan',page:'1',pageSize:'24',city:CITY});
const PLAIN='/api/catalog/search?'+QUERY;
const POWER=PLAIN+'&powerTo=160';
const PETROL_POWER=POWER+'&fuel=petrol';
const PETROL_POWER_NEXT=PETROL_POWER.replace('page=1&','page=2&');
const BRAND_DIRECTORY='/api/catalog/brand-counts?market=japan&directory=1';
export const JAPAN_OBSERVED_TIMING_POLICY='japan-functional-observed-timing-v1';
const sha=value=>createHash('sha256').update(value).digest('hex');
const need=(value,code)=>{if(!value)throw Error('japan_browser_'+code);};
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
export function japanPowerOrderRequirement(value){
 need(value===undefined||value==='0'||value==='1','power_order_option');
 return value==='1';
}
export function japanBrandDirectoryRequirement(value){
 need(value===undefined||value==='0'||value==='1','brand_directory_option');
 return value==='1';
}
export function japanPriceSortRequirement(value){
 need(value===undefined||value==='0'||value==='1','price_sort_option');
 return value==='1';
}
export function japanTimingPolicy(value){
 need(value===undefined||value===JAPAN_OBSERVED_TIMING_POLICY,'timing_policy');
 return value;
}

/** Timing observations describe completed or attempted functional journeys.
 * They never change the content verdict or claim a speed test passed. */
export function collectJapanObservedTimings(report){
 if(report.timingPolicy!==JAPAN_OBSERVED_TIMING_POLICY)return report;
 const samples=[];
 const observe=(phase,value)=>{
  if(!value||typeof value!=='object')return;
  const measured=Number.isFinite(value.durationMs)&&value.durationMs>=0;
  samples.push({phase,durationMs:measured?value.durationMs:null,measurement:measured?'observed':'unavailable'});
 };
 for(const row of report.checks?.health||[])
  if(['before','after'].includes(row?.stage))observe('health_'+row.stage,row);
 for(const row of report.checks?.responses||[])
  if(typeof row?.stage==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(row.stage))observe(row.stage,row);
 for(const key of ['ui','petrolPowerUi'])observe(key,report.checks?.[key]);
 for(const row of report.checks?.visibility||[])
  if(row?.path==='/'||row?.path==='/cars')observe(row.path==='/'?'home_visibility':'catalog_visibility',row);
 report.timings={version:1,unit:'ms',scope:'japan-functional-journeys',latencyThresholdApplied:false,samples};
 report.timingObserved=samples.length>0;
 report.speedGateRequired=false;report.speedPassed=null;
 return report;
}

/** A mixed overview may keep streaming unrelated sections. Under the Japan
 * policy, inspect the actual Japan rail after the response commits instead of
 * awaiting completion of every section's document lifecycle. */
export async function navigateJapanOverview(view,pathname,timingPolicy){
 need(pathname==='/'||pathname==='/cars','overview_path');
 japanTimingPolicy(timingPolicy);
 return view.goto(ORIGIN+pathname+'?'+new URLSearchParams({city:CITY}),
  {waitUntil:timingPolicy===JAPAN_OBSERVED_TIMING_POLICY?'commit':'domcontentloaded',timeout:90_000});
}
export function japanPetrolPowerUrl(value,pageNumber=1){
 let url;try{url=new URL(value,ORIGIN);}catch{return false;}
 return url.origin===ORIGIN&&(url.pathname==='/cars/japan'||url.pathname==='/cars'&&url.searchParams.get('market')==='japan')
  &&url.searchParams.get('fuel')==='petrol'&&url.searchParams.get('powerTo')==='160'
  &&url.searchParams.get('city')===CITY&&Number(url.searchParams.get('page')||'1')===pageNumber;
}

export function japanReleaseBinding(oracle,release,nonce){
 need(/^[a-f0-9]{40}$/.test(release||'')&&/^[a-f0-9]{32}$/.test(nonce||''),'arguments');
 need(oracle?.version===1&&oracle.runtimeSha===release
  &&/^gen_china_[0-9]+_[0-9]+$/.test(oracle.expectedGeneration||'')
  &&/^[a-f0-9]{64}$/.test(oracle.generationManifestSha256||''),'oracle_binding');
 return {generationId:oracle.expectedGeneration,generationManifestSha256:oracle.generationManifestSha256};
}

/** The required petrol and fixed combined journeys have narrower supplier predicates than local
 * enrichment. It can prove fresh complete source pages while deliberately
 * leaving the complete user selection unknown. Only the finite page receipts
 * distinguish that limitation from a supplier failure or stale fallback. */
export function verifyJapanSourceScopePage(payload,{query,countAcceptance,now=Date.now()}={}){
 need([JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE,JAPAN_SOURCE_COUNT_ACCEPTANCE].includes(countAcceptance),'source_scope_profile');
 let url;try{url=new URL(query,ORIGIN);}catch{need(false,'source_scope_query');}
 const params=url.searchParams,page=Number(params.get('page'));
 const combined=query===japanStabilitySearchApi('combined');
 need(url.origin===ORIGIN&&url.pathname==='/api/catalog/search'&&!url.username&&!url.password&&!url.hash
  &&[...params.keys()].every(key=>(combined?['market','page','pageSize','city','powerTo','fuel','auctionGrade','transmission']
   :['market','page','pageSize','city','powerTo','fuel','after']).includes(key)&&params.getAll(key).length===1)
  &&params.get('market')==='japan'&&params.get('city')===CITY&&params.get('fuel')==='petrol'
  &&params.get('powerTo')==='160'&&params.get('pageSize')==='24'&&[1,2].includes(page)
  &&payload.page===page&&payload.pageSize===24,'source_scope_query');
 if(page===1)need(!params.has('after'),'source_scope_query');
 else checkedJapanPaginationCursor(params.get('after'),page,{requirePowerOrder:true});
 need(payload.partial===true&&payload.selectionIncomplete===false&&payload.stale===false
  &&payload.interrupted===false&&payload.scanLimited===false&&payload.total===null
  &&(payload.countSummary===null||countAcceptance===JAPAN_SOURCE_COUNT_ACCEPTANCE&&Boolean(verifyJapanSourceCountSummary(payload.countSummary,{query,now})))
  &&Array.isArray(payload.items)&&payload.items.length>0&&payload.items.length<=24
  &&typeof payload.hasMore==='boolean'&&(!payload.hasMore||payload.items.length===24)
  &&Number.isSafeInteger(payload.reads)&&payload.reads>=1&&payload.reads<=8,'source_scope_partial');
 if(payload.hasMore)checkedJapanPaginationCursor(payload.nextCursor,page+1,{requirePowerOrder:true});
 else need(payload.nextCursor===null,'source_scope_cursor');
 const evidence=japanPageReadEvidence(payload);
 need(evidence.status==='recorded'&&!evidence.limited&&evidence.omitted===0
  &&evidence.receipts.length===payload.reads&&evidence.receipts.every(receipt=>
   receipt.table==='stats'&&receipt.kind==='list'&&receipt.pageSize===24&&receipt.outcome==='fresh'
   &&receipt.reason===undefined&&Number.isFinite(Date.parse(receipt.observedAt))
   &&Date.parse(receipt.observedAt)<=now+60_000&&now-Date.parse(receipt.observedAt)<30*60_000),
 'source_scope_receipts');
 need(Date.parse(payload.observedAt)===Math.min(...evidence.receipts.map(receipt=>Date.parse(receipt.observedAt))),
  'source_scope_observation');
 return {partial:true,selectionComplete:false,limitation:'source_scope_unproven',
  freshSourcePages:evidence.receipts.length,sourcePagesComplete:true,fullSelectionExhaustionClaimed:false};
}

export function verifyJapanPage(payload,status,now=Date.now(),{countAcceptance,query}={}){
 need(countAcceptance===undefined||[JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE,JAPAN_SOURCE_COUNT_ACCEPTANCE].includes(countAcceptance),'count_acceptance');
 need(status===200&&payload?.ok===true,'http');
 const observed=Date.parse(payload.observedAt||payload.generationId||'');
 const sourceScope=payload.partial===true&&[JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE,JAPAN_SOURCE_COUNT_ACCEPTANCE].includes(countAcceptance)
  ?verifyJapanSourceScopePage(payload,{countAcceptance,query,now}):null;
 need(payload.stale===false&&(!payload.partial||sourceScope)&&!payload.interrupted&&!payload.scanLimited,'unavailable_or_stale');
 need(Number.isFinite(observed)&&observed<=now+60_000&&now-observed<30*60_000,'observation_expired');
 need(Array.isArray(payload.items)&&payload.items.length>0&&payload.items.length<=24
  &&payload.items.every(row=>row.market==='japan'&&/^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(row.id||''))
  &&new Set(payload.items.map(row=>row.id)).size===payload.items.length,'rows');
 return {status,shown:payload.items.length,received:payload.received??null,observedAt:new Date(observed).toISOString(),
  ageSeconds:Number(((now-observed)/1000).toFixed(3)),stale:false,partial:false,...sourceScope,
  total:Number.isSafeInteger(payload.total)?payload.total:null,hasMore:payload.hasMore===true};
}

/** Preserve only public response aggregates before validation can reject them.
 * An interrupted continuation must remain diagnosable without publishing rows,
 * supplier URLs, visitor data or arbitrary upstream error text. */
export function japanResponseObservation(payload,status){
 const natural=value=>Number.isSafeInteger(value)&&value>=0?value:null;
 const boolean=value=>typeof value==='boolean'?value:null;
 const sourceDate=payload?.observedAt||payload?.generationId;
 const observed=typeof sourceDate==='string'?Date.parse(sourceDate):NaN;
 return {status:Number.isInteger(status)&&status>=100&&status<=599?status:null,
  ok:boolean(payload?.ok),shown:Array.isArray(payload?.items)?payload.items.length:null,
  received:natural(payload?.received),observedAt:Number.isFinite(observed)?new Date(observed).toISOString():null,
  stale:boolean(payload?.stale),partial:boolean(payload?.partial),interrupted:boolean(payload?.interrupted),
  scanLimited:boolean(payload?.scanLimited),hasMore:boolean(payload?.hasMore),total:natural(payload?.total)};
}

/** Diagnostics must not copy opaque validators, proxy names, cookies or
 * arbitrary extension directives into the public acceptance artifact. */
export function japanResponseHeaders(headers){
 const result={},omitted=[];
 const read=name=>headers&&typeof headers==='object'?headers[name]:undefined;
 const bounded=value=>typeof value==='string'&&value.length<=512&&!/[\x00-\x1f\x7f]/.test(value);
 const natural=value=>/^(?:0|[1-9][0-9]{0,9})$/.test(value)&&Number(value)<=2147483647;
 const cache=read('cache-control');
 if(cache!==undefined){
  const allowed=new Set(['public','private','no-cache','no-store','must-revalidate','proxy-revalidate','immutable','no-transform','must-understand']);
  const numeric=new Set(['max-age','s-maxage','stale-while-revalidate','stale-if-error']);
  const safe=[];let invalid=!bounded(cache);
  if(!invalid){
   const parts=cache.split(',');invalid=parts.length>16;
   if(!invalid)for(const part of parts){
    const value=part.trim().toLowerCase(),match=/^([a-z-]+)=([0-9]+)$/.exec(value);
    if(allowed.has(value))safe.push(value);
    else if(match&&numeric.has(match[1])&&natural(match[2]))safe.push(match[1]+'='+Number(match[2]));
    else invalid=true;
   }
  }
  if(safe.length)result.cacheControl=[...new Set(safe)].join(', ');
  if(invalid)omitted.push('cache-control');
 }
 const age=read('age');
 if(age!==undefined){if(typeof age==='string'&&natural(age))result.ageSeconds=Number(age);else omitted.push('age');}
 const etag=read('etag');
 if(etag!==undefined){
  if(bounded(etag)&&etag.length<=256&&/^(?:W\/)?"[\x21\x23-\x7e]{1,250}"$/.test(etag))
   result.etag={weak:etag.startsWith('W/'),sha256:sha(etag)};
  else omitted.push('etag');
 }
 const via=read('via');
 if(via!==undefined){
  // Keep only protocol versions/count. The received-by token and comments can
  // contain internal hostnames and are never retained, even when well formed.
  const parts=bounded(via)?via.split(','):[],protocols=[];
  let valid=parts.length>0&&parts.length<=8;
  if(valid)for(const part of parts){
   const match=/^(?:HTTP\/)?(1\.0|1\.1|2|2\.0|3|3\.0) +[^\s(),]+(?: +\([^()]*\))?$/.exec(part.trim());
   if(!match){valid=false;break;}protocols.push(match[1]);
  }
  if(valid)result.via={hops:parts.length,protocols};else omitted.push('via');
 }
 return {...result,omitted};
}

function japanResponseTransport(response){
 const date=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000?new Date(value).toISOString():null;
 return {requestedAt:date(response.requestedAt),receivedAt:date(response.receivedAt),
  durationMs:Number.isFinite(response.durationMs)&&response.durationMs>=0?response.durationMs:null,
  responseHeaders:japanResponseHeaders(response.headers)};
}

const SOURCE_READ_LIMIT=8;
const sourceReadReasons=new Set(['client_ip_missing','not_configured','market_not_supported','invalid_query','visitor_restricted',
 'request_failed','request_timeout','connect_timeout','response_too_large','query_too_large','empty_response','invalid_response','identity_mismatch',
 'quota_invalid','quota_exhausted','quota_busy','local_busy','directory_unavailable','cursor_expired','source_disabled','operation_failed']);
const sourceReadDispositions=new Set(['source','source_recovery','memory_cache','saved_cache','cooldown_recovery','local_recovery',
 'policy_empty','shared_or_cached','rejected','unavailable']);
const receiptUuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const receiptHash=(value,length)=>value===null||typeof value==='string'&&new RegExp('^[a-f0-9]{'+length+'}$').test(value);
const receiptDate=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
 &&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const receiptReason=value=>value===null||typeof value==='string'&&(sourceReadReasons.has(value)||/^http_[1-5][0-9]{2}$/.test(value));
const receiptStatus=value=>value===null||Number.isInteger(value)&&value>=100&&value<=599;
const receiptKeys=(value,required,optional=[])=>value&&typeof value==='object'&&!Array.isArray(value)
 &&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const queryReceiptKeys=['table','kind','page','pageSize','canonicalQuerySha256','wireQuerySha256'];
const responseEvidenceKeys=['version','mime','encoding','bodyClass','bytesRead','truncated','readStatus'];
const responseEvidenceMimes=new Set(['json','html','text','other','missing']);
const responseEvidenceEncodings=new Set(['identity','gzip','other','missing']);
const responseEvidenceClasses=new Set(['empty','bot_refusal','ban_refusal','sql_syntax','sql_unknown_column',
 'sql_unsupported_function','json_unclassified','html_unclassified','text_unclassified','binary_unclassified','unclassified']);
const responseEvidenceReadStatuses=new Set(['complete','limit','chunk_limit','timeout','aborted','read_error','no_body']);
const responseEvidenceColumns=new Set(['id','year','auction_type','status','finish','marka_name','model_name','grade',
 'auction_date','time','kpp','priv','kuzov','color','eng_v','pw','mileage','rate','serial','lot']);
const responseEvidenceFunctions=new Set(['concat_ws','length','trim','count']);
/** The prefix itself is private. This optional observation contains only fixed
 * classes and the count of retained prefix bytes, never body text or its hash. */
function copyResponseEvidence(value,httpStatus){
 if(!Number.isInteger(httpStatus)||httpStatus<100||httpStatus>599||httpStatus>=200&&httpStatus<=299
  ||!receiptKeys(value,responseEvidenceKeys,['identifier']))return null;
 // Snapshot only data properties. An accessor must not pass an enum check and
 // then return private text when copied into the artifact.
 const fields={};
 for(const key of [...responseEvidenceKeys,...(Object.hasOwn(value,'identifier')?['identifier']:[])]){
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!Object.hasOwn(descriptor,'value'))return null;
  if(key!=='identifier'||descriptor.value!==undefined)fields[key]=descriptor.value;
 }
 if(fields.version!==1||!responseEvidenceMimes.has(fields.mime)||!responseEvidenceEncodings.has(fields.encoding)
  ||!responseEvidenceClasses.has(fields.bodyClass)||!Number.isSafeInteger(fields.bytesRead)||fields.bytesRead<0||fields.bytesRead>4096
  ||typeof fields.truncated!=='boolean'||!responseEvidenceReadStatuses.has(fields.readStatus))return null;
 if(fields.readStatus==='limit'&&(fields.bytesRead!==4096||fields.truncated!==true)
  ||fields.readStatus==='complete'&&fields.truncated!==false
  ||fields.readStatus==='no_body'&&(fields.bytesRead!==0||fields.truncated!==false||fields.bodyClass!=='empty')
  ||['chunk_limit','timeout','aborted','read_error'].includes(fields.readStatus)&&fields.truncated!==true)return null;
 if(Object.hasOwn(fields,'identifier')&&(fields.truncated===true
  ||!(fields.bodyClass==='sql_unknown_column'&&responseEvidenceColumns.has(fields.identifier)
   ||fields.bodyClass==='sql_unsupported_function'&&responseEvidenceFunctions.has(fields.identifier))))return null;
 return fields;
}
function receiptQuery(value,nullable=true){
 if(nullable&&queryReceiptKeys.every(key=>value[key]===null))return true;
 const size=value.kind==='list'?Number.isInteger(value.pageSize)&&value.pageSize>=1&&value.pageSize<=48
  :['detail','count'].includes(value.kind)?value.pageSize===1:['models','makes','colors'].includes(value.kind)&&value.pageSize===500;
 return ['stats','main'].includes(value.table)&&size&&Number.isInteger(value.page)&&value.page>=1&&value.page<=1_000_000
  &&typeof value.canonicalQuerySha256==='string'&&receiptHash(value.canonicalQuerySha256,64)
  &&typeof value.wireQuerySha256==='string'&&receiptHash(value.wireQuerySha256,64);
}
function copySourceReadReceipt(value){
 const keys=['version','readId','runtimeSha','readStartedAt','readFinishedAt',...queryReceiptKeys,'disposition','sourceAttempted','reason','sourceAttempt'];
 if(!receiptKeys(value,keys,['cooldownOrigin','emptyValidation'])||value.version!==1||!receiptUuid(value.readId)||!receiptHash(value.runtimeSha,40)
  ||!receiptDate(value.readStartedAt)||!receiptDate(value.readFinishedAt)||value.readStartedAt>value.readFinishedAt
  ||!receiptQuery(value)||!sourceReadDispositions.has(value.disposition)||![true,false,null].includes(value.sourceAttempted)
  ||!receiptReason(value.reason))return null;
 if(Object.hasOwn(value,'emptyValidation')&&value.emptyValidation!==true)return null;
 if(['source','source_recovery'].includes(value.disposition)&&value.sourceAttempted!==true
  ||value.disposition==='shared_or_cached'&&value.sourceAttempted!==null
  ||!['source','source_recovery','shared_or_cached','unavailable'].includes(value.disposition)&&value.sourceAttempted!==false)return null;
 let sourceAttempt=null;
 if(value.sourceAttempted===true){
  const attempt=value.sourceAttempt;
  if(!receiptKeys(attempt,['startedAt','finishedAt','httpStatus'],['responseEvidence'])||!receiptDate(attempt.startedAt)||!receiptDate(attempt.finishedAt)
   ||attempt.startedAt>attempt.finishedAt||attempt.startedAt<value.readStartedAt||attempt.finishedAt>value.readFinishedAt
   ||!receiptStatus(attempt.httpStatus))return null;
  sourceAttempt={startedAt:attempt.startedAt,finishedAt:attempt.finishedAt,httpStatus:attempt.httpStatus};
  if(attempt.responseEvidence!==undefined){
   const evidence=copyResponseEvidence(attempt.responseEvidence,attempt.httpStatus);if(!evidence)return null;
   sourceAttempt.responseEvidence=evidence;
  }
 }else if(value.sourceAttempt!==null)return null;
 let cooldownOrigin;
 if(Object.hasOwn(value,'cooldownOrigin')){
  const origin=value.cooldownOrigin,originKeys=['runtimeSha',...queryReceiptKeys,'attemptStartedAt','attemptFinishedAt','httpStatus','reason'];
  if(!receiptKeys(origin,originKeys)||!receiptHash(origin.runtimeSha,40)||!receiptQuery(origin,false)
   ||!receiptDate(origin.attemptStartedAt)||!receiptDate(origin.attemptFinishedAt)||origin.attemptStartedAt>origin.attemptFinishedAt
   ||!receiptStatus(origin.httpStatus)||origin.reason===null||!receiptReason(origin.reason))return null;
  cooldownOrigin=Object.fromEntries(originKeys.map(key=>[key,origin[key]]));
 }
 return {...Object.fromEntries(keys.filter(key=>key!=='sourceAttempt').map(key=>[key,value[key]])),sourceAttempt,
  ...(cooldownOrigin?{cooldownOrigin}:{}),...(value.emptyValidation===true?{emptyValidation:true}:{})};
}

/** Receipts are observational: malformed/missing evidence is reported as an
 * omission, never trusted as source success and never used to relax a gate. */
export function japanSourceReadEvidence(payload,expectedRelease){
 try{
 const wrapper=payload?.catalogReadReceipt,raw=payload?.sourceReadReceipts;
 const omissions=[],result={status:'omitted',catalogReadReceipt:null,runtimeMatchesExpected:null,
  sourceReadReceipts:[],sourceReadReceiptsLimited:true,omittedReceipts:Array.isArray(raw)?raw.length:null,omissions};
 const keys=['version','readId','runtimeSha','readStartedAt','readFinishedAt','sourceReadCalls'];
 if(!receiptKeys(wrapper,keys)||wrapper.version!==1||!receiptUuid(wrapper.readId)||!receiptHash(wrapper.runtimeSha,40)
  ||!receiptDate(wrapper.readStartedAt)||!receiptDate(wrapper.readFinishedAt)||wrapper.readStartedAt>wrapper.readFinishedAt
  ||!Number.isInteger(wrapper.sourceReadCalls)||wrapper.sourceReadCalls<0||wrapper.sourceReadCalls>SOURCE_READ_LIMIT){
  omissions.push(wrapper===undefined?'catalog_receipt_missing':'catalog_receipt_malformed');
  if(wrapper===undefined&&raw===undefined)result.status='missing';
  return result;
 }
 result.catalogReadReceipt=Object.fromEntries(keys.map(key=>[key,wrapper[key]]));
 result.runtimeMatchesExpected=typeof wrapper.runtimeSha==='string'&&typeof expectedRelease==='string'&&receiptHash(expectedRelease,40)
  ?wrapper.runtimeSha===expectedRelease:null;
 if(!Array.isArray(raw)){omissions.push(raw===undefined?'source_receipts_missing':'source_receipts_malformed');return result;}
 const identities=new Set();
 for(const item of raw.slice(0,SOURCE_READ_LIMIT)){
  const receipt=copySourceReadReceipt(item);
  if(!receipt){omissions.push('source_receipt_malformed');continue;}
  if(identities.has(receipt.readId)){omissions.push('source_receipt_duplicate');continue;}
  identities.add(receipt.readId);result.sourceReadReceipts.push(receipt);
 }
 if(raw.length>SOURCE_READ_LIMIT)omissions.push('source_receipt_limit');
 if(raw.length!==wrapper.sourceReadCalls)omissions.push('source_read_calls_mismatch');
 if(typeof payload.sourceReadReceiptsLimited!=='boolean')omissions.push('source_receipts_limited_unknown');
 else if(payload.sourceReadReceiptsLimited)omissions.push('source_receipts_limited');
 result.omittedReceipts=raw.length-result.sourceReadReceipts.length;
 result.sourceReadReceiptsLimited=payload.sourceReadReceiptsLimited!==false||omissions.length>0;
 result.omissions=[...new Set(omissions)];
 result.status=result.sourceReadReceiptsLimited?'partial':'recorded';
 return result;
 }catch{
  return {status:'omitted',catalogReadReceipt:null,runtimeMatchesExpected:null,sourceReadReceipts:[],
   sourceReadReceiptsLimited:true,omittedReceipts:null,omissions:['source_evidence_malformed']};
 }
}

export function recordJapanResponse(report,stage,response,expectedRelease){
 const observed={stage,...japanResponseObservation(response.data,response.status),...japanResponseTransport(response),
  sourceReadEvidence:japanSourceReadEvidence(response.data,expectedRelease),
  pageReadEvidence:japanPageReadEvidence(response.data)};
 (report.checks.responses??=[]).push(observed);
 return observed;
}

/** The current query client emits one finite receipt per actual source page,
 * including a later refill failure. Retain only its public schema. When a
 * response has unusually many reads, keep the beginning and ending (including
 * the final failure), explicitly mark the omission, and never claim freshness
 * or source success merely because a receipt exists. */
export function japanPageReadEvidence(payload){
 const required=['version','requestId','queryHash','table','kind','page','pageSize','startedAt','finishedAt',
  'stage','supplierAttempted','outcome'];
 const optional=['reason','observedAt'];
 const reasons=new Set([...sourceReadReasons,'directory_too_large','directory_page_repeated']);
 const iso=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)
  &&Number.isFinite(Date.parse(value));
 const safeReason=value=>typeof value==='string'&&(reasons.has(value)||/^http_[45]\d\d$/.test(value));
 const topReason=Object.getOwnPropertyDescriptor(payload??{},'reason')?.value;
 const reason=safeReason(topReason)?{reason:topReason}:{};
 const empty={status:'missing',receipts:[],received:0,omitted:0,limited:false,...reason};
 try{
  const raw=Array.isArray(payload?.sourceReceipts)?payload.sourceReceipts:payload?.sourceReceipt!==undefined?[payload.sourceReceipt]:[];
  if(!raw.length)return empty;
  const selected=raw.length>16?[...raw.slice(0,8),...raw.slice(-8)]:raw;
  const receipts=[],seen=new Set();
  for(const original of selected){
   if(!original||typeof original!=='object'||Array.isArray(original))continue;
   const descriptors=Object.getOwnPropertyDescriptors(original),keys=Reflect.ownKeys(descriptors);
   if(!required.every(key=>Object.hasOwn(descriptors[key]??{},'value'))
    ||keys.some(key=>typeof key!=='string'||![...required,...optional].includes(key)||!Object.hasOwn(descriptors[key],'value')))continue;
   const row=Object.fromEntries(keys.map(key=>[key,descriptors[key].value]));
   if(row.version!==1||!receiptUuid(row.requestId)||!receiptHash(row.queryHash,64)||typeof row.queryHash!=='string'
    ||!['stats','main'].includes(row.table)||!['list','detail','count','models','makes','colors'].includes(row.kind)
    ||!Number.isSafeInteger(row.page)||row.page<1||row.page>1_000_000
    ||!Number.isSafeInteger(row.pageSize)||row.pageSize<1||row.pageSize>500
    ||!iso(row.startedAt)||!iso(row.finishedAt)||Date.parse(row.startedAt)>Date.parse(row.finishedAt)
    ||!['query','access','storage','supplier','empty_verification','cooldown','queue'].includes(row.stage)
    ||typeof row.supplierAttempted!=='boolean'||!['fresh','stale','partial','unavailable'].includes(row.outcome)
    ||Object.hasOwn(row,'reason')&&!safeReason(row.reason)||Object.hasOwn(row,'observedAt')&&!iso(row.observedAt)
    ||seen.has(row.requestId))continue;
   seen.add(row.requestId);receipts.push(row);
  }
  const omitted=raw.length-receipts.length;
  return {status:omitted?'partial':'recorded',receipts,received:raw.length,omitted,limited:omitted>0,...reason};
 }catch{return {...empty,status:'omitted',limited:true};}
}

const SSR_EVIDENCE_ATTRIBUTE='data-japan-source-receipts';
const SSR_EVIDENCE_BYTES=8192,SSR_EVIDENCE_LIMIT=8;
function ssrBinding({page,after=''}){
 return Number.isSafeInteger(page)&&page>=1&&page<=1_000_000&&typeof after==='string'&&after.length<=512
  ?{page,afterSha256:sha(after)}:null;
}

/** The inert annotation is evidence from an already performed SSR read. It is
 * never a replacement for the catalog, freshness or visible-card gates. */
export function japanSsrPageReadEvidence(raw,expected){
 const binding=ssrBinding(expected??{});
 const missing=code=>({status:code==='annotation_missing'?'missing':'omitted',
  page:binding?.page??null,afterSha256:binding?.afterSha256??null,bindingMatched:false,
  receipts:[],received:0,omitted:0,limited:true,omissions:[code]});
 if(!binding)return missing('binding_invalid');
 if(raw===null||raw===undefined)return missing('annotation_missing');
 if(typeof raw!=='string'||Buffer.byteLength(raw)>SSR_EVIDENCE_BYTES)return missing('annotation_size_or_type');
 let value;try{value=JSON.parse(raw);}catch{return missing('annotation_malformed');}
 if(!receiptKeys(value,['version','page','afterSha256','receipts','omitted'])||value.version!==1
  ||!Number.isSafeInteger(value.page)||value.page<1||value.page>1_000_000
  ||typeof value.afterSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.afterSha256)
  ||!Array.isArray(value.receipts)||value.receipts.length>SSR_EVIDENCE_LIMIT
  ||!Number.isSafeInteger(value.omitted)||value.omitted<0||value.omitted>1_000_000)return missing('annotation_malformed');
 if(value.page!==binding.page||value.afterSha256!==binding.afterSha256)return missing('binding_mismatch');
 const projected=japanPageReadEvidence({sourceReceipts:value.receipts}),omitted=value.omitted+projected.omitted;
 return {...binding,bindingMatched:true,status:omitted?'partial':projected.status,
  receipts:projected.receipts,received:value.receipts.length+value.omitted,omitted,limited:omitted>0,
  omissions:projected.omitted?['receipt_omitted']:[]};
}

/** Wait for the actual new main element, not merely a changed URL. Read only
 * its bounded attribute; do not collect a DOM/response dump or add a request.
 * Missing observational metadata is explicit and does not alter acceptance.
 */
export async function readJapanSsrPageEvidence(view,expected){
 const binding=ssrBinding(expected??{});
 if(!binding)return japanSsrPageReadEvidence(undefined,expected);
 let handle;
 try{
  handle=await view.waitForFunction(({attribute,maximum,page,afterSha256})=>{
   const nodes=document.querySelectorAll('main.ac-ajes-catalog');
   if(nodes.length!==1)return false;
   const raw=nodes[0].getAttribute(attribute);
   if(typeof raw!=='string'||raw.length>maximum)return false;
   try{const value=JSON.parse(raw);return value?.version===1&&value.page===page&&value.afterSha256===afterSha256?raw:false;}
   catch{return false;}
  },{attribute:SSR_EVIDENCE_ATTRIBUTE,maximum:SSR_EVIDENCE_BYTES,...binding},{timeout:5000});
  return japanSsrPageReadEvidence(await handle.jsonValue(),expected);
 }catch{
  return {...japanSsrPageReadEvidence(undefined,expected),omissions:['bound_dom_not_observed']};
 }finally{if(handle)await handle.dispose().catch(()=>{});}
}

export function verifyJapanWarmPage(first,second){
 need((first.observedAt||first.generationId)===(second.observedAt||second.generationId)
  &&JSON.stringify(first.items.map(row=>row.id))===JSON.stringify(second.items.map(row=>row.id)),'warm_changed');
 return {sameObservation:true,sameRows:true};
}

export function verifyJapanPowerPage(payload,pageNumber=1,{requireExactCount=false,countAcceptance,query}={}){
 need(Number.isSafeInteger(pageNumber)&&pageNumber>=1,'power_page_number');
 need(typeof requireExactCount==='boolean','exact_count_option');
 need(countAcceptance===undefined||[JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE,JAPAN_SOURCE_COUNT_ACCEPTANCE].includes(countAcceptance)&&!requireExactCount,'count_acceptance');
 let localPower=0,supplierPower=0,unknownPower=0;
 for(const row of payload.items){
  if(positive(row.powerHp)){
   need(row.powerHp<=160&&!row.japanSupplierPower&&row.japanPowerUnknown!==true,'local_power');localPower++;
  }else if(row.japanSupplierPower){
   const power=row.japanSupplierPower;
   need(power.offerId===row.id&&power.unit==='hp'&&power.source==='ajes_pw'
    &&Number.isSafeInteger(power.hp)&&power.hp>0&&power.hp<=160&&row.japanPowerUnknown!==true,'supplier_power');supplierPower++;
  }else{need(row.japanPowerUnknown===true,'unknown_unlabelled');unknownPower++;}
 }
 const expected={shown:payload.items.length,localPower,supplierPower,unknownPower};
 need(payload.powerFilterSummary&&Object.entries(expected).every(([key,value])=>payload.powerFilterSummary[key]===value),'power_summary');
 // A supplier count is an upper bound until the local predicate is exhausted.
 if(requireExactCount)verifyJapanExactCount(payload,{query});
 else if([JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE,JAPAN_SOURCE_COUNT_ACCEPTANCE].includes(countAcceptance))
  need(payload.total===null&&(!payload.countSummary||payload.countSummary.upperBound===true),'false_exact_count');
 else if(payload.hasMore||pageNumber>1)need(payload.total===null&&(!payload.countSummary||payload.countSummary.upperBound===true),'false_exact_count');
 else need(payload.total===payload.items.length&&payload.countSummary?.total===payload.items.length&&payload.countSummary?.upperBound===false,'exhausted_count');
 return {...expected,unknownRetainedAndLabelled:true,countHonest:true};
}

/** New usability checks supplement the accepted calculation/freshness gates.
 * They inspect the actual observed pages; exhaustive source/lane/admission
 * transitions are covered by the required native suite, not a live bulk scan. */
export function verifyJapanFullPage(payload,{countAcceptance,query,now=Date.now()}={}){
 need(countAcceptance===undefined||[JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE,JAPAN_SOURCE_COUNT_ACCEPTANCE].includes(countAcceptance),'count_acceptance');
 need(Array.isArray(payload?.items)&&payload.items.length>0&&payload.items.length<=24,'usability_rows');
 need(payload.hasMore!==true||payload.items.length===24,'short_page_with_more');
 const sourceScope=payload.partial===true&&[JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE,JAPAN_SOURCE_COUNT_ACCEPTANCE].includes(countAcceptance)
  ?verifyJapanSourceScopePage(payload,{countAcceptance,query,now}):null;
 need((!payload.partial||sourceScope)&&!payload.interrupted&&!payload.scanLimited,'usability_partial');
 return {shown:payload.items.length,hasMore:payload.hasMore===true,fullOrExhausted:true,...sourceScope};
}

export function verifyJapanKnownPowerOrder(pages){
 need(Array.isArray(pages)&&pages.length>0,'power_order_pages');
 let unknownStarted=false,known=0,unknown=0;const identities=new Set();
 for(const page of pages)for(const row of page.items){
  need(!identities.has(row.id),'power_order_duplicate');identities.add(row.id);
  if(row.japanPowerUnknown===true){unknownStarted=true;unknown++;}
  else {need(positive(row.powerHp)||positive(row.japanSupplierPower?.hp),'power_order_unlabelled');
   need(!unknownStarted,'known_after_unknown');known++;}
 }
 need(known>0,'power_order_no_known_sample');
 return {pages:pages.length,known,unknown,knownBeforeUnknown:true,distinctRows:true};
}

export function verifyJapanVisibleVehiclePolicy(pages){
 let checked=0;
 for(const page of pages)for(const row of page.items){
  const body=String(row.bodyType||'').toLowerCase().trim();
  const category=String(row.vehicleCategory||'').toUpperCase().trim();
  const model=String(row.model||'').toUpperCase().replace(/[^A-Z0-9]+/g,' ');
  need(!['bus','minibus','truck','special','special_equipment'].includes(body)
   &&!['M2','M3','N2','N3'].includes(category)
   &&!(positive(row.grossVehicleWeightKg)&&row.grossVehicleWeightKg>3500)
   &&!/(?:^| )(?:COASTER|CIVILIAN|ROSA|CANTER|ELF|SUPER GREAT)(?: |$)/.test(model)
   &&!(String(row.make||'').normalize('NFKC').trim().toUpperCase()==='MAZDA'
     &&/^TITAN(?:$|[ /-])/.test(String(row.model||'').normalize('NFKC').trim().toUpperCase().replace(/\s+/g,' '))),
   'excluded_vehicle_visible');
  checked++;
 }
 need(checked>0,'vehicle_policy_no_sample');return {checked,excludedVehiclesVisible:0};
}

export function verifyJapanBrandDirectory(payload,status,now=Date.now()){
 const observed=Date.parse(payload?.generationId||'');
 need(status===200&&payload?.directoryComplete===true&&payload.stale===false
  &&Number.isFinite(observed)&&observed<=now+60_000&&now-observed<30*60_000,'brand_directory_unavailable');
 need(Array.isArray(payload.makes)&&payload.makes.length>7
  &&payload.makes.every(name=>typeof name==='string'&&name.trim()===name&&name.length>0&&name.length<=80&&!/[\u0000-\u001f<>]/.test(name)),
  'brand_directory_rows');
 const makes=[...payload.makes].sort((a,b)=>a.localeCompare(b,'ru'));
 need(new Set(makes.map(name=>name.toLocaleLowerCase('en-US'))).size===makes.length,'brand_directory_duplicate');
 return {makes,observedAt:new Date(observed).toISOString(),complete:true};
}

/** The continuation comes from the clicked public link, never from a new scan
 * or an invented source offset. Only this exact requested second-page query is
 * admitted by the explicit API reader. */
export function japanPetrolPowerPageApi(value){
 need(japanPetrolPowerUrl(value,2),'continuation_query');
 const source=new URL(value,ORIGIN),after=source.searchParams.get('after');
 need(!source.username&&!source.password&&!source.hash,'continuation_scope');
 need(/^jp1\.[a-f0-9]{32}\.2\.[a-f0-9]{16}$/.test(after||''),'continuation_cursor');
 need([...source.searchParams.keys()].every(key=>['market','fuel','city','powerTo','page','pageSize','after','view'].includes(key))
  &&[...new Set(source.searchParams.keys())].every(key=>source.searchParams.getAll(key).length===1),'continuation_scope');
 const query=new URLSearchParams(QUERY);query.set('page','2');query.set('powerTo','160');query.set('fuel','petrol');query.set('after',after);
 return '/api/catalog/search?'+query;
}


/** Historical 24-row profiles retain j1. Only the reviewed power-order
 * profile requires j2 for power queries; plain and usability jp1 stay separate. */
export function checkedJapanPaginationCursor(value,visiblePage,{requirePowerOrder=false}={}){
 need(typeof requirePowerOrder==='boolean','power_order_option');
 if(requirePowerOrder){
  need(typeof value==='string'&&value.length<=320&&Number.isSafeInteger(visiblePage)&&visiblePage>=2&&visiblePage<=1_000_000,'pagination_cursor');
  const match=/^j2\.([ku])\.([1-9]\d{0,6})\.(0|[1-9]\d?)\.([1-9]\d{0,6})\.([a-f0-9]{64})\.([a-f0-9]{64})\.(-|[a-f0-9]{64})$/.exec(value);
  need(match&&Number(match[2])<=1_000_000&&Number(match[3])<=24&&Number(match[4])===visiblePage
   &&(Number(match[3])===0?match[7]==='-':match[7]!=='-'),'pagination_cursor');
  return {phase:match[1],sourcePage:Number(match[2]),acceptedSkip:Number(match[3]),visiblePage,
   queryHash:match[5],epochHash:match[6],membershipHash:match[7],cursorSha256:sha(value)};
 }
 need(typeof value==='string'&&value.length<=160&&Number.isSafeInteger(visiblePage)&&visiblePage>=2&&visiblePage<=1_000_000,'pagination_cursor');
 const match=/^j1\.([1-9]\d{0,6})\.(0|[1-9]\d?)\.([1-9]\d{0,6})\.([a-f0-9]{64})\.(-|[a-f0-9]{64})$/.exec(value);
 need(match&&Number(match[1])<=1_000_000&&Number(match[2])<24&&Number(match[3])===visiblePage
  &&(Number(match[2])===0?match[5]==='-':match[5]!=='-'),'pagination_cursor');
 return {sourcePage:Number(match[1]),acceptedSkip:Number(match[2]),visiblePage,cursorSha256:sha(value)};
}
export function japanPaginationPageApi(value,{kind,expectedCursor,requirePowerOrder=false}={}){
 need(['plain','power','petrol_power'].includes(kind),'pagination_kind');
 need(typeof requirePowerOrder==='boolean','power_order_option');
 let source;try{source=new URL(value,ORIGIN);}catch{need(false,'pagination_query');}
 const power=kind!=='plain',petrol=kind==='petrol_power';
 need(source.origin===ORIGIN&&!source.username&&!source.password&&!source.hash
  &&(source.pathname==='/cars/japan'||source.pathname==='/cars'&&source.searchParams.get('market')==='japan')
  &&(!source.searchParams.has('market')||source.searchParams.get('market')==='japan')
  &&source.searchParams.get('city')===CITY&&source.searchParams.get('page')==='2'
  &&(!source.searchParams.has('pageSize')||source.searchParams.get('pageSize')==='24')
  &&(power?source.searchParams.get('powerTo')==='160':!source.searchParams.has('powerTo'))
  &&(petrol?source.searchParams.get('fuel')==='petrol':!source.searchParams.has('fuel'))
  &&(!source.searchParams.has('view')||['grid','list'].includes(source.searchParams.get('view')))
  &&[...source.searchParams.keys()].every(key=>['market','fuel','city','powerTo','page','pageSize','after','view'].includes(key))
  &&[...new Set(source.searchParams.keys())].every(key=>source.searchParams.getAll(key).length===1),'pagination_query');
 const after=source.searchParams.get('after');
 checkedJapanPaginationCursor(after,2,{requirePowerOrder:requirePowerOrder&&power});
 if(expectedCursor!==undefined)need(after===expectedCursor,'pagination_emitted_cursor');
 const query=new URLSearchParams(QUERY);query.set('page','2');
 if(power)query.set('powerTo','160');if(petrol)query.set('fuel','petrol');
 query.set('after',after);return '/api/catalog/search?'+query;
}
export function verifyJapanPaginationPair(first,next,{observedUrl,kind,firstStatus,nextStatus,now=Date.now(),requirePowerOrder=false,requireExactCount=false,countAcceptance}={}){
 need(typeof requirePowerOrder==='boolean','power_order_option');
 need(typeof requireExactCount==='boolean','exact_count_option');
 need(countAcceptance===undefined||[JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE,JAPAN_SOURCE_COUNT_ACCEPTANCE].includes(countAcceptance)&&!requireExactCount,'count_acceptance');
 const firstApi=kind==='plain'?PLAIN:kind==='power'?POWER:PETROL_POWER;
 const nextApi=japanPaginationPageApi(observedUrl,{kind,expectedCursor:first.nextCursor,requirePowerOrder});
 const firstOptions={countAcceptance,query:firstApi,now},nextOptions={countAcceptance,query:nextApi,now};
 const firstObservation=verifyJapanPage(first,firstStatus,now,firstOptions),nextObservation=verifyJapanPage(next,nextStatus,now,nextOptions);
 need(first.page===1&&next.page===2&&first.pageSize===24&&next.pageSize===24&&first.hasMore===true
  &&typeof next.hasMore==='boolean','pagination_page');
 const countQuery={market:'japan',city:CITY,...(kind!=='plain'?{powerTo:'160'}:{}),...(kind==='petrol_power'?{fuel:'petrol'}:{})};
 const exactCount=requireExactCount?verifyJapanExactCountStable(
  verifyJapanExactCount(first,{query:countQuery,now}),verifyJapanExactCount(next,{query:countQuery,now})):undefined;
 if(!requireExactCount)need(first.total===null&&next.total===null,'pagination_count');
 const firstPage=verifyJapanFullPage(first,firstOptions),secondPage=verifyJapanFullPage(next,nextOptions);
 const orderedPower=requirePowerOrder&&kind!=='plain';
 const cursor=checkedJapanPaginationCursor(first.nextCursor,2,{requirePowerOrder:orderedPower});
 let following;
 if(next.hasMore)following=checkedJapanPaginationCursor(next.nextCursor,3,{requirePowerOrder:orderedPower});
 else need(next.nextCursor===null,'pagination_exhausted_cursor');
 const firstIds=new Set(first.items.map(row=>row.id));
 need(next.items.every(row=>!firstIds.has(row.id)),'pagination_duplicate');
 if(kind!=='plain'){
  verifyJapanPowerPage(first,1,{requireExactCount,countAcceptance,query:countQuery});
  verifyJapanPowerPage(next,2,{requireExactCount,countAcceptance,query:countQuery});
 }
 if(kind==='petrol_power')need([...first.items,...next.items].every(row=>row.fuel==='petrol'),'pagination_fuel');
 let powerOrder;
 if(orderedPower){
  const order=verifyJapanKnownPowerOrder([first,next]);
  const firstUnknown=first.items.some(row=>row.japanPowerUnknown===true),nextUnknown=next.items.some(row=>row.japanPowerUnknown===true);
  need(cursor.phase!=='k'||!firstUnknown,'power_cursor_phase');
  need(cursor.phase!=='u'||next.items.every(row=>row.japanPowerUnknown===true),'power_cursor_phase');
  // Switching exactly at a full known page starts U at its first source row.
  if(cursor.phase==='u'&&!firstUnknown)need(cursor.sourcePage===1&&cursor.acceptedSkip===0,'power_cursor_phase');
  if(following){
   need(following.queryHash===cursor.queryHash&&following.epochHash===cursor.epochHash,'power_cursor_binding');
   need(cursor.phase!=='u'||following.phase==='u','power_cursor_phase');
   need(following.phase!=='k'||!nextUnknown,'power_cursor_phase');
   if(cursor.phase===following.phase){
    need(following.sourcePage>cursor.sourcePage||following.sourcePage===cursor.sourcePage&&following.acceptedSkip>cursor.acceptedSkip,'power_cursor_progress');
    if(following.sourcePage===cursor.sourcePage)need(following.membershipHash===cursor.membershipHash,'power_cursor_membership');
   }else if(!nextUnknown)need(following.sourcePage===1&&following.acceptedSkip===0,'power_cursor_phase');
  }
  // This describes the two observed pages, not an unbounded catalogue scan.
  powerOrder={...order,cursorVersion:'j2'};
 }
 return {first:{...firstObservation,...firstPage},next:{...nextObservation,...secondPage},
  cursorSha256:cursor.cursorSha256,followedEmittedCursor:true,distinctRows:true,visiblePages:2,
  ...(powerOrder?{powerOrder}:{}),...(exactCount?{exactCount}:{})};
}

export function japanVerificationRequestScope(url,method,resourceType){
 if(!['GET','HEAD'].includes(method))return 'mutation';
 let value,pathname;try{value=new URL(url);pathname=decodeURIComponent(value.pathname);}catch{return 'external';}
 if(value.username||value.password)return 'external';
 if(value.origin!==ORIGIN){
  // Japan photos are intentionally direct. Permit only the same immutable image
  // URL shapes accepted by ajesImageUrl, never supplier APIs or external scripts.
  const authority=/^https:\/\/([^/?#]*)/i.exec(url)?.[1];
  if(resourceType==='image'&&value.protocol==='https:'&&authority?.toLowerCase()===value.hostname
   &&!value.port&&!value.search&&!value.hash&&!/[?#]/.test(url)
   &&/^(?:7\.tru\.ru|7\.ajes\.com|8\.ajes\.com|9\.ajes\.com)$/.test(value.hostname)
   &&/^\/imgs?\/[A-Za-z0-9_-]+(?:&(?:h|w)=\d+)*$/.test(value.pathname))return 'supplier_image';
  return 'external';
 }
 if(/[\\\x00-\x1f\x7f]/.test(pathname)||/^(?:\/crm|\/admin|\/api\/(?:crm|admin|internal))(?:\/|$)/.test(pathname))return 'private';
 return 'allowed';
}

const CALCULATION_KEYS=new Set(['vehicleCategory','grossVehicleWeightKg','n1IceFuel','year','productionMonth','productionDay',
 'transportToBorderRub','engineCc','fuel','powerHp','powerKw','hybridKind','power30MinKw','power30MinHp',
 'icePowerKw','icePowerHp','deliveryCity','customsCalculationDate']);
const empty=value=>value===undefined||value==='';

/** One ephemeral, public calculation for the exact observed petrol listing.
 * The route validates a scenario and returns it without saving the offer,
 * encyclopedia, CRM or editorial data. No other POST receives this exception. */
export function japanCalculationReadGrant(row,city=CITY,detailHref=ORIGIN+'/cars/offer/'+row?.id){
 const power=row?.japanSupplierPower;
 need(row?.market==='japan'&&/^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(row.id||'')&&row.fuel==='petrol'
  &&power?.offerId===row.id&&power.source==='ajes_pw'&&power.unit==='hp'
  &&power.combustionPreviewEligible===true&&Number.isSafeInteger(power.hp)&&power.hp>0&&power.hp<=160
  &&!positive(row.powerHp)&&!positive(row.powerKw)
  &&row.japanPowerUnknown!==true&&city===CITY
  &&Number.isInteger(row.year)&&row.year>=2008&&row.year<=new Date().getUTCFullYear()+1
  &&Number.isInteger(row.engineCc)&&row.engineCc>=300&&row.engineCc<=3000
  &&row.sourceCurrency==='JPY'&&positive(row.sourcePrice),'calculation_binding');
 let detail;try{detail=new URL(detailHref,ORIGIN);}catch{}
 const offerPath='/cars/offer/'+row.id;
 need(detail?.origin===ORIGIN&&!detail.username&&!detail.password&&!detail.hash
  &&(detail.pathname===offerPath||detail.pathname.startsWith(offerPath+'/'))
  &&(!detail.searchParams.has('city')||detail.searchParams.get('city')===city),'calculation_detail_binding');
 return {offerId:row.id,powerHp:power.hp,year:row.year,engineCc:row.engineCc,
  sourceCurrency:row.sourceCurrency,sourcePrice:row.sourcePrice,detailUrl:detail.href,
  city,requests:0,bodySha256:null,body:null,response:null};
}

export function checkedJapanCalculationRead({url,method,resourceType,frameUrl,headers,body},grant){
 if(!grant||grant.requests>=2||method!=='POST'||!['fetch','xhr'].includes(resourceType)||typeof body!=='string'
  ||Buffer.byteLength(body)>4096)return null;
 const target=ORIGIN+'/api/catalog/offer/'+grant.offerId+'/calculate';
 let frame;try{frame=new URL(frameUrl);}catch{return null;}
 const offerPath='/cars/offer/'+grant.offerId;
 if(url!==target||frame.href!==grant.detailUrl||frame.origin!==ORIGIN
  ||!(frame.pathname===offerPath||frame.pathname.startsWith(offerPath+'/'))
  ||headers?.origin!==ORIGIN||!/^application\/json(?:\s*;|$)/i.test(headers?.['content-type']||''))return null;
 let draft;try{draft=JSON.parse(body);}catch{return null;}
 if(!draft||Array.isArray(draft)||typeof draft!=='object'||Object.keys(draft).some(key=>!CALCULATION_KEYS.has(key))
  ||Object.values(draft).some(value=>typeof value!=='string')||draft.fuel!=='petrol'
  ||draft.deliveryCity!==grant.city||Number(draft.powerHp)!==grant.powerHp
  ||Number(draft.year)!==grant.year||Number(draft.engineCc)!==grant.engineCc
  ||(!empty(draft.powerKw)&&(!positive(Number(draft.powerKw))||Math.abs(Number(draft.powerKw)-grant.powerHp*0.73549875)>0.00001))
  ||!['','M1',undefined].includes(draft.vehicleCategory)
  ||['grossVehicleWeightKg','n1IceFuel','transportToBorderRub','hybridKind','power30MinKw','power30MinHp',
    'icePowerKw','icePowerHp','customsCalculationDate'].some(key=>!empty(draft[key])))return null;
 for(const [key,max] of [['productionMonth',12],['productionDay',31]])if(!empty(draft[key])
  &&(!Number.isInteger(Number(draft[key]))||Number(draft[key])<1||Number(draft[key])>max))return null;
 if(!empty(draft.productionDay)&&empty(draft.productionMonth))return null;
 const canonical=JSON.stringify(Object.fromEntries(Object.entries(draft).sort(([a],[b])=>a.localeCompare(b))));
 if(grant.bodySha256&&grant.bodySha256!==sha(canonical))return null;
 return {draft,bodySha256:sha(canonical)};
}

export function verifyJapanDeliveredCalculation(value,status,grant){
 need(status===200&&value?.requiresConfirmation===true&&value?.customs?.status==='ready','calculation_response');
 const car=value.breakdown?.find(row=>row.id==='car');
 need(positive(value.totalRub)&&positive(car?.amountRub)&&value.totalRub>car.amountRub,'calculation_total');
 need(value.deliveryQuote?.city===grant.city&&positive(value.deliveryQuote?.amountRub)
  &&value.deliveryQuote?.status==='estimated','calculation_city');
 need(Array.isArray(value.breakdown)&&value.breakdown.length>1
  &&value.breakdown.every(row=>typeof row.id==='string'&&typeof row.amountRub==='number'&&Number.isFinite(row.amountRub)),
  'calculation_breakdown');
 need(value.currencyRate?.currency===grant.sourceCurrency&&value.currencyRate?.sourcePrice===grant.sourcePrice
  &&positive(value.currencyRate?.sourcePriceRub)&&Math.round(value.currencyRate.sourcePriceRub)===car.amountRub,
  'calculation_source_price');
 need(Math.abs(value.breakdown.reduce((total,row)=>total+row.amountRub,0)-value.totalRub)<0.01,'calculation_ledger');
 return {status,totalRub:value.totalRub,carRub:car.amountRub,city:grant.city,
  deliveryRub:value.deliveryQuote.amountRub,customsReady:true,requiresConfirmation:true};
}

/** Never publish Playwright exception text, which can contain private URLs. */
export function japanNavigationErrorCode(error){
 try{
  if(error?.name==='TimeoutError')return 'timeout';
  const message=typeof error?.message==='string'?error.message:'';
  const allowed=new Set(['ERR_ABORTED','ERR_FAILED','ERR_BLOCKED_BY_CLIENT','ERR_CONNECTION_RESET',
   'ERR_CONNECTION_CLOSED','ERR_CONNECTION_REFUSED','ERR_EMPTY_RESPONSE','ERR_INCOMPLETE_CHUNKED_ENCODING',
   'ERR_HTTP2_PROTOCOL_ERROR','ERR_TIMED_OUT','ERR_NAME_NOT_RESOLVED','ERR_CERT_AUTHORITY_INVALID']);
  const code=/\bnet::(ERR_[A-Z0-9_]+)\b/.exec(message)?.[1];
  if(allowed.has(code))return code;
  if(message.includes('is interrupted by another navigation'))return 'navigation_interrupted';
  if(message.includes('Target page, context or browser has been closed'))return 'target_closed';
 }catch{}
 return 'unknown';
}

export async function installReadFence(context,report,{getCalculationGrant,isLegacyMazdaThreeStage}={}){
 let legacyNavigation=null,legacyNavigationUsed=false,legacyObservation=null,legacyDestinationFrame=null;
 const legacyStage=()=>report.codeScope===JAPAN_STABILITY_CODE_SCOPE&&isLegacyMazdaThreeStage?.()===true;
 const grantedLegacyRedirect=(request,response)=>{
  if(!legacyNavigation||legacyNavigation.abort||!legacyStage()||response.status()!==308
   ||request.url()!==JAPAN_LEGACY_MAZDA_THREE_PAGES.literal||request.method()!=='GET'
   ||request.resourceType()!=='document')return false;
  try{
   const location=response.headers().location;
   return (location===JAPAN_LEGACY_MAZDA_THREE_PAGES.canonical
     ||location===JAPAN_LEGACY_MAZDA_THREE_PAGES.canonical.slice(ORIGIN.length))
    &&request.isNavigationRequest()===true&&request.redirectedFrom()===null
    &&request.frame()===legacyNavigation.frame&&legacyNavigation.page.mainFrame()===legacyNavigation.frame
    &&legacyNavigation.page.context()===context;
  }catch{return false;}
 };
 report.blockedRequests={mutation:0,external:0,private:0,redirect:0};
 report.supplierImageRequests=0;
 if(getCalculationGrant)report.japanPreviewCalculationRequests=0;
 await context.route('**/*',async route=>{
  const request=route.request();let scope=japanVerificationRequestScope(request.url(),request.method(),request.resourceType());
  const grant=getCalculationGrant?.();let calculation;
  if(scope==='mutation'&&grant){
   let frameUrl;try{frameUrl=request.frame().url();}catch{}
   calculation=checkedJapanCalculationRead({url:request.url(),method:request.method(),resourceType:request.resourceType(),
    frameUrl,headers:request.headers(),body:request.postData()},grant);
   if(calculation)scope='calculation_read';
  }
  if(!['allowed','supplier_image','calculation_read'].includes(scope)){report.blockedRequests[scope]++;await route.abort('blockedbyclient');return;}
  let response;
  try{
   // The read fence must not impose a shorter deadline than the page check.
   if(scope==='supplier_image')report.supplierImageRequests++;
   if(scope==='calculation_read'){
    grant.requests++;grant.bodySha256=calculation.bodySha256;grant.body=calculation.draft;
    report.japanPreviewCalculationRequests++;
   }
   response=await route.fetch({maxRedirects:0,timeout:90_000});
   if(legacyObservation&&request.url()===JAPAN_LEGACY_MAZDA_THREE_PAGES.canonical
    &&request.resourceType()==='document'&&request.isNavigationRequest()===true&&request.frame()===legacyDestinationFrame){
    const status=response.status();
    legacyObservation.canonicalStatus=Number.isInteger(status)&&status>=100&&status<=599?status:null;
    legacyObservation.canonicalRedirectBlocked=status>=300&&status<400&&status!==304;
   }
   if(response.status()>=300&&response.status()<400&&response.status()!==304){
    if(scope==='allowed'&&grantedLegacyRedirect(request,response)){
     // Playwright need not re-route a redirected request. Stop the verified
     // first hop; the one explicit target navigation below gets a fresh fence.
     const active=legacyNavigation;
     active.abort=route.abort('blockedbyclient');await active.abort;
    }else{report.blockedRequests.redirect++;await route.abort('blockedbyclient');}
   }else{
    if(scope==='calculation_read'){
     const raw=await response.body();need(raw.length<=128*1024,'calculation_response_size');
     grant.response={status:response.status(),data:JSON.parse(raw.toString())};
    }
    await route.fulfill({response});
   }
  }catch(error){
   if(legacyObservation&&request.resourceType()==='document'
    &&Object.values(JAPAN_LEGACY_MAZDA_THREE_PAGES).includes(request.url()))
    legacyObservation.fenceFailureCode=japanNavigationErrorCode(error);
   await route.abort('failed').catch(()=>{});
  }
  finally{if(response)await response.dispose().catch(()=>{});}
 });
 report.readOnlyBrowserFence=true;
 return {navigateLegacyMazdaThree:async page=>{
  need(legacyStage()&&!legacyNavigationUsed&&page.context()===context&&page.url()==='about:blank','legacy_redirect_context');
  legacyNavigationUsed=true;
  const observation={phase:'probe_navigation',probeClosed:false,canonicalStatus:null,
   canonicalUrlExact:null,canonicalMainFrameCommitted:false};
  (report.checks??={}).legacyNavigation=observation;legacyObservation=observation;
  const destinationFrame=page.mainFrame();legacyDestinationFrame=destinationFrame;let probe;
  const committed=frame=>{
   if(frame===destinationFrame){
    const url=frame.url(),exact=url===JAPAN_LEGACY_MAZDA_THREE_PAGES.canonical;
    observation.canonicalMainFrameCommitted ||= exact;
    observation.lastMainFrame=exact?'canonical':url==='about:blank'?'blank'
     :url.startsWith('chrome-error:')?'browser_error':'other';
   }
  };
  page.on?.('framenavigated',committed);
  try{
   probe=await context.newPage();
   need(probe!==page&&probe.context()===context,'legacy_redirect_context');
   const active={page:probe,frame:probe.mainFrame(),abort:null};legacyNavigation=active;
   let failed;
   try{await probe.goto(JAPAN_LEGACY_MAZDA_THREE_PAGES.literal,{waitUntil:'domcontentloaded',timeout:90_000});}
   catch(error){failed=error;}
   finally{legacyNavigation=null;}
   if(!active.abort||!failed||!/\bnet::ERR_BLOCKED_BY_CLIENT\b/.test(failed.message||'')){
    if(failed)throw failed;
    need(false,'legacy_redirect_missing');
   }
   await active.abort;
   observation.phase='probe_close';await probe.close();observation.probeClosed=true;probe=null;
   need(legacyStage()&&page.context()===context&&page.mainFrame()===destinationFrame&&page.url()==='about:blank',
    'legacy_redirect_context');
   const redirectProof={status:308,redirects:1,sameOrigin:true,exactTarget:true,mainFrame:true};
   report.checks.legacyCanonicalRedirect=redirectProof;
   // A failed navigation may still commit Chromium's error page. Closing its
   // separate page is the barrier; the destination has never been aborted.
   observation.phase='canonical_navigation';
   const response=await page.goto(JAPAN_LEGACY_MAZDA_THREE_PAGES.canonical,{waitUntil:'domcontentloaded',timeout:90_000});
   const status=response?.status();observation.canonicalStatus=Number.isInteger(status)&&status>=100&&status<=599?status:null;
   observation.canonicalUrlExact=page.url()===JAPAN_LEGACY_MAZDA_THREE_PAGES.canonical;
   observation.phase='complete';return {response,redirectProof};
  }catch(error){observation.failureCode=japanNavigationErrorCode(error);throw error;}
  finally{
   legacyNavigation=null;legacyObservation=null;legacyDestinationFrame=null;page.off?.('framenavigated',committed);
   if(probe)await probe.close().catch(()=>{});
  }
 }};
}

async function readJson(context,url,{paginationKind,stability=false,requirePowerOrder=false,priceSort=false,exactCount=false,modelCoverage=false,sourceCount=false,sourcePriceOrder=false}={}){
 let continuation=false;
 const priceSortApi=priceSort&&japanPriceSortApiAllowed(url);
 const exactCountApi=exactCount&&japanExactCountApiAllowed(url);
 const modelCoverageApi=modelCoverage&&japanModelCoverageApiAllowed(url);
 const sourceCountApi=sourceCount&&japanSourceCountApiAllowed(url);
 const sourcePriceApi=sourcePriceOrder&&japanSourcePriceApiAllowed(url);
 if(url.startsWith('/api/catalog/search?')){
  const query=new URL(url,ORIGIN).searchParams;
  if(query.has('after')&&!priceSortApi&&!exactCountApi&&!sourceCountApi){
   const pageUrl=new URL('/cars/japan',ORIGIN);pageUrl.search=query.toString();
   continuation=(paginationKind?japanPaginationPageApi(pageUrl.href,{kind:paginationKind,requirePowerOrder}):japanPetrolPowerPageApi(pageUrl.href))===url;
  }
 }
 need(url==='/api/health'||url===PLAIN||url===POWER||url===PETROL_POWER||url===PETROL_POWER_NEXT||url===BRAND_DIRECTORY||continuation
  ||stability&&japanStabilityApiAllowed(url)||priceSortApi||exactCountApi||modelCoverageApi||sourceCountApi||sourcePriceApi,'api_scope');
 const started=Date.now();
 const response=await context.request.get(ORIGIN+url,{timeout:45_000,maxRedirects:0,headers:{'Cache-Control':'no-cache'}});
 const data=await response.json().catch(()=>null),receivedAt=Date.now();
 return {status:response.status(),data,headers:response.headers(),durationMs:receivedAt-started,requestedAt:started,receivedAt};
}

export async function runJapanBrowserAcceptance({oraclePath,releaseSha,nonce,outputFile,playwrightModule,chromeBin,codeScope=SCOPE,requirePowerOrder=false,requireBrandDirectory=false,requirePriceSort=false,requireExactCount=false,requireModelCoverage=false,requireSourceCount=false,requireA4Power160Continuation=false,requireSourcePriceOrder=false,timingPolicy}){
 const stability=codeScope===JAPAN_STABILITY_CODE_SCOPE;
 const pagination=codeScope===JAPAN_PAGINATION_CODE_SCOPE||stability;
 const completion=[COMPLETION_SCOPE,COMPLETION_V2_SCOPE,USABILITY_SCOPE,JAPAN_PAGINATION_CODE_SCOPE,JAPAN_STABILITY_CODE_SCOPE].includes(codeScope);
 const usability=codeScope===USABILITY_SCOPE;
 const report={version:1,kind:'catalog-japan-browser-v1',codeScope,release:releaseSha,nonce,
  checkedAt:new Date().toISOString(),passed:false,japanFreshnessPassed:false,japanPowerApiPassed:false,
  japanUiPassed:false,japanVisibilityPassed:false,readOnlyBrowserFence:false,
  productionMutations:0,directSupplierApiRequests:0,supplierImageRequests:0,explicitJapanApiRequests:0,checks:{},screenshots:[]};
 if(completion)Object.assign(report,{japanPetrolPowerUiPassed:false,japanDetailPowerInputPassed:false,
  japanDeliveredCalculationPassed:false,japanPreviewCalculationRequests:0});
 if(usability)Object.assign(report,Object.fromEntries(USABILITY_GATES.map(key=>[key,false])));
 if(pagination)Object.assign(report,{japanFullPagesPassed:false,japanPagination24Passed:false,japanCatalogWarningRemovedPassed:false});
 if(stability)Object.assign(report,Object.fromEntries(JAPAN_STABILITY_GATES.map(key=>[key,false])));
 if(requirePowerOrder===true)report.japanPowerOrderPassed=false;
 if(requireBrandDirectory===true)Object.assign(report,{japanBrandDirectoryPassed:false,japanBrandDirectoryUiRequests:0});
 if(requirePriceSort===true)Object.assign(report,{japanPriceSortRequired:true,
  ...Object.fromEntries(JAPAN_PRICE_SORT_GATES.map(key=>[key,false]))});
 if(requireExactCount===true)Object.assign(report,{japanExactCountRequired:true,
  ...Object.fromEntries(JAPAN_EXACT_COUNT_GATES.map(key=>[key,false]))});
 if(requireModelCoverage===true)Object.assign(report,{countAcceptance:JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE,
  japanModelCoverageRequired:true,japanModelCoveragePassed:false,japanExactCountRequired:false,japanExactCountPassed:null});
 if(requireSourceCount===true)Object.assign(report,{countAcceptance:JAPAN_SOURCE_COUNT_ACCEPTANCE,
  japanSourceCountRequired:true,japanSourceCountPassed:false});
 if(requireA4Power160Continuation===true)Object.assign(report,
  {japanA4Power160ContinuationRequired:true,japanA4Power160ContinuationPassed:false});
 if(requireSourcePriceOrder===true)Object.assign(report,
  {japanSourcePriceOrderRequired:true,japanSourcePriceOrderPassed:false});
 if(timingPolicy===JAPAN_OBSERVED_TIMING_POLICY)Object.assign(report,
  {timingPolicy,speedGateRequired:false,speedPassed:null,timingObserved:false});
 let browser,context,currentPage,calculationGrant=null,brandDirectory=null,stabilityBrandDirectory=null,stage='preconditions';
 const usabilityPages=[],quietChecks=[];
 const read=async(url,options={})=>{
  const value=await readJson(context,url,{...options,exactCount:requireExactCount,modelCoverage:requireModelCoverage,sourceCount:requireSourceCount,sourcePriceOrder:requireSourcePriceOrder});
  if(requireExactCount&&url.startsWith('/api/catalog/search?')&&value.status===200&&value.data?.ok===true)
   verifyJapanExactCount(value.data,{query:url});
  return value;
 };
 const verifyPower=(payload,page=1,options={})=>verifyJapanPowerPage(payload,page,{...options,requireExactCount,countAcceptance:report.countAcceptance});
 const capture=async(page,name)=>{
  const relative=path.join('artifacts/catalog-japan-live',nonce,name+'.png');
  const file=path.join(ROOT,relative);await fs.mkdir(path.dirname(file),{recursive:true});
  const raw=await page.screenshot({path:file,fullPage:true,animations:'disabled',timeout:10_000});
  report.screenshots.push({path:relative,sha256:sha(raw)});
 };
 const health=async()=>{
  const value=await read('/api/health');
  const observation={stage:report.checks.health?.length?'after':'before',...japanResponseTransport(value),
   status:value.status,ok:typeof value.data?.ok==='boolean'?value.data.ok:null,
   releaseSha:typeof value.data?.releaseSha==='string'&&/^[a-f0-9]{40}$/.test(value.data.releaseSha)?value.data.releaseSha:null,
   calculationVersion:typeof value.data?.calculationVersion==='string'&&/^[a-f0-9]{64}$/.test(value.data.calculationVersion)?value.data.calculationVersion:null};
  (report.checks.health??=[]).push(observation);
  need(value.status===200&&value.data?.ok===true&&value.data.releaseSha===releaseSha,'release_changed');
  need(value.data.calculationVersion==='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90','calculation_changed');
 };
 try{
  need([SCOPE,COMPLETION_SCOPE,COMPLETION_V2_SCOPE,USABILITY_SCOPE,JAPAN_PAGINATION_CODE_SCOPE,JAPAN_STABILITY_CODE_SCOPE].includes(codeScope),'code_scope');
  need(typeof requirePowerOrder==='boolean'&&(!requirePowerOrder||stability),'power_order_option');
  need(typeof requireBrandDirectory==='boolean'&&(!requireBrandDirectory||stability),'brand_directory_option');
  need(typeof requirePriceSort==='boolean'&&(!requirePriceSort||stability&&requirePowerOrder&&requireBrandDirectory),'price_sort_option');
  need(typeof requireExactCount==='boolean'&&(!requireExactCount||stability&&requirePowerOrder&&requireBrandDirectory&&requirePriceSort),'exact_count_option');
  need(typeof requireModelCoverage==='boolean'&&(!requireModelCoverage||stability&&requirePowerOrder&&requireBrandDirectory
   &&requirePriceSort&&!requireExactCount&&timingPolicy===JAPAN_OBSERVED_TIMING_POLICY),'model_coverage_option');
  need(typeof requireSourceCount==='boolean'&&(!requireSourceCount||requireModelCoverage&&!requireExactCount),'source_count_option');
  need(typeof requireA4Power160Continuation==='boolean'&&(!requireA4Power160Continuation||requireSourceCount
   &&requirePowerOrder&&requireModelCoverage&&!requireExactCount),'power_continuation_option');
  need(typeof requireSourcePriceOrder==='boolean'&&(!requireSourcePriceOrder||requireSourceCount
   &&requireA4Power160Continuation&&requirePriceSort&&!requireExactCount),'source_price_option');
  japanTimingPolicy(timingPolicy);
  need(timingPolicy===undefined||stability&&requirePowerOrder&&requireBrandDirectory,'timing_policy_scope');
  need(path.isAbsolute(outputFile),'output');
  try{await fs.access(outputFile);need(false,'report_exists');}catch(error){if(error?.code!=='ENOENT')throw error;}
  const raw=await fs.readFile(oraclePath),binding=japanReleaseBinding(JSON.parse(raw),releaseSha,nonce);
  report.generationManifestSha256=binding.generationManifestSha256;report.oracleSha256=sha(raw);
  const {chromium}=await import(playwrightModule||'playwright');
  browser=await chromium.launch({headless:true,executablePath:chromeBin,args:['--no-sandbox']});
  context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',locale:'ru-RU'});
  const fence=await installReadFence(context,report,{
   ...(completion?{getCalculationGrant:()=>calculationGrant}:{}),
   ...(stability?{isLegacyMazdaThreeStage:()=>stage==='stability_legacy_mazda_three'}:{})});await health();
  const checkPaginationWarning=async catalog=>{
   need(await catalog.locator('[data-japan-power-summary-page]').count()===0
    &&!/(?:Отбор не подтверждает право|Мощность по данным поставщика:\s*\d)/u.test(await catalog.innerText()),'catalog_warning');
  };
  const checkPaginationUi=async(view,first,kind)=>{
   need(pagination,'pagination_scope');
   const catalog=view.locator('main.ac-ajes-catalog'),cards=catalog.locator(CARD);
   await cards.nth(first.items.length-1).waitFor({state:'attached',timeout:60_000});
   need(await cards.count()===first.items.length,'pagination_ui_first_count');
   for(const row of first.items){const card=cards.filter({has:view.locator('a[href*="'+row.id+'"]')});
    await card.waitFor({state:'attached',timeout:30_000});need(await card.count()===1,'pagination_ui_first_identity');}
   need(new URL(view.url()).searchParams.get('city')===CITY,'pagination_ui_city');
   await checkPaginationWarning(catalog);
   const next=catalog.locator('nav.ac-pagination a[aria-label="Страница 2"]');
   need(await next.count()===1,'pagination_ui_next_link');
   const href=await next.getAttribute('href');
   japanPaginationPageApi(href,{kind,expectedCursor:first.nextCursor,requirePowerOrder});
   await next.click();await view.waitForURL(url=>url.searchParams.get('page')==='2',{timeout:60_000});
   const observedUrl=view.url(),api=japanPaginationPageApi(observedUrl,{kind,expectedCursor:first.nextCursor,requirePowerOrder});
   if(stability)(report.checks.ssrPageReadEvidence??=[]).push({stage,kind,
    ...await readJapanSsrPageEvidence(view,{page:2,after:new URL(observedUrl).searchParams.get('after')||''})});
   report.explicitJapanApiRequests++;
   const result=await read(api,{paginationKind:kind,requirePowerOrder});
   recordJapanResponse(report,stage,result,releaseSha);
   const proof=verifyJapanPaginationPair(first,result.data,{observedUrl,kind,firstStatus:200,nextStatus:result.status,requirePowerOrder,requireExactCount,countAcceptance:report.countAcceptance});
   await cards.nth(result.data.items.length-1).waitFor({state:'attached',timeout:60_000});
   need(await cards.count()===result.data.items.length,'pagination_ui_next_count');
   for(const row of result.data.items){const card=cards.filter({has:view.locator('a[href*="'+row.id+'"]')});
    await card.waitFor({state:'attached',timeout:30_000});need(await card.count()===1,'pagination_ui_next_identity');}
   need(await cards.count()===result.data.items.length,'pagination_ui_next_count');
   await checkPaginationWarning(catalog);
   return {...proof,navigatedThroughLink:true,uiMatchesApi:true,cityPreserved:true,warningRemoved:true};
  };
  const plain=[];report.checks.freshness={observations:[]};report.checks.responses=[];
  for(let index=0;index<2;index++){
   stage=index?'plain_warm':'plain_first';report.explicitJapanApiRequests++;
   const response=await read(PLAIN);
   recordJapanResponse(report,stage,response,releaseSha);
   const observation=verifyJapanPage(response.data,response.status);
   report.checks.freshness.observations.push({...observation,durationMs:response.durationMs,
    sourceObservedDuringRequest:Date.parse(observation.observedAt)>=response.requestedAt-1000});
   plain.push(response.data);
  }
  Object.assign(report.checks.freshness,verifyJapanWarmPage(...plain));report.japanFreshnessPassed=true;
  if(usability){
   usabilityPages.push(plain[0]);
   stage='brand_directory_api';report.explicitJapanApiRequests++;
   const directory=await read(BRAND_DIRECTORY);
   recordJapanResponse(report,stage,directory,releaseSha);
   brandDirectory=verifyJapanBrandDirectory(directory.data,directory.status);
   report.checks.brandDirectory={makes:brandDirectory.makes.length,complete:true,observedAt:brandDirectory.observedAt,
    durationMs:directory.durationMs};
  }
  stage='power_api';report.explicitJapanApiRequests++;
  const power=await read(POWER);
  recordJapanResponse(report,stage,power,releaseSha);
  report.checks.power={...verifyJapanPage(power.data,power.status),...verifyPower(power.data,1,{query:POWER}),durationMs:power.durationMs};
  report.japanPowerApiPassed=true;
  if(pagination){
   verifyJapanFullPage(plain[0]);verifyJapanFullPage(power.data);
   report.checks.pagination24={};stage='pagination_plain_page_two';
   const ordinary=await context.newPage();currentPage=ordinary;let errors=0;ordinary.on('pageerror',()=>{errors++;});
   await ordinary.setViewportSize({width:390,height:900});
   const query=new URLSearchParams(QUERY);query.delete('market');
   const response=await ordinary.goto(ORIGIN+'/cars/japan?'+query,{waitUntil:'domcontentloaded',timeout:90_000});
   need(response?.status()===200,'pagination_plain_http');
   report.checks.pagination24.plain=await checkPaginationUi(ordinary,plain[0],'plain');
   need(errors===0,'pagination_plain_javascript');
   await capture(ordinary,'japan-plain-page-two-mobile');await ordinary.close();currentPage=null;
  }
  if(usability)usabilityPages.push(power.data);
  stage='power_ui';const page=await context.newPage();currentPage=page;
  let pageErrors=0;page.on('pageerror',()=>{pageErrors++;});
  const pageQuery=new URLSearchParams(QUERY);pageQuery.delete('market');pageQuery.set('powerTo','160');
  const start=Date.now(),response=await page.goto(ORIGIN+'/cars/japan?'+pageQuery,{waitUntil:'domcontentloaded',timeout:90_000});
  need(response?.status()===200,'power_page_http');
  const main=page.locator('main.ac-ajes-catalog');await main.waitFor({state:'visible',timeout:60_000});
  await main.locator('h2').filter({hasText:'Япония'}).waitFor({state:'visible',timeout:60_000});
  const cards=main.locator(CARD);await cards.nth(power.data.items.length-1).waitFor({state:'attached',timeout:60_000});
  need(await cards.count()===power.data.items.length,'ui_count');
  let supplierVisible=0,unknownVisible=0;
  for(const row of power.data.items){
   const card=cards.filter({has:page.locator('a[href*="'+row.id+'"]')});need(await card.count()===1,'ui_identity');
   if(row.japanSupplierPower){
    const label=card.locator('[data-japan-supplier-power="true"]');
    await label.scrollIntoViewIfNeeded();need(await label.isVisible()&&(await label.innerText()).includes(row.japanSupplierPower.hp+' л.с.'),'ui_supplier_power');supplierVisible++;
   }else if(row.japanPowerUnknown===true){
    const label=card.locator('[data-japan-power-unknown="true"]');
    await label.scrollIntoViewIfNeeded();need(await label.isVisible()&&(await label.innerText()).includes('Мощность не указана'),'ui_unknown_power');unknownVisible++;
   }
  }
  need(await main.getByText('Показаны сохранённые автомобили. Полный список пока недоступен.',{exact:true}).count()===0,'ui_stale');
  if(requireBrandDirectory){
   stage='stability_brand_directory_desktop';
   report.checks.brandDirectory={contract:'source-counts-v1',desktopProgress:{}};
   const checked=await checkJapanStabilityBrandControl({view:page,controls:main,
    rail:main.locator('section.ac-brand-rail[aria-label="Марки автомобилей"]'),visibleRows:power.data.items,
    progress:report.checks.brandDirectory.desktopProgress,
    capture:view=>capture(view,'japan-complete-source-brands-desktop'),
    onResponse:value=>{report.japanBrandDirectoryUiRequests++;recordJapanResponse(report,stage,value,releaseSha);}});
   stabilityBrandDirectory=checked.directory;
   report.checks.brandDirectory.desktop=checked.proof;
  }
  if(usability){
   stage='brand_directory_rail';
   const rail=main.locator('[data-japan-brand-directory="rail"][data-status="ready"][data-directory-complete="true"]');
   await rail.waitFor({state:'visible',timeout:60_000});
   const names=await rail.locator('a[title^="Автомобили "]').evaluateAll(nodes=>nodes.map(node=>(node.getAttribute('title')||'').slice('Автомобили '.length,-' под заказ'.length)).sort((a,b)=>a.localeCompare(b,'ru')));
   need(JSON.stringify(names)===JSON.stringify(brandDirectory.makes),'brand_rail_names');
   need(await main.getByText('Марка не найдена',{exact:true}).count()===0,'brand_rail_false_empty');
   const railBox=await rail.boundingBox(),firstCard=await cards.first().boundingBox();
   need(railBox&&firstCard&&railBox.y+railBox.height<=firstCard.y,'brand_rail_layout');
   report.checks.brandDirectory.railMakes=names.length;report.checks.brandDirectory.aboveCars=true;
   need(await main.locator('[data-japan-power-summary-page]').count()===0
    &&!/(?:Отбор не подтверждает право|Мощность по данным поставщика:\s*\d)/u.test(await main.innerText()),'catalog_warning');
   quietChecks.push({path:'/cars/japan',view:'grid',warningAbsent:true});
  }
  report.checks.ui={cards:await cards.count(),supplierVisible,unknownVisible,durationMs:Date.now()-start,city:CITY,
   powerTo:160,pageErrors};
  await capture(page,'japan-power-desktop');
  stage='power_list';
  await page.getByRole('button',{name:'Список',exact:true}).click();
  await main.locator('article.ac-catalog-list-row').first().waitFor({state:'visible',timeout:15_000});
  need(await main.locator('article.ac-catalog-list-row').count()===power.data.items.length,'list_count');
  for(const row of power.data.items){
   const card=main.locator('article.ac-catalog-list-row').filter({has:page.locator('a[href*="'+row.id+'"]')});
   if(row.japanSupplierPower){
    const label=card.locator('[data-japan-supplier-power="true"]');
    await label.scrollIntoViewIfNeeded();need(await label.isVisible()&&(await label.innerText()).includes(row.japanSupplierPower.hp+' л.с.'),'list_supplier_power');
   }else if(row.japanPowerUnknown===true){
    const label=card.locator('[data-japan-power-unknown="true"]');
    await label.scrollIntoViewIfNeeded();need(await label.isVisible()&&(await label.innerText()).includes('Мощность не указана'),'list_unknown_power');
   }
  }
  report.checks.ui.listCards=power.data.items.length;
  await capture(page,'japan-power-list');
  await page.getByRole('button',{name:'Плитка',exact:true}).click();
  await main.locator('article.ac-catalog-card').first().waitFor({state:'visible',timeout:15_000});
  const detailRow=power.data.items.find(row=>row.japanSupplierPower)||power.data.items.find(row=>row.japanPowerUnknown)||power.data.items[0];
  const detailHref=await cards.filter({has:page.locator('a[href*="'+detailRow.id+'"]')}).locator('a[href*="'+detailRow.id+'"]').first().getAttribute('href');
  const detailUrl=new URL(detailHref,ORIGIN);
  need(detailUrl.origin===ORIGIN&&detailUrl.pathname.startsWith('/cars/offer/')&&detailUrl.pathname.includes(detailRow.id),'detail_link');
  await page.setViewportSize({width:390,height:900});await cards.first().scrollIntoViewIfNeeded();
  await capture(page,'japan-power-mobile');need(pageErrors===0,'page_errors');
  if(pagination){
   stage='pagination_power_page_two';
   report.checks.pagination24.power=await checkPaginationUi(page,power.data,'power');
   need(pageErrors===0,'pagination_power_javascript');await capture(page,'japan-power-page-two-mobile');
  }
  stage='power_detail';
  const detailResponse=await page.goto(detailUrl.href,{waitUntil:'domcontentloaded',timeout:90_000});
  need(detailResponse?.status()===200,'detail_http');
  await page.locator('#offer-parameters').waitFor({state:'attached',timeout:60_000});
  if(detailRow.japanSupplierPower){
   const label=page.locator('[data-japan-supplier-power]').first();await label.scrollIntoViewIfNeeded();
   need(await label.isVisible()&&(await label.innerText()).includes(detailRow.japanSupplierPower.hp+' л.с.'),'detail_supplier_power');
  }else if(detailRow.japanPowerUnknown){
   // A detail read may supply a previously absent field; it must still disclose
   // the source or the absence rather than silently inventing calculation power.
   const label=page.locator('[data-japan-supplier-power],[data-japan-power-unknown]').first();
   await label.scrollIntoViewIfNeeded();need(await label.isVisible(),'detail_unknown_power');
  }
  report.checks.ui.detailOpened=true;report.checks.ui.detailSourceKind=detailRow.japanSupplierPower?'supplier':detailRow.japanPowerUnknown?'unknown':'local';
  await capture(page,'japan-detail-mobile');need(pageErrors===0,'detail_javascript');report.japanUiPassed=true;
  await page.close();currentPage=null;
  report.checks.visibility=[];
  for(const pathname of ['/','/cars']){
   stage=pathname==='/'?'home_visibility':'catalog_visibility';
   const view=await context.newPage();currentPage=view;let errors=0;view.on('pageerror',()=>{errors++;});
   const began=Date.now(),result=await navigateJapanOverview(view,pathname,timingPolicy);
   need(result?.status()===200,'overview_http');
   const rail=view.locator('[data-japan-auction-rail="true"][data-status="ready"]');
   await rail.locator('h2').filter({hasText:'Япония'}).waitFor({state:'visible',timeout:60_000});
   await rail.locator(CARD).first().waitFor({state:'attached',timeout:60_000});
   const link=rail.locator('a[href*="/cars/japan"]').filter({hasText:'Все'}).first();
   need(await link.count()===1,'overview_link');
   const href=new URL(await link.getAttribute('href'),ORIGIN);
   need(href.pathname==='/cars/japan'&&href.searchParams.get('city')===CITY,'overview_city');
   await rail.scrollIntoViewIfNeeded();
   await capture(view,pathname==='/'?'japan-home-desktop':'japan-catalog-desktop');
   await view.setViewportSize({width:390,height:900});await rail.scrollIntoViewIfNeeded();
   await capture(view,pathname==='/'?'japan-home-mobile':'japan-catalog-mobile');
   need(errors===0,'overview_javascript');
   report.checks.visibility.push({path:pathname,headingVisible:true,cards:await rail.locator(CARD).count(),
    linkCityMatched:true,durationMs:Date.now()-began,pageErrors:errors});
   await view.close();currentPage=null;
  }
  report.japanVisibilityPassed=true;
  if(completion){
   stage='completion_city_hydration';
   await context.addCookies([{name:'avtocena_city',value:encodeURIComponent('Москва'),url:ORIGIN,sameSite:'Lax'}]);
   const view=await context.newPage();currentPage=view;let errors=0;view.on('pageerror',()=>{errors++;});
   await view.setViewportSize({width:390,height:900});
   // Seed the previous visitor choice once. A detail navigation must retain the
   // city adopted by the real catalog UI rather than reseeding storage again.
   await view.addInitScript(()=>{
    if(location.origin==='https://avtocena.com'&&!sessionStorage.getItem('japan-completion-city-seeded')){
     localStorage.setItem('avtocena_city','Москва');sessionStorage.setItem('japan-completion-city-seeded','1');
    }
   });
   const started=Date.now(),baseQuery=new URLSearchParams({fuel:'petrol',city:CITY});
   const initial=await view.goto(ORIGIN+'/cars/japan?'+baseQuery,{waitUntil:'domcontentloaded',timeout:90_000});
   need(initial?.status()===200,'petrol_page_http');
   const catalog=view.locator('main.ac-ajes-catalog');
   await catalog.locator(CARD).first().waitFor({state:'visible',timeout:60_000});
   await view.getByRole('button',{name:'Открыть фильтры',exact:true}).click();
   const dialog=view.getByRole('dialog',{name:'Фильтры каталога',exact:true});
   await dialog.waitFor({state:'visible',timeout:15_000});
   const cityButton=dialog.locator('.ac-catalog-city-filter button').first();
   await cityButton.waitFor({state:'visible',timeout:15_000});
   need((await cityButton.innerText()).trim()===CITY&&new URL(view.url()).searchParams.get('city')===CITY,'city_hydration');
   if(usability){
    stage='brand_directory_filter';
    const trigger=dialog.getByRole('button',{name:'Выбрать марки автомобилей',exact:true});
    await trigger.click();
    const directory=dialog.locator('[data-japan-brand-directory="filter"][data-status="ready"][data-directory-complete="true"]');
    await directory.waitFor({state:'visible',timeout:60_000});
    const names=await directory.locator('button[data-facet-value]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-facet-value')).filter(Boolean).sort((a,b)=>a.localeCompare(b,'ru')));
    need(JSON.stringify(names)===JSON.stringify(brandDirectory.makes),'brand_filter_names');
    report.checks.brandDirectory.filterMakes=names.length;report.checks.brandDirectory.sameCompleteDirectory=true;
    report.japanBrandDirectoryPassed=true;
    await capture(view,'japan-complete-brand-filter-mobile');await trigger.click();
   }
   stage='completion_petrol_power_toggle';
   const powerToggle=dialog.locator('input[type="checkbox"][name="powerTo"][value="160"]');
   need(!(await powerToggle.isChecked()),'petrol_initial_toggle');
   await powerToggle.check();
   await view.waitForURL(url=>url.searchParams.get('powerTo')==='160',{timeout:60_000});
   const toggled=new URL(view.url());
   need(japanPetrolPowerUrl(toggled.href),'petrol_toggle_query');
   if(await dialog.isVisible()){
    need(!/(?:^|\s)0\s+автомобил/u.test(await dialog.locator('.ac-mobile-filter-header [role="status"]').innerText()),'petrol_false_zero');
    need((await cityButton.innerText()).trim()===CITY,'city_after_toggle');
    await dialog.getByRole('button',{name:'Показать автомобили',exact:true}).click();
   }
   report.explicitJapanApiRequests++;
   let filtered=await read(PETROL_POWER);
   recordJapanResponse(report,stage,filtered,releaseSha);
   const aggregate={...verifyJapanPage(filtered.data,filtered.status,Date.now(),{countAcceptance:report.countAcceptance,query:PETROL_POWER}),...verifyPower(filtered.data,1,{query:PETROL_POWER})};
   const petrolFirst=filtered.data;
   if(usability)usabilityPages.push(petrolFirst);
   need(filtered.data.items.every(row=>row.fuel==='petrol'),'petrol_api_fuel');
   const visibleCards=catalog.locator(CARD);
   await visibleCards.nth(filtered.data.items.length-1).waitFor({state:'visible',timeout:60_000});
   need(await visibleCards.count()===filtered.data.items.length,'petrol_ui_count');
   for(const row of filtered.data.items){
    const card=visibleCards.filter({has:view.locator('a[href*="'+row.id+'"]')});
    await card.waitFor({state:'attached',timeout:30_000});need(await card.count()===1,'petrol_ui_identity');
   }
   const shown=catalog.locator('p[role="status"]').filter({hasText:/^Показано\s+\d+/}).first();
   await shown.waitFor({state:'visible',timeout:15_000});
   need(new RegExp('^Показано\\s+'+filtered.data.items.length+'(?:\\s|$)').test((await shown.innerText()).trim()),'petrol_ui_shown');
   need(new URL(view.url()).searchParams.get('city')===CITY&&errors===0,'petrol_ui_city');
   report.checks.petrolPowerUi={...aggregate,city:CITY,previousCity:'Москва',cityPreserved:true,
    toggledThroughUi:true,cards:await visibleCards.count(),durationMs:Date.now()-started,pageErrors:errors};
   await visibleCards.first().scrollIntoViewIfNeeded();await capture(view,'japan-petrol-power-city-mobile');
   if(requireBrandDirectory){
    // These are the existing fresh API rows whose identities have just been
    // matched to this exact page; no additional source read certifies fallback.
    stage='stability_brand_directory_mobile';
    await view.getByRole('button',{name:'Открыть фильтры',exact:true}).click();
    await dialog.waitFor({state:'visible',timeout:15_000});
    report.checks.brandDirectory.mobileProgress={};
    const checked=await checkJapanStabilityBrandControl({view,controls:dialog,visibleRows:filtered.data.items,
     expectedDirectory:stabilityBrandDirectory,progress:report.checks.brandDirectory.mobileProgress,
     capture:view=>capture(view,'japan-complete-source-brands-mobile'),
     onResponse:value=>{report.japanBrandDirectoryUiRequests++;recordJapanResponse(report,stage,value,releaseSha);}});
    report.checks.brandDirectory.mobile=checked.proof;
    report.checks.brandDirectory.sameSourceDirectory=true;
    verifyJapanStabilityBrandRequestCount(report.japanBrandDirectoryUiRequests,
     [report.checks.brandDirectory.desktop,checked.proof]);
    report.japanBrandDirectoryPassed=true;
    await dialog.getByRole('button',{name:'Свернуть фильтры',exact:true}).click();
   }
   if(pagination)await checkPaginationWarning(catalog);
   stage='completion_petrol_power_page_two';
   const firstIds=new Set(filtered.data.items.map(row=>row.id));
   const next=catalog.locator('nav.ac-pagination a[aria-label="Страница 2"]');
   await next.click();await view.waitForURL(url=>url.searchParams.get('page')==='2',{timeout:60_000});
   const nextUrl=new URL(view.url());
   need(japanPetrolPowerUrl(nextUrl.href,2),'petrol_page_two_query');
   const pageTwoApi=pagination?japanPaginationPageApi(nextUrl.href,{kind:'petrol_power',expectedCursor:petrolFirst.nextCursor,requirePowerOrder})
    :usability?japanPetrolPowerPageApi(nextUrl.href):PETROL_POWER_NEXT;
   if(stability)(report.checks.ssrPageReadEvidence??=[]).push({stage,kind:'petrol_power',
    ...await readJapanSsrPageEvidence(view,{page:2,after:nextUrl.searchParams.get('after')||''})});
   report.explicitJapanApiRequests++;filtered=await read(pageTwoApi,pagination?{paginationKind:'petrol_power',requirePowerOrder}:{});
   recordJapanResponse(report,stage,filtered,releaseSha);
   const nextAggregate={...verifyJapanPage(filtered.data,filtered.status,Date.now(),{countAcceptance:report.countAcceptance,query:pageTwoApi}),...verifyPower(filtered.data,2,{query:pageTwoApi})};
   need(filtered.data.items.every(row=>row.fuel==='petrol'&&!firstIds.has(row.id)),'petrol_page_two_rows');
   for(const row of filtered.data.items){
    const card=visibleCards.filter({has:view.locator('a[href*="'+row.id+'"]')});
    await card.waitFor({state:'attached',timeout:30_000});need(await card.count()===1,'petrol_page_two_identity');
   }
   need(await visibleCards.count()===filtered.data.items.length,'petrol_page_two_count');
   report.checks.petrolPowerUi.pageTwo={...nextAggregate,cityPreserved:true,distinctRows:true,navigatedThroughLink:true};
   report.japanPetrolPowerUiPassed=true;
   if(pagination){
    await checkPaginationWarning(catalog);
    report.checks.pagination24.petrolPower={...verifyJapanPaginationPair(petrolFirst,filtered.data,
     {observedUrl:nextUrl.href,kind:'petrol_power',firstStatus:200,nextStatus:filtered.status,requirePowerOrder,requireExactCount,countAcceptance:report.countAcceptance}),
     navigatedThroughLink:true,uiMatchesApi:true,cityPreserved:true,warningRemoved:true};
    need(['plain','power','petrolPower'].every(key=>report.checks.pagination24[key]?.followedEmittedCursor===true
     &&report.checks.pagination24[key]?.uiMatchesApi===true),'pagination_evidence');
    report.japanFullPagesPassed=true;report.japanPagination24Passed=true;
    report.japanCatalogWarningRemovedPassed=['plain','power','petrolPower'].every(key=>report.checks.pagination24[key]?.warningRemoved===true);
    if(requirePowerOrder){
     need(['power','petrolPower'].every(key=>report.checks.pagination24[key]?.powerOrder?.cursorVersion==='j2'
      &&report.checks.pagination24[key]?.powerOrder?.knownBeforeUnknown===true),'power_order_evidence');
     report.japanPowerOrderPassed=true;
    }
   }
   if(usability){
    usabilityPages.push(filtered.data);
    report.checks.fullPages=usabilityPages.map(verifyJapanFullPage);
    report.japanFullPagesPassed=true;
    report.checks.knownPowerOrder=verifyJapanKnownPowerOrder([petrolFirst,filtered.data]);
    report.japanKnownPowerOrderPassed=true;
    report.checks.vehiclePolicy=verifyJapanVisibleVehiclePolicy(usabilityPages);
    report.japanVehiclePolicyPassed=true;
    need(await catalog.locator('[data-japan-power-summary-page]').count()===0
     &&!/(?:Отбор не подтверждает право|Мощность по данным поставщика:\s*\d)/u.test(await catalog.innerText()),'catalog_warning');
    quietChecks.push({path:'/cars/japan',view:'mobile-page-two',warningAbsent:true});
    report.checks.quietCatalog={checks:quietChecks};report.japanQuietCatalogPassed=true;
   }
   await visibleCards.first().scrollIntoViewIfNeeded();await capture(view,'japan-petrol-power-page-two-mobile');
   const row=filtered.data.items.find(item=>item.japanSupplierPower?.combustionPreviewEligible===true
    &&!positive(item.powerHp)&&!positive(item.powerKw)&&!item.japanPowerUnknown
    &&positive(item.japanDeliveredPreview?.totalRub)
    &&item.sourceCurrency==='JPY'&&positive(item.sourcePrice)
    &&Number.isInteger(item.year)&&item.year>=2008&&item.year<=new Date().getUTCFullYear()+1
    &&Number.isInteger(item.engineCc)&&item.engineCc>=300&&item.engineCc<=3000
    &&(!item.vehicleCategory||item.vehicleCategory==='M1'||item.vehicleCategory==='unknown'));
   need(row,'petrol_calculation_sample');
   const selected=visibleCards.filter({has:view.locator('a[href*="'+row.id+'"]')});
   const cardPrice=selected.locator('[title="Предварительная стоимость под ключ по данным аукциона"] .ac-price');
   await cardPrice.waitFor({state:'visible',timeout:30_000});
   const listVisibleRub=Number((await cardPrice.innerText()).replace(/[^0-9]/g,''));
   need(positive(listVisibleRub),'petrol_catalog_delivered');
   const detailLink=selected.locator('a[href*="'+row.id+'"]').first();
   const href=await detailLink.getAttribute('href');
   const target=new URL(href,ORIGIN),offerPath='/cars/offer/'+row.id;
   need(target.origin===ORIGIN&&(target.pathname===offerPath||target.pathname.startsWith(offerPath+'/'))
    &&(!target.searchParams.has('city')||target.searchParams.get('city')===CITY),'petrol_detail_city_link');
   calculationGrant=japanCalculationReadGrant(row,CITY,target.href);
   stage='completion_detail_power';
   const calculationResponse=view.waitForResponse(response=>response.request().method()==='POST'
    &&response.url()===ORIGIN+'/api/catalog/offer/'+row.id+'/calculate',{timeout:90_000});
   // Observe the promise immediately so a failed detail navigation cannot leave
   // an unhandled response timeout while the report is being written.
   calculationResponse.catch(()=>{});
   await detailLink.click();await view.waitForURL(url=>url.href===target.href,{timeout:90_000});
   const detail=view.locator('main.ac-offer-page[data-offer-id="'+row.id+'"]');
   await detail.waitFor({state:'visible',timeout:60_000});
   const summary=detail.locator('summary[aria-label^="Мощность:"]');
   await summary.waitFor({state:'visible',timeout:60_000});await summary.click();
   const input=detail.locator('input[aria-label="Мощность, л.с."]');
   await input.waitFor({state:'visible',timeout:15_000});
   const detailPower=Number(await input.inputValue());
   need(detailPower===row.japanSupplierPower.hp,'detail_power_input');
   need((await detail.locator('[data-city-delivery]').innerText()).includes(CITY),'detail_city');
   report.checks.detailPower={offerIdentitySha256:sha(row.id),sourcePowerHp:row.japanSupplierPower.hp,
    inputPowerHp:detailPower,sameOffer:true,city:CITY};
   report.japanDetailPowerInputPassed=true;await summary.click();
   stage='completion_delivered_calculation';
   await calculationResponse;
   need(calculationGrant.response&&calculationGrant.requests>=1&&calculationGrant.requests<=2,'calculation_observed');
   const result=verifyJapanDeliveredCalculation(calculationGrant.response.data,calculationGrant.response.status,calculationGrant);
   const parameters=detail.locator('.ac-inline-parameters[data-share-year]');
   need(Number(await parameters.getAttribute('data-share-year'))===Number(calculationGrant.body.year)
    &&Number(await parameters.getAttribute('data-share-engine-cc'))===Number(calculationGrant.body.engineCc)
    &&await parameters.getAttribute('data-share-fuel')===calculationGrant.body.fuel
    &&Number(calculationGrant.body.powerHp)===detailPower,'calculation_parameters');
   const panel=detail.locator('.ac-offer-price-panel');
   await panel.locator('.ac-price-trend-label').filter({hasText:'Предварительно под ключ'}).waitFor({state:'visible',timeout:30_000});
   const visibleRub=Number((await panel.locator('.ac-price').innerText()).replace(/[^0-9]/g,''));
   need(visibleRub===Math.round(result.totalRub)&&listVisibleRub===visibleRub,'calculation_visible_total');
   need(Number(await detail.locator('[data-price-line="car"]').getAttribute('data-price-amount-rub'))===result.carRub,'calculation_visible_car');
   need((await detail.locator('[data-city-delivery]').innerText()).includes(CITY)&&errors===0,'calculation_visible_city');
   report.checks.deliveredCalculation={...result,requestPowerHp:Number(calculationGrant.body.powerHp),
    visibleRub,listVisibleRub,sourcePowerHp:row.japanSupplierPower.hp,ephemeral:true,saved:false};
   report.japanDeliveredCalculationPassed=true;
   await panel.scrollIntoViewIfNeeded();await capture(view,'japan-petrol-delivered-detail-mobile');
   calculationGrant=null;await view.close();currentPage=null;
  }
  if(stability){
   verifyJapanVisibleVehiclePolicy([plain[0],power.data]);
   const stabilityPageOptions=()=>({countAcceptance:report.countAcceptance,
    query:stage==='stability_combined_filters'?japanStabilitySearchApi('combined'):undefined});
   await runJapanStabilityBrowser({context,report,generationId:binding.generationId,capture,requirePriceSort,requireExactCount,requireSourcePriceOrder,
    countAcceptance:report.countAcceptance,
    onStage:value=>{stage=value;},onPage:value=>{currentPage=value;},
    read:async url=>{report.explicitJapanApiRequests++;const value=await read(url,{stability:true,priceSort:requirePriceSort});
     recordJapanResponse(report,stage,value,releaseSha);return value;},
    verifyPage:(payload,status)=>verifyJapanPage(payload,status,Date.now(),stabilityPageOptions()),
    verifyFullPage:payload=>verifyJapanFullPage(payload,stabilityPageOptions()),verifyPowerPage:verifyPower,
    pageReadEvidence:japanPageReadEvidence,readSsrPageEvidence:readJapanSsrPageEvidence,
    observeResponse:value=>recordJapanResponse(report,stage,value,releaseSha),
    verifyVehiclePolicy:verifyJapanVisibleVehiclePolicy,navigateLegacyMazdaThree:fence.navigateLegacyMazdaThree});
  }
  if(requireExactCount)await runJapanExactCountBrowser({context,report,capture,
   onStage:value=>{stage=value;},onPage:value=>{currentPage=value;},
   read:async url=>{report.explicitJapanApiRequests++;const value=await read(url,{stability:true,priceSort:requirePriceSort});
    recordJapanResponse(report,stage,value,releaseSha);return value;},
   verifyPage:verifyJapanPage,verifyFullPage:verifyJapanFullPage,verifyPowerPage:verifyPower,
   verifyVehiclePolicy:verifyJapanVisibleVehiclePolicy,verifyVisible:verifyJapanPriceSortVisible});
  if(requireSourceCount)await runJapanSourceCountBrowser({context,report,capture,auctionDatabaseLabel:requireSourcePriceOrder,
   onStage:value=>{stage=value;},onPage:value=>{currentPage=value;},
   read:async url=>{report.explicitJapanApiRequests++;const value=await read(url);
    recordJapanResponse(report,stage,value,releaseSha);return value;},
   observeResponse:value=>recordJapanResponse(report,stage,value,releaseSha),
   verifyPage:verifyJapanPage,verifyFullPage:verifyJapanFullPage,
   verifyPowerPage:verifyPower,pageReadEvidence:japanPageReadEvidence,readSsrPageEvidence:readJapanSsrPageEvidence,
   verifyVehiclePolicy:verifyJapanVisibleVehiclePolicy,verifyVisible:verifyJapanPriceSortVisible});
  else if(requireModelCoverage)await runJapanModelCoverageBrowser({context,report,capture,
   onStage:value=>{stage=value;},onPage:value=>{currentPage=value;},
   read:async url=>{report.explicitJapanApiRequests++;const value=await read(url);
    recordJapanResponse(report,stage,value,releaseSha);return value;},
   verifyPage:verifyJapanPage,verifyFullPage:verifyJapanFullPage,
   verifyVehiclePolicy:verifyJapanVisibleVehiclePolicy,verifyVisible:verifyJapanPriceSortVisible});
  stage='release_after';await health();
  report.passed=['japanFreshnessPassed','japanPowerApiPassed','japanUiPassed','japanVisibilityPassed','readOnlyBrowserFence',
   ...(completion?['japanPetrolPowerUiPassed','japanDetailPowerInputPassed','japanDeliveredCalculationPassed']:[]),
   ...(usability?USABILITY_GATES:[]),...(pagination?['japanFullPagesPassed','japanPagination24Passed','japanCatalogWarningRemovedPassed']:[]),
   ...(stability?JAPAN_STABILITY_GATES:[]),...(requirePowerOrder?['japanPowerOrderPassed']:[]),
   ...(requireBrandDirectory?['japanBrandDirectoryPassed']:[]),...(requirePriceSort?JAPAN_PRICE_SORT_GATES:[]),
   ...(requireExactCount?JAPAN_EXACT_COUNT_GATES:[]),...(requireModelCoverage?JAPAN_MODEL_COVERAGE_GATES:[]),
   ...(requireSourceCount?JAPAN_SOURCE_COUNT_GATES:[]),
   ...(requireA4Power160Continuation?JAPAN_A4_POWER160_CONTINUATION_GATES:[]),
   ...(requireSourcePriceOrder?['japanSourcePriceOrderPassed']:[])].every(key=>report[key]===true);
 }catch(error){
  const navigationCode=japanNavigationErrorCode(error);
  report.error={stage,code:/^japan_browser_[a-z_]+$/.test(error?.message||'')?error.message:'japan_browser_check_failed',
   timeout:error?.name==='TimeoutError',...(navigationCode==='unknown'?{}:{navigationCode})};
  if(currentPage&&/^[a-f0-9]{32}$/.test(nonce||''))await capture(currentPage,'failure').catch(()=>{});
 }finally{
  if(context)await context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});
  if(requireSourceCount)report.checkedAt=new Date().toISOString();
  collectJapanObservedTimings(report);
  await fs.writeFile(outputFile,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 }
 return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  need(process.argv.length===2,'arguments');
  const report=await runJapanBrowserAcceptance({oraclePath:process.env.ORACLE_PATH,releaseSha:process.env.EXPECTED_RELEASE_SHA,
   nonce:process.env.VERIFICATION_NONCE,outputFile:path.resolve(process.env.OUTPUT||path.join(ROOT,'catalog-next-japan-browser-report.json')),
   playwrightModule:process.env.PLAYWRIGHT_MODULE,chromeBin:process.env.CHROME_BIN,codeScope:process.env.CATALOG_CODE_SCOPE||SCOPE,
   requirePowerOrder:japanPowerOrderRequirement(process.env.CATALOG_JAPAN_POWER_ORDER_REQUIRED),
   requireBrandDirectory:japanBrandDirectoryRequirement(process.env.CATALOG_JAPAN_BRAND_DIRECTORY_REQUIRED),
   requirePriceSort:japanPriceSortRequirement(process.env.CATALOG_JAPAN_PRICE_SORT_REQUIRED),
   requireExactCount:japanExactCountRequirement(process.env.CATALOG_JAPAN_EXACT_COUNT_REQUIRED),
   requireModelCoverage:japanModelCoverageRequirement(process.env.CATALOG_JAPAN_MODEL_COVERAGE_REQUIRED),
   requireSourceCount:japanSourceCountRequirement(process.env.CATALOG_JAPAN_SOURCE_COUNT_REQUIRED),
   requireA4Power160Continuation:japanA4Power160ContinuationRequirement(process.env.CATALOG_JAPAN_A4_POWER160_CONTINUATION_REQUIRED),
   requireSourcePriceOrder:japanSourcePriceOrderRequirement(process.env.CATALOG_JAPAN_SOURCE_PRICE_ORDER_REQUIRED),
   timingPolicy:japanTimingPolicy(process.env.CATALOG_JAPAN_TIMING_POLICY)});
  console.log('JAPAN_BROWSER '+JSON.stringify(report));if(!report.passed)process.exitCode=1;
 }catch{console.error('japan_browser_report_failed');process.exitCode=1;}
}
