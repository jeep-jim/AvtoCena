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
import {candidateBudgetInputs,installCandidateBudgetStorage,verifyCandidateBudgetAuthority,installCandidateBudgetNetworkFence} from '../scripts/catalog-candidate-budget-prepare.mjs';
import {candidateBudgetContract,candidateBudgetWriteKind,persistCandidateBudgetObject,candidateControlsRevision,
  candidateControlsKey,assertCandidateBudgetReceipt} from '../scripts/lib/catalog-candidate-budget.mjs';
import {PREPARED_MARKETS,stagedBudgetDigest as hash} from '../scripts/lib/catalog-staged-budget.mjs';
import {publishSelectorMarket} from '../apps/web/lib/catalog/budget-selector-publication';
import {StorageConflictError} from '../apps/web/lib/data';

const root=fileURLToPath(new URL('..',import.meta.url)),run=promisify(execFile);
const release='c'.repeat(40),calculator='d'.repeat(64),baseline={release:'a'.repeat(40),calculationVersion:'b'.repeat(64)};
const generationId='gen_1790000000000_abc12345',encyclopediaDigest=hash({});
const context=()=>({version:1,mode:'candidate-prepare',release,calculationVersion:calculator,encyclopediaDigest,
  liveIdentity:baseline,baselineLiveIdentity:baseline,manifest:{version:2,generationId,markets:Object.fromEntries(PREPARED_MARKETS.map(market=>
    [market,{count:market==='korea'?1:0,chunks:market==='korea'?['chunk-0001']:[]}]))},
  manifestEtag:'"manifest"',lockRevision:{found:true,etag:'"lease"'},controlsRevision:{found:false,etag:null,digest:hash(null)}});
const input=()=>({fingerprint:'e'.repeat(64),sourceIds:hash(['korea-car']),sourceRows:1,
  coverage:{projectionRows:1,selectorRows:1,eligibleRows:1,projectionIds:hash(['korea-car']),eligibleIds:hash(['korea-car'])}});
const contract=()=>candidateBudgetContract(context(),{korea:input()});
const numeric=(c:any)=>({version:1,key:c.markets.korea.budgetPath.split('/').at(-1).slice(0,-5),sourceIds:input().sourceIds,
  createdAt:Date.now(),prices:[],checksum:hash([])});
const env=()=>({CATALOG_CANDIDATE_ACTION:'prepare',CATALOG_CANDIDATE_HEALTH_PHASE:'before-activation',
  CATALOG_EXPECTED_LIVE_RELEASE:baseline.release,CATALOG_EXPECTED_LIVE_CALCULATION_VERSION:baseline.calculationVersion,
  CATALOG_EXPECTED_GENERATION:generationId,CATALOG_CANDIDATE_RELEASE:release,CATALOG_CANDIDATE_CALCULATION_VERSION:calculator,
  CATALOG_CANDIDATE_ENCYCLOPEDIA_DIGEST:encyclopediaDigest,CATALOG_CANDIDATE_REPORT:'/tmp/candidate-report.json'});

test('candidate phase requires explicit separate baseline and candidate identities',async()=>{
  assert.deepEqual(candidateBudgetInputs(env()).liveIdentity,baseline);
  assert.throws(()=>candidateBudgetInputs({...env(),CATALOG_CANDIDATE_HEALTH_PHASE:'after-activation'}),/inputs_invalid/);
  assert.throws(()=>candidateBudgetInputs({...env(),CATALOG_EXPECTED_LIVE_CALCULATION_VERSION:calculator}),/namespace_not_isolated/);
  const after=candidateBudgetInputs({...env(),CATALOG_CANDIDATE_ACTION:'verify',CATALOG_CANDIDATE_HEALTH_PHASE:'after-activation',
    CATALOG_CANDIDATE_PREPARED_REPORT:'/tmp/previous.json',CATALOG_CANDIDATE_PREPARED_RECEIPT:'f'.repeat(64)});
  assert.deepEqual(after.liveIdentity,{release,calculationVersion:calculator});assert.deepEqual(after.baselineLiveIdentity,baseline);
  const c=context(),storage={readJsonWithMeta:async(key:string)=>key==='catalog/manifest.json'?{found:true,etag:c.manifestEtag,value:c.manifest}:
    key==='catalog/import-lock.json'?{found:true,etag:'"lease"',value:{lockedUntil:''}}:{found:false,value:null}};
  await verifyCandidateBudgetAuthority(c,storage,async()=>baseline);
  await assert.rejects(verifyCandidateBudgetAuthority(c,storage,async()=>after.liveIdentity),/live_identity_changed/);
  await verifyCandidateBudgetAuthority({...c,liveIdentity:after.liveIdentity},storage,async()=>after.liveIdentity);
  await assert.rejects(verifyCandidateBudgetAuthority({...c,liveIdentity:after.liveIdentity},storage,async()=>baseline),/live_identity_changed/);
});

