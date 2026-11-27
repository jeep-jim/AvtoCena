import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {inspectSavedActiveStabilityFailure,inspectSavedFailure,verifySavedActiveStabilityReport}
 from '../scripts/catalog-next/japan-usability-saved-failure-20261126.mjs';

const env={REGCLOUD_S3_ACCESS_KEY_ID:'UNITTEST',REGCLOUD_S3_SECRET_ACCESS_KEY:'PRIVATE_SECRET'};
const prefix='/avtocena-staging-8120751/migration-staging/full-20261011/';
const keys=['integrations/ajes/catalog-failure-pages/stats-list-1.json',
 'integrations/ajes/catalog-failure-pages/stats-list-2.json',
 'integrations/ajes/catalog-failure-pages/stats-list-3.json',
 'integrations/ajes/catalog-failure-pages/stats-count.json','integrations/ajes/catalog-failure-stats.json'];
const slots=['stats-list-1','stats-list-2','stats-list-3','stats-count','stats-latest'];
const scope='catalog-japan-stability-v1',runtime='a'.repeat(40),controller='b'.repeat(40),nonce='c'.repeat(32);
const reportName='catalog-next-japan-source-failure-report.json',browserName='catalog-next-japan-browser-report.json';
const planName='.github/operations/catalog-next/china-code-serving-plan.json';
const source={kind:'list',page:1,pageSize:24,startedAt:'2026-11-27T08:00:00.000Z',
 finishedAt:'2026-11-27T08:00:01.000Z',httpStatus:200,outcome:'invalid_response',providerCode:null,
 sql:'SELECT PRIVATE_QUERY',clientIp:'203.0.113.17',endpoint:'https://private.example/feed',body:'PRIVATE_BODY'};
const validation={version:1,phase:'page_shape',code:'row_limit_exceeded',rootKind:'array',rowCount:25,wireBytes:2048};
function partialReport(){return {version:1,kind:'japan-stability-saved-failure-v1',records:[
 {slot:slots[0],readStatus:'ok',startedAt:source.startedAt,finishedAt:source.finishedAt,kind:'list',outcome:'invalid_response',
  page:1,pageSize:24,httpStatus:200,providerCode:null,sqlSha256:'d'.repeat(64),sqlBytes:3556,responseValidation:validation},
 {slot:slots[1],readStatus:'missing'},{slot:slots[2],readStatus:'deadline'},
 {slot:slots[3],readStatus:'unavailable'},{slot:slots[4],readStatus:'byte_limit'}],
 supplierRequests:0,writes:0,attribution:'saved_outer_request_metadata_only',historyReads:0,
 capture:{version:1,stage:'before_rollback',runtimeSha:runtime,controllerSha:controller,nonce,
  failedStage:'plain_first',capturedAt:'2026-11-27T08:00:05.000Z'}};}
