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
import {assertStagedBudgetContext, assertStagedBudgetReport, installStagedBudgetStorage, readLiveBudgetIdentity,
  stagedBudgetDigest, stagedBudgetWriteAllowed, verifyStagedBudgetAuthority, verifyBudgetSourceCoverage} from '../scripts/lib/catalog-staged-budget.mjs';
import {publishSelectorMarket} from '../apps/web/lib/catalog/budget-selector-publication';
import {specificationSelectorDirectory} from '../apps/web/lib/catalog/budget-selector-codec';
import {getJsonStorage, resetJsonStorageForTests, StorageConflictError} from '../apps/web/lib/data';
import {persistCatalogOffers, readCurrentCatalogProjectionSnapshot, resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';

const release='a'.repeat(40), calculationVersion='b'.repeat(64), base='gen_1790000000000_abc12345';
const generationId='gen_1790001000000_def12345';
const context=()=>({version:1,release,calculationVersion,expectedBaseGenerationId:base,operationId:'publication-test',baseEtag:'"base"',encyclopediaDigest:null,
  manifest:{version:2,generationId,updatedAt:new Date().toISOString(),markets:{korea:{count:1,chunks:['chunk-0001']},japan:{count:5,chunks:['chunk-0001']}}}});
const run=promisify(execFile), root=fileURLToPath(new URL('..',import.meta.url));

test('live calculator identity, real manifest ETag and lease remain authoritative',async()=>{
  const c=context(), state:any={base:{found:true,etag:c.baseEtag,value:{generationId:base}},lock:{operationId:c.operationId,lockedUntil:new Date(Date.now()+60000).toISOString()}};
  const storage={readJsonWithMeta:async()=>state.base,readJson:async()=>state.lock};
  const identity=async()=>({release,calculationVersion});
  assert.deepEqual(await readLiveBudgetIdentity(async()=>Response.json({ok:true,releaseSha:release,calculationVersion})),await identity());
  await assert.rejects(readLiveBudgetIdentity(async()=>Response.json({ok:true,releaseSha:release})),/identity_invalid/);
  await verifyStagedBudgetAuthority(c,storage,identity);
  state.base.etag='"other"';await assert.rejects(verifyStagedBudgetAuthority(c,storage,identity),/publication_changed/);state.base.etag=c.baseEtag;
  state.lock.operationId='competing';await assert.rejects(verifyStagedBudgetAuthority(c,storage,identity),/lease_lost/);state.lock.operationId=c.operationId;
  await assert.rejects(verifyStagedBudgetAuthority(c,storage,async()=>({release:'c'.repeat(40),calculationVersion})),/calculator_changed/);
  await assert.rejects(verifyStagedBudgetAuthority(c,storage,async()=>({release,calculationVersion:'d'.repeat(64)})),/calculator_changed/);
  state.lock.lockedUntil='invalid';await assert.rejects(verifyStagedBudgetAuthority(c,storage,identity),/lease_lost/);
});

test('candidate overlay preserves metadata and fences all public, cursor, manual and Japan writes',async()=>{
  const c=context(), writes:any[]=[], original={version:2,generationId:base,markets:{}};
  const storage:any={driver:'object',readJsonWithMeta:async()=>({found:true,etag:c.baseEtag,value:original}),
    writeJson:async(...args:any[])=>writes.push(args),deleteJson:async()=>{throw Error('unfenced');}};
  installStagedBudgetStorage(storage,c,'prepare');
  assert.deepEqual(await storage.readJsonWithMeta('catalog/manifest.json',null),{found:true,etag:c.baseEtag,value:c.manifest});
  assert.equal(original.generationId,base);
  const allowed=`catalog/generations/${generationId}/indexes/budget-markets-v7/${calculationVersion}/ready.json`;
  await storage.writeJson(allowed,{ready:true},{ifNoneMatch:'*'});assert.deepEqual(writes[0][2],{ifNoneMatch:'*'});
  for(const key of ['catalog/manifest.json','catalog/previous-manifest.json','catalog/import-lock.json','catalog/intake-cursors/v1/korea.json',
    'catalog-editorial/current.json','catalog/public/projection/all.json',`catalog/generations/${base}/indexes/budget-markets-v3/ready.json`,
    `catalog/generations/${generationId}/indexes/budget-markets-v3/japan.json`,`catalog/runtime-budget-prices-v3/japan/${calculationVersion}.json`]){
    assert.equal(stagedBudgetWriteAllowed(key,c),false);await assert.rejects(storage.writeJson(key,{}),/write_forbidden/);
  }
  await assert.rejects(storage.deleteJson('x'),/write_forbidden/);assert.equal(writes.length,1);
});

test('readiness binds every retained market, exact day, rates, manual price and source inputs',()=>{
  const c=context(), digest='e'.repeat(64), receipt={fingerprint:digest,sourceRows:1,sourceIds:digest,selectorChecksum:digest,
    coverage:{projectionRows:1,selectorRows:1,eligibleRows:1,projectionIds:digest,eligibleIds:digest},
    budget:{rows:1,checksum:digest},sort:{rows:1,checksum:digest}};
  const report={version:1,verified:true,release,calculationVersion,generationId,manifestDigest:stagedBudgetDigest(c.manifest),
    utcDay:'2026-11-16',policyDay:'2026-11-16',encyclopediaDigest:null,markets:{korea:receipt}};
  assert.deepEqual(assertStagedBudgetContext(c),['korea']);assertStagedBudgetReport(report,c);
  for(const damage of [(r:any)=>r.utcDay='2026-11-17',(r:any)=>r.markets.korea.fingerprint='f'.repeat(64),
    (r:any)=>r.markets.korea.sourceIds='f'.repeat(64),(r:any)=>r.markets.korea.sort.checksum='f'.repeat(64)]){
    const changed=structuredClone(report);damage(changed);assert.throws(()=>assertStagedBudgetReport(changed,c,report),/context_changed/);
  }
  assert.throws(()=>assertStagedBudgetReport({...report,markets:{}},c),/report_invalid/);
  assert.throws(()=>assertStagedBudgetReport({...report,markets:{korea:{...receipt,sourceRows:2}}},c),/incomplete/);
});

test('source coverage permits policy exclusions but rejects a consistent selector missing an eligible offer',()=>{
 const c=context();c.manifest.markets.korea.count=3;
 const projection={generationId,items:[{id:'visible',market:'korea'},{id:'hidden',market:'korea'},{id:'expired',market:'korea'}]};
 const source=(ids:string[])=>ids.map(id=>['korea',100,null,null,false,{id}]);
 const prepareRows=(rows:any[])=>rows.filter(row=>row.id==='visible');
 const coverage=verifyBudgetSourceCoverage({manifest:c.manifest,market:'korea',projection,source:source(['visible']),prepareRows});
 assert.equal(coverage.projectionRows,3);assert.equal(coverage.eligibleRows,1);assert.equal(coverage.selectorRows,1);
 assert.equal(verifyBudgetSourceCoverage({manifest:c.manifest,market:'korea',projection,source:source(['visible','expired']),prepareRows}).selectorRows,2);
 assert.throws(()=>verifyBudgetSourceCoverage({manifest:c.manifest,market:'korea',projection,source:source(['hidden']),prepareRows}),/eligible_source_missing/);
 assert.throws(()=>verifyBudgetSourceCoverage({manifest:c.manifest,market:'korea',projection:{...projection,items:projection.items.slice(0,2)},source:source(['visible']),prepareRows}),/projection_incomplete/);
 assert.throws(()=>verifyBudgetSourceCoverage({manifest:c.manifest,market:'korea',projection,source:source(['visible','foreign']),prepareRows}),/selector_identity_invalid/);
});

test('real child prepares and rereads exact stored snapshots; missing or corrupt objects never pass',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'staged-child-test-')), c=context();
  const values=new Map<string,Buffer>(), writes:string[]=[], reads:string[]=[];let rejectWrites=false;
  const put=(key:string,value:any)=>values.set(key,Buffer.from(JSON.stringify(value)));
  put('catalog/manifest.json',{version:2,generationId:base,markets:{}});
  put('catalog-editorial/current.json',{version:1,revision:1,entries:{}});
  put('fees/exchange-rates.json',{rates:[['KRW',0.065],['EUR',95],['USD',85]].map(([currency,rate])=>
    ({currency,cbrRate:rate,nominal:1,effectiveRate:rate,rateDate:new Date().toISOString().slice(0,10),rateSource:'cbr'}))});
  const index:any={version:3,generationId,sourceRows:1,displayOrderVersion:1,filterVersion:1,specificationFilterVersion:1,bodyFilterVersion:1,inventoryPolicyVersion:1,
    rows:[['korea',1500000,null,null,false,{id:'retained-test-car',make:'Hyundai',model:'Avante',year:2024,block:0}]],otherRows:[]};
  const selectorPrefix=`catalog/generations/${generationId}/indexes/`;
  const append=async(prefix:string)=>{
    const entry=await publishSelectorMarket(index,'korea',async name=>JSON.parse(values.get(prefix+name+'.json')!.toString()),async(name,value)=>{put(prefix+name+'.json',value);});
    put(prefix+'ready.json',{version:4,generationId,encyclopediaDigest:null,markets:{korea:entry}});
  };
  await append(selectorPrefix+'budget-markets-v3/');
  await append(selectorPrefix+specificationSelectorDirectory(null,calculationVersion)+'/');
  put(selectorPrefix+'projection/korea.json',{generationId,items:[{
    id:'retained-test-car',market:'korea',make:'Hyundai',model:'Avante',year:2024,cardProjectionVersion:3,
    cardImageUrl:'https://example.test/car.jpg',fuel:'petrol',powertrainKind:'combustion',bodyType:'sedan',engineCc:1598,
    powerHp:123,publicVisibleRub:1500000,publicSpecificationVerified:true,totalRub:1500000,sourcePrice:15000000,sourceCurrency:'KRW',
  }]});
  const server=http.createServer(async(req,res)=>{
    const key=decodeURIComponent((req.url||'').replace(/^\/test\//,''));
    if(req.method==='GET'){
      reads.push(key);const body=values.get(key);if(!body){res.writeHead(404);res.end();return;}
      res.writeHead(200,{'content-type':'application/json',etag:key==='catalog/manifest.json'?c.baseEtag:'"stored"'});res.end(body);return;
    }
    if(req.method==='PUT'){
      writes.push(key);const parts=[];for await(const part of req)parts.push(part);
      if(rejectWrites){res.writeHead(403);res.end('<Error><Code>AccessDenied</Code><Message>fixture</Message></Error>');return;}
      values.set(key,Buffer.concat(parts));res.writeHead(200,{etag:'"stored"'});res.end();return;
    }
    res.writeHead(405);res.end();
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address() as any;
  const contextPath=path.join(temp,'context.json'),reportPath=path.join(temp,'report.json');
  await fs.mkdir(path.join(temp,'data'));await fs.writeFile(contextPath,JSON.stringify(c));
  const env={...process.env,JSON_STORAGE_DRIVER:'object',CATALOG_LIVE_RATE_DISABLED:'true',AVTOCENA_RELEASE_SHA:release,AVTOCENA_CALCULATION_VERSION:calculationVersion,
    YC_OBJECT_STORAGE_ENDPOINT:`http://127.0.0.1:${address.port}`,YC_OBJECT_STORAGE_BUCKET:'test',YC_OBJECT_STORAGE_REGION:'test',YC_OBJECT_STORAGE_PREFIX:'',
    YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'fixture'};
  const invoke=(mode:string)=>run(process.execPath,['--import',createRequire(import.meta.url).resolve('tsx'),
    path.join(root,'scripts/catalog-staged-budget-child.mjs'),mode,process.env.CATALOG_TEST_STAGED_RUNTIME_ROOT||root,contextPath,reportPath],{cwd:temp,env,timeout:30000,maxBuffer:1024*1024});
  try{
    await invoke('prepare');const prepared=JSON.parse(await fs.readFile(reportPath,'utf8'));assertStagedBudgetReport(prepared,c);
    assert.equal(prepared.markets.korea.budget.rows,1);assert.equal(prepared.markets.korea.sort.rows,1);
    assert.ok(writes.length>=2);assert.ok(writes.every(key=>stagedBudgetWriteAllowed(key,c)));
    assert.ok(!reads.some(key=>/\/japan\b|ajes/.test(key)),'no Japanese source or partition read');
    const writeCount=writes.length;await invoke('verify');assert.equal(writes.length,writeCount);
    const verified=JSON.parse(await fs.readFile(reportPath,'utf8'));assertStagedBudgetReport(verified,c,prepared);
    const budgetKey=[...values.keys()].find(key=>key.startsWith('catalog/runtime-budget-prices-v3/korea/'))!;
    const snapshot=values.get(budgetKey)!;values.delete(budgetKey);
    await assert.rejects(invoke('verify'),/price_snapshot_missing/);assert.equal(writes.length,writeCount);
    values.set(budgetKey,Buffer.from('{"version":1,"prices":[]}'));
    await assert.rejects(invoke('verify'),/price_snapshot_missing/);assert.equal(writes.length,writeCount);
    values.set(budgetKey,snapshot);
    put('catalog-editorial/current.json',{version:1,revision:2,entries:{'retained-test-car':{id:'retained-test-car',market:'korea',sellerPrice:{amount:100000,currency:'KRW'}}}});
    await assert.rejects(invoke('verify'),/price_snapshot_missing/);assert.equal(writes.length,writeCount);
    put('catalog-editorial/current.json',{version:1,revision:1,entries:{}});
    put('fees/exchange-rates.json',{rates:[{currency:'KRW',cbrRate:0.07,nominal:1,effectiveRate:0.07,rateDate:new Date().toISOString().slice(0,10),rateSource:'cbr'}]});
    await assert.rejects(invoke('verify'),/price_snapshot_missing/);assert.equal(writes.length,writeCount);
    // 83ff's historical writer swallows PUT errors; durable readback must still fail.
    rejectWrites=true;await assert.rejects(invoke('prepare'),/price_snapshot_missing|object_storage_PUT_403/);
    assert.equal(JSON.parse(values.get('catalog/manifest.json')!.toString()).generationId,base);
    const fence=path.join(root,'scripts/catalog-staged-budget-child.mjs');
    await assert.rejects(run(process.execPath,['--input-type=module','--eval',
      `const {installStagedBudgetNetworkFence}=await import(${JSON.stringify(fence)});installStagedBudgetNetworkFence('http://127.0.0.1');await fetch('https://supplier.invalid/stats');`],{cwd:temp,env}),/external_request_forbidden/);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(temp,{recursive:true,force:true});}
});

test('real publication prepares before aliases and preserves the previous generation after a late readiness failure',async()=>{
  const previousCwd=process.cwd(), driver=process.env.JSON_STORAGE_DRIVER;
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'staged-publication-test-'));
  try{
    process.chdir(temp);await fs.mkdir('data');process.env.JSON_STORAGE_DRIVER='local';
    for(const mode of ['prepare_failed','before_commit_failed','cas_conflict','success']){
      resetJsonStorageForTests();resetCatalogReadCachesForTests();const storage=getJsonStorage();
      const baseline={version:2,generationId:base,markets:{korea:{count:1,chunks:['chunk-0001']}}};await storage.writeJson('catalog/manifest.json',baseline);
      await storage.writeJson(`catalog/generations/${base}/indexes/projection/korea.json`,{generationId:base,items:[{
        id:'previous-retained-car',market:'korea',make:'Kia',model:'K5',year:new Date().getUTCFullYear()-1,cardProjectionVersion:3,
        cardImageUrl:'https://example.test/car.jpg',fuel:'petrol',powertrainKind:'combustion',bodyType:'sedan',engineCc:1999,
        powerHp:160,powerKw:117.68,icePowerKw:117.68,utilizationPowerKw:117.68,publicVisibleRub:3000000,
        publicSpecificationVerified:true,totalRub:3000000,sourcePrice:30000000,sourceCurrency:'KRW',
      }]});
      const write=storage.writeJson.bind(storage),read=storage.readJson.bind(storage);let aliases=0,prepared=0,verified=0,manifestWrites=0;
      storage.writeJson=async(key,value,condition)=>{
        if(key.startsWith('catalog/public/')){assert.equal(prepared,1,'staging must finish first');aliases++;}
        if(key==='catalog/manifest.json'){
          assert.ok(verified>0);manifestWrites++;if(mode==='cas_conflict'&&manifestWrites===1)throw new StorageConflictError();
        }
        return write(key,value,condition);
      };
      const options={expectedBaseGenerationId:base,beforePreparedGeneration:async(manifest:any)=>{
        prepared++;assert.equal(aliases,0);assert.notEqual(manifest.generationId,base);
        assert.ok(await read(`catalog/generations/${manifest.generationId}/indexes/budget-count-v3.json`,null));
        if(mode==='prepare_failed')throw Error('preparation_failed');
        return async()=>{verified++;if(mode==='before_commit_failed')throw Error('prepared_context_changed');};
      }};
      if(mode==='success'||mode==='cas_conflict'){
        const result=await persistCatalogOffers([],options);assert.equal((await read<any>('catalog/manifest.json',null)).generationId,result.generationId);
        assert.deepEqual(await read('catalog/previous-manifest.json',null),baseline);
        assert.equal(verified,mode==='cas_conflict'?2:1);
      }else{
        await assert.rejects(persistCatalogOffers([],options),/preparation_failed|prepared_context_changed/);
        assert.deepEqual(await read('catalog/manifest.json',null),baseline);assert.equal(manifestWrites,0);
        assert.equal(aliases>0,mode==='before_commit_failed','late alias staging does not activate the failed generation');
        if(mode==='before_commit_failed'){
          resetCatalogReadCachesForTests();const visible=await readCurrentCatalogProjectionSnapshot();
          assert.equal(visible.generationId,base);assert.deepEqual(visible.items.map(row=>row.id),['previous-retained-car'],
            'reader rejects staged aliases and still reads the previous immutable projection');
        }
      }
    }
  }finally{
    process.chdir(previousCwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;
    resetJsonStorageForTests();resetCatalogReadCachesForTests();await fs.rm(temp,{recursive:true,force:true});
  }
});
