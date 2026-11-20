import fs from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {parseArgs} from 'node:util';
import {digest,openChinaShadowDisk,readVerifiedLocalFile,finalizeChinaShadowStage} from './lib/china-shadow-disk.mjs';
import {CHINA_LOCAL_CANONICAL_CHUNK_MAX_BYTES} from './lib/china-native-canonical.mjs';

globalThis.fetch=async()=>{throw Error('china_shadow:network_disabled');};
const cases={
 'novokuznetsk-cold':[
  {market:'china',budgetTo:3000000,pageSize:12},
  {market:'china',budgetFrom:1500000,budgetTo:2500000,city:'Новокузнецк',yearFrom:2022,pageSize:12},
 ],
 'novokuznetsk-city':[{market:'china',budgetFrom:1500000,budgetTo:2500000,city:'Новокузнецк',yearFrom:2022,pageSize:12}],
 'kemerovo-rpm':[{market:'china',make:'Mercedes-Benz,BMW',yearFrom:2019,yearTo:2023,budgetTo:2550000,city:'Кемерово',pageSize:12}],
};
const SHA=/^[a-f0-9]{64}$/,GEN=/^gen_\d{13}_[a-z0-9]{1,64}$/;
const fail=code=>{throw Error('china_shadow:'+code);};
const {values,positionals}=parseArgs({allowPositionals:true,options:{
 archive:{type:'string'},'expect-sha':{type:'string'},shadow:{type:'string'},case:{type:'string'},page:{type:'string'},
 'page-size':{type:'string'},'allowed-stage-parent':{type:'string'},'expect-ready':{type:'string'},'budget-from':{type:'string'},'budget-to':{type:'string'},repeat:{type:'string'},concurrency:{type:'string'},id:{type:'string'},
}});
const [command]=positionals;
const number=(v,fallback,max)=>{const n=Number(v??fallback);if(!Number.isSafeInteger(n)||n<1||n>max)fail('query_limit');return n;};
const budget=v=>{if(v===undefined)return undefined;const n=Number(v);if(!Number.isFinite(n)||n<=0)fail('budget_limit');return n;};
const cliStart=performance.now(),cpuStart=process.cpuUsage();
const statistics=()=>{const cpu=process.cpuUsage(cpuStart);return {wallMs:performance.now()-cliStart,userMs:cpu.user/1000,
 sysMs:cpu.system/1000,maxRssBytes:process.resourceUsage().maxRSS*1024};};
const summary=(samples)=>{
 const sorted=[...samples].sort((a,b)=>a-b),at=p=>sorted[Math.max(0,Math.ceil(p*sorted.length)-1)];
 return {count:samples.length,p50:at(.50),p95:at(.95),p99:at(.99),max:sorted.at(-1)};
};
const json=b=>JSON.parse(b.toString('utf8'));