test('only candidate-computed exact keys are writable; generic, live, Japan and source keys are denied',()=>{
  const c=contract(),price=numeric(c),key=c.markets.korea.budgetPath;
  assert.equal(candidateBudgetWriteKind(c,key,price),'numeric-price');
  for(const wrong of [key.replace('/korea/','/china/'),key.replace(/\/[a-f0-9]{64}\.json$/,'/'+ 'f'.repeat(64)+'.json'),
    `catalog/generations/${generationId}/indexes/budget-markets-v3/ready.json`,'catalog/manifest.json','catalog/previous-manifest.json',
    'catalog/intake-cursors/v1/korea.json','catalog-editorial/current.json','knowledge/encyclopedia/releases/'+release+'.json',
    'catalog/paid-encar-reports/v1/123/complete.json','catalog/runtime-budget-selections-v1/japan/'+ 'f'.repeat(64)+'/ready.json']) {
    assert.throws(()=>candidateBudgetWriteKind(c,wrong,price),/write_forbidden/);
  }
  const part={encoding:'gzip-base64',payload:'fixture'},partKey=c.specificationPrefix+'parts/korea/'+hash(part)+'.json';
  assert.equal(candidateBudgetWriteKind(c,partKey,part),'content-addressed-part');
  assert.throws(()=>candidateBudgetWriteKind(c,partKey,{...part,payload:'changed'}),/write_forbidden/);
  assert.throws(()=>candidateBudgetWriteKind(c,partKey.replace('parts/korea/','parts/japan/'),part),/write_forbidden/);
  assert.throws(()=>candidateBudgetContract({...context(),calculationVersion:baseline.calculationVersion},{korea:input()}),/not_isolated/);
  const missing=context();delete missing.manifest.markets.georgia;
  assert.throws(()=>candidateBudgetContract(missing,{korea:input()}),/market_manifest_incomplete/);
});

test('candidate objects require CAS and preserve existing Japan directory references',async()=>{
  const c=contract(),value=numeric(c),key=c.markets.korea.budgetPath,conditions:any[]=[];
  let current:any={found:false,value:null};
  const persist=(k:string,v:any,condition?:any)=>persistCandidateBudgetObject({contract:c,key:k,value:v,condition,
    read:async()=>current,write:async(_k:string,_v:any,cond:any)=>{conditions.push(cond);},ConflictError:StorageConflictError});
  await persist(key,value);assert.deepEqual(conditions.pop(),{ifNoneMatch:'*'});
  current={found:true,etag:'"winner"',value:{old:true}};
  await persist(key,value);assert.deepEqual(conditions.pop(),{ifMatch:'"winner"'});
  await assert.rejects(persist(key,value,{ifNoneMatch:'*'}),StorageConflictError);
  await assert.rejects(persist(key,value,{ifMatch:'"stale"'}),StorageConflictError);
  current={found:true,value:{old:true}};await assert.rejects(persist(key,value),/etag_required/);
  const ready={version:4,generationId,encyclopediaDigest,markets:{korea:{chunks:[]},japan:{kept:true}}};
  current={found:true,etag:'"ready"',value:ready};
  await assert.rejects(persist(c.specificationPrefix+'ready.json',{...ready,markets:{korea:ready.markets.korea}}),/japan_partition_changed/);
  await persist(c.specificationPrefix+'ready.json',{...ready,markets:{...ready.markets,korea:{chunks:[1]}}});
  assert.deepEqual(conditions.pop(),{ifMatch:'"ready"'});
});

