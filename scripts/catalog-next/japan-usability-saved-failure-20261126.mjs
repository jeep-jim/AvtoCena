// Fixed saved failure objects only. No application imports, supplier calls or writes.
import {fileURLToPath} from 'node:url';
import {createHash,createHmac} from 'node:crypto';
import fs from 'node:fs/promises';
import {constants as fileConstants} from 'node:fs';
import path from 'node:path';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const releaseKeys=[['stats-list-1','integrations/ajes/catalog-failure-pages/stats-list-1.json'],['stats-count','integrations/ajes/catalog-failure-pages/stats-count.json'],['stats-latest','integrations/ajes/catalog-failure-stats.json']];
const pageThreeKeys=[['stats-list-3','integrations/ajes/catalog-failure-pages/stats-list-3.json']];
const pageTwoKeys=[['stats-list-2','integrations/ajes/catalog-failure-pages/stats-list-2.json']];
const stabilityKeys=[...pageThreeKeys,...releaseKeys];
const activeStabilityKeys=[releaseKeys[0],...pageTwoKeys,...pageThreeKeys,...releaseKeys.slice(1)];
const validationCodes={decode:['gzip_invalid','json_invalid'],page_shape:['root_not_array','row_limit_exceeded','row_not_object'],
 aggregate_shape:['total_invalid','count_row_count','make_name_missing'],empty_confirmation:['count_unavailable','count_unverified']};
const validationKeys=new Set(['version','phase','code','wireBytes','decodedBytes','rootKind','rowCount','originCode']);
const failureReasons=new Set(['client_ip_missing','visitor_restricted','not_configured','request_failed','request_timeout','connect_timeout',
 'quota_exhausted','quota_busy','quota_invalid','invalid_response','empty_response','response_too_large','identity_mismatch','query_too_large',
 'directory_unavailable','directory_too_large','directory_page_repeated','local_busy','market_not_supported','operation_failed']);
export function sanitizeSavedResponseValidation(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 let descriptors;try{descriptors=Object.getOwnPropertyDescriptors(value);}catch{return undefined;}
 const keys=Reflect.ownKeys(descriptors);
 if(keys.some(key=>!validationKeys.has(key)||!Object.hasOwn(descriptors[key],'value')))return undefined;
 const raw=Object.fromEntries(keys.map(key=>[key,descriptors[key].value]));
 if(raw.version!==1||typeof raw.phase!=='string'||typeof raw.code!=='string'
  ||!Object.hasOwn(validationCodes,raw.phase)||!validationCodes[raw.phase].includes(raw.code))return undefined;
 const result={version:1,phase:raw.phase,code:raw.code};
 for(const key of ['wireBytes','decodedBytes','rowCount'])if(Object.hasOwn(raw,key)){
  if(!Number.isSafeInteger(raw[key])||raw[key]<0||raw[key]>2097152)return undefined;
  result[key]=raw[key];
 }
 if(Object.hasOwn(raw,'rootKind')){
  if(!['array','object','string','number','boolean','null'].includes(raw.rootKind))return undefined;
  result.rootKind=raw.rootKind;
 }
 if(Object.hasOwn(raw,'rowCount')&&raw.rootKind!=='array')return undefined;
 if(raw.phase==='empty_confirmation'){
  if(typeof raw.originCode!=='string'
   ||!failureReasons.has(raw.originCode)&&!/^http_[45]\d\d$/.test(raw.originCode))return undefined;
  result.originCode=raw.originCode;
 }else if(Object.hasOwn(raw,'originCode'))return undefined;
 return result;
}
export const inspectSavedFailure=options=>inspectFixedSavedFailure(releaseKeys,options);
export async function inspectSavedPageTwoFailure(options){
 const report=await inspectFixedSavedFailure(pageTwoKeys,options);
 return {...report,kind:'japan-page-two-saved-failure-v1',attribution:'saved_outer_request_metadata_only',historyReads:0};
}
export async function inspectSavedPageThreeFailure(options){
 const report=await inspectFixedSavedFailure(pageThreeKeys,options);
 return {...report,kind:'japan-page-three-saved-failure-v1',attribution:'saved_outer_request_metadata_only',historyReads:0};
}
export async function inspectSavedStabilityFailure(options){
 // Read the volatile page-three slot first, sharing one deadline and byte budget
 // with the three existing release slots. There is no second read or fallback.
 const report=await inspectFixedSavedFailure(stabilityKeys,options);
 return {...report,kind:'japan-stability-saved-failure-v1',attribution:'saved_outer_request_metadata_only',historyReads:0};
}
export async function inspectSavedActiveStabilityFailure(options){
 const report=await inspectFixedSavedFailure(activeStabilityKeys,options,5000);
 return {...report,kind:'japan-stability-saved-failure-v1',attribution:'saved_outer_request_metadata_only',historyReads:0};
}
async function inspectFixedSavedFailure(keys,{env=process.env,fetcher=globalThis.fetch}={},deadlineMs=20000){
const hash=x=>createHash('sha256').update(x).digest('hex');
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
const int=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max?x:null;
const timestamp=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)&&Number.isFinite(Date.parse(x))?x:null;
const outcomes=/^(?:http_[1-5]\d{2}|visitor_restricted|request_failed|request_timeout|connect_timeout|quota_exhausted|quota_busy|local_busy|invalid_response|empty_response|query_too_large|response_too_large|identity_mismatch)$/;
const sanitize=value=>{
const responseValidation=sanitizeSavedResponseValidation(value?.responseValidation);
return {startedAt:timestamp(value?.startedAt),finishedAt:timestamp(value?.finishedAt),
 kind:['list','detail','count','models','makes','colors'].includes(value?.kind)?value.kind:null,
 outcome:typeof value?.outcome==='string'&&outcomes.test(value.outcome)?value.outcome:null,
 page:int(value?.page,1,1000000),pageSize:int(value?.pageSize,1,500),httpStatus:int(value?.httpStatus,100,599),
 providerCode:typeof value?.providerCode==='string'&&/^(?:bot|ban)\d{0,13}$/.test(value.providerCode)?value.providerCode:null,
 sqlSha256:typeof value?.sql==='string'?hash(value.sql):null,sqlBytes:typeof value?.sql==='string'?Buffer.byteLength(value.sql):null,
 ...(responseValidation?{responseValidation}:{})};};
