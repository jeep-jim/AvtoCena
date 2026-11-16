import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {activeBudgetInputs, assertActiveBudgetState, verifyActiveBudgetAuthority, installActiveBudgetStorage,
  restoreCandidateEncyclopedia} from '../scripts/catalog-active-budget-check.mjs';
import {PREPARED_MARKETS, assertBudgetReadinessReport, stagedBudgetDigest} from '../scripts/lib/catalog-staged-budget.mjs';
import {publishSelectorMarket} from '../apps/web/lib/catalog/budget-selector-publication';
import {specificationSelectorDirectory} from '../apps/web/lib/catalog/budget-selector-codec';
import {StorageConflictError} from '../apps/web/lib/data';

const release='a'.repeat(40),calculator='b'.repeat(64),generationId='gen_1790000000000_abc12345';
const root=fileURLToPath(new URL('..',import.meta.url)),run=promisify(execFile);
const context=()=>({version:1,mode:'live',release,calculationVersion:calculator,liveIdentity:{release,calculationVersion:calculator},
  manifest:{version:2,generationId,markets:{korea:{count:1,chunks:['chunk-0001']}}},manifestEtag:'"manifest"',
  lockRevision:{found:true,etag:'"lease"'},encyclopediaDigest:null});
const metadata=(c:any)=>({manifest:{found:true,etag:c.manifestEtag,value:c.manifest},lock:{found:true,etag:'"lease"',value:{lockedUntil:''}}});

test('live and candidate have independent exact identities; live-calculation equality cannot be bypassed',async()=>{
 const env={CATALOG_ACTIVE_BUDGET_MODE:'live',CATALOG_EXPECTED_LIVE_RELEASE:release,CATALOG_EXPECTED_GENERATION:generationId};
 assert.equal(activeBudgetInputs(env).release,release);
 assert.throws(()=>activeBudgetInputs({...env,CATALOG_CANDIDATE_RELEASE:'c'.repeat(40)}),/forbidden/);
 assert.throws(()=>activeBudgetInputs({...env,CATALOG_ACTIVE_BUDGET_MODE:'candidate-isolated'}),/binding_required/);
 const candidate={...env,CATALOG_ACTIVE_BUDGET_MODE:'candidate-isolated',CATALOG_CANDIDATE_RELEASE:'c'.repeat(40),
  CATALOG_CANDIDATE_CALCULATION_VERSION:'d'.repeat(64),CATALOG_CANDIDATE_ENCYCLOPEDIA_DIGEST:'e'.repeat(64)};
 assert.equal(activeBudgetInputs(candidate).release,candidate.CATALOG_CANDIDATE_RELEASE);
 const c=context(),state=metadata(c),storage={readJsonWithMeta:async(key:string)=>key==='catalog/manifest.json'?state.manifest:state.lock};
 await verifyActiveBudgetAuthority(c,storage,async()=>c.liveIdentity);
 await assert.rejects(verifyActiveBudgetAuthority({...c,calculationVersion:'d'.repeat(64)},storage,async()=>c.liveIdentity),/live_calculation_mismatch/);
 await verifyActiveBudgetAuthority({...c,mode:'candidate-isolated',release:'c'.repeat(40),calculationVersion:'d'.repeat(64)},storage,async()=>c.liveIdentity);
 await assert.rejects(verifyActiveBudgetAuthority(c,storage,async()=>({release:'f'.repeat(40),calculationVersion:calculator})),/live_identity_changed/);
});

test('active and completed intervening publishers invalidate the proof even without a generation change',()=>{
 const c=context(),state=metadata(c);assertActiveBudgetState(c,state.manifest,state.lock);
 assert.throws(()=>assertActiveBudgetState(c,state.manifest,{...state.lock,value:{lockedUntil:new Date(Date.now()+60000).toISOString()}}),/writer_busy/);
 assert.throws(()=>assertActiveBudgetState(c,state.manifest,{...state.lock,etag:'"new-lease"'}),/writer_revision_changed/);
 assert.throws(()=>assertActiveBudgetState(c,state.manifest,{...state.lock,value:{lockedUntil:'bad'}}),/lock_invalid/);
 assert.throws(()=>assertActiveBudgetState(c,{...state.manifest,etag:'"changed"'},state.lock),/manifest_changed/);
});

