import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {assertBudgetSourceSupplement,assertBudgetSourceSupplementPlan,assertBudgetReadinessReport,
  stagedBudgetDigest as hash,stagedBudgetWriteAllowed,installStagedBudgetStorage,PREPARED_MARKETS} from '../scripts/lib/catalog-staged-budget.mjs';
import {candidateBudgetContract,candidateBudgetWriteKind,persistCandidateBudgetObject,candidateBudgetCore} from '../scripts/lib/catalog-candidate-budget.mjs';
import {installCandidateBudgetStorage} from '../scripts/catalog-candidate-budget-prepare.mjs';
import {installActiveBudgetStorage} from '../scripts/catalog-active-budget-check.mjs';
import {StorageConflictError} from '../apps/web/lib/data';

const generationId='gen_1790000000000_fixture',base='gen_1780000000000_previous';
const release='a'.repeat(40),calculationVersion='b'.repeat(64),encyclopediaDigest='c'.repeat(64);
function fixture(){
  const context:any={version:1,mode:'candidate-prepare',release,calculationVersion,encyclopediaDigest,
    baselineLiveIdentity:{release:'d'.repeat(40),calculationVersion:'e'.repeat(64)},liveIdentity:{release:'d'.repeat(40),calculationVersion:'e'.repeat(64)},
    manifest:{version:2,generationId,markets:Object.fromEntries(PREPARED_MARKETS.map(market=>[market,{count:market==='uae'?2:0,chunks:[]}]))},
    manifestEtag:'"manifest"',lockRevision:{found:false,etag:null},controlsRevision:{found:false,etag:null,digest:hash(null)}};
  const baseline:any={version:3,generationId,sourceRows:1,rows:[['uae',100,null,null,false,{id:'original',block:7}]],otherRows:[],pricingChunks:{uae:['budget-prices-v3/uae/0.json']}};
  const card={generationId,market:'uae',block:0,items:[{id:'missing',market:'uae',totalRub:200}]};
  const replay={generationId,market:'uae',entries:[['missing',{sourcePrice:10,sourceCurrency:'AED'}]]};
  const contextSha256=hash([encyclopediaDigest,calculationVersion]),prefix=`budget-source-supplements-v1/${contextSha256}/`;
  const object=(kind:string,value:any)=>({path:prefix+(kind==='card'?'cards':'replay')+'/uae/'+hash(value)+'.json',kind,sha256:hash(value),
    bytes:Buffer.byteLength(JSON.stringify(value)),rows:1,idsSha256:hash(['missing'])});
  const objects=[object('card',card),object('replay',replay)];
  const index={...baseline,sourceRows:2,rows:[...baseline.rows,['uae',200,null,null,false,{id:'missing',block:0,cardPath:objects[0].path}]],
    pricingChunks:{uae:[...baseline.pricingChunks.uae,objects[1].path]}};
  const source=index.rows,coverage={projectionRows:2,selectorRows:2,eligibleRows:2,projectionIds:hash(['missing','original']),eligibleIds:hash(['missing','original'])};
  const body={version:1,generationId,market:'uae',calculationVersion,encyclopediaDigest,contextSha256,
    baselineSourceIds:hash(['original']),baselineSourceRows:1,sourceIds:hash(['original','missing']),sourceRows:2,
    sourceCardsSha256:hash(source.map(row=>[row[5].id,row[5].block,row[5].cardPath??null])),pricingChunksSha256:hash(index.pricingChunks),
    projectionIdsSha256:coverage.projectionIds,eligibleIdsSha256:coverage.eligibleIds,missingIds:['missing'],objects};
  const descriptor={...body,checksum:hash(body)},plan={index,descriptor,objects:[{path:objects[0].path,value:card},{path:objects[1].path,value:replay}]};
  const input={fingerprint:'f'.repeat(64),sourceIds:descriptor.sourceIds,sourceRows:2,coverage,sourceSupplement:descriptor};
  const contract=candidateBudgetContract(context,{uae:input}),keys=objects.map(object=>`catalog/generations/${generationId}/indexes/${object.path}`);
  return {context,baseline,plan,input,contract,keys,card,replay};
}

