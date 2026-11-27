import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectSavedFailure,inspectSavedPageThreeFailure,verifySavedPageThreeInvocation,sanitizeSavedResponseValidation}
 from '../scripts/catalog-next/japan-usability-saved-failure-20261126.mjs';

const env={REGCLOUD_S3_ACCESS_KEY_ID:'UNITTEST',REGCLOUD_S3_SECRET_ACCESS_KEY:'PRIVATE_SECRET'};
const origin='https://s3.regru.cloud';
const prefix='/avtocena-staging-8120751/migration-staging/full-20261011/';
const pageThree=prefix+'integrations/ajes/catalog-failure-pages/stats-list-3.json';
const hash=value=>createHash('sha256').update(value).digest('hex');
const source={table:'stats',kind:'list',page:3,pageSize:24,startedAt:'2026-11-27T06:42:50.000Z',
 finishedAt:'2026-11-27T06:42:51.000Z',httpStatus:200,outcome:'invalid_response',providerCode:null,
 sql:'SELECT PRIVATE_QUERY',clientIp:'203.0.113.17',endpoint:'https://private.example/feed',
 body:'PRIVATE_BODY',rows:[{private:'COMMERCIAL_DATA'}]};

test('page three reader performs exactly one signed GET to its fixed existing slot and emits only safe metadata',async()=>{
 const calls=[];
 const report=await inspectSavedPageThreeFailure({env,keys:['catalog/CRM/private.json'],fetcher:async(input,options)=>{
  const url=new URL(input);calls.push(url.href);
  assert.equal(url.origin,origin);assert.equal(url.pathname,pageThree);assert.equal(url.search,'');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert(options.signal instanceof AbortSignal);
  assert.match(options.headers.authorization,/^AWS4-HMAC-SHA256 Credential=UNITTEST\//);
  return new Response(JSON.stringify(source),{status:200});
 }});
 assert.equal(calls.length,1);assert.equal(report.kind,'japan-page-three-saved-failure-v1');
 assert.equal(report.attribution,'saved_outer_request_metadata_only');
 assert.equal(report.supplierRequests,0);assert.equal(report.writes,0);assert.equal(report.historyReads,0);
 assert.deepEqual(report.records,[{slot:'stats-list-3',readStatus:'ok',startedAt:source.startedAt,finishedAt:source.finishedAt,
  kind:'list',outcome:'invalid_response',page:3,pageSize:24,httpStatus:200,providerCode:null,
  sqlSha256:hash(source.sql),sqlBytes:Buffer.byteLength(source.sql)}]);
 for(const privateValue of ['PRIVATE_SECRET','PRIVATE_QUERY','203.0.113.17','private.example','PRIVATE_BODY','COMMERCIAL_DATA'])
  assert.equal(JSON.stringify(report).includes(privateValue),false);
 for(const absent of ['clientIp','endpoint','sql','body','rows','rowCount','nestedCountOutcome'])
  assert.equal(Object.hasOwn(report.records[0],absent),false);
});

test('the existing release collector retains its three original slots and original report shape',async()=>{
 const paths=[];
 const report=await inspectSavedFailure({env,fetcher:async(input,options)=>{
  paths.push(new URL(input).pathname);assert.equal(options.method,'GET');return new Response(null,{status:404});
 }});
 assert.deepEqual(paths,[prefix+'integrations/ajes/catalog-failure-pages/stats-list-1.json',
  prefix+'integrations/ajes/catalog-failure-pages/stats-count.json',prefix+'integrations/ajes/catalog-failure-stats.json']);
 assert.equal(report.kind,'japan-usability-saved-failure-v1');
 assert.deepEqual(report.records.map(row=>row.slot),['stats-list-1','stats-count','stats-latest']);
 assert(report.records.every(row=>row.readStatus==='missing'));
});

test('invalid metadata cannot leak arbitrary outcomes, provider values or fabricated numeric counts',async()=>{
 const report=await inspectSavedPageThreeFailure({env,fetcher:async()=>new Response(JSON.stringify({
  ...source,startedAt:'PRIVATE_TIME',finishedAt:[],kind:'PRIVATE_KIND',outcome:'PRIVATE_REASON',providerCode:'PRIVATE_PROVIDER',
  page:'3',pageSize:0,httpStatus:200.5,sql:{secret:'PRIVATE_SQL'}}),{status:200})});
 const record=report.records[0];
 for(const field of ['startedAt','finishedAt','kind','outcome','providerCode','page','pageSize','httpStatus','sqlSha256','sqlBytes'])
  assert.equal(record[field],null);
 assert.equal(JSON.stringify(report).includes('PRIVATE'),false);
});

test('optional response validation projects finite phase codes and bounds without requiring new fields in old records',async()=>{
 const samples=[
  {version:1,phase:'decode',code:'gzip_invalid',wireBytes:2097152},
  {version:1,phase:'decode',code:'json_invalid',decodedBytes:0},
  {version:1,phase:'page_shape',code:'root_not_array',rootKind:'null'},
  {version:1,phase:'page_shape',code:'row_limit_exceeded',rootKind:'array',rowCount:25},
  {version:1,phase:'page_shape',code:'row_not_object',rootKind:'array'},
  {version:1,phase:'aggregate_shape',code:'total_invalid'},
  {version:1,phase:'aggregate_shape',code:'count_row_count',rootKind:'array',rowCount:2},
  {version:1,phase:'aggregate_shape',code:'make_name_missing'},
  {version:1,phase:'empty_confirmation',code:'count_unavailable',originCode:'http_500'},
  {version:1,phase:'empty_confirmation',code:'count_unverified',originCode:'invalid_response'},
 ];
 for(const value of samples)assert.deepEqual(sanitizeSavedResponseValidation(value),value);
 const report=await inspectSavedPageThreeFailure({env,fetcher:async()=>new Response(JSON.stringify({
  ...source,responseValidation:samples.at(-1)}),{status:200})});
 assert.deepEqual(report.records[0].responseValidation,samples.at(-1));
 assert.equal(sanitizeSavedResponseValidation(undefined),undefined);
});

test('unknown response-validation fields, raw reasons, accessor values and invalid counters are entirely omitted',async()=>{
 const base={version:1,phase:'page_shape',code:'row_limit_exceeded'};
 for(const value of [null,[],{...base,version:2},{...base,phase:'decode'},{...base,phase:['page_shape']},{...base,code:'PRIVATE_BODY'},
  {...base,sql:'PRIVATE_QUERY'},{...base,clientIp:'203.0.113.17'},{...base,originCode:'invalid_response'},
  {...base,rowCount:-1},{...base,rowCount:2097153},{...base,rowCount:1.5},{...base,wireBytes:'24'},
  {...base,rootKind:'PRIVATE_VALUE'},{...base,rowCount:24},{...base,rowCount:24,rootKind:'object'},
  {version:1,phase:'empty_confirmation',code:'count_unavailable'},
  {version:1,phase:'empty_confirmation',code:'count_unavailable',originCode:'http_200'},
  {version:1,phase:'empty_confirmation',code:'count_unavailable',originCode:'PRIVATE_REASON'}])
  assert.equal(sanitizeSavedResponseValidation(value),undefined);
 const accessor={...base};Object.defineProperty(accessor,'rowCount',{get(){throw Error('must not execute getter');}});
 assert.equal(sanitizeSavedResponseValidation(accessor),undefined);
 assert.equal(sanitizeSavedResponseValidation(new Proxy({},{ownKeys(){throw Error('PRIVATE_PROXY');}})),undefined);
 assert.equal(sanitizeSavedResponseValidation({...base,[Symbol('PRIVATE_KEY')]:1}),undefined);
 const report=await inspectSavedPageThreeFailure({env,fetcher:async()=>new Response(JSON.stringify({
  ...source,responseValidation:{...base,body:'PRIVATE_RESPONSE'}}),{status:200})});
 assert.equal(report.records[0].readStatus,'ok');assert.equal(Object.hasOwn(report.records[0],'responseValidation'),false);
 assert.equal(JSON.stringify(report).includes('PRIVATE_RESPONSE'),false);
});

test('missing and unavailable slots are bounded terminal reads without a retry or fallback to another slot',async()=>{
 for(const [status,wanted] of [[404,'missing'],[403,'unavailable'],[500,'unavailable']]){
  let calls=0,cancelled=0;
  const report=await inspectSavedPageThreeFailure({env,fetcher:async(input,options)=>{
   calls++;assert.equal(new URL(input).pathname,pageThree);assert.equal(options.method,'GET');
   return {status,body:{cancel:async()=>{cancelled++;}}};
  }});
  assert.equal(calls,1);assert.equal(cancelled,1);assert.deepEqual(report.records,[{slot:'stats-list-3',readStatus:wanted}]);
 }
});

test('page three saved object obeys the existing 64 KiB body cap before and during streaming',async()=>{
 let cancelled=0,reads=0;
 const header=await inspectSavedPageThreeFailure({env,fetcher:async()=>({status:200,
  headers:new Headers({'content-length':'65537'}),body:{cancel:async()=>{cancelled++;},getReader(){throw Error('must not read');}}})});
 assert.equal(header.records[0].readStatus,'byte_limit');assert.equal(cancelled,1);
 const streamed=await inspectSavedPageThreeFailure({env,fetcher:async()=>({status:200,headers:new Headers(),body:{getReader(){return{
  read:async()=>({done:false,value:Buffer.alloc(++reads===1?65536:1)}),cancel:async()=>{cancelled++;}
 };}}})});
 assert.equal(streamed.records[0].readStatus,'byte_limit');assert.equal(reads,2);assert.equal(cancelled,2);
});

test('configuration and transport failures never expose raw errors or contact an alternate endpoint',async()=>{
 let calls=0;
 const absent=await inspectSavedPageThreeFailure({env:{},fetcher:async()=>{calls++;throw Error('must not fetch');}});
 assert.equal(calls,0);assert.equal(absent.readStatus,'configuration_unavailable');
 const failed=await inspectSavedPageThreeFailure({env,fetcher:async()=>{calls++;throw Error('PRIVATE_SECRET SQL visitorIp=203.0.113.17');}});
 assert.equal(calls,1);assert.deepEqual(failed.records,[{slot:'stats-list-3',readStatus:'unavailable'}]);
 assert.equal(JSON.stringify(failed).includes('PRIVATE'),false);
});

test('page three invocation requires its exact main workflow, inspect job and reviewed source before credentials',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'japan-page-three-invocation-'));
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  git(['init','--quiet']);
  git(['-c','user.name=Offline test','-c','user.email=offline@example.invalid','commit','--allow-empty','--quiet','-m','fixture']);
  const sha=git(['rev-parse','HEAD']);
  const environment={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'jeep-jim/AvtoCena',GITHUB_REPOSITORY_ID:'1289722938',
   GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'12345',GITHUB_JOB:'inspect',
   GITHUB_WORKFLOW_REF:'jeep-jim/AvtoCena/.github/workflows/japan-page-three-saved-failure.yml@refs/heads/main',
   GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_SHA:sha,EXPECTED_CONTROLLER_SHA:sha};
  const checked=verifySavedPageThreeInvocation({root,environment});
  assert.equal(checked.sourceSha,sha);assert.equal(checked.approvedSourceSha,sha);assert.equal(checked.runId,'12345');
  for(const change of [{GITHUB_ACTIONS:'false'},{GITHUB_JOB:'release'},{GITHUB_RUN_ID:'0'},{GITHUB_RUN_ATTEMPT:'2'},
   {GITHUB_REF:'refs/heads/other'},{EXPECTED_CONTROLLER_SHA:'f'.repeat(40)},
   {GITHUB_WORKFLOW_REF:environment.GITHUB_WORKFLOW_REF.replace('japan-page-three-saved-failure','japan-usability-saved-failure-20261126')}])
   assert.throws(()=>verifySavedPageThreeInvocation({root,environment:{...environment,...change}}));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('page three workflow runs only its exact readonly marker and publishes one sanitized report',async()=>{
 const workflow=await fs.readFile(new URL('../.github/workflows/japan-page-three-saved-failure.yml',import.meta.url),'utf8');
 assert(workflow.includes('paths: [.github/market-runs/japan-page-three-saved-failure.json]'));
 assert(workflow.includes("if: github.repository_id == '1289722938' && github.ref == 'refs/heads/main' && github.run_attempt == '1'"));
 assert(workflow.includes('permissions:\n  contents: read\n'));
 assert(workflow.includes('fetch-depth: 2\n          persist-credentials: false'));
 assert(workflow.includes('EXPECTED_CONTROLLER_SHA: ${{ inputs.expected_controller_sha }}'));
 assert(workflow.includes('concurrency:\n  group: japan-usability-saved-failure-readonly\n  cancel-in-progress: false'));
 const beforeCredentials=workflow.slice(0,workflow.indexOf('secrets.REGCLOUD_'));
 for(const check of ['node scripts/verify-frozen-speed-baselines.mjs',
  'node --check scripts/catalog-next/japan-usability-saved-failure-20261126.mjs',
  'node scripts/catalog-next/japan-usability-saved-failure-20261126.mjs --verify-page-three',
  'tests/catalog-next-japan-page-three-saved-failure.test.mjs tests/readonly-marker-invocation.test.mjs'])assert(beforeCredentials.includes(check));
 assert.equal((workflow.match(/secrets\./g)||[]).length,2);
 assert(workflow.includes('--run-page-three > japan-page-three-saved-failure-report.json'));
 assert(workflow.includes('path: japan-page-three-saved-failure-report.json\n          if-no-files-found: ignore\n          retention-days: 14'));
 for(const forbidden of ['schedule:','workflow_run:','pull_request','SSH_PRIVATE_KEY','ssh ','curl ','npm ',
  'AJES_API_PASSWORD','list-objects','list-object-versions','delete-object','contents: write','continue-on-error:'])
  assert.equal(workflow.includes(forbidden),false,forbidden);
 const commands=workflow.split(/\n        run: \|\n/).slice(1).map(value=>value.split(/\n      - /,1)[0]);
 assert(commands.every(value=>!value.includes('${{')));
});
