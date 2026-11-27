import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {japanReleaseBinding,verifyJapanPage,verifyJapanWarmPage,verifyJapanPowerPage,japanVerificationRequestScope,installReadFence,japanResponseObservation,
 japanResponseHeaders,japanSourceReadEvidence,recordJapanResponse,runJapanBrowserAcceptance,
 japanCalculationReadGrant,checkedJapanCalculationRead,verifyJapanDeliveredCalculation,japanPetrolPowerUrl,verifyJapanFullPage,verifyJapanKnownPowerOrder,verifyJapanVisibleVehiclePolicy,verifyJapanBrandDirectory,japanPetrolPowerPageApi}
 from '../scripts/catalog-next/japan-browser-acceptance.mjs';
import {JAPAN_LEGACY_MAZDA_THREE_PAGES} from '../scripts/catalog-next/japan-stability-browser.mjs';

const now=Date.parse('2026-11-26T05:00:00Z'),release='a'.repeat(40),nonce='b'.repeat(32),manifest='c'.repeat(64);
const local={id:'ajes-stats-local1',market:'japan',powerHp:150};
const supplier={id:'ajes-stats-source2',market:'japan',japanSupplierPower:{offerId:'ajes-stats-source2',hp:160,unit:'hp',source:'ajes_pw'}};
const unknown={id:'ajes-stats-unknown3',market:'japan',japanPowerUnknown:true};
const copy=value=>structuredClone(value);
function page(){return {ok:true,stale:false,observedAt:new Date(now-1000).toISOString(),items:copy([local,supplier,unknown]),received:3,
 hasMore:true,total:null,countSummary:{total:600000,upperBound:true},powerFilterSummary:{shown:3,localPower:1,supplierPower:1,unknownPower:1}};}
const iso=ms=>new Date(ms).toISOString();
const receiptId=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const sourceReceipt=(n=1)=>({version:1,readId:receiptId(n),runtimeSha:release,
 readStartedAt:iso(now-500),readFinishedAt:iso(now-100),table:'stats',kind:'list',page:1,pageSize:48,
 canonicalQuerySha256:'d'.repeat(64),wireQuerySha256:'e'.repeat(64),disposition:'source_recovery',sourceAttempted:true,
 reason:'empty_response',sourceAttempt:{startedAt:iso(now-400),finishedAt:iso(now-200),httpStatus:200}});
function receiptPayload(receipts=[sourceReceipt()]){
 return {catalogReadReceipt:{version:1,readId:receiptId(999),runtimeSha:release,readStartedAt:iso(now-600),
  readFinishedAt:iso(now),sourceReadCalls:receipts.length},sourceReadReceipts:receipts,sourceReadReceiptsLimited:false};
}
const responseEvidence=()=>({version:1,mime:'html',encoding:'identity',bodyClass:'sql_unknown_column',
 bytesRead:167,truncated:false,readStatus:'complete'});
function non2xxReceipt(evidence=responseEvidence()){
 const receipt=sourceReceipt();receipt.reason='http_500';receipt.sourceAttempt.httpStatus=500;
 receipt.sourceAttempt.responseEvidence=evidence;return receipt;
}

test('Japan verification is bound to the new source, nonce and existing China generation',()=>{
 const oracle={version:1,runtimeSha:release,expectedGeneration:'gen_china_45655051136_1',generationManifestSha256:manifest};
 assert.deepEqual(japanReleaseBinding(oracle,release,nonce),{generationId:oracle.expectedGeneration,generationManifestSha256:manifest});
 for(const bad of [{...oracle,runtimeSha:'d'.repeat(40)},{...oracle,expectedGeneration:'latest'},{...oracle,generationManifestSha256:'bad'}])
  assert.throws(()=>japanReleaseBinding(bad,release,nonce),/japan_browser_oracle_binding/);
 assert.throws(()=>japanReleaseBinding(oracle,release,'anything'),/japan_browser_arguments/);
});

test('fresh nonempty rows and the actual source date are required; HTTP200 is insufficient',()=>{
 assert.equal(verifyJapanPage(page(),200,now).shown,3);
 for(const changed of [{stale:true},{partial:true},{scanLimited:true},{interrupted:true},{items:[]},
  {observedAt:new Date(now-1800000).toISOString()},{observedAt:new Date(now+60001).toISOString()},
  {items:[local,local]},{items:[{...local,market:'china'}]},{ok:false}])
  assert.throws(()=>verifyJapanPage({...page(),...changed},200,now),/japan_browser_/);
 assert.throws(()=>verifyJapanPage(page(),503,now),/japan_browser_http/);
});

test('warm proof does not manufacture a new observation or silently change rows',()=>{
 const a=page();assert.deepEqual(verifyJapanWarmPage(a,copy(a)),{sameObservation:true,sameRows:true});
 assert.throws(()=>verifyJapanWarmPage(a,{...copy(a),observedAt:new Date(now).toISOString()}),/warm_changed/);
 assert.throws(()=>verifyJapanWarmPage(a,{...copy(a),items:[unknown]}),/warm_changed/);
});

test('a rejected partial response preserves typed flags and counts without disclosing rows or upstream details',()=>{
 const value={...page(),partial:true,interrupted:true,scanLimited:true,received:24,
  supplierUrl:'https://private.example/?token=secret',visitorIp:'private',error:{raw:'private failure'}};
 const observed=japanResponseObservation(value,200);
 assert.deepEqual(observed,{status:200,ok:true,shown:3,received:24,observedAt:value.observedAt,
  stale:false,partial:true,interrupted:true,scanLimited:true,hasMore:true,total:null});
 assert.throws(()=>verifyJapanPage(value,200,now),/japan_browser_unavailable_or_stale/);
 assert.equal(JSON.stringify(observed).includes('private'),false);
 assert.equal(JSON.stringify(observed).includes('ajes-stats-'),false);
});

test('missing or wrongly typed response metadata is recorded as unknown, never a fabricated false or zero',()=>{
 const empty={status:null,ok:null,shown:null,received:null,observedAt:null,
  stale:null,partial:null,interrupted:null,scanLimited:null,hasMore:null,total:null};
 assert.deepEqual(japanResponseObservation(null,undefined),empty);
 assert.deepEqual(japanResponseObservation({ok:'true',items:{},received:'24',observedAt:'invalid',
  stale:'false',partial:0,interrupted:'false',scanLimited:1,hasMore:'true',total:-1},'200'),empty);
});

test('HTTP diagnostics keep bounded cache directives, opaque ETag fingerprints and proxy protocols only',()=>{
 const etag='W/"opaque-validator-secret"';
 const result=japanResponseHeaders({'cache-control':'private, max-age=15, stale-while-revalidate=30, internal-secret=do-not-copy',
  age:'12',etag,via:'1.1 internal-proxy-secret (internal-comment-secret), 2 edge-secret',
  'set-cookie':'session-cookie-secret','server':'server-secret','authorization':'credential-secret'});
 assert.deepEqual(result,{cacheControl:'private, max-age=15, stale-while-revalidate=30',ageSeconds:12,
  etag:{weak:true,sha256:createHash('sha256').update(etag).digest('hex')},via:{hops:2,protocols:['1.1','2']},omitted:['cache-control']});
 for(const secret of ['opaque-validator-secret','internal-secret','internal-proxy-secret','internal-comment-secret','edge-secret',
  'session-cookie-secret','server-secret','credential-secret','set-cookie','authorization'])assert.equal(JSON.stringify(result).includes(secret),false);
});