let total=0;
const records=[];
try {
 if(!env.REGCLOUD_S3_ACCESS_KEY_ID||!env.REGCLOUD_S3_SECRET_ACCESS_KEY)throw Error();
 const endpoint=new URL('https://s3.regru.cloud');
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error();
 const bucket='avtocena-staging-8120751',access=env.REGCLOUD_S3_ACCESS_KEY_ID||'',secret=env.REGCLOUD_S3_SECRET_ACCESS_KEY||'';
 const region='us-east-1',prefix='migration-staging/full-20261011';
 if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)||!access||!secret||prefix.split('/').some(x=>x==='.'||x==='..'))throw Error();
 const signal=AbortSignal.timeout(deadlineMs);
 for(const [slot,key] of keys){
  if(signal.aborted){records.push({slot,readStatus:'deadline'});continue;}
  if(total>=128*1024){records.push({slot,readStatus:'byte_limit'});continue;}
  try {
   const full=[prefix,key].filter(Boolean).join('/').split('/').map(encodeURIComponent).join('/');
   const url=new URL(endpoint.href.replace(/\/+$/g,'')+'/'+bucket+'/'+full);
   if(url.origin!==endpoint.origin)throw Error();
   const date=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),day=date.slice(0,8),payload=hash('');
   const headers={host:url.host,'x-amz-content-sha256':payload,'x-amz-date':date};
   const signed=Object.keys(headers).sort().join(';');
   const canonical=Object.keys(headers).sort().map(k=>k+':'+headers[k].trim()+'\n').join('');
   const scope=day+'/'+region+'/s3/aws4_request';
   const toSign=['AWS4-HMAC-SHA256',date,scope,hash(['GET',url.pathname,'',canonical,signed,payload].join('\n'))].join('\n');
   const signing=hmac(hmac(hmac(hmac('AWS4'+secret,day),region),'s3'),'aws4_request');
   headers.authorization='AWS4-HMAC-SHA256 Credential='+access+'/'+scope+', SignedHeaders='+signed+', Signature='+createHmac('sha256',signing).update(toSign).digest('hex');
   const response=await fetcher(url,{method:'GET',headers,redirect:'error',signal});
   if(response.status!==200){await response.body?.cancel();records.push({slot,readStatus:response.status===404?'missing':'unavailable'});continue;}
   const limit=Math.min(64*1024,128*1024-total);
   if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();records.push({slot,readStatus:'byte_limit'});continue;}
   const reader=response.body?.getReader();if(!reader)throw Error();
   const chunks=[];let bytes=0,oversize=false;
   while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;bytes+=value.byteLength;
    if(bytes>limit||total>128*1024){oversize=true;await reader.cancel();break;}chunks.push(value);}
   if(oversize){records.push({slot,readStatus:'byte_limit'});continue;}
   const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
   records.push({slot,readStatus:'ok',...sanitize(value)});
  } catch {records.push({slot,readStatus:signal.aborted?'deadline':'unavailable'});}
 }
 return {version:1,kind:'japan-usability-saved-failure-v1',records,supplierRequests:0,writes:0};
} catch {return {version:1,kind:'japan-usability-saved-failure-v1',readStatus:'configuration_unavailable',records:[],supplierRequests:0,writes:0};}
}