const plan=()=>({version:1,market:'china',codeScope:scope,runtimeSha:runtime});
const browser=()=>({version:1,kind:'catalog-japan-browser-v1',codeScope:scope,release:runtime,nonce,passed:false,
 checkedAt:'2026-11-27T08:00:00.000Z',error:{stage:'plain_first',code:'japan_browser_unavailable_or_stale',timeout:false}});
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'japan-active-failure-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.dirname(path.join(root,planName)),{recursive:true});
 const write=async(report=partialReport(),serving=plan(),japan=browser())=>{
  for(const [name,value] of [[reportName,report],[planName,serving],[browserName,japan]])
   await fs.writeFile(path.join(root,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
 };
 await write();return {root,write,verify:()=>verifySavedActiveStabilityReport({root,environment:{GITHUB_SHA:controller}})};
}

test('active snapshot reads exactly five fixed slots in order under one 5-second signal and projects no raw data',async t=>{
 const signal=new AbortController().signal,deadlines=[],calls=[];
 t.mock.method(AbortSignal,'timeout',milliseconds=>{deadlines.push(milliseconds);return signal;});
 const report=await inspectSavedActiveStabilityFailure({env,deadlineMs:60000,keys:['catalog/CRM/private.json'],fetcher:async(input,options)=>{
  const url=new URL(input);calls.push(url.pathname);
  assert.equal(url.origin,'https://s3.regru.cloud');assert.equal(url.search,'');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.signal,signal);
  assert.match(options.headers.authorization,/^AWS4-HMAC-SHA256 Credential=UNITTEST\//);
  return new Response(JSON.stringify({...source,responseValidation:validation}));
 }});
 assert.deepEqual(deadlines,[5000]);assert.deepEqual(calls,keys.map(key=>prefix+key));
 assert.deepEqual(report.records.map(row=>row.slot),slots);assert.equal(report.records.length,5);
 assert.equal(report.kind,'japan-stability-saved-failure-v1');assert.equal(report.attribution,'saved_outer_request_metadata_only');
 assert.equal(report.supplierRequests,0);assert.equal(report.writes,0);assert.equal(report.historyReads,0);
 assert.deepEqual(report.records[0].responseValidation,validation);
 for(const forbidden of ['PRIVATE_SECRET','PRIVATE_QUERY','203.0.113.17','private.example','PRIVATE_BODY'])
  assert.equal(JSON.stringify(report).includes(forbidden),false);
 for(const record of report.records)for(const field of ['sql','clientIp','endpoint','body','runtimeSha','requestId'])
  assert.equal(Object.hasOwn(record,field),false);
});

test('active deadline stops remaining slots while legacy collection retains its original 20-second budget',async t=>{
 const controller=new AbortController(),deadlines=[];let calls=0;
 t.mock.method(AbortSignal,'timeout',milliseconds=>{deadlines.push(milliseconds);return controller.signal;});
 const report=await inspectSavedActiveStabilityFailure({env,fetcher:async()=>{
  calls++;if(calls===2){controller.abort();throw Error('PRIVATE_TIMEOUT');}
  return new Response(null,{status:404});
 }});
 assert.equal(calls,2);assert.deepEqual(report.records.map(row=>row.readStatus),['missing','deadline','deadline','deadline','deadline']);
 await inspectSavedFailure({env,fetcher:async()=>{throw Error('must not fetch after deadline');}});
 assert.deepEqual(deadlines,[5000,20000]);
});

test('active capture preserves both the shared 128 KiB budget and the 64 KiB per-body limit',async()=>{
 let calls=0;
 const bounded=await inspectSavedActiveStabilityFailure({env,fetcher:async()=>{calls++;
  return new Response(JSON.stringify(source).padEnd(65536,' '));}});
 assert.equal(calls,2);assert.deepEqual(bounded.records.map(row=>row.readStatus),['ok','ok','byte_limit','byte_limit','byte_limit']);
 let oversizedCalls=0,cancelled=0;
 const oversized=await inspectSavedActiveStabilityFailure({env,fetcher:async()=>{
  oversizedCalls++;return oversizedCalls===1?{status:200,headers:new Headers({'content-length':'65537'}),
   body:{cancel:async()=>{cancelled++;},getReader(){throw Error('must not read');}}}:new Response(null,{status:404});
 }});
 assert.equal(oversizedCalls,5);assert.equal(cancelled,1);
 assert.deepEqual(oversized.records.map(row=>row.readStatus),['byte_limit','missing','missing','missing','missing']);
});

test('a correctly bound partial active report is verified locally without credentials, network or a rewrite',async t=>{
 const f=await fixture(t),before=await fs.readFile(path.join(f.root,reportName));let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('must not fetch');});
 const result=await f.verify();
 assert.equal(result.verified,true);assert.equal(result.runtimeSha,runtime);assert.equal(result.controllerSha,controller);
 assert.equal(result.nonce,nonce);assert.equal(result.failedStage,'plain_first');assert.equal(calls,0);
 assert.deepEqual(await fs.readFile(path.join(f.root,reportName)),before);
 assert.equal((await fs.stat(path.join(f.root,reportName))).mode&0o777,0o600);
 const config={...partialReport(),records:[],readStatus:'configuration_unavailable'};
 await f.write(config);assert.equal((await f.verify()).verified,true);
});

test('active report verification rejects wrong runtime/controller/nonce/stage/time and malformed or successful browser bindings',async t=>{
 const f=await fixture(t);
 const changes=[
  x=>{x.report.capture.runtimeSha='1'.repeat(40);},x=>{x.report.capture.controllerSha='1'.repeat(40);},
  x=>{x.report.capture.nonce='1'.repeat(32);},x=>{x.report.capture.failedStage='plain_warm';},
  x=>{x.report.capture.capturedAt='2026-11-27T07:59:59.999Z';},x=>{x.report.capture.stage='after_rollback';},
  x=>{x.report.capture.failedStage=['plain_first'];},x=>{x.report.capture.extra='PRIVATE_VALUE';},
  x=>{x.serving.runtimeSha='1'.repeat(40);},x=>{x.serving.codeScope='catalog-japan-pagination24-v1';},
  x=>{x.japan.release='1'.repeat(40);},x=>{x.japan.nonce='1'.repeat(32);},x=>{x.japan.error.stage='plain_warm';},
  x=>{x.japan.passed=true;},x=>{delete x.japan.error;},x=>{x.japan.checkedAt='PRIVATE_DATE';},
  x=>{x.japan.codeScope='catalog-japan-pagination24-v1';},x=>{delete x.report.capture;},
 ];
 for(const change of changes){
  const input={report:structuredClone(partialReport()),serving:plan(),japan:browser()};change(input);
  await f.write(input.report,input.serving,input.japan);await assert.rejects(f.verify);
 }
});