test('malformed and oversized headers are omitted without reflecting their contents',()=>{
 const result=japanResponseHeaders({'cache-control':'public, token=header-secret\r\nSet-Cookie: header-secret',age:'2147483648',
  etag:'header-secret',via:'1.1 '+ 'header-secret'.repeat(1000),'set-cookie':'header-secret'});
 assert.deepEqual(result,{omitted:['cache-control','age','etag','via']});
 assert.deepEqual(japanResponseHeaders({'cache-control':Array(17).fill('public').join(','),age:'-1',etag:'"bad\nsecret"',via:'garbage-secret'}),
  {omitted:['cache-control','age','etag','via']});
 assert.deepEqual(japanResponseHeaders(null),{omitted:[]});
});

test('source evidence retains current reads and a safe historical cooldown origin without relabelling attempts',()=>{
 const attempted=sourceReceipt(),cached={...sourceReceipt(2),disposition:'saved_cache',sourceAttempted:false,sourceAttempt:null,reason:null};
 const origin={runtimeSha:'f'.repeat(40),table:'stats',kind:'list',page:1,pageSize:48,
  canonicalQuerySha256:attempted.canonicalQuerySha256,wireQuerySha256:attempted.wireQuerySha256,
  attemptStartedAt:iso(now-30000),attemptFinishedAt:iso(now-29000),httpStatus:200,reason:'empty_response'};
 const cooldown={...cached,readId:receiptId(3),disposition:'cooldown_recovery',reason:'empty_response',cooldownOrigin:origin};
 const unknown={...cached,readId:receiptId(4),disposition:'shared_or_cached',sourceAttempted:null};
 const result=japanSourceReadEvidence(receiptPayload([attempted,cached,cooldown,unknown]),release);
 assert.equal(result.status,'recorded');assert.equal(result.runtimeMatchesExpected,true);assert.equal(result.omittedReceipts,0);
 assert.deepEqual(result.sourceReadReceipts,[attempted,cached,cooldown,unknown]);
 assert.deepEqual(result.omissions,[]);assert.equal(result.sourceReadReceiptsLimited,false);
 assert.equal(japanSourceReadEvidence(receiptPayload(), 'f'.repeat(40)).runtimeMatchesExpected,false);
 const unavailableRuntime=receiptPayload();unavailableRuntime.catalogReadReceipt.runtimeSha=null;
 assert.equal(japanSourceReadEvidence(unavailableRuntime,release).runtimeMatchesExpected,null);
 const tooLarge=sourceReceipt();tooLarge.reason='query_too_large';tooLarge.sourceAttempt.httpStatus=414;
 assert.equal(japanSourceReadEvidence(receiptPayload([tooLarge]),release).sourceReadReceipts[0].reason,'query_too_large');
});

test('empty validation marks a separate COUNT failure without relabelling the recorded LIST attempt',()=>{
 const receipt={...sourceReceipt(),reason:'invalid_response',emptyValidation:true};
 const result=japanSourceReadEvidence(receiptPayload([receipt]),release);
 assert.equal(result.status,'recorded');
 assert.equal(result.sourceReadReceipts[0].emptyValidation,true);
 assert.equal(result.sourceReadReceipts[0].kind,'list');
 assert.equal(result.sourceReadReceipts[0].sourceAttempt.httpStatus,200);
 assert.equal(result.sourceReadReceipts[0].reason,'invalid_response');
 assert.equal(Object.hasOwn(japanSourceReadEvidence(receiptPayload(),release).sourceReadReceipts[0],'emptyValidation'),false);
 for(const value of [false,'true',1,null,{private:'empty-validation-secret'}]){
  const omitted=japanSourceReadEvidence(receiptPayload([{...receipt,emptyValidation:value}]),release);
  assert.deepEqual(omitted.sourceReadReceipts,[]);assert.deepEqual(omitted.omissions,['source_receipt_malformed']);
  assert.equal(JSON.stringify(omitted).includes('empty-validation-secret'),false);
 }
});

test('bounded non2xx response classes survive as a detached observation while the original failure remains',()=>{
 const samples=[responseEvidence(),...['ban_refusal','sql_syntax','sql_unsupported_function'].map(bodyClass=>({...responseEvidence(),bodyClass})),
  {...responseEvidence(),mime:'json',encoding:'gzip',bodyClass:'json_unclassified'},
  {...responseEvidence(),mime:'text',encoding:'missing',bodyClass:'bot_refusal'},
  {...responseEvidence(),mime:'other',encoding:'other',bodyClass:'binary_unclassified',bytesRead:4096,truncated:true,readStatus:'limit'},
  {...responseEvidence(),mime:'missing',bodyClass:'empty',bytesRead:0,readStatus:'no_body'},
  ...['chunk_limit','timeout','aborted','read_error'].map(readStatus=>({...responseEvidence(),bodyClass:'unclassified',bytesRead:0,truncated:true,readStatus}))];
 for(const evidence of samples){
  const receipt=non2xxReceipt(evidence),result=japanSourceReadEvidence(receiptPayload([receipt]),release);
  assert.equal(result.status,'recorded');assert.equal(result.sourceReadReceiptsLimited,false);assert.deepEqual(result.omissions,[]);
  const observed=result.sourceReadReceipts[0];
  assert.equal(observed.reason,'http_500');assert.equal(observed.disposition,'source_recovery');assert.equal(observed.sourceAttempted,true);
  assert.equal(observed.sourceAttempt.httpStatus,500);assert.deepEqual(observed.sourceAttempt.responseEvidence,evidence);
  assert.notEqual(observed.sourceAttempt.responseEvidence,evidence);
  evidence.bytesRead=1;assert.notEqual(observed.sourceAttempt.responseEvidence.bytesRead,evidence.bytesRead);
 }
 const absent=non2xxReceipt();absent.sourceAttempt.responseEvidence=undefined;
 assert.equal(Object.hasOwn(japanSourceReadEvidence(receiptPayload([absent]),release).sourceReadReceipts[0].sourceAttempt,'responseEvidence'),false);
});

