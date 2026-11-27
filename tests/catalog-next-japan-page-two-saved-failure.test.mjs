import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectSavedPageTwoFailure,verifySavedPageTwoInvocation}
 from '../scripts/catalog-next/japan-usability-saved-failure-20261126.mjs';

const env={REGCLOUD_S3_ACCESS_KEY_ID:'UNITTEST',REGCLOUD_S3_SECRET_ACCESS_KEY:'PRIVATE_SECRET'};
const pathname='/avtocena-staging-8120751/migration-staging/full-20261011/integrations/ajes/catalog-failure-pages/stats-list-2.json';
const hash=value=>createHash('sha256').update(value).digest('hex');
const source={table:'stats',kind:'list',page:2,pageSize:24,startedAt:'2026-11-27T07:57:50.000Z',
 finishedAt:'2026-11-27T07:57:51.000Z',httpStatus:200,outcome:'invalid_response',providerCode:null,
 sql:'SELECT PRIVATE_QUERY',clientIp:'203.0.113.17',endpoint:'https://private.example/feed',
 body:'PRIVATE_BODY',rows:[{private:'COMMERCIAL_DATA'}]};

test('page two performs one signed GET to its fixed current slot and emits only hash/time and finite optional phase',async()=>{
 let calls=0;
 const validation={version:1,phase:'page_shape',code:'row_limit_exceeded',rootKind:'array',rowCount:25,wireBytes:2048};
 const report=await inspectSavedPageTwoFailure({env,keys:['catalog/CRM/private.json'],fetcher:async(input,options)=>{
  calls++;const url=new URL(input);
  assert.equal(url.origin,'https://s3.regru.cloud');assert.equal(url.pathname,pathname);assert.equal(url.search,'');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert(options.signal instanceof AbortSignal);
  assert.match(options.headers.authorization,/^AWS4-HMAC-SHA256 Credential=UNITTEST\//);
  return new Response(JSON.stringify({...source,responseValidation:validation}),{status:200});
 }});
 assert.equal(calls,1);assert.equal(report.kind,'japan-page-two-saved-failure-v1');
 assert.equal(report.attribution,'saved_outer_request_metadata_only');
 assert.equal(report.supplierRequests,0);assert.equal(report.writes,0);assert.equal(report.historyReads,0);
 assert.deepEqual(report.records,[{slot:'stats-list-2',readStatus:'ok',startedAt:source.startedAt,finishedAt:source.finishedAt,
  kind:'list',outcome:'invalid_response',page:2,pageSize:24,httpStatus:200,providerCode:null,
  sqlSha256:hash(source.sql),sqlBytes:Buffer.byteLength(source.sql),responseValidation:validation}]);
 for(const privateValue of ['PRIVATE_SECRET','PRIVATE_QUERY','203.0.113.17','private.example','PRIVATE_BODY','COMMERCIAL_DATA'])
  assert.equal(JSON.stringify(report).includes(privateValue),false);
 for(const absent of ['clientIp','endpoint','sql','body','rows','runtimeSha','requestId'])
  assert.equal(Object.hasOwn(report.records[0],absent),false);
});

test('page two accepts old records without validation and omits an unsafe optional block without inventing attribution',async()=>{
 for(const extra of [{},{responseValidation:{version:1,phase:'decode',code:'json_invalid',body:'PRIVATE_RESPONSE'}}]){
  let calls=0;
  const report=await inspectSavedPageTwoFailure({env,fetcher:async()=>{calls++;return new Response(JSON.stringify({...source,...extra}));}});
  assert.equal(calls,1);assert.equal(report.records[0].readStatus,'ok');
  assert.equal(Object.hasOwn(report.records[0],'responseValidation'),false);
  assert.equal(JSON.stringify(report).includes('PRIVATE_RESPONSE'),false);
 }
});

test('page two preserves the 64 KiB body cap before and during streaming',async()=>{
 let cancelled=0,reads=0,calls=0;
 const header=await inspectSavedPageTwoFailure({env,fetcher:async()=>{calls++;return {status:200,
  headers:new Headers({'content-length':'65537'}),body:{cancel:async()=>{cancelled++;},getReader(){throw Error('must not read');}}};}});
 assert.equal(calls,1);assert.equal(cancelled,1);assert.equal(header.records[0].readStatus,'byte_limit');
 const streamed=await inspectSavedPageTwoFailure({env,fetcher:async()=>{calls++;return {status:200,headers:new Headers(),body:{getReader(){return{
  read:async()=>({done:false,value:Buffer.alloc(++reads===1?65536:1)}),cancel:async()=>{cancelled++;}
 };}}};}});
 assert.equal(calls,2);assert.equal(cancelled,2);assert.equal(reads,2);assert.equal(streamed.records[0].readStatus,'byte_limit');
 const boundary=await inspectSavedPageTwoFailure({env,fetcher:async()=>new Response(JSON.stringify(source).padEnd(65536,' '))});
 assert.equal(boundary.records[0].readStatus,'ok');
});

test('page two creates one 20-second deadline and cannot retry or read another slot after abort',async t=>{
 const controller=new AbortController(),deadlines=[];let calls=0;
 t.mock.method(AbortSignal,'timeout',milliseconds=>{deadlines.push(milliseconds);return controller.signal;});
 const report=await inspectSavedPageTwoFailure({env,fetcher:async(input,options)=>{
  calls++;assert.equal(new URL(input).pathname,pathname);assert.equal(options.signal,controller.signal);
  controller.abort();throw Error('PRIVATE_TIMEOUT');
 }});
 assert.deepEqual(deadlines,[20000]);assert.equal(calls,1);
 assert.deepEqual(report.records,[{slot:'stats-list-2',readStatus:'deadline'}]);
 assert.equal(JSON.stringify(report).includes('PRIVATE'),false);
});

test('page two missing/configuration/transport failures remain bounded without alternate reads',async()=>{
 let calls=0;
 const absent=await inspectSavedPageTwoFailure({env:{},fetcher:async()=>{calls++;throw Error('must not fetch');}});
 assert.equal(calls,0);assert.equal(absent.readStatus,'configuration_unavailable');
 for(const [status,wanted] of [[404,'missing'],[403,'unavailable'],[500,'unavailable']]){
  let reads=0,cancelled=0;
  const report=await inspectSavedPageTwoFailure({env,fetcher:async(input,options)=>{
   reads++;assert.equal(new URL(input).pathname,pathname);assert.equal(options.method,'GET');
   return {status,body:{cancel:async()=>{cancelled++;}}};
  }});
  assert.equal(reads,1);assert.equal(cancelled,1);assert.deepEqual(report.records,[{slot:'stats-list-2',readStatus:wanted}]);
 }
 const failed=await inspectSavedPageTwoFailure({env,fetcher:async()=>{calls++;throw Error('PRIVATE_SECRET SQL visitorIp=203.0.113.17');}});
 assert.equal(calls,1);assert.deepEqual(failed.records,[{slot:'stats-list-2',readStatus:'unavailable'}]);
 assert.equal(JSON.stringify(failed).includes('PRIVATE'),false);
});

test('page two invocation requires its exact reviewed workflow and supports only its own marker-only push',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'japan-page-two-invocation-'));
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const commit=message=>git(['-c','user.name=Offline test','-c','user.email=offline@example.invalid','commit','--quiet','-m',message]);
 try{
  git(['init','--quiet']);await fs.writeFile(path.join(root,'controller.txt'),'reviewed');git(['add','controller.txt']);commit('fixture');
  const sha=git(['rev-parse','HEAD']);
  const environment={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'jeep-jim/AvtoCena',GITHUB_REPOSITORY_ID:'1289722938',
   GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'12345',GITHUB_JOB:'inspect',
   GITHUB_WORKFLOW_REF:'jeep-jim/AvtoCena/.github/workflows/japan-page-two-saved-failure.yml@refs/heads/main',
   GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_SHA:sha,EXPECTED_CONTROLLER_SHA:sha};
  const checked=verifySavedPageTwoInvocation({root,environment});
  assert.equal(checked.sourceSha,sha);assert.equal(checked.approvedSourceSha,sha);assert.equal(checked.runId,'12345');
  for(const change of [{GITHUB_ACTIONS:'false'},{GITHUB_REPOSITORY_ID:'1'},{GITHUB_JOB:'release'},
   {GITHUB_RUN_ID:'0'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_REF:'refs/heads/other'},{EXPECTED_CONTROLLER_SHA:'f'.repeat(40)},
   {GITHUB_WORKFLOW_REF:environment.GITHUB_WORKFLOW_REF.replace('page-two','page-three')}])
   assert.throws(()=>verifySavedPageTwoInvocation({root,environment:{...environment,...change}}));
  const marker='.github/market-runs/japan-page-two-saved-failure.json';
  await fs.mkdir(path.dirname(path.join(root,marker)),{recursive:true});
  await fs.writeFile(path.join(root,marker),JSON.stringify({version:1,operation:'japan-page-two-saved-failure-v1',approvedSourceSha:sha}));
  git(['add',marker]);commit('dedicated page two marker');
  const head=git(['rev-parse','HEAD']),event=path.join(root,'event.json');
  await fs.writeFile(event,JSON.stringify({before:sha,after:head,ref:'refs/heads/main',created:false,deleted:false,forced:false}));
  const push={...environment,GITHUB_EVENT_NAME:'push',GITHUB_SHA:head,GITHUB_EVENT_PATH:event};
  const accepted=verifySavedPageTwoInvocation({root,environment:push});
  assert.equal(accepted.sourceSha,head);assert.equal(accepted.approvedSourceSha,sha);
  await fs.writeFile(path.join(root,'controller.txt'),'unreviewed');
  assert.throws(()=>verifySavedPageTwoInvocation({root,environment:push}));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('page two workflow mirrors the reviewed page-three workflow and runs new plus legacy gates before credentials',async()=>{
 const old=await fs.readFile(new URL('../.github/workflows/japan-page-three-saved-failure.yml',import.meta.url),'utf8');
 const workflow=await fs.readFile(new URL('../.github/workflows/japan-page-two-saved-failure.yml',import.meta.url),'utf8');
 const expected=old.replaceAll('page-three','page-two').replaceAll('page three','page two')
  .replace('tests/catalog-next-japan-page-two-saved-failure.test.mjs tests/readonly-marker-invocation.test.mjs',
   'tests/catalog-next-japan-page-two-saved-failure.test.mjs tests/catalog-next-japan-page-three-saved-failure.test.mjs tests/readonly-marker-invocation.test.mjs');
 assert.equal(workflow,expected);
 const beforeCredentials=workflow.slice(0,workflow.indexOf('secrets.REGCLOUD_'));
 for(const check of ['node scripts/verify-frozen-speed-baselines.mjs','--verify-page-two',
  'tests/catalog-next-japan-page-two-saved-failure.test.mjs tests/catalog-next-japan-page-three-saved-failure.test.mjs tests/readonly-marker-invocation.test.mjs'])
  assert(beforeCredentials.includes(check));
 assert.equal((workflow.match(/secrets\./g)||[]).length,2);
 assert(workflow.includes('--run-page-two > japan-page-two-saved-failure-report.json'));
 for(const forbidden of ['schedule:','workflow_run:','SSH_PRIVATE_KEY','ssh ','curl ','npm ',
  'AJES_API_PASSWORD','list-objects','list-object-versions','delete-object','contents: write','continue-on-error:'])
  assert.equal(workflow.includes(forbidden),false,forbidden);
});