test('raw network fence blocks supplier calls and PUTs outside candidate keys or without CAS',async()=>{
  const previous=globalThis.fetch,c=contract(),key=c.markets.korea.budgetPath;let calls=0;
  const config={YC_OBJECT_STORAGE_ENDPOINT:'https://storage.test',YC_OBJECT_STORAGE_BUCKET:'bucket',YC_OBJECT_STORAGE_PREFIX:'private'};
  try{
    installCandidateBudgetNetworkFence(config,async()=>{calls++;return new Response('{}');},c,true);
    const options={method:'PUT',headers:{'if-none-match':'*'},body:JSON.stringify(numeric(c))};
    await fetch('https://storage.test/bucket/private/'+key,options);assert.equal(calls,1);
    for(const url of ['https://supplier.test/list','https://storage.test/bucket/private/catalog/manifest.json',
      'https://storage.test/other/private/'+key,'https://storage.test/bucket/private/'+key+'?acl']) {
      await assert.rejects(fetch(url,options),/forbidden/);
    }
    await assert.rejects(fetch('https://storage.test/bucket/private/'+key,{...options,headers:{}}),/forbidden/);
    installCandidateBudgetNetworkFence(config,async()=>{calls++;return new Response('{}');},c,false);
    await assert.rejects(fetch('https://storage.test/bucket/private/'+key,options),/forbidden/);assert.equal(calls,1);
  }finally{globalThis.fetch=previous;}
});

test('controls, lease and actual manifest are pinned; initial discovery and verification cannot write',async()=>{
  const ctx=context(),c=contract();let writes=0,controls:any={found:false,value:null};
  let manifest:any={found:true,etag:ctx.manifestEtag,value:ctx.manifest},lock:any={found:true,etag:'"lease"',value:{lockedUntil:''}};
  const make=()=>({readJsonWithMeta:async(key:string,fallback:any)=>key==='catalog/manifest.json'?manifest:key==='catalog/import-lock.json'?lock:
    key===candidateControlsKey?controls:{found:false,value:fallback},writeJson:async()=>{writes++;},deleteJson:async()=>{writes++;}});
  const storage:any=make(),guard=installCandidateBudgetStorage(storage,ctx,'prepare',StorageConflictError);
  await assert.rejects(storage.writeJson(c.markets.korea.budgetPath,numeric(c)),/write_forbidden/);
  guard.setContract(c);await storage.writeJson(c.markets.korea.budgetPath,numeric(c));assert.equal(writes,1);
  controls={found:true,etag:'"changed"',value:{revision:2}};
  await assert.rejects(storage.writeJson(c.markets.korea.budgetPath,numeric(c)),/controls_changed/);controls={found:false,value:null};
  lock={...lock,etag:'"intervening-writer"'};await assert.rejects(guard.checkState(),/writer_revision_changed/);lock={...lock,etag:'"lease"'};
  manifest={...manifest,etag:'"replaced"'};await assert.rejects(guard.checkState(),/manifest_changed/);manifest={...manifest,etag:ctx.manifestEtag};
  const readonly:any=make(),check=installCandidateBudgetStorage(readonly,ctx,'verify',StorageConflictError);check.setContract(c);
  await assert.rejects(readonly.writeJson(c.markets.korea.budgetPath,numeric(c)),/write_forbidden/);
  await assert.rejects(readonly.deleteJson('anything'),/write_forbidden/);assert.equal(writes,1);
});