test('malformed or private response evidence is omitted rather than reflected or treated as successful source data',()=>{
 const secret='private-response-diagnostic-secret';
 const changes=[v=>v.version=2,v=>v.mime=secret,v=>v.encoding=secret,v=>v.bodyClass=secret,v=>v.readStatus=secret,
  v=>v.bytesRead=-1,v=>v.bytesRead=4097,v=>v.bytesRead=0.5,v=>v.bytesRead=Infinity,v=>v.bytesRead=NaN,v=>v.bytesRead='167',
  v=>v.truncated=1,v=>v.truncated=true,v=>v.readStatus='limit',v=>v.readStatus='chunk_limit',v=>v.readStatus='no_body',v=>v.readStatus='timeout',
  v=>v.body=secret,v=>v.bodySha256=secret,v=>v.url='https://source.invalid/?key='+secret,
  v=>v.rawHeaders={authorization:secret},v=>v.message=secret];
 for(const change of changes){
  const evidence=responseEvidence();change(evidence);
  const result=japanSourceReadEvidence(receiptPayload([non2xxReceipt(evidence)]),release);
  assert.equal(result.status,'partial');assert.deepEqual(result.sourceReadReceipts,[]);
  assert.equal(result.omittedReceipts,1);assert.deepEqual(result.omissions,['source_receipt_malformed']);
  assert.equal(JSON.stringify(result).includes(secret),false);
 }
 for(const value of [null,[],secret,42]){
  const result=japanSourceReadEvidence(receiptPayload([non2xxReceipt(value)]),release);
  assert.deepEqual(result.sourceReadReceipts,[]);assert.deepEqual(result.omissions,['source_receipt_malformed']);
 }
 for(const httpStatus of [null,200,204,299]){
  const receipt=non2xxReceipt();receipt.sourceAttempt.httpStatus=httpStatus;
  assert.deepEqual(japanSourceReadEvidence(receiptPayload([receipt]),release).sourceReadReceipts,[]);
 }
 for(const changesValue of [false,true]){
  let reads=0;const evidence=responseEvidence();
  Object.defineProperty(evidence,'bodyClass',{get(){reads++;if(!changesValue)throw Error(secret);return reads===1?'sql_unknown_column':secret;}});
  const poisoned=japanSourceReadEvidence(receiptPayload([non2xxReceipt(evidence)]),release);
  assert.deepEqual(poisoned.omissions,['source_receipt_malformed']);assert.equal(JSON.stringify(poisoned).includes(secret),false);
  assert.equal(reads,0);
 }
 const historical=sourceReceipt();historical.disposition='cooldown_recovery';historical.sourceAttempted=false;historical.sourceAttempt=null;
 historical.cooldownOrigin={runtimeSha:release,table:'stats',kind:'list',page:1,pageSize:48,canonicalQuerySha256:'d'.repeat(64),
  wireQuerySha256:'e'.repeat(64),attemptStartedAt:iso(now-1000),attemptFinishedAt:iso(now-900),httpStatus:500,reason:'http_500',
  responseEvidence:responseEvidence()};
 assert.deepEqual(japanSourceReadEvidence(receiptPayload([historical]),release).sourceReadReceipts,[]);
});

test('an observed SQL identifier is limited to a public enum and its matching error class',()=>{
 for(const [bodyClass,identifiers] of [
  ['sql_unknown_column',['id','year','auction_type','status','finish','marka_name','model_name','grade','auction_date','time','kpp','priv','kuzov','color','eng_v','pw','mileage','rate','serial','lot']],
  ['sql_unsupported_function',['concat_ws','length','trim','count']]])for(const identifier of identifiers){
  const evidence={...responseEvidence(),bodyClass,identifier};
  const observed=japanSourceReadEvidence(receiptPayload([non2xxReceipt(evidence)]),release);
  assert.equal(observed.status,'recorded');assert.equal(observed.sourceReadReceipts[0].sourceAttempt.responseEvidence.identifier,identifier);
 }
 for(const evidence of [
  {...responseEvidence(),identifier:'private_identifier_secret'}, {...responseEvidence(),identifier:'db.grade'},
  {...responseEvidence(),identifier:'GRADE'}, {...responseEvidence(),identifier:['grade']}, {...responseEvidence(),identifier:null},
  {...responseEvidence(),identifier:'grade',truncated:true,readStatus:'limit',bytesRead:4096},
  {...responseEvidence(),identifier:'concat_ws'}, {...responseEvidence(),bodyClass:'sql_unsupported_function',identifier:'grade'},
  {...responseEvidence(),bodyClass:'sql_syntax',identifier:'grade'}, {...responseEvidence(),bodyClass:'text_unclassified',identifier:'count'}]){
  const result=japanSourceReadEvidence(receiptPayload([non2xxReceipt(evidence)]),release);
  assert.deepEqual(result.sourceReadReceipts,[]);assert.deepEqual(result.omissions,['source_receipt_malformed']);
  assert.equal(JSON.stringify(result).includes('private_identifier_secret'),false);
 }
 const absent={...responseEvidence(),identifier:undefined};
 assert.equal(Object.hasOwn(japanSourceReadEvidence(receiptPayload([non2xxReceipt(absent)]),release)
  .sourceReadReceipts[0].sourceAttempt.responseEvidence,'identifier'),false);
 const accessor=responseEvidence();Object.defineProperty(accessor,'identifier',{enumerable:true,get(){throw Error('private_identifier_secret');}});
 const rejected=japanSourceReadEvidence(receiptPayload([non2xxReceipt(accessor)]),release);
 assert.deepEqual(rejected.omissions,['source_receipt_malformed']);assert.equal(JSON.stringify(rejected).includes('private_identifier_secret'),false);
});

test('unknown schema, private fields and malformed receipt values never reach the report',()=>{
 for(const change of [r=>r.version=2,r=>r.readId='visitor-secret',r=>r.runtimeSha='runtime-secret',
  r=>r.reason='private-provider-secret',r=>r.endpoint='https://supplier-secret/?password=credential-secret',
  r=>r.sourceAttempt.body='supplier-body-secret',r=>r.sourceAttempt.httpStatus='200',
  r=>r.readStartedAt='2026-11-26',r=>r.sourceAttempt.startedAt=iso(now-1000),r=>r.sourceAttempted=false,
  r=>r.pageSize=49,r=>r.canonicalQuerySha256='select private-commercial-sql',r=>r.table='china']){
  const value=sourceReceipt();change(value);
  const result=japanSourceReadEvidence(receiptPayload([value]),release);
  assert.equal(result.status,'partial');assert.equal(result.omittedReceipts,1);assert.deepEqual(result.sourceReadReceipts,[]);
  assert.deepEqual(result.omissions,['source_receipt_malformed']);
  assert.doesNotMatch(JSON.stringify(result),/visitor-secret|runtime-secret|private-provider-secret|supplier-secret|credential-secret|supplier-body-secret|private-commercial-sql/);
 }
 const value=receiptPayload();value.catalogReadReceipt.private='wrapper-secret';
 const result=japanSourceReadEvidence(value,release);
 assert.equal(result.catalogReadReceipt,null);assert.deepEqual(result.sourceReadReceipts,[]);
 assert.deepEqual(result.omissions,['catalog_receipt_malformed']);assert.equal(JSON.stringify(result).includes('wrapper-secret'),false);
 const cooldown=sourceReceipt();cooldown.disposition='cooldown_recovery';cooldown.sourceAttempted=false;cooldown.sourceAttempt=null;
 cooldown.cooldownOrigin={runtimeSha:release,table:'stats',kind:'list',page:1,pageSize:48,
  canonicalQuerySha256:'d'.repeat(64),wireQuerySha256:'e'.repeat(64),attemptStartedAt:iso(now-1000),
  attemptFinishedAt:iso(now-900),httpStatus:200,reason:'empty_response',clientIp:'203.0.113.7'};
 const hidden=japanSourceReadEvidence(receiptPayload([cooldown]),release);
 assert.deepEqual(hidden.sourceReadReceipts,[]);assert.equal(JSON.stringify(hidden).includes('203.0.113.7'),false);
 const poisoned=sourceReceipt();Object.defineProperty(poisoned,'sourceAttempt',{get(){throw Error('getter-private-secret');}});
 const safelyOmitted=japanSourceReadEvidence(receiptPayload([poisoned]),release);
 assert.equal(safelyOmitted.status,'omitted');assert.deepEqual(safelyOmitted.omissions,['source_evidence_malformed']);
 assert.equal(JSON.stringify(safelyOmitted).includes('getter-private-secret'),false);
});