const activeReportNeed=value=>{if(!value)throw Error('japan_active_stability_report_invalid');};
const exactObject=(value,required,optional=[])=>value&&typeof value==='object'&&!Array.isArray(value)
 &&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const isoTime=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value));
const boundedInteger=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const nullable=(value,check)=>value===null||check(value);
async function readLocalBoundedJson(filename,limit){
 const file=await fs.open(filename,fileConstants.O_RDONLY|fileConstants.O_NOFOLLOW);
 try{
  const stat=await file.stat();activeReportNeed(stat.isFile()&&stat.size>0&&stat.size<=limit);
  const bytes=Buffer.alloc(limit+1);let total=0;
  while(total<bytes.length){const {bytesRead}=await file.read(bytes,total,bytes.length-total,null);if(!bytesRead)break;total+=bytesRead;}
  activeReportNeed(total>0&&total<=limit);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,total));
  return {value:JSON.parse(text),text};
 }finally{await file.close();}
}
function checkedActiveRecord(record,slot){
 activeReportNeed(record?.slot===slot);
 if(record.readStatus!=='ok'){
  activeReportNeed(exactObject(record,['slot','readStatus'])
   &&['missing','unavailable','deadline','byte_limit'].includes(record.readStatus));
  return;
 }
 activeReportNeed(exactObject(record,['slot','readStatus','startedAt','finishedAt','kind','outcome','page','pageSize',
  'httpStatus','providerCode','sqlSha256','sqlBytes'],['responseValidation']));
 activeReportNeed(nullable(record.startedAt,isoTime)&&nullable(record.finishedAt,isoTime)
  &&nullable(record.kind,value=>['list','detail','count','models','makes','colors'].includes(value))
  &&nullable(record.outcome,value=>typeof value==='string'&&/^(?:http_[1-5]\d{2}|visitor_restricted|request_failed|request_timeout|connect_timeout|quota_exhausted|quota_busy|local_busy|invalid_response|empty_response|query_too_large|response_too_large|identity_mismatch)$/.test(value))
  &&nullable(record.page,value=>boundedInteger(value,1,1000000))
  &&nullable(record.pageSize,value=>boundedInteger(value,1,500))
  &&nullable(record.httpStatus,value=>boundedInteger(value,100,599))
  &&nullable(record.providerCode,value=>typeof value==='string'&&/^(?:bot|ban)\d{0,13}$/.test(value))
  &&nullable(record.sqlSha256,value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))
  &&nullable(record.sqlBytes,value=>boundedInteger(value,0,64*1024))
  &&(record.sqlSha256===null)===(record.sqlBytes===null));
 if(Object.hasOwn(record,'responseValidation'))activeReportNeed(sanitizeSavedResponseValidation(record.responseValidation)!==undefined);
}

/** Verify the already written local snapshot only. The checker has no storage
 * capability, does not rewrite the file and cannot trigger another source read. */