async function readArchive(){
 if(!values.archive||!SHA.test(values['expect-sha']??''))fail('out_of_band_archive_sha256_required');
 const arch=path.resolve(values.archive);
 if(await fs.realpath(arch)!==arch)fail('archive_symlink');
 const name='shadow-package.json',info=await fs.stat(path.join(arch,name));
 const spec=json(await readVerifiedLocalFile(arch,name,{bytes:info.size,sha256:values['expect-sha']},8*1024*1024));
 if(spec?.version!==1||spec.market!=='china'||spec.stage!=='canonical-admitted-v1'||!GEN.test(spec.generationId)||
    !Number.isSafeInteger(spec.count)||spec.count<1||spec.count>1_000_000||!Array.isArray(spec.chunks)||
    spec.chunks.length!==Math.ceil(spec.count/500)||!Array.isArray(spec.plan)||!Array.isArray(spec.runtimeFiles)||
    !spec.runtimeFiles.length||!Array.isArray(spec.withdrawn)||spec.withdrawn.length>1024||
    !spec.modelScope?.make||!spec.modelScope?.model||(spec.withFixedCities!==undefined&&spec.withFixedCities!==true)||(spec.withStreamingSearch!==undefined&&spec.withStreamingSearch!==true)||
    ![spec.source?.receiptSha256,spec.fx?.receiptSha256,spec.pricingFingerprint,spec.calculationVersion,
      spec.expectedAdmittedIdsSha256,spec.legacyOracleSha256,spec.archiveReceiptSha256].every(v=>SHA.test(v))||
    !Number.isSafeInteger(spec.blockRows)||spec.blockRows<1||spec.blockRows>128)
  fail('archive_contract');
 if(!spec.source?.cursor||!Number.isSafeInteger(spec.source.validUntil)||Date.now()>=spec.source.validUntil)fail('expired_capture');
 const freshSnapshot=spec.conversion?.mode==='complete-fresh-replacement';
 if(freshSnapshot&&(!SHA.test(spec.conversion?.replacementProofSha256)||spec.withdrawn.length||
   spec.conversion.previousServingGeneration!=='rollback-only'))fail('fresh_replacement_binding');
 const fxDay=Date.parse(spec.fx?.receipt?.pricingAsOf);
 if(!Number.isFinite(fxDay)||Date.now()<fxDay||!freshSnapshot&&new Date(fxDay+7*3600000).toISOString().slice(0,10)!==
    new Date(Date.now()+7*3600000).toISOString().slice(0,10))fail('expired_fx_policy_day');
 for(const [kind,expected] of [['archive',spec.archiveReceiptSha256],['oracle',spec.legacyOracleSha256]]){
  const proof=spec.evidence?.[kind];
  const file=kind==='archive'?'evidence/archive-receipt.json':'evidence/legacy-oracle.json';
  if(!proof||proof.path!==file||proof.sha256!==expected)fail('required_evidence');
  await readVerifiedLocalFile(arch,file,proof,16*1024*1024);
 }
 const workerCtx=path.join(arch,'context'),dataPath=path.join(workerCtx,'data');
 if(await fs.realpath(dataPath)!==dataPath)fail('runtime_context_scope');
 const actual=new Set();
 async function scan(dir){
  for(const ent of await fs.readdir(dir,{withFileTypes:true})){
   const file=path.join(dir,ent.name);
   if(ent.isDirectory())await scan(file);
   else if(ent.isFile()){actual.add(path.relative(arch,file));if(actual.size>2000)fail('runtime_file_limit');}
   else fail('runtime_context_symlink');
  }
 }
 await scan(workerCtx);
 for(const f of spec.runtimeFiles){
  if(!f?.path?.startsWith('context/data/')||!actual.delete(f.path))fail('runtime_file_inventory');
  await readVerifiedLocalFile(arch,f.path,f,64*1024*1024);
 }
 if(actual.size)fail('runtime_file_inventory');
 if(spec.withStreamingSearch){
  const editorial=spec.runtimeFiles.find(f=>f.path==='context/data/catalog-editorial/current.json');
  if(editorial){
   const snapshot=json(await readVerifiedLocalFile(arch,editorial.path,editorial,8*1024*1024));
   if(!snapshot||!snapshot.entries||typeof snapshot.entries!=='object'||Array.isArray(snapshot.entries)||
      Object.values(snapshot.entries).some(entry=>!entry||entry.market==='china'))fail('china_editorial_not_supported_in_stage');
  }
 }
 const archiveIO={reads:0,bytes:0,maxBytes:0};
 function chunks(){
  return (async function*(){
   for(const [i,desc] of spec.chunks.entries()){
    const expected='canonical/chunk-'+String(i+1).padStart(4,'0')+'.json';
    if(desc.path!==expected||desc.rows!==Math.min(500,spec.count-i*500))fail('chunk_inventory');
    const body=await readVerifiedLocalFile(arch,desc.path,desc,spec.withStreamingSearch?CHINA_LOCAL_CANONICAL_CHUNK_MAX_BYTES:4*1024*1024);
    archiveIO.reads++;archiveIO.bytes+=body.length;archiveIO.maxBytes=Math.max(archiveIO.maxBytes,body.length);
    const rows=json(body);
    if(!Array.isArray(rows)||rows.length!==desc.rows||rows.some(row=>row?.market!=='china'||row.status!=='active'||typeof row.id!=='string'))fail('canonical_rows');
    yield rows;
   }
  })();
 }
 return {arch,spec,workerCtx,chunks,archiveIO};
}