test('receipt omission is explicit and at most eight current source observations are retained',()=>{
 assert.deepEqual(japanSourceReadEvidence({},release),{status:'missing',catalogReadReceipt:null,runtimeMatchesExpected:null,
  sourceReadReceipts:[],sourceReadReceiptsLimited:true,omittedReceipts:null,omissions:['catalog_receipt_missing']});
 const receipts=Array.from({length:1000},(_,i)=>sourceReceipt(i+1)),value=receiptPayload(receipts);
 value.catalogReadReceipt.sourceReadCalls=8;
 const result=japanSourceReadEvidence(value,release);
 assert.equal(result.sourceReadReceipts.length,8);assert.equal(result.omittedReceipts,992);assert.equal(result.sourceReadReceiptsLimited,true);
 assert.deepEqual(result.omissions,['source_receipt_limit','source_read_calls_mismatch']);
 assert.equal(result.sourceReadReceipts.at(-1).readId,receiptId(8));
 const duplicate=japanSourceReadEvidence(receiptPayload([sourceReceipt(),sourceReceipt()]),release);
 assert.equal(duplicate.sourceReadReceipts.length,1);assert.deepEqual(duplicate.omissions,['source_receipt_duplicate']);
 const absent=receiptPayload();delete absent.sourceReadReceipts;
 assert.deepEqual(japanSourceReadEvidence(absent,release).omissions,['source_receipts_missing']);
 const wrongType=receiptPayload();wrongType.sourceReadReceipts='receipt-secret';
 assert.deepEqual(japanSourceReadEvidence(wrongType,release).omissions,['source_receipts_malformed']);
});

test('new diagnostic evidence cannot turn a stale page into a passing page',()=>{
 const payload={...page(),...receiptPayload(),stale:true,partial:true,scanLimited:true},report={checks:{}};
 recordJapanResponse(report,'plain_first',{data:payload,status:200,requestedAt:now-50,receivedAt:now,
  durationMs:50,headers:{'cache-control':'private, max-age=15'}},release);
 assert.equal(report.checks.responses[0].sourceReadEvidence.status,'recorded');
 assert.equal(report.checks.responses[0].requestedAt,iso(now-50));assert.equal(report.checks.responses[0].receivedAt,iso(now));
 assert.throws(()=>verifyJapanPage(payload,200,now),/japan_browser_unavailable_or_stale/);
});

test('the real reporter writes request times and sanitized receipt before its stale failure, without network',async t=>{
 t.mock.timers.enable({apis:['Date'],now});
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'japan-receipt-report-'));
 const oraclePath=path.join(directory,'oracle.json'),outputFile=path.join(directory,'report.json'),fixtureKey='receipt-'+randomUUID();
 const calls=[],closed=[];
 const evidence={...responseEvidence(),identifier:'grade'};
 const payload={...page(),...receiptPayload([non2xxReceipt(evidence)]),stale:true,partial:true,scanLimited:true,received:48,
  supplierUrl:'https://source-secret/?password=source-secret',visitorIp:'203.0.113.8'};
 const context={route:async()=>{},close:async()=>{closed.push('context');},request:{get:async(url,options)=>{
  calls.push({url,options});t.mock.timers.tick(17);
  return {status:()=>200,headers:()=>({'cache-control':'private, max-age=15',etag:'"validator-secret"',via:'1.1 proxy-secret',
   'set-cookie':'cookie-secret'}),json:async()=>{t.mock.timers.tick(3);return url.endsWith('/api/health')
    ?{ok:true,releaseSha:release,calculationVersion:'4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90',private:'health-secret'}:payload;}};
 }}};
 globalThis[fixtureKey]={launch:async()=>({newContext:async()=>context,close:async()=>{closed.push('browser');}})};
 try{
  await fs.writeFile(oraclePath,JSON.stringify({version:1,runtimeSha:release,expectedGeneration:'gen_china_45655051136_1',generationManifestSha256:manifest}));
  const playwrightModule='data:text/javascript;base64,'+Buffer.from('export const chromium=globalThis['+JSON.stringify(fixtureKey)+'];').toString('base64');
  const report=await runJapanBrowserAcceptance({oraclePath,releaseSha:release,nonce,outputFile,playwrightModule,codeScope:'catalog-japan-usability-v1'});
  assert.equal(report.passed,false);assert.deepEqual(report.error,{stage:'plain_first',code:'japan_browser_unavailable_or_stale',timeout:false});
  const saved=JSON.parse(await fs.readFile(outputFile,'utf8'));assert.deepEqual(saved,report);
  assert.equal(saved.checks.health[0].releaseSha,release);assert.equal(saved.checks.health[0].requestedAt,iso(now));
  const observed=saved.checks.responses[0];
  assert.equal(observed.requestedAt,iso(now+20));assert.equal(observed.receivedAt,iso(now+40));assert.equal(observed.durationMs,20);
  assert.equal(observed.sourceReadEvidence.sourceReadReceipts[0].wireQuerySha256,'e'.repeat(64));
  assert.equal(observed.sourceReadEvidence.sourceReadReceipts[0].reason,'http_500');
  assert.equal(observed.sourceReadEvidence.sourceReadReceipts[0].sourceAttempt.httpStatus,500);
  assert.deepEqual(observed.sourceReadEvidence.sourceReadReceipts[0].sourceAttempt.responseEvidence,evidence);
  assert.equal(observed.stale,true);assert.equal(observed.scanLimited,true);assert.equal(saved.explicitJapanApiRequests,1);
  assert.equal(calls.length,2);assert.ok(calls[0].url.endsWith('/api/health'));assert.ok(calls[1].url.includes('/api/catalog/search?'));
  for(const call of calls)assert.deepEqual(call.options,{timeout:45000,maxRedirects:0,headers:{'Cache-Control':'no-cache'}});
  assert.doesNotMatch(JSON.stringify(saved),/source-secret|203\.0\.113\.8|validator-secret|proxy-secret|cookie-secret|health-secret/);
  assert.deepEqual(closed,['context','browser']);
 }finally{delete globalThis[fixtureKey];await fs.rm(directory,{recursive:true,force:true});}
});

test('integer supplier hp, local precedence and unknown labels preserve honest filtering',()=>{
 assert.deepEqual(verifyJapanPowerPage(page()),{shown:3,localPower:1,supplierPower:1,unknownPower:1,unknownRetainedAndLabelled:true,countHonest:true});
 for(const change of [row=>row.items[0].powerHp=161,row=>row.items[0].japanPowerUnknown=true,
  row=>row.items[0].japanSupplierPower=supplier.japanSupplierPower,
  row=>row.items[1].japanSupplierPower.hp=161,row=>row.items[1].japanSupplierPower.hp=159.5,
  row=>row.items[1].japanSupplierPower.hp='160',row=>row.items[1].japanSupplierPower.unit='kW',
  row=>row.items[1].japanSupplierPower.source='ajes_pw_first',row=>row.items[1].japanSupplierPower.offerId=unknown.id,
  row=>delete row.items[2].japanPowerUnknown,row=>row.powerFilterSummary.unknownPower=0,
  row=>row.total=600000,row=>row.countSummary.upperBound=false]){
  const value=page();change(value);assert.throws(()=>verifyJapanPowerPage(value),/japan_browser_/);
 }
});

test('only exhausted first-page local results may carry their exact count',()=>{
 const value={...page(),hasMore:false,total:3,countSummary:{total:3,upperBound:false}};
 assert.equal(verifyJapanPowerPage(value).countHonest,true);
 for(const changed of [{total:null},{total:600000},{countSummary:{total:600000,upperBound:false}},{countSummary:{upperBound:false}},{countSummary:{total:3,upperBound:true}}])
  assert.throws(()=>verifyJapanPowerPage({...value,...changed}),/japan_browser_exhausted_count/);
});