export async function verifySavedActiveStabilityReport({root=ROOT,environment=process.env}={}){
 const [saved,planFile,browserFile]=await Promise.all([
  readLocalBoundedJson(path.join(root,'catalog-next-japan-source-failure-report.json'),32*1024),
  readLocalBoundedJson(path.join(root,'.github/operations/catalog-next/china-code-serving-plan.json'),128*1024),
  readLocalBoundedJson(path.join(root,'catalog-next-japan-browser-report.json'),1024*1024),
 ]);
 const report=saved.value,plan=planFile.value,browser=browserFile.value;
 // Only our compact or two-space JSON encoding is accepted. This also rejects
 // duplicate keys whose overwritten raw value could otherwise escape validation.
 activeReportNeed([JSON.stringify(report),JSON.stringify(report,null,2)].some(text=>saved.text===text||saved.text===text+'\n'));
 activeReportNeed(exactObject(report,['version','kind','records','supplierRequests','writes','attribution','historyReads','capture'],['readStatus'])
  &&report.version===1&&report.kind==='japan-stability-saved-failure-v1'
  &&report.attribution==='saved_outer_request_metadata_only'
  &&report.supplierRequests===0&&report.writes===0&&report.historyReads===0&&Array.isArray(report.records));
 if(Object.hasOwn(report,'readStatus'))activeReportNeed(report.readStatus==='configuration_unavailable'&&report.records.length===0);
 else{
  activeReportNeed(report.records.length===activeStabilityKeys.length);
  report.records.forEach((record,index)=>checkedActiveRecord(record,activeStabilityKeys[index][0]));
 }
 const capture=report.capture;
 activeReportNeed(exactObject(capture,['version','stage','runtimeSha','controllerSha','nonce','failedStage','capturedAt'])
  &&capture.version===1&&capture.stage==='before_rollback'
  &&typeof capture.runtimeSha==='string'&&/^[a-f0-9]{40}$/.test(capture.runtimeSha)
  &&typeof capture.controllerSha==='string'&&/^[a-f0-9]{40}$/.test(capture.controllerSha)
  &&typeof capture.nonce==='string'&&/^[a-f0-9]{32}$/.test(capture.nonce)
  &&typeof capture.failedStage==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(capture.failedStage)
  &&isoTime(capture.capturedAt)&&capture.controllerSha===environment.GITHUB_SHA);
 activeReportNeed(plan?.version===1&&plan.market==='china'&&plan.codeScope==='catalog-japan-stability-v1'
  &&plan.runtimeSha===capture.runtimeSha&&browser?.version===1&&browser.kind==='catalog-japan-browser-v1'
  &&browser.codeScope==='catalog-japan-stability-v1'&&browser.passed===false
  &&browser.release===capture.runtimeSha&&browser.nonce===capture.nonce
  &&browser.error?.stage===capture.failedStage&&isoTime(browser.checkedAt)
  &&Date.parse(capture.capturedAt)>=Date.parse(browser.checkedAt));
 return {version:1,kind:'japan-active-stability-report-verification-v1',verified:true,
  runtimeSha:capture.runtimeSha,controllerSha:capture.controllerSha,nonce:capture.nonce,
  failedStage:capture.failedStage,capturedAt:capture.capturedAt};
}

export function verifySavedPageTwoInvocation({root=ROOT,environment=process.env}={}){
 if(environment.GITHUB_ACTIONS!=='true'
  ||environment.GITHUB_WORKFLOW_REF!=='jeep-jim/AvtoCena/.github/workflows/japan-page-two-saved-failure.yml@refs/heads/main'
  ||environment.GITHUB_JOB!=='inspect'||!/^[1-9][0-9]{0,19}$/.test(environment.GITHUB_RUN_ID??''))
  throw Error('japan_page_two_invocation_rejected');
 const invocation=verifyReadonlyInvocation({root,env:environment,
  markerPath:'.github/market-runs/japan-page-two-saved-failure.json',operation:'japan-page-two-saved-failure-v1'});
 return {...invocation,runId:environment.GITHUB_RUN_ID,attempt:'1'};
}

export function verifySavedPageThreeInvocation({root=ROOT,environment=process.env}={}){
 if(environment.GITHUB_ACTIONS!=='true'
  ||environment.GITHUB_WORKFLOW_REF!=='jeep-jim/AvtoCena/.github/workflows/japan-page-three-saved-failure.yml@refs/heads/main'
  ||environment.GITHUB_JOB!=='inspect'||!/^[1-9][0-9]{0,19}$/.test(environment.GITHUB_RUN_ID??''))
  throw Error('japan_page_three_invocation_rejected');
 const invocation=verifyReadonlyInvocation({root,env:environment,
  markerPath:'.github/market-runs/japan-page-three-saved-failure.json',operation:'japan-page-three-saved-failure-v1'});
 return {...invocation,runId:environment.GITHUB_RUN_ID,attempt:'1'};
}

