import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createResourceNodeInvocation} from './lib/node-resource-memory.mjs';
import {rawDigest} from './lib/catalog-raw-provenance.mjs';
import {openOwnedChinaVerifiedInput} from './lib/open-owned-china-verified-input.mjs';
import {ownedChinaFrozenFx} from './lib/owned-china-frozen-pricing.mjs';
import {verifyReadonlyInvocation} from './lib/readonly-marker-invocation.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const invocation=verifyReadonlyInvocation({root,markerPath:'.github/market-runs/stage-owned-china.json',operation:'prepare-owned-china-private-generation'});
const native=path.resolve(process.argv[2]),release=path.resolve(process.argv[3]),writer=path.resolve(process.argv[4]);
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:writer,encoding:'utf8'}).trim(),'e5fe885258ed06832109d199c164bc4a9fe7dcbc');
const {calculationVersion}=await import(pathToFileURL(path.join(writer,'scripts/catalog-calculation-version.mjs')).href);
const workerCalc=calculationVersion(writer);
assert.equal(workerCalc,'214076c7c2102da508fc340303ac5e1d32f79da72ff93e7bdb9e29e2b77b79aa');
const writerImport=name=>import(pathToFileURL(path.join(writer,name)).href);
const contextPlan=JSON.parse(await fs.readFile(new URL('../.github/operations/china-rev5-source-stage-v3/runtime-context-plan.json',import.meta.url)));
const servingReleases=new Set(['22867cbcfaee27b2e8917b6bf880e44827f67b60','0509e76cb02523157c98804c52edd7eb784916ba']);
const gitTree=rev=>execFileSync('git',['rev-parse',rev+':data/catalog/vehicle-knowledge'],{cwd:release,encoding:'utf8'}).trim();
async function checkRuntime(){
  const response=await fetch('https://avtocena.com/api/health',{redirect:'error',signal:AbortSignal.timeout(30000)});
  assert(response.ok,'live runtime unavailable');
  const live=await response.json();
  assert(live.ok && servingReleases.has(live.releaseSha) && live.calculationVersion===contextPlan.calculationVersion,'serving calculation changed');
  assert.equal(gitTree(live.releaseSha),gitTree(contextPlan.releaseSha),'serving model data changed');
  return live.releaseSha;
}
await checkRuntime();
const state=await openOwnedChinaVerifiedInput(native);
const {prepared,coverage,witness,temp,readerOwner}=state;
const {plan}=prepared;
assert.equal(coverage.previouslyPublishedAbsentWithoutRemovalEvent,0,'previous listings missing without a removal decision');
assert(plan.source.cursor.sequence>state.base.cursor.sequence,'source already served');
const {ObjectJsonStorage}=await writerImport('apps/web/lib/data.ts');
const store=new ObjectJsonStorage();
const privacy=await store.readChinaPrivateStageBucketPrivacy();
const {materializeChinaRuntimeContext}=await writerImport('scripts/catalog-china-materialize-runtime.mjs');
const capture=out=>materializeChinaRuntimeContext({plan:contextPlan,expectedPlanSha256:rawDigest(contextPlan),releaseRoot:release,out,
  credentials:{access:process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID,secret:process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY}});
const context=await capture(path.join(temp,'avtocena-china-context-owned'));
const fxWire=ownedChinaFrozenFx(prepared,randomUUID());
const generationId='gen_'+plan.source.observedAt+'_china'+readerOwner.runId;
const input={plan,witness,sourceReport:{binding:prepared.report.sources[0].snapshotBinding,completedAt:prepared.report.completedAt,
  withdrawals:prepared.report.confirmedWithdrawals},fxWire,generationId,calculationVersion:workerCalc};
await fs.writeFile(path.join(temp,'stage-input.json'),JSON.stringify(input),{flag:'wx',mode:0o600});
// Both independent comparisons have completed. Only this run's downloaded
// scratch files are removed; the verified remote archive is untouched.
assert.equal(prepared.directory,path.join(temp,'archive'));
await fs.rm(prepared.directory,{recursive:true});
const loader=pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href;
const childScript=path.join(root,'scripts/build-owned-china-private-stage.mjs');
const child=await createResourceNodeInvocation({role:'owned-china-price-stage',
  args:['--import',loader,childScript,writer,temp,rawDigest(input)],
  env:{PATH:process.env.PATH,HOME:temp,TMPDIR:temp,NODE_ENV:'production'}});
const worker=spawn(process.execPath,child.args,{stdio:'inherit',cwd:root,env:child.env});
await new Promise((resolve,reject)=>{
  worker.once('error',reject);worker.once('exit',(code,signal)=>code===0?resolve():reject(Error('offline stage stopped: '+(signal||code))));
});
const result=JSON.parse(await fs.readFile(path.join(temp,'private-result.json')));
assert(result.selected>0 && result.selected<=witness.normalized.rows && result.ready.rows===result.selected &&
  result.ready.generationId===generationId && result.fxReceiptSha256===fxWire.receiptSha256,'offline stage census');