test('an exhausted second page cannot turn its own row count into a complete filtered total',()=>{
 const value={...page(),hasMore:false,total:null,countSummary:{total:600000,upperBound:true}};
 assert.equal(verifyJapanPowerPage(value,2).countHonest,true);
 for(const changed of [{total:3},{countSummary:{total:3,upperBound:false}}])
  assert.throws(()=>verifyJapanPowerPage({...value,...changed},2),/japan_browser_false_exact_count/);
});

test('actual unknown-only or local-only samples do not require invented supplier evidence',()=>{
 for(const [item,key] of [[unknown,'unknownPower'],[local,'localPower'],[supplier,'supplierPower']]){
  const value=page();value.items=[copy(item)];value.powerFilterSummary={shown:1,localPower:0,supplierPower:0,unknownPower:0};value.powerFilterSummary[key]=1;
  assert.equal(verifyJapanPowerPage(value)[key],1);
 }
});

test('browser verification cannot send mutations, visit private paths or call suppliers directly',()=>{
 assert.equal(japanVerificationRequestScope('https://avtocena.com/cars/japan?powerTo=160','GET'),'allowed');
 assert.equal(japanVerificationRequestScope('https://avtocena.com/api/catalog/search?market=japan','GET'),'allowed');
 for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(japanVerificationRequestScope('https://avtocena.com/api/leads',method),'mutation');
 for(const pathname of ['/crm/site','/api/crm/users','/api/admin/settings','/api/internal/read','/%61pi/admin/settings'])
  assert.equal(japanVerificationRequestScope('https://avtocena.com'+pathname,'GET'),'private');
 for(const url of ['https://ajes.com/api/','https://other.example/','https://secret@avtocena.com/','bad'])
  assert.equal(japanVerificationRequestScope(url,'GET'),'external');
});

test('only actual image resources may read the exact four AJ photo hosts and permitted rendition paths',()=>{
 for(const host of ['7.tru.ru','7.ajes.com','8.ajes.com','9.ajes.com']){
  for(const pathname of ['/img/Abc-123_4','/imgs/Abc-123_4&w=320','/img/Abc-123_4&h=50&w=320']){
   const url='https://'+host+pathname;
   for(const method of ['GET','HEAD'])assert.equal(japanVerificationRequestScope(url,method,'image'),'supplier_image');
   for(const resourceType of [undefined,'document','script','fetch','xhr'])
    assert.equal(japanVerificationRequestScope(url,'GET',resourceType),'external');
   assert.equal(japanVerificationRequestScope(url,'POST','image'),'mutation');
  }
 }
});

test('an image resource cannot disguise an AJ API, another host, credentials, port, query or fragment',()=>{
 for(const url of [
  'https://ajes.com/api/','https://7.ajes.com/api/','https://7.ajes.com/api/aj_bids.txt',
  'https://7.ajes.com/img/api/query','https://7.ajes.com/img/abc?sql=select',
  'https://7.ajes.com/img/abc?','https://7.ajes.com/img/abc#fragment',
  'https://7.ajes.com/img/abc#','https://7.ajes.com/img/abc%3Fw=320',
  'https://7.ajes.com/img/../api/','https://7.ajes.com/img/abc&sql=select',
  'https://7.ajes.com/img/abc&w=320&redirect=https://other.example/',
  'https://7.ajes.com:8443/img/abc','https://7.ajes.com:443/img/abc',
  'https://secret@7.ajes.com/img/abc','https://@7.ajes.com/img/abc',
  'https://7.ajes.com.evil.example/img/abc','https://6.ajes.com/img/abc','http://7.ajes.com/img/abc',
  'https://other.example/img/abc','https://7.ajes.com\\img\\abc',
 ])assert.equal(japanVerificationRequestScope(url,'GET','image'),'external',url);
});

async function fencedRequest({url,method='GET',resourceType='image',status=200,grant,body,headers,frameUrl,responseData={}}){
 let handler;
 const report={productionMutations:0,directSupplierApiRequests:0};
 await installReadFence({route:async(pattern,callback)=>{assert.equal(pattern,'**/*');handler=callback;}},report,
  grant?{getCalculationGrant:()=>grant}:{});
 const calls={fetch:0,fulfill:0,dispose:0,aborts:[],options:undefined};
 const response={status:()=>status,body:async()=>Buffer.from(JSON.stringify(responseData)),dispose:async()=>{calls.dispose++;}};
 await handler({request:()=>({url:()=>url,method:()=>method,resourceType:()=>resourceType,postData:()=>body,
   headers:()=>headers,frame:()=>({url:()=>frameUrl})}),
  fetch:async options=>{calls.fetch++;calls.options=options;return response;},
  fulfill:async input=>{assert.equal(input.response,response);calls.fulfill++;},
  abort:async code=>{calls.aborts.push(code);}});
 return {report,calls};
}

test('the installed fence forwards only allowed photo reads and counts supplier images separately from API requests',async()=>{
 const {report,calls}=await fencedRequest({url:'https://7.ajes.com/img/Abc_123&w=320'});
 assert.equal(report.readOnlyBrowserFence,true);assert.equal(report.supplierImageRequests,1);
 assert.equal(report.directSupplierApiRequests,0);assert.equal(report.productionMutations,0);
 assert.equal(calls.fetch,1);assert.equal(calls.fulfill,1);assert.equal(calls.dispose,1);
 assert.deepEqual(calls.options,{maxRedirects:0,timeout:90_000});assert.deepEqual(calls.aborts,[]);
 assert.deepEqual(report.blockedRequests,{mutation:0,external:0,private:0,redirect:0});
 const local=await fencedRequest({url:'https://avtocena.com/logo.svg'});
 assert.equal(local.calls.fetch,1);assert.equal(local.report.supplierImageRequests,0);
});

test('blocked requests never reach fetch or inflate the supplier image counter',async()=>{
 for(const input of [
  {url:'https://7.ajes.com/api/',scope:'external'},
  {url:'https://7.ajes.com/img/abc',resourceType:'document',scope:'external'},
  {url:'https://7.ajes.com/img/abc?redirect=1',scope:'external'},
  {url:'https://7.ajes.com/img/abc',method:'POST',scope:'mutation'},
  {url:'https://avtocena.com/api/admin/settings',scope:'private'},
 ]){
  const {report,calls}=await fencedRequest(input);
  assert.equal(calls.fetch,0);assert.equal(calls.fulfill,0);assert.equal(calls.dispose,0);
  assert.equal(report.supplierImageRequests,0);assert.equal(report.directSupplierApiRequests,0);
  assert.equal(report.blockedRequests[input.scope],1);assert.deepEqual(calls.aborts,['blockedbyclient']);
 }
});

test('a permitted supplier image cannot redirect into any API, foreign origin or private page',async()=>{
 for(const status of [301,302,303,307,308]){
  const {report,calls}=await fencedRequest({url:'https://7.ajes.com/img/abc',status});
  assert.equal(calls.fetch,1);assert.equal(calls.options.maxRedirects,0);assert.equal(calls.fulfill,0);
  assert.equal(calls.dispose,1);assert.deepEqual(calls.aborts,['blockedbyclient']);
  assert.equal(report.supplierImageRequests,1);assert.equal(report.blockedRequests.redirect,1);
  assert.equal(report.directSupplierApiRequests,0);
 }
});