async function availableBytes(dir){
 const vol=await fs.statfs(dir);return Number(vol.bavail)*Number(vol.bsize);
}
async function sampleDisk(dir,callback){
 const start=await availableBytes(dir);let minimum=start;
 const tick=setInterval(()=>{void availableBytes(dir).then(value=>{minimum=Math.min(value,minimum);}).catch(()=>{});},250);
 tick.unref();
 try{
  const result=await callback(),end=await availableBytes(dir);
  return {...result,disk:{startFreeBytes:start,endFreeBytes:end,minObservedFreeBytes:Math.min(minimum,end),scope:'workspace filesystem; sampled at 250 ms'}};
 }finally{clearInterval(tick);}
}

async function main(){
 if(command==='acceptance-plan'){
  console.log(JSON.stringify({supportedNow:'isolated one-model price-ascending list, count and direct',blockedCases:cases,
   optionalExactCitySlices:['novokuznetsk-city','kemerovo-rpm'],
   requiredMetrics:['cold and warm p50/p95/p99','actual offered/achieved RPM','CPU','maximum RSS','read/write objects and bytes','workspace disk peak/free space','timeouts/errors','zero supplier/FX network calls']},null,2));return;
 }
 if(!['preflight','prepare','probe','probe-fs'].includes(command)||positionals.length!==1)fail('usage_preflight_prepare_probe_or_acceptance_plan');
 const nativeProbe=command==='probe-fs';
 const selectedCase=command==='probe'||nativeProbe?(values.case??'model'):'model';
 if(selectedCase!=='model'&&!(nativeProbe&&selectedCase==='compatibility')&&!Object.hasOwn(cases,selectedCase))fail('scenario');
 const denyCase=()=>{
  console.log(JSON.stringify({status:'blocked_not_in_prepared_scope',case:selectedCase,queries:cases[selectedCase],
   reason:'not one of the exact fixed-city slices, or archive does not enable those slices'}));
  process.exitCode=3;
 };
 if(selectedCase!=='model'&&(!nativeProbe&&selectedCase==='novokuznetsk-cold'||!values.archive)){denyCase();return;}
 const {arch,spec,workerCtx,chunks,archiveIO}=await readArchive();
 if(selectedCase!=='model'&&!nativeProbe&&spec.withFixedCities!==true){denyCase();return;}
 if(nativeProbe&&spec.withStreamingSearch!==true)fail('native_requires_streaming_readiness');
 if(command==='preflight'){
  const {createPreparedCoverageIdsDigest}=await import('../apps/web/lib/catalog/prepared-price-coverage.ts');
  const {preparedPriceCardDigest}=await import('../apps/web/lib/catalog/prepared-price-card-block.ts');
  const ids=createPreparedCoverageIdsDigest(),unique=new Set();let ordinal=0,chunk=0;
  for await(const rows of chunks()){
   chunk++;
   for(const row of rows){if(unique.has(row.id))fail('duplicate_id');unique.add(row.id);ids.add(row.id);}
   for(let offset=0;offset<rows.length;offset+=spec.blockRows){
    const sub=rows.slice(offset,offset+spec.blockRows),want=spec.plan[ordinal++];
    if(!want||want.sourceChunk!=='chunk-'+String(chunk).padStart(4,'0')||want.part!==Math.floor(offset/spec.blockRows)||
       want.rows!==sub.length||want.sourceInputSha256!==preparedPriceCardDigest(sub)||
       want.sourceIdsSha256!==preparedPriceCardDigest(sub.map(row=>row.id)))fail('block_plan');
   }
  }
  if(ordinal!==spec.plan.length||ids.finish()!==spec.expectedAdmittedIdsSha256)fail('coverage');
  console.log(JSON.stringify({status:'canonical_input_verified_only',rows:spec.count,blocks:ordinal,archiveIO,resources:statistics()}));return;
 }
 if(!values.shadow)fail('isolated_shadow_required');
 const shadow=path.resolve(values.shadow);
 if(shadow.startsWith(arch+path.sep)||arch.startsWith(shadow+path.sep)||shadow===arch)fail('shared_archive_shadow_path');
 if(nativeProbe){
  const {openStageChinaFiles}=await import('../apps/web/lib/catalog/china-stage-runtime-files.ts');
  // Need a private, independently selected allowlist parent, not a fallback
  // to cwd, user data, a public path or merely a convincing stage filename.
  if(!values['allowed-stage-parent']||!values['expect-ready'])fail('native_stage_pins_required');
  const files=await openStageChinaFiles({allowedParent:values['allowed-stage-parent'],root:shadow,
   readySha256:values['expect-ready'],archiveSha256:values['expect-sha'],expectedGenerationId:spec.generationId,
   expectedFxSha256:spec.fx.receiptSha256,expectedAdmittedRows:spec.count,sourceValidUntil:spec.source.validUntil});
  // Knowledge resolution may read the package's hash-verified local context;
  // no serving reads are allowed to touch the mutable shared editorial index.
  process.env.JSON_STORAGE_DRIVER='local';process.env.CATALOG_LIVE_RATE_DISABLED='1';
  process.chdir(workerCtx);
  return probe({spec,archiveIO,selectedCase,files});
 }
 const disk=await openChinaShadowDisk(shadow,command==='prepare');
 Object.assign(process.env,disk.env,{AVTOCENA_CALCULATION_VERSION:spec.calculationVersion});
 globalThis.fetch=disk.fetchMock;process.chdir(workerCtx);
 if(command==='prepare'){
  const scratch=path.join(disk.root,'tmp');await fs.mkdir(scratch,{mode:0o700});process.env.TMPDIR=scratch;
 }
 const {ObjectJsonStorage}=await import('../apps/web/lib/data.ts');
 const {openIndependentMarketFixture}=await import('../apps/web/lib/catalog/independent-market-activation-fixture.ts');
 const storage=new ObjectJsonStorage(),publication=openIndependentMarketFixture(storage,'china',{
  origin:disk.endpoint,bucket:disk.bucket,prefix:disk.prefix,fixtureFetch:disk.fetchMock,
  assertAuthorized:async market=>{if(market!=='china'||disk.mode!=='prepare')fail('shadow_authority');},
 });
 if(command==='prepare'){
  const {importCatalogFxBatch}=await import('../apps/web/lib/catalog/rates.ts');
  const {prepareIndependentChinaCanonicalChunks}=await import('../apps/web/lib/catalog/independent-china-prepared-fixture.ts');
  const fx=importCatalogFxBatch(spec.fx,spec.fx.receiptSha256);
  if(fx.receipt.market!=='china')fail('fx_market');
  const base=await publication.observe(),ttl=Math.min(8*3600_000,spec.source.validUntil-Date.now());
  const lease=await publication.acquire({action:'publish',generationId:spec.generationId,expectedBaseSha256:base.baseSha256},ttl);
  const backend={kind:'mock-s3',origin:disk.endpoint,bucket:disk.bucket,prefix:disk.prefix,fixtureFetch:disk.fetchMock};
  const report=await sampleDisk(disk.root,async()=>{
   const staged=await prepareIndependentChinaCanonicalChunks({...spec,chunks,fx,backend,publication,lease,...(spec.conversion?.mode==='complete-fresh-replacement'?{freshSnapshot:true}:{}),expectedBlocks:async function*(){yield* spec.plan;}});
   const ready=await finalizeChinaShadowStage({disk,storage,publication,lease,staged,archiveSha256:values['expect-sha'],
    source:spec.source,fxReceiptSha256:fx.receiptSha256,count:spec.count,streaming:spec.withStreamingSearch===true});
   return {...ready,archiveIO,io:disk.metrics,resources:statistics()};
  });
  await fs.writeFile(path.join(disk.root,'receipt.json'),JSON.stringify(report),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify(report));return;
 }
 const receipt=json(await fs.readFile(path.join(disk.root,'receipt.json')));
 if(receipt.archiveSha256!==values['expect-sha']||receipt.generationId!==spec.generationId)fail('shadow_receipt');
 return probe({spec,archiveIO,selectedCase,disk,storage,publication});
}