export function verifySavedStabilityFailureInvocation({environment=process.env}={}){
 if(environment.GITHUB_ACTIONS!=='true'||environment.GITHUB_REPOSITORY_ID!=='1289722938'
  ||environment.GITHUB_REF!=='refs/heads/main'||environment.GITHUB_RUN_ATTEMPT!=='1'
  ||environment.GITHUB_WORKFLOW_REF!=='jeep-jim/AvtoCena/.github/workflows/catalog-next-china-photo-release.yml@refs/heads/main'
  ||environment.GITHUB_JOB!=='release'||!['push','workflow_dispatch'].includes(environment.GITHUB_EVENT_NAME)
  ||environment.CATALOG_CODE_SCOPE!=='catalog-japan-stability-v1')
  throw Error('japan_stability_saved_failure_invocation_rejected');
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 if(process.argv.length===3&&process.argv[2]==='--verify-active-stability-report'){
  try{
   verifySavedStabilityFailureInvocation();
   console.log(JSON.stringify(await verifySavedActiveStabilityReport()));
  }catch{console.log(JSON.stringify({version:1,kind:'japan-active-stability-report-verification-v1',verified:false}));process.exitCode=1;}
 }else if(process.argv.length===3&&['--verify-page-two','--run-page-two'].includes(process.argv[2])){
  try{
   const invocation=verifySavedPageTwoInvocation();
   if(process.argv[2]==='--verify-page-two')console.log(JSON.stringify({kind:'japan-page-two-invocation-v1',verified:true,sourceSha:invocation.sourceSha,supplierRequests:0,writes:0}));
   else{
    const report={...await inspectSavedPageTwoFailure(),controllerSha:invocation.sourceSha,
     approvedControllerSha:invocation.approvedSourceSha,runId:invocation.runId,attempt:invocation.attempt,checkedAt:new Date().toISOString()};
    console.log(JSON.stringify(report));
    if(report.readStatus||report.records.some(row=>!['ok','missing'].includes(row.readStatus)))process.exitCode=1;
   }
  }catch{console.log(JSON.stringify({readStatus:'invocation_rejected',supplierRequests:0,writes:0}));process.exitCode=1;}
 }else if(process.argv.length===3&&process.argv[2]==='--run-stability'){
  try{
   verifySavedStabilityFailureInvocation();
   const report=await inspectSavedStabilityFailure();
   console.log(JSON.stringify(report));
   if(report.readStatus||report.records.some(row=>!['ok','missing'].includes(row.readStatus)))process.exitCode=1;
  }catch{console.log(JSON.stringify({readStatus:'invocation_rejected',supplierRequests:0,writes:0}));process.exitCode=1;}
 }else if(process.argv.length===3&&['--verify-page-three','--run-page-three'].includes(process.argv[2])){
  try{
   const invocation=verifySavedPageThreeInvocation();
   if(process.argv[2]==='--verify-page-three')console.log(JSON.stringify({kind:'japan-page-three-invocation-v1',verified:true,sourceSha:invocation.sourceSha,supplierRequests:0,writes:0}));
   else{
    const report={...await inspectSavedPageThreeFailure(),controllerSha:invocation.sourceSha,
     approvedControllerSha:invocation.approvedSourceSha,runId:invocation.runId,attempt:invocation.attempt,checkedAt:new Date().toISOString()};
    console.log(JSON.stringify(report));
    if(report.readStatus||report.records.some(row=>!['ok','missing'].includes(row.readStatus)))process.exitCode=1;
   }
  }catch{console.log(JSON.stringify({readStatus:'invocation_rejected',supplierRequests:0,writes:0}));process.exitCode=1;}
 }else{
 const workflows=new Set(['japan-usability-saved-failure-20261126.yml','catalog-next-china-photo-release.yml'].map(name=>'jeep-jim/AvtoCena/.github/workflows/'+name+'@refs/heads/main'));
 if(process.argv.length!==3||process.argv[2]!=='--run'||process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY_ID!=='1289722938'||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_RUN_ATTEMPT!=='1'||!workflows.has(process.env.GITHUB_WORKFLOW_REF)||!['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)){
  console.log(JSON.stringify({readStatus:'invocation_rejected'}));process.exitCode=1;
 }else{const report=await inspectSavedFailure();console.log(JSON.stringify(report));if(report.readStatus||report.records.some(row=>!['ok','missing'].includes(row.readStatus)))process.exitCode=1;}
 }
}