test('candidate overlay honors local CAS and cannot write, hide or replace the active manifest',async()=>{
 const c={...context(),mode:'candidate-isolated',release:'c'.repeat(40),calculationVersion:'d'.repeat(64)},state=metadata(c);
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'active-budget-overlay-'));let remoteWrites=0;
 const storage:any={readJsonWithMeta:async(key:string,fallback:any)=>key==='catalog/manifest.json'?state.manifest:key==='catalog/import-lock.json'?state.lock:{found:false,value:fallback},
  writeJson:async()=>{remoteWrites++;},deleteJson:async()=>{remoteWrites++;}};
 try{
  installActiveBudgetStorage(storage,c,'prepare',temp,StorageConflictError);
  const key=`catalog/runtime-budget-prices-v3/korea/${'e'.repeat(64)}.json`;
  await storage.writeJson(key,{value:1},{ifNoneMatch:'*'});const saved=await storage.readJsonWithMeta(key,null);
  await assert.rejects(storage.writeJson(key,{value:2},{ifNoneMatch:'*'}),StorageConflictError);
  await storage.writeJson(key,{value:3},{ifMatch:saved.etag});assert.equal((await storage.readJson(key,null)).value,3);
  assert.deepEqual(await storage.readJsonWithMeta('catalog/manifest.json',null),state.manifest);
  for(const key of ['catalog/manifest.json','catalog/previous-manifest.json','catalog/intake-cursors/v1/korea.json','catalog-editorial/current.json']){
   await assert.rejects(storage.writeJson(key,{}),/write_forbidden/);
  }
  await assert.rejects(storage.deleteJson('x'),/write_forbidden/);assert.equal(remoteWrites,0);
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});

test('candidate encyclopedia must be an exact existing immutable index, without creating a release binding',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'active-budget-index-')),models={test:[]},digest=stagedBudgetDigest(models),reads:string[]=[];
 try{
  const storage={readJson:async(key:string)=>{reads.push(key);return {version:1,digest,models};}};
  assert.equal(await restoreCandidateEncyclopedia(storage,temp,digest),digest);
  assert.deepEqual(reads,[`knowledge/encyclopedia/calculation-indexes/${digest}.json`]);
  await assert.rejects(restoreCandidateEncyclopedia({readJson:async()=>null},temp,digest),/invalid/);
  await assert.rejects(restoreCandidateEncyclopedia(storage,temp,'e'.repeat(64)),/invalid/);
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});