await prepared.assertCurrent();await state.files.assertPointer();await checkRuntime();
const verifiedContext=await capture(path.join(temp,'avtocena-china-context-pretransfer'));
assert.equal(verifiedContext.receiptSha256,context.receiptSha256,'runtime inputs changed during preparation');
const {openStageChinaFiles}=await writerImport('apps/web/lib/catalog/china-stage-runtime-files.ts');
const files=await openStageChinaFiles({allowedParent:temp,root:path.join(temp,'avtocena-china-shadow-owned'),
  readySha256:result.ready.runtimeReadySha256,archiveSha256:plan.evidence.archive.manifestSha256,expectedGenerationId:generationId,
  expectedFxSha256:fxWire.receiptSha256,expectedAdmittedRows:result.selected,sourceValidUntil:plan.source.validUntil});
const permit={version:1,kind:'china-own-regcloud-private-stage-v1',market:'china',runId:'owned-china-'+readerOwner.runId+'-'+readerOwner.attempt,
  storage:contextPlan.storage,generationId,archiveSha256:plan.evidence.archive.manifestSha256,runtimeReadySha256:files.readySha256,
  expectedChinaPublicBaseSha256:plan.control.activeSha256,minAdmittedRows:result.selected,maxArtifactBytes:96*1024**3,
  validUntil:files.ready.validUntil,expectedOwnerApprovalSha256:rawDigest(invocation),publicationAuthorized:false,cursorAdvanceAuthorized:false};
const expected=rawDigest(permit);
const {transferChinaPrivateStage}=await writerImport('apps/web/lib/catalog/china-durable-object-stage.ts');
let lastCheck=0,checking;
async function guard(p,hash){
  assert.equal(hash,expected);assert.equal(rawDigest(p),expected);assert(Date.now()<permit.validUntil);
  if(Date.now()-lastCheck<60000)return;
  checking??=Promise.all([prepared.assertCurrent(),state.files.assertPointer(),checkRuntime()]).then(()=>{lastCheck=Date.now();}).finally(()=>{checking=undefined;});
  await checking;
}
const ready=await transferChinaPrivateStage({storage:store,files,permit,expectedPermitSha256:expected,expectedBucketPrivacy:privacy,assertApprovedRunner:guard});
await prepared.assertCurrent();await state.files.assertPointer();const servingRelease=await checkRuntime();
const target={runId:permit.runId,generationId,readySha256:ready.readySha256};
const {openChinaStageObjectFiles}=await writerImport('apps/web/lib/catalog/china-regcloud-object-reader.ts');
const {openIndependentChinaRegcloud}=await writerImport('apps/web/lib/catalog/independent-market-activation-fixture.ts');
const {openIndependentChinaPrepared}=await writerImport('apps/web/lib/catalog/independent-china-prepared-fixture.ts');
const {selectPreparedChinaFilterPage}=await writerImport('apps/web/lib/catalog/prepared-china-filter-index.ts');
const {compilePreparedChinaCompatibilityPredicate}=await writerImport('apps/web/lib/catalog/storage.ts');
const remote=await openChinaStageObjectFiles(store,target,()=>guard(permit,expected));
const publication=openIndependentChinaRegcloud(remote),paper=await publication.openChinaPrepared();
const {snapshot,orderedAdmittedIdsSha256}=await openIndependentChinaPrepared(publication);
assert.equal(orderedAdmittedIdsSha256,result.orderedAdmittedIdsSha256);assert.equal(snapshot.rows,result.selected);
const query={market:'china',powerTo:160},matches=await compilePreparedChinaCompatibilityPredicate(query);
const page=(start,countOnly)=>selectPreparedChinaFilterPage(snapshot,snapshot.filterIndex,query,{start,pageSize:24,countOnly},paper.read);
const total=(await page(0,true)).total,seen=new Set();
assert(total>0 && total<=result.selected,'private 160hp index census');
for(const start of [0,24]){
  const selected=await page(start,false);
  assert.equal(selected.total,total);
  assert.equal(selected.positions.length,Math.min(24,Math.max(0,total-start)));
  for(const [id,chunk,part,offset] of selected.positions){
    const block=await (await snapshot.readChunk(chunk)).load(part);
    const row=block.projection.items[offset];
    assert.equal(row.id,id);assert(!seen.has(id) && matches(row),'filter returned a duplicate or nonmatching car');
    seen.add(id);
  }
}
for(const id of state.removedSample)assert.equal(await snapshot.locate(id),null,'explicitly removed car still locatable');
await remote.assertPointer();await prepared.assertCurrent();
const receipt={version:1,market:'china',owner:readerOwner,servingRelease,contextReceiptSha256:context.receiptSha256,
  evidence:{control:plan.control,source:plan.source,archive:plan.evidence.archive,rates:plan.evidence.rateSnapshot,coverage},
  price:{receiptSha256:fxWire.receiptSha256,pricingFingerprint:result.pricingFingerprint,workerCalculationVersion:workerCalc,servingCalculationVersion:contextPlan.calculationVersion,
    selected:result.selected,orderedAdmittedIdsSha256:result.orderedAdmittedIdsSha256,counts:result.counts},
  target,filter:{powerTo:160,total,pageRowsVerified:seen.size},removedVerified:state.removedSample,validUntil:permit.validUntil,published:false};
await fs.writeFile(path.join(process.env.RUNNER_TEMP,'owned-china-stage.json'),JSON.stringify(receipt),{flag:'wx',mode:0o600});
console.log(JSON.stringify({stage:'private_generation_verified',...receipt.target,selected:result.selected,under160:total,removedVerified:state.removedSample.length,sourceCursor:plan.source.cursor.sequence,published:false}));