async function legacyRedirectFence(options={}){
 let handler,stage=options.stage??true;
 const calls={navigate:[],fetch:[],fulfill:0,aborts:[],dispose:0};
 const report={codeScope:options.codeScope??'catalog-japan-stability-v1'};
 const context={route:async(_pattern,callback)=>{handler=callback;}},frame={};
 const dispatch=async(url,first)=>{
  const response={status:()=>first?(options.status??308):(options.nextStatus??200),
   headers:()=>({location:first?('location' in options?options.location:JAPAN_LEGACY_MAZDA_THREE_PAGES.canonical)
    :options.nextLocation??JAPAN_LEGACY_MAZDA_THREE_PAGES.literal}),dispose:async()=>{calls.dispose++;}};
  let aborted,fulfilled;
  await handler({request:()=>({url:()=>first?(options.source??url):url,
    method:()=>first?(options.method??'GET'):'GET',resourceType:()=>first?(options.resourceType??'document'):'document',
    isNavigationRequest:()=>options.navigation??true,redirectedFrom:()=>options.redirectedFrom??null,
    frame:()=>options.wrongFrame?{}:frame}),
   fetch:async settings=>{calls.fetch.push({url,settings});return response;},
   fulfill:async input=>{assert.equal(input.response,response);calls.fulfill++;fulfilled=response;},
   abort:async code=>{calls.aborts.push(code);aborted=code;}});
  if(first&&options.changeStage)stage=false;
  if(options.gotoError)throw Error(options.gotoError);
  if(aborted)throw Error('page.goto: net::ERR_BLOCKED_BY_CLIENT');
  return fulfilled;
 };
 const page={context:()=>options.wrongContext?{}:context,mainFrame:()=>frame,
  goto:async(url,settings)=>{calls.navigate.push({url,settings});return dispatch(url,calls.navigate.length===1);}};
 const fence=await installReadFence(context,report,{isLegacyMazdaThreeStage:()=>stage});
 return {run:()=>fence.navigateLegacyMazdaThree(page),ungranted:()=>dispatch(JAPAN_LEGACY_MAZDA_THREE_PAGES.literal,true),calls,report};
}

test('only the exact granted legacy document 308 is followed once through two separately fenced GETs',async()=>{
 for(const location of [JAPAN_LEGACY_MAZDA_THREE_PAGES.canonical,
  JAPAN_LEGACY_MAZDA_THREE_PAGES.canonical.slice('https://avtocena.com'.length)]){
  const fixture=await legacyRedirectFence({location});const result=await fixture.run();
  assert.equal(result.response.status(),200);
  assert.deepEqual(result.redirectProof,{status:308,redirects:1,sameOrigin:true,exactTarget:true,mainFrame:true});
  assert.deepEqual(fixture.calls.navigate,Object.values(JAPAN_LEGACY_MAZDA_THREE_PAGES).map(url=>
   ({url,settings:{waitUntil:'domcontentloaded',timeout:90_000}})));
  assert.deepEqual(fixture.calls.fetch,Object.values(JAPAN_LEGACY_MAZDA_THREE_PAGES).map(url=>
   ({url,settings:{maxRedirects:0,timeout:90_000}})));
  assert.equal(fixture.calls.fulfill,1);assert.equal(fixture.calls.dispose,2);
  assert.deepEqual(fixture.calls.aborts,['blockedbyclient']);
  assert.deepEqual(fixture.report.blockedRequests,{mutation:0,external:0,private:0,redirect:0});
  await assert.rejects(fixture.run(),/legacy_redirect_context/);
  assert.equal(fixture.calls.navigate.length,2);
  await assert.rejects(fixture.ungranted(),/ERR_BLOCKED_BY_CLIENT/);
  assert.equal(fixture.report.blockedRequests.redirect,1);
 }
});

test('legacy redirect grants reject other scopes, stages, frames, methods and request types',async()=>{
 for(const options of [
  {codeScope:'catalog-japan-pagination24-v1'},{codeScope:'catalog-japan-usability-v1'},
  {stage:false},{wrongContext:true},{changeStage:true},
  {wrongFrame:true},{navigation:false},{redirectedFrom:{}},
  ...['HEAD','POST','PUT','DELETE'].map(method=>({method})),
  ...['fetch','xhr','image','script'].map(resourceType=>({resourceType})),
 ]){
  const fixture=await legacyRedirectFence(options);
  await assert.rejects(fixture.run(),/legacy_redirect_context|ERR_BLOCKED_BY_CLIENT/);
  assert(fixture.calls.navigate.length<=1,JSON.stringify(options));
  assert(fixture.calls.fetch.length<=1,JSON.stringify(options));
  assert.equal(fixture.calls.fulfill,0);
 }
 const idle=await legacyRedirectFence();
 await assert.rejects(idle.ungranted(),/ERR_BLOCKED_BY_CLIENT/);
 assert.equal(idle.report.blockedRequests.redirect,1);
});

test('legacy navigation rejects every nonexact source or target and every other redirect status',async()=>{
 const {literal,canonical}=JAPAN_LEGACY_MAZDA_THREE_PAGES;
 const changed=value=>[
  value+'#',value+'#fragment',value+'&private=1',value+'&city=Новокузнецк',
  value.replace('avtocena.com','supplier.example'),value.replace('avtocena.com','7.ajes.com'),
  value.replace('https://','https://user:secret@'),value.replace('/cars/japan','/api/admin/japan'),
  value.replace('/cars/japan','/cars/../cars/japan'),value.replace('/cars/japan','/cars\\japan'),
  value.replace('/cars/japan','/cars/\njapan'),value.replace('https://avtocena.com','https://avtocena.com:443'),
  value.replace('city=','city=Other&oldcity='),
 ];
 for(const options of [
  ...changed(literal).map(source=>({source})),
  {source:literal.replace('make=Mazda','make=MAZDA')},{source:literal.replace('model=3','model=AXELA')},
  {source:literal.replace('model=3&','')},{source:literal+'&model=3'},
  ...changed(canonical).map(location=>({location})),
  {location:canonical.replace('/Mazda/3','/MAZDA/3')},{location:canonical.replace('/Mazda/3','/Mazda/AXELA')},
  {location:canonical+'&model=3'},{location:literal},{location:''},{location:undefined},
  ...[301,302,303,307].map(status=>({status})),
 ]){
  const fixture=await legacyRedirectFence(options);
  await assert.rejects(fixture.run(),/ERR_BLOCKED_BY_CLIENT/,JSON.stringify(options));
  assert.equal(fixture.calls.navigate.length,1);assert(fixture.calls.fetch.length<=1);
  assert.equal(fixture.calls.fulfill,0);
  assert.equal(fixture.report.checks?.legacyCanonicalRedirect,undefined);
 }
 for(const status of [200,304,404]){
  const fixture=await legacyRedirectFence({status});
  await assert.rejects(fixture.run(),/legacy_redirect_missing/);
  assert.equal(fixture.calls.navigate.length,1);
 }
});