test('fresh active children cover all five markets; candidate preparation writes only its local overlay',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'active-budget-child-')),c:any=context();
 c.manifest.markets=Object.fromEntries(PREPARED_MARKETS.map(market=>[market,{count:1,chunks:['chunk-0001']}]));
 const values=new Map<string,Buffer>(),writes:string[]=[],reads:string[]=[];
 const put=(key:string,value:any)=>values.set(key,Buffer.from(JSON.stringify(value)));
 put('catalog/manifest.json',c.manifest);put('catalog/import-lock.json',{lockedUntil:''});
 put('catalog-editorial/current.json',{version:1,revision:1,entries:{}});
 put('fees/exchange-rates.json',{rates:[['KRW',0.065],['EUR',95],['USD',85],['CNY',12],['AED',23]].map(([currency,rate])=>
  ({currency,cbrRate:rate,nominal:1,effectiveRate:rate,rateDate:new Date().toISOString().slice(0,10),rateSource:'cbr'}))});
 const raw=PREPARED_MARKETS.map(market=>({id:market+'-car',market,make:'Hyundai',model:'Avante',year:2024,cardProjectionVersion:3,
  cardImageUrl:'https://example.test/car.jpg',fuel:'petrol',powertrainKind:'combustion',bodyType:'sedan',engineCc:1598,powerHp:123,
  publicVisibleRub:1500000,publicSpecificationVerified:true,totalRub:1500000,sourcePrice:15000000,sourceCurrency:'KRW'}));
 const prefix=`catalog/generations/${generationId}/indexes/`;
 put(prefix+'budget-cards-v3/0.json',{generationId,items:raw});
 const baseDirectory:any={version:4,generationId,encyclopediaDigest:null,markets:{}};
 const specDirectory:any={version:4,generationId,encyclopediaDigest:null,markets:{}};
 for(const row of raw){
  put(prefix+`projection/${row.market}.json`,{generationId,items:[row]});
  const index:any={version:3,generationId,sourceRows:1,displayOrderVersion:1,filterVersion:1,specificationFilterVersion:1,bodyFilterVersion:1,
   inventoryPolicyVersion:1,rows:[[row.market,1500000,null,null,false,{id:row.id,make:row.make,model:row.model,year:row.year,block:0}]],otherRows:[]};
  for(const [dir,directory]of [[prefix+'budget-markets-v3/',baseDirectory],[prefix+specificationSelectorDirectory(null,calculator)+'/',specDirectory]] as const){
   directory.markets[row.market]=await publishSelectorMarket(index,row.market,async name=>JSON.parse(values.get(dir+name+'.json')!.toString()),
    async(name,value)=>{put(dir+name+'.json',value);});
  }
 }
 put(prefix+'budget-markets-v3/ready.json',baseDirectory);put(prefix+specificationSelectorDirectory(null,calculator)+'/ready.json',specDirectory);
 const server=http.createServer(async(req,res)=>{
  const key=decodeURIComponent((req.url||'').replace(/^\/test\//,''));
  if(req.method==='HEAD'){res.writeHead(values.has(key)?200:404,{etag:'"stored"'});res.end();return;}
  if(req.method==='GET'){
   reads.push(key);const body=values.get(key);if(!body){res.writeHead(404);res.end();return;}
   res.writeHead(200,{'content-type':'application/json',etag:key==='catalog/manifest.json'?'"manifest"':key==='catalog/import-lock.json'?'"lease"':'"stored"'});res.end(body);return;
  }
  if(req.method==='PUT'){writes.push(key);const parts=[];for await(const part of req)parts.push(part);values.set(key,Buffer.concat(parts));res.writeHead(200);res.end();return;}
  res.writeHead(405);res.end();
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as any;
 const contextPath=path.join(temp,'context.json'),reportPath=path.join(temp,'report.json'),overlay=path.join(temp,'derived');
 await fs.mkdir(path.join(temp,'data'));
 const env={...process.env,JSON_STORAGE_DRIVER:'object',CATALOG_LIVE_RATE_DISABLED:'true',
  YC_OBJECT_STORAGE_ENDPOINT:`http://127.0.0.1:${address.port}`,YC_OBJECT_STORAGE_BUCKET:'test',YC_OBJECT_STORAGE_REGION:'test',YC_OBJECT_STORAGE_PREFIX:'',
  YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'fixture'};
 const invoke=async(phase:string,activeContext:any)=>{
  await fs.writeFile(contextPath,JSON.stringify(activeContext));
  await run(process.execPath,['--import',createRequire(import.meta.url).resolve('tsx'),path.join(root,'scripts/catalog-active-budget-check.mjs'),
   '--child',phase,process.env.CATALOG_TEST_STAGED_RUNTIME_ROOT||root,contextPath,reportPath,overlay],{
   cwd:temp,env:{...env,AVTOCENA_RELEASE_SHA:activeContext.release,AVTOCENA_CALCULATION_VERSION:activeContext.calculationVersion},timeout:30000,maxBuffer:1024*1024});
  return JSON.parse(await fs.readFile(reportPath,'utf8'));
 };
 try{
  const prepared=await invoke('prepare',c);assertBudgetReadinessReport(prepared,c);
  assert.deepEqual(Object.keys(prepared.markets).sort(),PREPARED_MARKETS.slice().sort());
  const count=writes.length;assert.ok(count>=10);assertBudgetReadinessReport(await invoke('verify',c),c,prepared);assert.equal(writes.length,count);
  const candidate={...c,mode:'candidate-isolated',release:'c'.repeat(40),calculationVersion:'d'.repeat(64)};
  const isolated=await invoke('prepare',candidate);assertBudgetReadinessReport(isolated,candidate);
  assert.equal(writes.length,count,'candidate derived writes never reach remote storage');
  assertBudgetReadinessReport(await invoke('verify',candidate),candidate,isolated);assert.equal(writes.length,count);
  assert.ok((await fs.readdir(path.join(overlay,'catalog'))).length>0);
  assert.ok(!reads.some(key=>/\/japan\b|ajes/.test(key)));
  put('catalog/import-lock.json',{operationId:'new-publisher',lockedUntil:new Date(Date.now()+60000).toISOString()});
  await assert.rejects(invoke('verify',candidate),/writer_busy/);assert.equal(writes.length,count);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(temp,{recursive:true,force:true});}
});