test('active verifier rejects raw fields, unsafe optional phases, invalid limits, duplicate JSON values and extra records',async t=>{
 const f=await fixture(t);
 const changes=[
  x=>{x.body='PRIVATE_RESPONSE';},x=>{x.records[0].sql='PRIVATE_SQL';},x=>{x.records[0].clientIp='203.0.113.17';},
  x=>{x.records[0].outcome='PRIVATE_FAILURE';},x=>{x.records[0].sqlBytes=65537;},
  x=>{x.records[0].responseValidation={...validation,body:'PRIVATE_RESPONSE'};},
  x=>{x.records[0].responseValidation={version:1,phase:'empty_confirmation',code:'count_unavailable'};},
  x=>{x.records.reverse();},x=>{x.records.pop();},x=>{x.records.push({slot:'stats-list-4',readStatus:'missing'});},
  x=>{x.historyReads=1;},x=>{x.writes=1;},x=>{x.supplierRequests=1;},
 ];
 for(const change of changes){const value=structuredClone(partialReport());change(value);await f.write(value);await assert.rejects(f.verify);}
 await f.write();
 const duplicate=JSON.stringify(partialReport()).replace('"nonce":','"nonce":"PRIVATE_HIDDEN","nonce":');
 assert.equal(JSON.parse(duplicate).capture.nonce,nonce);
 await fs.writeFile(path.join(f.root,reportName),duplicate);await assert.rejects(f.verify);
});

test('active verifier reads only fixed bounded local files and rejects missing, oversized and symlink snapshots',async t=>{
 const f=await fixture(t),filename=path.join(f.root,reportName);
 await fs.writeFile(filename,' '.repeat(32*1024+1));await assert.rejects(f.verify);
 await fs.unlink(filename);await assert.rejects(f.verify);
 await fs.writeFile(path.join(f.root,'outside.json'),JSON.stringify(partialReport()));
 await fs.symlink(path.join(f.root,'outside.json'),filename);await assert.rejects(f.verify);
 await fs.unlink(filename);await f.write();
 await fs.writeFile(path.join(f.root,browserName),' '.repeat(1024*1024+1));await assert.rejects(f.verify);
 await f.write();await fs.writeFile(path.join(f.root,planName),' '.repeat(128*1024+1));await assert.rejects(f.verify);
});

test('the actual workflow shell preserves a valid active file byte-for-byte and falls back only after a failed local binding check',async t=>{
 const f=await fixture(t);
 for(const name of ['scripts/catalog-next/japan-usability-saved-failure-20261126.mjs','scripts/lib/readonly-marker-invocation.mjs']){
  const target=path.join(f.root,name);await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.copyFile(new URL('../'+name,import.meta.url),target);
 }
 const workflow=await fs.readFile(new URL('../.github/workflows/catalog-next-china-photo-release.yml',import.meta.url),'utf8');
 const hook=workflow.split('      - name: Preserve bounded saved Japan failure metadata after an unsuccessful publication\n')[1].split('\n      - name: ')[0];
 const commands=hook.split('        run: |\n')[1].split('\n').map(line=>line.replace(/^          /,'')).join('\n');
 assert(commands.indexOf('--verify-active-stability-report')<commands.indexOf('> catalog-next-japan-source-failure-report.json'));
 const calls=path.join(f.root,'mock-gets.txt'),stub=path.join(f.root,'mock-fetch.mjs');
 await fs.writeFile(stub,"import fs from 'node:fs';globalThis.fetch=async input=>{fs.appendFileSync(process.env.MOCK_GETS,new URL(input).pathname+'\\n');return new Response(null,{status:404});};\n");
 const environment={...process.env,...env,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY_ID:'1289722938',GITHUB_REF:'refs/heads/main',
  GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'release',GITHUB_EVENT_NAME:'push',GITHUB_SHA:controller,CATALOG_CODE_SCOPE:scope,
  GITHUB_WORKFLOW_REF:'jeep-jim/AvtoCena/.github/workflows/catalog-next-china-photo-release.yml@refs/heads/main',
  NODE_OPTIONS:'--import='+pathToFileURL(stub).href,MOCK_GETS:calls};
 const run=()=>{
  const result=spawnSync('bash',['-e','-o','pipefail','-c',commands],{cwd:f.root,env:environment,encoding:'utf8',timeout:5000});
  assert.equal(result.error,undefined);assert.equal(result.status,0);assert.equal(result.stderr,'');return result;
 };
 const before=await fs.readFile(path.join(f.root,reportName));
 const preserved=run();assert(preserved.stdout.includes('"verified":true'));
 assert.deepEqual(await fs.readFile(path.join(f.root,reportName)),before);
 await assert.rejects(fs.readFile(calls),{code:'ENOENT'});
 const wrong=structuredClone(partialReport());wrong.capture.nonce='1'.repeat(32);await f.write(wrong);
 const fallback=run();assert(fallback.stdout.includes('"verified":false'));
 const after=JSON.parse(await fs.readFile(path.join(f.root,reportName),'utf8'));
 assert.equal(after.kind,'japan-stability-saved-failure-v1');assert.equal(Object.hasOwn(after,'capture'),false);
 assert.deepEqual(after.records.map(row=>row.slot),['stats-list-3','stats-list-1','stats-count','stats-latest']);
 assert(after.records.every(row=>row.readStatus==='missing'));
 assert.deepEqual((await fs.readFile(calls,'utf8')).trim().split('\n'),[keys[2],keys[0],keys[3],keys[4]].map(key=>prefix+key));
});
