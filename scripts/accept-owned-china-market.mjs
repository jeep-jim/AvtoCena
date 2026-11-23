import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {captureOwnedChinaControl,OWNED_CHINA_PREPARED,OWNED_CHINA_PUBLIC_CONTROL} from './lib/owned-china-publication-source.mjs';
import {cutOwnedChina} from './lib/owned-china-cut.mjs';
import {rawDigest} from './lib/catalog-raw-provenance.mjs';

const runtime=path.resolve(process.argv[2]),writer=path.resolve(process.argv[3]),stageId=process.env.STAGE_RUN_ID;
const release='0509e76cb02523157c98804c52edd7eb784916ba',servedCalc='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90';
const git=(dir,...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
assert.equal(git(runtime,'rev-parse','HEAD'),release);
assert(/^[1-9]\d{0,19}$/.test(stageId));
assert.equal(process.env.GITHUB_REPOSITORY,'jeep-jim/AvtoCena');assert.equal(process.env.GITHUB_REPOSITORY_ID,'1289722938');
assert.equal(process.env.GITHUB_REF,'refs/heads/main');
const auth={Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json'};
async function gh(route){
 const r=await fetch('https://api.github.com/repos/jeep-jim/AvtoCena/actions/'+route,{headers:auth,redirect:'error',signal:AbortSignal.timeout(30000)});
 assert(r.ok,'upstream Actions receipt unavailable');return r.json();
}
const [run,jobs]=await Promise.all([gh('runs/'+stageId),gh('runs/'+stageId+'/attempts/1/jobs?per_page=100')]);
assert(String(run.id)===stageId && run.repository?.id===1289722938 && run.head_repository?.id===1289722938 &&
 run.head_branch==='main' && run.status==='completed' && run.conclusion==='success' && run.run_attempt===1 &&
 ['push','workflow_run'].includes(run.event) && run.path==='.github/workflows/stage-owned-china-generation.yml','unreviewed upstream stage');
assert(jobs.total_count===1 && jobs.jobs[0].name==='verify' && jobs.jobs[0].status==='completed' &&
 jobs.jobs[0].conclusion==='success' && jobs.jobs[0].head_sha===run.head_sha,'upstream stage not verified');
const receipt=JSON.parse(await readFile(process.argv[4],'utf8'));
if(receipt.status==='no_matching_new_archive'){
 assert(run.event==='workflow_run' && receipt.version===1 && receipt.market==='china' && receipt.published===false &&
  receipt.owner?.runId===stageId && receipt.owner.attempt==='1' && receipt.owner.revision===run.head_sha,'invalid no-op receipt');
 console.log(JSON.stringify({stage:'no_matching_new_archive',stageRun:stageId,published:false}));
 process.exit(0);
}
const {source,control,archive,rates,coverage}=receipt.evidence;
assert(receipt.version===1 && receipt.market==='china' && receipt.published===false && receipt.owner.runId===stageId &&
 receipt.owner.attempt==='1' && receipt.owner.revision===run.head_sha && receipt.target.runId==='owned-china-'+stageId+'-1' &&
 receipt.target.generationId==='gen_'+source.observedAt+'_china'+stageId && receipt.price.servingCalculationVersion===servedCalc &&
 receipt.filter.powerTo===160 && receipt.filter.total>0 && receipt.filter.pageRowsVerified===Math.min(48,receipt.filter.total) &&
 coverage.previouslyPublishedStillInSource+coverage.previouslyPublishedExplicitlyRemoved+coverage.previouslyPublishedAbsentWithoutRemovalEvent===coverage.previouslyPublished &&
 Array.isArray(receipt.removedVerified) &&
 receipt.removedVerified.length===Math.min(8,coverage.previouslyPublishedExplicitlyRemoved),'incomplete upstream receipt');
const load=(dir,name)=>import(pathToFileURL(path.join(dir,'apps/web/lib',name+'.ts')).href);
const [{ObjectJsonStorage},{ObjectJsonStorage:ScopedWriter},reader,fixture,{offerCardPath}]=await Promise.all([
 load(runtime,'data'),load(writer,'data'),load(runtime,'catalog/china-regcloud-object-reader'),
 load(runtime,'catalog/prepared-china-http-fixture'),load(runtime,'catalog/offer-url')]);
const storage=new ObjectJsonStorage(),writeStore=new ScopedWriter();
const site='https://avtocena.com';
async function web(route,{html=false,absent=false}={}){
 assert(route.startsWith('/') && !route.startsWith('//'));
 const r=await fetch(site+route,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(40000)});
 if(absent&&[404,410].includes(r.status)){await r.body?.cancel();return null;}
 assert.equal(r.status,200,'public read '+new URL(site+route).pathname);
 const max=html?8*1024**2:2*1024**2;let size=0;const buffers=[];
 for await(const b of r.body){size+=b.byteLength;assert(size<=max,'public body too large');buffers.push(b);}
 const body=Buffer.concat(buffers).toString('utf8');return html?body:JSON.parse(body);
}
async function runtimeCurrent(){
 const h=await web('/api/health');assert(h.ok && h.service==='avtocena-web' && h.releaseSha===release && h.calculationVersion===servedCalc,'serving released calculator changed');
}
async function sourceCurrent(){
 await runtimeCurrent();
 const row=await storage.readJsonWithMeta(OWNED_CHINA_PREPARED,null),head=row.value;
 assert(row.found && head.market==='china' && head.cursor===source.cursor.sequence && head.observations===coverage.sourceActive &&
   head.archiveRoot===archive.root && head.archiveSha256===archive.manifestSha256 && head.rateRun===head.runId,'new source available');
 assert.equal(rates.key,'catalog/feed-rates/v1/china/'+head.rateRun+'.json');assert.equal(rawDigest(await storage.readJson(rates.key,null)),rates.sha256);
 assert.equal(Date.parse((await storage.readJson('catalog/owned-feed/v1/china/runs/'+head.runId+'/complete.json',null)).completedAt),source.observedAt);
}
let oldLeaseEnd=0,oldReady,oldPath,confirmedRemoved;
async function rollbackCurrent(phase){
 const ref=control.state.active;
 if(phase==='before'){
  const previous=await reader.openConfiguredChinaRegcloudFiles();
  assert(previous && previous.readySha256===ref.readySha256 && previous.ready.generationId===ref.generationId,'previous generation unavailable');
  oldLeaseEnd=previous.acceptedLegalUntil??previous.ready.validUntil;
  oldReady=previous.durable.runtimeReadySha256;oldPath=previous.durable.stageRoot;
  await previous.assertPointer();
 }
 assert(oldLeaseEnd>Date.now()+30000 && oldPath==='catalog/private-market-stage-v1/china/'+ref.runId+'/','previous legal prices expired');
 const [ready,native]=await Promise.all([storage.getBinaryBounded(oldPath+'READY.json',32*1024),storage.getBinaryBounded(oldPath+'runtime-ready.json',8192)]);
 assert(ready.checksum===ref.readySha256 && native.checksum===oldReady,'rollback target changed');
}
const target=receipt.target,gen=target.generationId;
async function preview({alreadyActive=false}={}){
 await runtimeCurrent();const r=await reader.openChinaStageObjectFiles(storage,target,async()=>{assert(Date.now()<receipt.validUntil);});
 assert(r.durable.archiveSha256===archive.manifestSha256 && r.durable.expectedChinaPublicBaseSha256===control.activeSha256 &&
   r.durable.pricingReceiptSha256===receipt.price.receiptSha256 && r.ready.admittedRows===receipt.price.selected &&
   rawDigest(r.durable.sourceCursor)===rawDigest(source.cursor),'durable READY differs from source');
 const result=await fixture.withPreparedChinaRegcloudPreview(r,async()=>{
  const query={market:'china',powerTo:160},opts={marketPage:true,includeFacets:false,unsupported:false,countOnly:false,indexedOnly:true,expectedGeneration:gen};
  const list=await fixture.readPreparedChinaCompatibility(query,opts);
  assert(list?.generationId===gen && list.total===receipt.filter.total && list.items.length===Math.min(list.total,24),'candidate guest search');
  const first=list.items[0],detail=await fixture.readPreparedChinaFixtureOffer(first.id,undefined,gen);
  assert(first.totalRub>0 && detail?.offer?.id===first.id && detail.offer.totalRub===first.totalRub,'candidate detail price');
  for(const id of receipt.removedVerified){const absent=await fixture.readPreparedChinaFixtureOffer(id,undefined,gen);assert(absent&&absent.offer===null,'retired car visible');}
  return {id:first.id,powerTotal:list.total,price:first.totalRub,card:offerCardPath(first)};
 });
 if(receipt.removedVerified.length && !alreadyActive){
  const old=await reader.openConfiguredChinaRegcloudFiles();assert(old&&old.readySha256===control.state.active.readySha256);
  confirmedRemoved=await fixture.withPreparedChinaRegcloudPreview(old,async()=>{
   const id=receipt.removedVerified[0],row=await fixture.readPreparedChinaFixtureOffer(id,undefined,control.state.active.generationId);
   assert(row?.offer?.id===id);const u=new URL(offerCardPath(row.offer),site);
   assert(u.origin===site && u.pathname.startsWith('/cars/offer/'+id+'/'));u.searchParams.set('market','china');u.searchParams.set('preparedCut',gen);
   return u.pathname+u.search;
  });
 }
 await r.assertPointer();return result;
}
async function publicRead(p){
 await runtimeCurrent();const base='/api/catalog/search?market=china&powerTo=160&source=existing';
 const count=await web(base+'&countOnly=1');assert(count.ok && count.generationId===gen && count.total===p.powerTotal && count.items.length===0);
 const seen=new Set();let price;
 for(const page of [1,2]){
  const list=await web(base+'&marketPage=1&page='+page);
  assert(list.ok && list.generationId===gen && list.total===p.powerTotal && list.items.length===Math.min(24,Math.max(0,list.total-(page-1)*24)));
  for(const row of list.items){assert(!seen.has(row.id) && row.market==='china');seen.add(row.id);if(row.id===p.id)price=row.totalRub;}
 }
 assert.equal(price,p.price);const card=await web(p.card,{html:true});
 const main=card.match(/<main\b[^>]*\bdata-offer-id="[^"]+"[^>]*>/)?.[0]??'';
 assert(main.includes('data-offer-id="'+p.id+'"') && main.includes('data-offer-price-rub="'+p.price+'"'),'public list and detail disagree');
 if(confirmedRemoved){const gone=await web(confirmedRemoved,{html:true,absent:true});
  assert(gone===null||(/class="ac-unavailable-main"/.test(gone)&&!/<main\b[^>]*data-offer-id=/.test(gone)),'removed car still offered');}
}
async function accept(p){
 let failure;
 for(const delay of [0,2000,5000]){if(delay)await sleep(delay);try{await publicRead(p);return;}catch(error){failure=error;}}
 throw failure;
}
async function lease(work){
 const key='catalog/import-lock.json',id='china-owned-cut-'+randomUUID();
 const initial=await storage.readJsonWithMeta(key,null),now=Date.now();
 if(initial.value?.lockedUntil)assert(Number.isFinite(Date.parse(initial.value.lockedUntil)) && Date.parse(initial.value.lockedUntil)<=now,'publication lease busy');
 assert(!initial.found||initial.etag);const lock={operationId:id,operationType:'china_owned_publication',startedAt:new Date(now).toISOString(),lockedUntil:new Date(now+15*60000).toISOString()};
 await storage.writeJson(key,lock,initial.found?{ifMatch:initial.etag}:{ifNoneMatch:'*'});
 async function check(){const cur=await storage.readJsonWithMeta(key,null);assert(cur.value?.operationId===id&&Date.parse(cur.value.lockedUntil)>Date.now(),'lost publication lease');return cur;}
 try{await check();return await work(check);}finally{
  const current=await storage.readJsonWithMeta(key,null);
  if(current.value?.operationId===id)await storage.writeJson(key,{...current.value,lockedUntil:'',finishedAt:new Date().toISOString()},{ifMatch:current.etag});
 }
}
const store={read:()=>captureOwnedChinaControl(storage),cas:(etag,state,deadline)=>writeStore.compareAndSwapScopedControl(OWNED_CHINA_PUBLIC_CONTROL,Buffer.from(JSON.stringify(state)),etag,deadline)};
const result=await cutOwnedChina({receipt,store,preview,sourceCurrent,rollbackCurrent,accept,lease});
console.log(JSON.stringify({stage:'public_china_readback',...result,sourceCursor:source.cursor.sequence,admitted:receipt.price.selected}));