async function probe({spec,archiveIO,selectedCase,disk,storage,publication,files}){
 const {readPreparedChinaIndexedModel,readPreparedChinaIndexedCity,readPreparedChinaFixtureOffer,readPreparedChinaCompatibility,
  withPreparedChinaHttpFixture,withPreparedChinaStageRuntime}=await import('../apps/web/lib/catalog/prepared-china-http-fixture.ts');
 const compatibility=selectedCase==='compatibility'||selectedCase==='novokuznetsk-cold'||Boolean(files&&spec.withFixedCities!==true&&selectedCase!=='model');
 const args=selectedCase==='model'?{market:'china',...spec.modelScope}:selectedCase==='compatibility'?
  {market:'china',make:spec.modelScope.make,city:'Омск'}:cases[selectedCase][selectedCase==='novokuznetsk-cold'?1:0];
 const query={...args,sort:'totalRub',page:number(values.page,1,1_000_000),pageSize:number(values['page-size'],args.pageSize??24,48),
  budgetFrom:budget(values['budget-from'])??args.budgetFrom,budgetTo:budget(values['budget-to'])??args.budgetTo};
 const select=compatibility?((params,countOnly)=>readPreparedChinaCompatibility(params,
  {countOnly,includeFacets:!countOnly,marketPage:false,unsupported:false})):selectedCase==='model'?readPreparedChinaIndexedModel:readPreparedChinaIndexedCity;
 const fixture=disk&&{storage,origin:disk.endpoint,bucket:disk.bucket,prefix:disk.prefix,fetchMock:disk.fetchMock,indexedModelOnly:true,independentChina:publication};
 const run=files?fn=>withPreparedChinaStageRuntime(files,fn):fn=>withPreparedChinaHttpFixture(fixture,fn);
 const repeat=number(values.repeat,1,10_000),concurrency=number(values.concurrency,1,64),times=[];
 let next=0,first=null;
 const runStart=performance.now();
 await Promise.all(Array.from({length:Math.min(concurrency,repeat)},async()=>{
  while(next<repeat){
   const n=next++,t=performance.now();
   const outcome=await run(async()=>{
    const list=await select(query,false),count=await select(query,true);
    if(!list||!count||list.total!==count.total||list.generationId!==count.generationId||list.generationId!==spec.generationId)fail('list_count_generation');
    const id=values.id||list.items[0]?.id;
    const direct=id?await readPreparedChinaFixtureOffer(id,query.city,list.generationId):null;
    if(id&&!direct?.offer&&!direct?.withdrawn)fail('card_unavailable');
    const card=direct?.offer;
    if(card&&list.items.some(row=>row.id===card.id&&row.totalRub!==card.totalRub))fail('list_card_price');
    return {generationId:list.generationId,total:list.total,page:query.page,items:list.items.map(row=>({id:row.id,rub:row.totalRub})),
     card:card?{id:card.id,rub:card.totalRub,priceLines:card.calculationSnapshot?.breakdown?.length}:direct?.withdrawn?{id:direct.withdrawn.id,state:direct.withdrawn.reason}:null};
   });
   times.push(performance.now()-t);
   if(n===0)first=outcome;
  }
 }));
 if(disk&&(disk.metrics.writeCount||disk.metrics.blockedRequests))fail('probe_reads_only');
 console.log(JSON.stringify({status:files?'isolated_native_filesystem_probe':'local_disk_probe',scope:'handler functions, not deployed HTTP/browser',case:selectedCase,repeat,concurrency,probeMs:summary(times),
  caseResults:first,achievedSequencesPerMinute:repeat*60000/Math.max(1,performance.now()-runStart),io:files?files.metrics():disk.metrics,archiveIO,resources:statistics()}));
}
await main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