test('a canonical second hop never redirects again and unrelated navigation errors never trigger fallback',async()=>{
 for(const nextStatus of [301,302,303,307,308])for(const nextLocation of [
  JAPAN_LEGACY_MAZDA_THREE_PAGES.literal,JAPAN_LEGACY_MAZDA_THREE_PAGES.canonical,
  'https://avtocena.com/api/admin/settings','https://7.ajes.com/api/',
 ]){
  const fixture=await legacyRedirectFence({nextStatus,nextLocation});
  await assert.rejects(fixture.run(),/ERR_BLOCKED_BY_CLIENT/);
  assert.equal(fixture.calls.navigate.length,2);assert.equal(fixture.calls.fetch.length,2);
  assert(fixture.calls.fetch.every(row=>row.settings.maxRedirects===0));
  assert.equal(fixture.calls.fulfill,0);assert.equal(fixture.report.blockedRequests.redirect,1);
 }
 for(const options of [{status:200,gotoError:'page.goto: net::ERR_BLOCKED_BY_CLIENT'},
  {gotoError:'page.goto: net::ERR_FAILED'},{gotoError:'Timeout 90000ms exceeded'}]){
  const fixture=await legacyRedirectFence(options);
  await assert.rejects(fixture.run());
  assert.equal(fixture.calls.navigate.length,1);
 }
});

const calculationRow=()=>({...copy(supplier),japanSupplierPower:{...copy(supplier.japanSupplierPower),combustionPreviewEligible:true},
 fuel:'petrol',year:2019,engineCc:660,sourcePrice:170000,sourceCurrency:'JPY'});
const calculationDraft=()=>({vehicleCategory:'',grossVehicleWeightKg:'',n1IceFuel:'',year:'2019',productionMonth:'',productionDay:'',
 transportToBorderRub:'',engineCc:'660',fuel:'petrol',powerHp:'160',powerKw:'117.6798',hybridKind:'',power30MinKw:'',icePowerKw:'',deliveryCity:'Новокузнецк'});
function calculationRequest(grant=japanCalculationReadGrant(calculationRow())){
 return {url:'https://avtocena.com/api/catalog/offer/'+grant.offerId+'/calculate',method:'POST',resourceType:'fetch',
  frameUrl:grant.detailUrl,headers:{origin:'https://avtocena.com','content-type':'application/json'},body:JSON.stringify(calculationDraft()),grant};
}
const calculationResult=()=>({requiresConfirmation:true,customs:{status:'ready'},totalRub:732137,
 currencyRate:{currency:'JPY',sourcePrice:170000,sourcePriceRub:82137},
 deliveryQuote:{city:'Новокузнецк',status:'estimated',amountRub:120000},
 breakdown:[{id:'car',amountRub:82137},{id:'delivery',amountRub:120000},{id:'fees',amountRub:530000}]});

test('the city and filter proof accepts both canonical Japan routes and preserves its actual page',()=>{
 const query=new URLSearchParams({fuel:'petrol',powerTo:'160',city:'Новокузнецк'});
 for(const base of ['/cars/japan?','/cars?market=japan&']){
  assert.equal(japanPetrolPowerUrl(base+query),true);
  assert.equal(japanPetrolPowerUrl(base+query+'&page=2',2),true);
  assert.equal(japanPetrolPowerUrl(base+query+'&page=2'),false);
 }
 for(const [field,value] of [['city','Москва'],['fuel','hybrid'],['powerTo','200']]){
  const bad=new URLSearchParams(query);bad.set(field,value);assert.equal(japanPetrolPowerUrl('/cars/japan?'+bad),false);
 }
 assert.equal(japanPetrolPowerUrl('/cars?market=china&'+query),false);
 assert.equal(japanPetrolPowerUrl('https://other.example/cars/japan?'+query),false);
});

test('the ephemeral calculation grant binds exact offer, scalar PW, year, volume and observed detail link',()=>{
 const row=calculationRow(),grant=japanCalculationReadGrant(row);
 assert.equal(grant.year,2019);assert.equal(grant.engineCc,660);assert.equal(grant.powerHp,160);
 assert.ok(checkedJapanCalculationRead(calculationRequest(grant),grant));
 const slug='https://avtocena.com/cars/offer/'+row.id+'/suzuki-alto-2019';
 const linked=japanCalculationReadGrant(row,'Новокузнецк',slug);
 assert.ok(checkedJapanCalculationRead(calculationRequest(linked),linked));
 for(const changed of [{market:'china'},{fuel:'hybrid'},{powerHp:150},{powerKw:110},{japanPowerUnknown:true},{year:0},{engineCc:0},
  {sourcePrice:null},{sourceCurrency:'USD'},{japanSupplierPower:{...row.japanSupplierPower,offerId:'ajes-stats-other'}},
  {japanSupplierPower:{...row.japanSupplierPower,combustionPreviewEligible:undefined}}])
  assert.throws(()=>japanCalculationReadGrant({...row,...changed}),/japan_browser_calculation_binding/);
 for(const href of ['https://other.example/cars/offer/'+row.id,slug+'?city=Москва',
  'https://avtocena.com/cars/offer/'+row.id+'other',slug+'#anything'])
  assert.throws(()=>japanCalculationReadGrant(row,'Новокузнецк',href),/japan_browser_calculation_detail_binding/);
});

test('all save/admin calls, other frames, other parameters, malformed JSON and excessive bodies stay blocked',()=>{
 const grant=japanCalculationReadGrant(calculationRow()),valid=calculationRequest(grant);
 const changes=[{method:'PUT'},{method:'GET'},{resourceType:'document'},
  {url:valid.url.replace('/calculate','/save')},{url:valid.url.replace('source2','other')},
  {url:valid.url+'?write=1'},{url:'https://avtocena.com/api/admin/save'},
  {frameUrl:'https://other.example/cars/offer/'+grant.offerId},
  {frameUrl:grant.detailUrl+'other'},{frameUrl:grant.detailUrl+'?city=Москва'},
  {headers:{origin:'https://other.example','content-type':'application/json'}},
  {headers:{origin:'https://avtocena.com','content-type':'text/plain'}},
  {body:'null'},{body:'[]'},{body:'{'},{body:'x'.repeat(4097)}];
 for(const value of changes)assert.equal(checkedJapanCalculationRead({...valid,...value},grant),null,JSON.stringify(value));
 for(const delta of [{powerHp:'159'},{year:'2018'},{engineCc:'1500'},{fuel:'hybrid'},{deliveryCity:'Москва'},
  {powerKw:'NaN'},{powerKw:'117'},{powerHp:160},{vehicleCategory:'N1'},{grossVehicleWeightKg:'1500'},
  {transportToBorderRub:'1'},{power30MinKw:'20'},{icePowerKw:'100'},{customsCalculationDate:'2026-01-01'},
  {productionMonth:'13'},{productionDay:'31'},{save:'1'}])
  assert.equal(checkedJapanCalculationRead({...valid,body:JSON.stringify({...calculationDraft(),...delta})},grant),null,JSON.stringify(delta));
 assert.equal(checkedJapanCalculationRead(valid,null),null);
});