test('receipt excludes envelope time but rejects date, rate, source, controls and saved checksum drift',()=>{
  const core={version:1,utcDay:'2026-11-16',policyDay:'2026-11-16',fingerprint:input().fingerprint,sourceIds:input().sourceIds,
    controlsRevision:context().controlsRevision,numericChecksum:hash([])},digest=hash(core);
  const report={core,receiptSha256:digest,checkedAt:'first'};
  assertCandidateBudgetReceipt({...report,checkedAt:'later'},core,digest);
  for(const [key,value]of Object.entries({utcDay:'2026-11-17',policyDay:'2026-11-17',fingerprint:'f'.repeat(64),sourceIds:'0'.repeat(64),
    controlsRevision:{found:false,etag:null,digest:'f'.repeat(64)},numericChecksum:'1'.repeat(64)})) {
    assert.throws(()=>assertCandidateBudgetReceipt(report,{...core,[key]:value},digest),/receipt_changed/);
  }
});

test('real runtime requires prepared reader; capable candidate verifies all five markets without further writes',async t=>{
  const runtimeRoot=process.env.CATALOG_TEST_STAGED_RUNTIME_ROOT||root;
  const runtimeSource=await fs.readFile(path.join(runtimeRoot,'apps/web/lib/catalog/storage.ts'),'utf8');
  const preparedReader=runtimeSource.includes('export async function verifyPreparedBudgetPriceCaches');
  const supplementReader=runtimeSource.includes('export async function readBudgetSpecificationSource');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'candidate-budget-child-')),ctx:any=context();
  ctx.manifest.markets=Object.fromEntries(PREPARED_MARKETS.map(market=>[market,{count:1,chunks:['chunk-0001']}]));
  if(supplementReader){ctx.manifest.markets.uae.count=3;ctx.manifest.markets.korea.count=2;}
  const values=new Map<string,Buffer>(),writes:{key:string,value:any}[]=[],reads:string[]=[];
  const put=(key:string,value:any)=>values.set(key,Buffer.from(JSON.stringify(value)));
  const etag=(key:string)=>'"'+hash(values.get(key)?.toString()??null)+'"';
  put('catalog/manifest.json',ctx.manifest);put('catalog/import-lock.json',{lockedUntil:''});
  put(candidateControlsKey,{version:1,revision:1,markets:{korea:{enabled:true}},sources:{encar_feed:{enabled:true}}});
  ctx.manifestEtag=etag('catalog/manifest.json');ctx.lockRevision.etag=etag('catalog/import-lock.json');
  ctx.controlsRevision=candidateControlsRevision({found:true,etag:etag(candidateControlsKey),value:JSON.parse(values.get(candidateControlsKey)!.toString())});
  put('catalog-editorial/current.json',{version:1,revision:1,entries:{}});
  const rates={rates:[['KRW',0.065],['EUR',95],['USD',85],['CNY',12],['AED',23]].map(([currency,rate])=>
    ({currency,cbrRate:rate,nominal:1,effectiveRate:rate,rateDate:new Date().toISOString().slice(0,10),rateSource:'cbr'}))};
  put('fees/exchange-rates.json',rates);
  const raw=PREPARED_MARKETS.map(market=>({id:market+'-car',market,make:'Hyundai',model:'Avante',year:2024,cardProjectionVersion:3,
    cardImageUrl:'https://example.test/car.jpg',fuel:'petrol',powertrainKind:'combustion',bodyType:'sedan',engineCc:1598,powerHp:123,
    publicVisibleRub:1500000,publicSpecificationVerified:true,totalRub:1500000,sourcePrice:15000000,sourceCurrency:'KRW'}));
  const prefix=`catalog/generations/${generationId}/indexes/`,directory:any={version:4,generationId,encyclopediaDigest:null,markets:{}};
  put(prefix+'budget-cards-v3/0.json',{generationId,items:raw});
  for(const row of raw){
    const unpriced=(id:string)=>({id,market:'uae',make:'Toyota',model:'Corolla',year:2026,trim:'Fixture',
      sourceGroup:'dubicars_uae_exact',sourcePrice:50000,sourceCurrency:'AED',sellerPriceRub:1100000,
      totalRub:null,catalogPricingMode:'seller',calculationStatus:'needs_data',cardProjectionVersion:3,
      calculationSnapshot:{currencyRate:{rateSource:'cbr',currency:'AED',sourcePrice:50000,effectiveRate:22},sourcePriceRub:1100000},
      cardImageUrl:'https://example.test/car.jpg',fuel:'petrol',transmission:'automatic',bodyType:'sedan',updatedAt:new Date().toISOString(),mileageKm:1000});
    const extras=supplementReader?(row.market==='uae'?[unpriced('uae-missing-1'),unpriced('uae-missing-2')]:
      row.market==='korea'?[{...row,id:'korea-missing-priced',sourcePrice:undefined,sourceCurrency:undefined,
        calculationStatus:'ready',calculationSnapshot:{deliveryPricingBasis:{subtotalRub:1500000,deliveryRub:0,percents:[]}}}]:[]):[];
    put(prefix+`projection/${row.market}.json`,{generationId,items:[row,...extras]});
    const index:any={version:3,generationId,sourceRows:1,displayOrderVersion:1,filterVersion:1,specificationFilterVersion:1,bodyFilterVersion:1,
      inventoryPolicyVersion:1,rows:[[row.market,1500000,null,null,false,{id:row.id,make:row.make,model:row.model,year:row.year,block:0}]],otherRows:[]};
    if(extras.length&&row.market==='korea'){
      const replayPath='budget-prices-v3/korea/0.json';
      index.pricingChunks={korea:[replayPath]};put(prefix+replayPath,{generationId,market:'korea',entries:[[row.id,row]]});
    }
    directory.markets[row.market]=await publishSelectorMarket(index,row.market,
      async name=>JSON.parse(values.get(prefix+'budget-markets-v3/'+name+'.json')!.toString()),
      async(name,value)=>{put(prefix+'budget-markets-v3/'+name+'.json',value);});
  }
  put(prefix+'budget-markets-v3/ready.json',directory);
  const original=new Map(values);
  const server=http.createServer(async(req,res)=>{
    const key=decodeURIComponent((req.url||'').replace(/^\/test\//,''));
    if(req.method==='HEAD'){res.writeHead(values.has(key)?200:404,{etag:etag(key)});res.end();return;}
    if(req.method==='GET'){
      reads.push(key);const body=values.get(key);if(!body){res.writeHead(404);res.end();return;}
      res.writeHead(200,{'content-type':'application/json',etag:etag(key)});res.end(body);return;
    }
    if(req.method==='PUT'){
      const parts=[];for await(const part of req)parts.push(part);const body=Buffer.concat(parts);
      if(req.headers['if-none-match']==='*'&&values.has(key)||req.headers['if-match']&&req.headers['if-match']!==etag(key)) {res.writeHead(412);res.end();return;}
      assert.ok(req.headers['if-none-match']==='*'||req.headers['if-match'],'every durable write uses CAS');
      writes.push({key,value:JSON.parse(body.toString())});values.set(key,body);res.writeHead(200,{etag:etag(key)});res.end();return;
    }
    res.writeHead(405);res.end();
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as any;
  const contextPath=path.join(temp,'context.json'),reportPath=path.join(temp,'report.json');
  await fs.mkdir(path.join(temp,'data/knowledge/encyclopedia'),{recursive:true});
  await fs.writeFile(path.join(temp,'data/knowledge/encyclopedia/calculation-v1.json'),JSON.stringify({version:1,digest:encyclopediaDigest,models:{}}));
  const childEnv={...process.env,NODE_PATH:path.join(root,'node_modules'),JSON_STORAGE_DRIVER:'object',CATALOG_LIVE_RATE_DISABLED:'true',
    YC_OBJECT_STORAGE_ENDPOINT:`http://127.0.0.1:${address.port}`,YC_OBJECT_STORAGE_BUCKET:'test',YC_OBJECT_STORAGE_REGION:'test',YC_OBJECT_STORAGE_PREFIX:'',
    YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'fixture',AVTOCENA_RELEASE_SHA:release,AVTOCENA_CALCULATION_VERSION:calculator};
  const invoke=async(phase:string)=>{
    await fs.writeFile(contextPath,JSON.stringify(ctx));
    await run(process.execPath,['--import',createRequire(import.meta.url).resolve('tsx'),path.join(root,'scripts/catalog-candidate-budget-prepare.mjs'),
      '--child',phase,runtimeRoot,contextPath,reportPath],{cwd:temp,env:childEnv,timeout:30000,maxBuffer:1024*1024});
    return JSON.parse(await fs.readFile(reportPath,'utf8'));
  };
  try{
    if(!preparedReader){
      await assert.rejects(invoke('prepare'),/prepared_reader_required/);assert.equal(writes.length,0);
      t.diagnostic('This source lacks the new reader and was correctly denied; the positive path is also tested with CATALOG_TEST_STAGED_RUNTIME_ROOT pointing to the exact candidate.');return;
    }
    const prepared=await invoke('prepare');assert.ok(prepared.derivedWrites>=20);
    assert.deepEqual(Object.keys(prepared.core.markets).sort(),PREPARED_MARKETS.slice().sort());
    assert.equal(prepared.core.preparedSelections.results.length,5);
    if(supplementReader){
      for(const market of PREPARED_MARKETS){
        const descriptor=prepared.core.markets[market].sourceSupplement;
        assert.equal(descriptor.calculationVersion,calculator);assert.equal(descriptor.encyclopediaDigest,encyclopediaDigest);
        assert.equal(descriptor.baselineSourceRows,1);assert.deepEqual(descriptor,prepared.core.contract.markets[market].sourceSupplement);
        if(!['uae','korea'].includes(market)){assert.deepEqual(descriptor.objects,[]);assert.deepEqual(descriptor.missingIds,[]);}
      }
      const added=prepared.core.markets.uae.sourceSupplement;
      assert.deepEqual(added.missingIds,['uae-missing-1','uae-missing-2']);assert.equal(added.sourceRows,3);
      assert.deepEqual(added.objects.map((object:any)=>object.kind),['card']);
      const korea=prepared.core.markets.korea.sourceSupplement;
      assert.deepEqual(korea.missingIds,['korea-missing-priced']);assert.equal(korea.sourceRows,2);
      assert.deepEqual(korea.objects.map((object:any)=>object.kind).sort(),['card','replay']);
    }
    for(const {key,value}of writes)assert.ok(candidateBudgetWriteKind(prepared.core.contract,key,value));
    for(const [key,value]of original)assert.deepEqual(values.get(key),value,'authoritative/source object preserved: '+key);
    const count=writes.length,verified=await invoke('verify');assert.equal(verified.derivedWrites,0);assert.equal(writes.length,count);
    assertCandidateBudgetReceipt(prepared,verified.core,prepared.receiptSha256);
    if(supplementReader){
      for(const market of PREPARED_MARKETS){
        const proof=verified.core.markets[market].cardReadiness;
        assert.equal(proof.verified,true);assert.equal(proof.sourceRows,verified.core.markets[market].sourceRows);
        assert.equal(proof.blocks.reduce((n:number,block:any)=>n+block.coveredRows,0),proof.sourceRows);
        assert.ok(proof.blocks.some((block:any)=>block.path==='budget-cards-v3/0.json'));
      }
      const legacyKey=prefix+'budget-cards-v3/0.json',legacy=values.get(legacyKey)!;
      values.delete(legacyKey);await assert.rejects(invoke('verify'),/budget_card_readiness_missing/);values.set(legacyKey,legacy);
      for(const mutate of [
        (part:any)=>{part.items.push(part.items[0]);},
        (part:any)=>{part.items[0].market='korea';},
        (part:any)=>{part.items=part.items.filter((row:any)=>row.id!=='korea-car');},
      ]){
        const damaged=JSON.parse(legacy.toString());mutate(damaged);put(legacyKey,damaged);
        await assert.rejects(invoke('verify'),/budget_card_readiness_(?:identity|mapping|incomplete)/);values.set(legacyKey,legacy);
      }
      const changedLegacy=JSON.parse(legacy.toString());changedLegacy.items[0].cardImageUrl='https://example.test/changed-with-same-id.jpg';
      put(legacyKey,changedLegacy);
      const changedCards=await invoke('verify');
      assert.throws(()=>assertCandidateBudgetReceipt(prepared,changedCards.core,prepared.receiptSha256),/receipt_changed/,
        'same IDs do not authorize changed payloads after the prepare receipt');
      values.set(legacyKey,legacy);
      assertCandidateBudgetReceipt(prepared,(await invoke('verify')).core,prepared.receiptSha256);
      assert.equal(writes.length,count,'all full-card verify passes are read-only');
      for(const object of [...prepared.core.markets.uae.sourceSupplement.objects,...prepared.core.markets.korea.sourceSupplement.objects]){
        const objectKey=prefix+object.path,savedObject=values.get(objectKey)!;
        values.delete(objectKey);await assert.rejects(invoke('verify'),/supplement_object/);values.set(objectKey,savedObject);
        put(objectKey,{damaged:true});await assert.rejects(invoke('verify'),/supplement_object/);values.set(objectKey,savedObject);
      }
      // A self-consistent rewritten v7 part cannot silently switch the card or
      // replay references after preflight; source IDs alone would miss this.
      const specPrefix=prepared.core.contract.specificationPrefix;
      const savedSpec=new Map([...values].filter(([key])=>key.startsWith(specPrefix)));
      const {readCompressedSelector}=await import('../apps/web/lib/catalog/budget-selector-publication');
      const readyDirectory=JSON.parse(values.get(specPrefix+'ready.json')!.toString());
      const savedIndex:any=await readCompressedSelector(readyDirectory,'uae',async name=>JSON.parse(values.get(specPrefix+name+'.json')!.toString()));
      const changed=structuredClone(savedIndex),missing=[...changed.rows,...changed.otherRows].find((row:any)=>row[5].id==='uae-missing-1');
      missing[5].cardPath='budget-cards-v3/0.json';
      readyDirectory.markets.uae=await publishSelectorMarket(changed,'uae',async name=>JSON.parse(values.get(specPrefix+name+'.json')!.toString()),async(name,value)=>{put(specPrefix+name+'.json',value);});
      put(specPrefix+'ready.json',readyDirectory);await assert.rejects(invoke('verify'),/supplement_mapping_changed/);
      for(const [key,value]of savedSpec)values.set(key,value);
    }
    const priceKey=prepared.core.contract.markets.korea.budgetPath,saved=values.get(priceKey)!;
    values.delete(priceKey);await assert.rejects(invoke('verify'),/snapshot_missing|prices_invalid/);values.set(priceKey,saved);
    const ready=prepared.core.preparedSelections.results.find((row:any)=>row.market==='korea');
    const partKey=prepared.core.contract.markets.korea.selectionPrefix+ready.directory.markets.korea.chunks[0].name+'.json',part=values.get(partKey)!;
    put(partKey,{encoding:'gzip-base64',payload:'broken'});await assert.rejects(invoke('verify'),/prepared_selection/);values.set(partKey,part);
    put('fees/exchange-rates.json',{rates:rates.rates.map(row=>row.currency==='KRW'?{...row,cbrRate:0.07,effectiveRate:0.07}:row)});
    await assert.rejects(invoke('verify'),/snapshot_missing|prepared_selection/);put('fees/exchange-rates.json',rates);
    put(candidateControlsKey,{version:1,revision:2});await assert.rejects(invoke('verify'),/controls_changed/);values.set(candidateControlsKey,original.get(candidateControlsKey)!);
    put(prefix+'projection/korea.json',{generationId,items:[]});await assert.rejects(invoke('verify'),/projection/);values.set(prefix+'projection/korea.json',original.get(prefix+'projection/korea.json')!);
    put('catalog/import-lock.json',{lockedUntil:new Date(Date.now()+60000).toISOString()});await assert.rejects(invoke('verify'),/writer_busy/);
    assert.equal(writes.length,count);assert.ok(!reads.some(key=>/\/japan\b|ajes/.test(key)));
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(temp,{recursive:true,force:true});}
});