test('source supplement planning binds exact calculator, encyclopedia, baseline rows, and every candidate object',()=>{
  const f=fixture();assert.deepEqual(assertBudgetSourceSupplementPlan(f.plan,f.context,'uae',f.baseline,f.input.coverage),f.plan.descriptor);
  for(const changed of [{...f.context,calculationVersion:'0'.repeat(64)},{...f.context,encyclopediaDigest:'0'.repeat(64)},
    {...f.context,manifest:{...f.context.manifest,generationId:base}}]){
    assert.throws(()=>assertBudgetSourceSupplement(f.plan.descriptor,changed,'uae',f.input),/supplement_invalid/);
  }
  for(const mutate of [
    (p:any)=>p.index.rows[0][5].block=8,
    (p:any)=>p.objects[0].value.items[0].id='foreign',
    (p:any)=>p.objects.pop(),
    (p:any)=>p.objects.push(p.objects[0]),
    (p:any)=>p.descriptor.baselineSourceRows=0,
    (p:any)=>p.descriptor.objects[0].bytes++,
    (p:any)=>p.descriptor.missingIds.push('foreign'),
  ]){
    const plan=structuredClone(f.plan);mutate(plan);
    const {checksum,...body}=plan.descriptor;plan.descriptor.checksum=hash(body);
    assert.throws(()=>assertBudgetSourceSupplementPlan(plan,f.context,'uae',f.baseline,f.input.coverage),/supplement/);
  }
  const wrong=structuredClone(f.baseline);wrong.rows[0][5].block=8;
  assert.throws(()=>assertBudgetSourceSupplementPlan(f.plan,f.context,'uae',wrong,f.input.coverage),/baseline_changed/);
  const replay=structuredClone(f.plan);replay.index.pricingChunks.uae[0]='budget-prices-v3/uae/foreign.json';
  replay.descriptor.pricingChunksSha256=hash(replay.index.pricingChunks);
  const {checksum,...body}=replay.descriptor;replay.descriptor.checksum=hash(body);
  assert.throws(()=>assertBudgetSourceSupplementPlan(replay,f.context,'uae',f.baseline,f.input.coverage),/baseline_changed/);
  const moved=structuredClone(f.plan);moved.index.otherRows=[moved.index.rows.shift()];
  const movedRows=[...moved.index.rows,...moved.index.otherRows];
  moved.descriptor.sourceIds=hash(movedRows.map(row=>row[5].id));
  moved.descriptor.sourceCardsSha256=hash(movedRows.map(row=>[row[5].id,row[5].block,row[5].cardPath??null]));
  const {checksum:oldChecksum,...movedBody}=moved.descriptor;moved.descriptor.checksum=hash(movedBody);
  assert.throws(()=>assertBudgetSourceSupplementPlan(moved,f.context,'uae',f.baseline,f.input.coverage),/baseline_changed/);
});

test('candidate discovery cannot write; only predeclared bounded immutable supplements can be persisted',async()=>{
  const f=fixture(),writes:any[]=[];let stored:any={found:false,value:null};
  const storage:any={readJsonWithMeta:async(key:string,fallback:any)=>key==='catalog/manifest.json'?{found:true,etag:f.context.manifestEtag,value:f.context.manifest}:
    key==='catalog/import-lock.json'||key==='catalog/operations/collection-controls-v1.json'?{found:false,value:null}:stored,
    writeJson:async(...args:any[])=>{writes.push(args);}};
  const guard=installCandidateBudgetStorage(storage,f.context,'prepare',StorageConflictError);
  await assert.rejects(storage.writeJson(f.keys[0],f.card,{ifNoneMatch:'*'}),/write_forbidden/);assert.equal(writes.length,0);
  guard.setContract(f.contract);
  await storage.writeJson(f.keys[0],f.card,{ifNoneMatch:'*'});await storage.writeJson(f.keys[1],f.replay,{ifNoneMatch:'*'});
  assert.equal(writes.length,2);assert.equal(candidateBudgetWriteKind(f.contract,f.keys[0],f.card),'source-supplement');
  for(const key of [f.keys[0].replace('/uae/','/korea/'),f.keys[0].replace('/uae/','/japan/'),f.keys[0].replace(generationId,base),
    f.keys[0].replace(f.plan.descriptor.contextSha256,'0'.repeat(64)),f.keys[0]+'\n',f.keys[0].replace('/cards/','/replay/')]){
    assert.throws(()=>candidateBudgetWriteKind(f.contract,key,f.card),/write_forbidden/);
  }
  for(const value of [{...f.card,block:1},{...f.card,items:[]},{...f.card,items:[{id:'foreign',market:'uae'}]},
    {...f.card,padding:'x'.repeat(4*1024*1024)}])assert.throws(()=>candidateBudgetWriteKind(f.contract,f.keys[0],value),/write_forbidden/);
  stored={found:true,etag:'"corrupt"',value:{damaged:true}};
  await assert.rejects(storage.writeJson(f.keys[0],f.card,{ifNoneMatch:'*'}),/immutable_source_conflict/);assert.equal(writes.length,2);
  const verifyStorage:any={...storage,readJsonWithMeta:async(key:string,fallback:any)=>key==='catalog/manifest.json'?{found:true,etag:f.context.manifestEtag,value:f.context.manifest}:{found:false,value:fallback},writeJson:async()=>{writes.push('unexpected');}};
  const verifier=installCandidateBudgetStorage(verifyStorage,f.context,'verify',StorageConflictError);verifier.setContract(f.contract);
  await assert.rejects(verifyStorage.writeJson(f.keys[0],f.card),/write_forbidden/);assert.equal(writes.length,2);
});