test('the installed fence counts only its bounded read-only calculations and never forwards a third request or different body',async()=>{
 const grant=japanCalculationReadGrant(calculationRow()),request=calculationRequest(grant),value=calculationResult();
 const first=await fencedRequest({...request,responseData:value});
 assert.equal(first.calls.fetch,1);assert.equal(first.calls.fulfill,1);assert.equal(first.calls.dispose,1);
 assert.equal(first.report.japanPreviewCalculationRequests,1);assert.equal(first.report.productionMutations,0);
 assert.equal(first.report.directSupplierApiRequests,0);assert.equal(first.report.supplierImageRequests,0);
 assert.deepEqual(first.calls.options,{maxRedirects:0,timeout:90000});assert.equal(grant.requests,1);
 assert.deepEqual(grant.response,{status:200,data:value});
 const changed=await fencedRequest({...request,body:JSON.stringify({...calculationDraft(),productionMonth:'1'})});
 assert.equal(changed.calls.fetch,0);assert.equal(changed.report.blockedRequests.mutation,1);assert.equal(grant.requests,1);
 const second=await fencedRequest({...request,responseData:value});assert.equal(second.calls.fetch,1);assert.equal(grant.requests,2);
 const third=await fencedRequest({...request,responseData:value});assert.equal(third.calls.fetch,0);
 assert.equal(third.report.blockedRequests.mutation,1);assert.equal(grant.requests,2);
 const noGrant=await fencedRequest({...request,grant:undefined});assert.equal(noGrant.calls.fetch,0);
 const save=await fencedRequest({...calculationRequest(japanCalculationReadGrant(calculationRow())),url:request.url.replace('/calculate','/save')});
 assert.equal(save.calls.fetch,0);assert.equal(save.report.blockedRequests.mutation,1);
});

test('an allowed calculation never follows redirects into save or another service',async()=>{
 const grant=japanCalculationReadGrant(calculationRow());
 const result=await fencedRequest({...calculationRequest(grant),status:307});
 assert.equal(result.calls.fetch,1);assert.equal(result.calls.options.maxRedirects,0);assert.equal(result.calls.fulfill,0);
 assert.equal(result.report.blockedRequests.redirect,1);assert.equal(grant.response,null);
});

test('a real delivered result requires the same invoice, complete customs, selected city and a balanced ledger',()=>{
 const grant=japanCalculationReadGrant(calculationRow()),value=calculationResult();
 const result=verifyJapanDeliveredCalculation(value,200,grant);
 assert.equal(result.totalRub,732137);assert.equal(result.carRub,82137);assert.equal(result.city,'Новокузнецк');
 for(const mutate of [v=>v.requiresConfirmation=false,v=>v.customs.status='needs_data',v=>v.totalRub=82137,
  v=>v.deliveryQuote.city='Москва',v=>v.deliveryQuote.amountRub=0,v=>v.deliveryQuote.status='needs_quote',
  v=>v.currencyRate.sourcePrice=1,v=>v.currencyRate.currency='USD',v=>v.currencyRate.sourcePriceRub=100000,
  v=>v.breakdown[2].amountRub+=1,v=>v.breakdown[2].amountRub='530000',v=>v.breakdown=null]){
  const changed=copy(value);mutate(changed);assert.throws(()=>verifyJapanDeliveredCalculation(changed,200,grant));
 }
 assert.throws(()=>verifyJapanDeliveredCalculation(value,400,grant),/japan_browser_calculation_response/);
});


test('usability acceptance requires a full visible page when continuation exists',()=>{
 const full={items:Array.from({length:24},(_,i)=>({...local,id:'ajes-stats-full'+i})),hasMore:true};
 assert.equal(verifyJapanFullPage(full).fullOrExhausted,true);
 assert.throws(()=>verifyJapanFullPage({...full,items:full.items.slice(0,23)}),/short_page_with_more/);
 assert.equal(verifyJapanFullPage({...full,items:[local],hasMore:false}).shown,1);
 for(const flag of ['partial','interrupted','scanLimited'])assert.throws(()=>verifyJapanFullPage({...full,[flag]:true}),/usability_partial/);
});

test('usability ordering spans the page boundary and rejects repeated or interleaved rows',()=>{
 const first={items:[local,supplier]},second={items:[unknown]};
 assert.deepEqual(verifyJapanKnownPowerOrder([first,second]),{pages:2,known:2,unknown:1,knownBeforeUnknown:true,distinctRows:true});
 assert.throws(()=>verifyJapanKnownPowerOrder([{items:[local,unknown]},{items:[supplier]}]),/known_after_unknown/);
 assert.throws(()=>verifyJapanKnownPowerOrder([first,{items:[local]}]),/power_order_duplicate/);
 assert.throws(()=>verifyJapanKnownPowerOrder([{items:[{id:'ajes-stats-unlabelled'}]}]),/power_order_unlabelled/);
});

test('visible vehicle acceptance excludes explicit buses, trucks and heavy categories without excluding ordinary vans',()=>{
 const allowed=[{...local,model:'HIACE VAN',bodyType:'minivan',vehicleCategory:'M1'},
  {...supplier,model:'HIJET VAN',vehicleCategory:'N1',grossVehicleWeightKg:3500}];
 assert.deepEqual(verifyJapanVisibleVehiclePolicy([{items:allowed}]),{checked:2,excludedVehiclesVisible:0});
 for(const changed of [{bodyType:'bus'},{bodyType:'truck'},{bodyType:'special'},
  {vehicleCategory:'M2'},{vehicleCategory:'M3'},{vehicleCategory:'N2'},
  {grossVehicleWeightKg:3501},{model:'COASTER GX'},{model:'CIVILIAN BUS'}])
  assert.throws(()=>verifyJapanVisibleVehiclePolicy([{items:[{...local,...changed}]}]),/excluded_vehicle_visible/);
});


test('complete fresh Japan directory must exceed the reported seven page-local makes',()=>{
 const payload={directoryComplete:true,stale:false,generationId:new Date(now-1000).toISOString(),
  makes:['Toyota','Honda','Nissan','Mazda','Suzuki','Subaru','Daihatsu','Mitsubishi','Lexus']};
 const result=verifyJapanBrandDirectory(payload,200,now);
 assert.equal(result.complete,true);assert.equal(result.makes.length,9);
 for(const bad of [{...payload,makes:payload.makes.slice(0,7)},{...payload,makes:[...payload.makes,'Toyota']},
  {...payload,makes:[...payload.makes,'<invalid>']},{...payload,directoryComplete:false},{...payload,stale:true},
  {...payload,generationId:new Date(now-30*60_000).toISOString()}])
  assert.throws(()=>verifyJapanBrandDirectory(bad,200,now),/japan_browser_brand_directory/);
 assert.throws(()=>verifyJapanBrandDirectory(payload,503,now),/japan_browser_brand_directory/);
});

test('the live second page reuses only the cursor on the clicked Japan petrol power link',()=>{
 const cursor='jp1.'+'a'.repeat(32)+'.2.'+'b'.repeat(16);
 const query=new URLSearchParams({fuel:'petrol',city:'Новокузнецк',powerTo:'160',page:'2',after:cursor});
 const source='https://avtocena.com/cars/japan?'+query;
 const result=new URL(japanPetrolPowerPageApi(source),'https://avtocena.com');
 assert.equal(result.pathname,'/api/catalog/search');assert.equal(result.searchParams.get('after'),cursor);
 assert.equal(result.searchParams.get('pageSize'),'24');assert.equal(result.searchParams.get('market'),'japan');
 for(const bad of [source.replace('avtocena.com','example.invalid'),source+'&fuel=petrol',source+'&url=https://example.invalid',
  source.replace(cursor,cursor.replace('.2.','.3.')),source.replace('powerTo=160','powerTo=260'),source+'#fragment',
  source.replace('&after='+cursor,''),source.replace('avtocena.com','user:secret@avtocena.com')])
  assert.throws(()=>japanPetrolPowerPageApi(bad),/japan_browser_continuation/);
});