test('staged and active writers accept only exact context content hashes and preserve verify-only zero writes',async()=>{
  const f=fixture(),staged={...f.context,expectedBaseGenerationId:base,baseEtag:'"base"',operationId:'fixture'};
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'supplement-active-'));
  try{
    for(const kind of ['staged','active'])for(const mode of ['prepare','verify']){
      const writes:any[]=[],context=kind==='staged'?staged:{...f.context,mode:'live',liveIdentity:{release,calculationVersion}};
      const storage:any={readJsonWithMeta:async(key:string,fallback:any)=>key==='catalog/manifest.json'?
        {found:true,etag:kind==='staged'?'"base"':context.manifestEtag,value:kind==='staged'?{generationId:base}:context.manifest}:{found:false,value:fallback},
        writeJson:async(...args:any[])=>{writes.push(args);}};
      if(kind==='staged')installStagedBudgetStorage(storage,context,mode);else installActiveBudgetStorage(storage,context,mode,temp,StorageConflictError);
      assert.equal(stagedBudgetWriteAllowed(f.keys[0],context),true);
      if(mode==='prepare'){
        await storage.writeJson(f.keys[0],f.card,{ifNoneMatch:'*'});assert.equal(writes.length,1);
        await assert.rejects(storage.writeJson(f.keys[0],{...f.card,block:1},{ifNoneMatch:'*'}),/supplement_object_invalid/);
        await assert.rejects(storage.writeJson(f.keys[0],f.card),/write_forbidden/);
      }else await assert.rejects(storage.writeJson(f.keys[0],f.card,{ifNoneMatch:'*'}),/write_forbidden/);
      for(const wrong of [f.keys[0].replace(f.plan.descriptor.contextSha256,'0'.repeat(64)),f.keys[0].replace('/uae/','/japan/'),f.keys[0].replace(generationId,base)]){
        assert.equal(stagedBudgetWriteAllowed(wrong,context),false);await assert.rejects(storage.writeJson(wrong,f.card,{ifNoneMatch:'*'}),/write_forbidden/);
      }
      assert.equal(writes.length,mode==='prepare'?1:0);
    }
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});

test('receipt requires the same complete source descriptors and fails if any is dropped or replaced',()=>{
  const f=fixture(),record={...f.input,selectorChecksum:'1'.repeat(64),budget:{rows:1,checksum:hash([])},sort:{rows:1,checksum:hash([])}};
  const report={version:1,verified:true,release,calculationVersion,generationId,manifestDigest:hash(f.context.manifest),encyclopediaDigest,
    utcDay:'2026-11-16',policyDay:'2026-11-16',markets:{uae:record},preparedSelections:{verified:true,generationId,results:[]}};
  assertBudgetReadinessReport(report,f.context);assert.ok(candidateBudgetCore(report,f.context,f.contract));
  const dropped=structuredClone(report);delete (dropped.markets.uae as any).sourceSupplement;
  assert.throws(()=>candidateBudgetCore(dropped,f.context,f.contract),/readback_contract_changed/);
  for(const field of ['sourceCardsSha256','pricingChunksSha256','calculationVersion']){
    const changed=structuredClone(report);(changed.markets.uae.sourceSupplement as any)[field]='0'.repeat(64);
    assert.throws(()=>candidateBudgetCore(changed,f.context,f.contract),/supplement_invalid/);
  }
});
