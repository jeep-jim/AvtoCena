import assert from 'node:assert/strict';
import test from 'node:test';
import {RAW_PREFIXES,rawDigest,rawGenerationKey,buildRawGenerationProvenance} from '../scripts/lib/catalog-raw-provenance.mjs';
import {RAW_COORDINATION_KEY,RAW_COORDINATED_WRITERS,RAW_COORDINATED_POINTERS,rawCatalogDescriptor,
  rawPointerDescriptor,createRawCoordination,transitionRawCoordination} from '../scripts/lib/catalog-raw-coordination.mjs';
import {RAW_GC_TARGET,RAW_GC_POLICY_KEY,readRawGcAuthority,inventoryRawGcRoots,prepareRawGcPlan,
  executeRawGcPlan,runRawGc} from '../scripts/lib/catalog-raw-gc.mjs';
import {RAW_INTERNAL_MANIFEST_KEY,RAW_INTERNAL_COORDINATION_ID,rawInternalProvenanceKey,
  rawInternalPointerDescriptor,buildRawInternalProvenance} from '../apps/web/lib/catalog/raw-internal-provenance.mjs';

const now=Date.parse('2026-11-16T12:00:00Z'),clock=()=>now,sha=n=>n.toString(16).padStart(64,'0');
const root=n=>'catalog/provider-replicas/che168/00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
const owner={runId:'43870000000',attempt:'1',sourceSha:'a'.repeat(40)};
const environment={GITHUB_REPOSITORY:'jeep-jim/AvtoCena',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ID:owner.runId,
  GITHUB_RUN_ATTEMPT:owner.attempt,GITHUB_SHA:owner.sourceSha};
const identity=n=>({operationId:'fixture_'+n,owner,token:sha(n)});
const step=(state,command)=>transitionRawCoordination(state,{...command,expectedRevision:state.revision});
const clone=value=>structuredClone(value);
const rowsOnly=rows=>rows.map(({key,size,lastModified})=>({key,size,lastModified}));

class MemoryIo {
  target=clone(RAW_GC_TARGET);values=new Map();calls=[];revision=0;beforeWrite=null;beforeHead=null;afterDelete=null;
  listOverride=null;readOverride=null;deleteMode='all';failKeys=new Set();
  set(key,value,lastModified='2026-01-01T00:00:00.000Z') {
    this.values.set(key,{value:clone(value),etag:'etag-'+(++this.revision),lastModified,size:Buffer.byteLength(JSON.stringify(value))});
  }
  state(){return clone(this.values.get(RAW_COORDINATION_KEY).value);}
  saveState(value){this.set(RAW_COORDINATION_KEY,value);}
  rows(prefix){return [...this.values].filter(([key])=>key.startsWith(prefix)).map(([key,{etag,size,lastModified}])=>({key,size,lastModified,etag})).sort((a,b)=>a.key.localeCompare(b.key));}
  check(input){assert.deepEqual(input.target,RAW_GC_TARGET);assert.equal(typeof input.deadline,'number');}
  async readJson(input){
    this.check(input);this.calls.push({type:'read',key:input.key});
    if(this.readOverride){const result=await this.readOverride(input);if(result)return result;}
    const row=this.values.get(input.key);return row?{found:true,value:clone(row.value),etag:row.etag}:{found:false,value:null};
  }
  async listPage(input){
    this.check(input);this.calls.push({type:'list',prefix:input.prefix,maxKeys:input.maxKeys,cursor:input.cursor});
    if(this.listOverride)return this.listOverride(input);
    assert.ok(input.maxKeys>0 && input.maxKeys<=1000);
    const all=this.rows(input.prefix),offset=Number(input.cursor||0),objects=all.slice(offset,offset+input.maxKeys);
    const truncated=offset+objects.length<all.length;
    return {prefix:input.prefix,objects,truncated,...(truncated?{nextCursor:String(offset+objects.length)}:{})};
  }
  async headObject(input){
    this.check(input);this.calls.push({type:'head',key:input.key});
    if(this.beforeHead)await this.beforeHead(input);
    const row=this.values.get(input.key);return row?{found:true,etag:row.etag,size:row.size,lastModified:row.lastModified}:{found:false};
  }
  async writeJson(input){
    this.check(input);if(this.beforeWrite)await this.beforeWrite(input);
    const old=this.values.get(input.key);
    if(input.condition?.ifNoneMatch==='*' && old || input.condition?.ifMatch && old?.etag!==input.condition.ifMatch){
      const error=Error('fixture conflict');error.name='StorageConflictError';throw error;
    }
    assert.ok(input.key===RAW_COORDINATION_KEY || /^catalog\/raw-feed-gc-plans\/v1\/(?:evidence\/)?[a-f0-9]{64}\.json$/.test(input.key));
    this.calls.push({type:'write',key:input.key,condition:clone(input.condition)});this.set(input.key,input.value);
  }
  async deleteBatch(input){
    this.check(input);assert.equal(input.requestSha256,rawDigest(input.objects));
    const state=this.state();assert.equal(state.gc.inflight.phase,'active');
    assert.ok(state.gc.groups.every(group=>state.roots.find(row=>row.root===group.root)?.state==='deleting'));
    assert.ok(input.objects.length>0 && input.objects.length<=1000);
    this.calls.push({type:'delete',keys:input.objects.map(row=>row.key)});
    if(this.deleteMode==='throw')throw Error('fixture transport timeout');
    const results=input.objects.map(row=>{
      if(this.failKeys.has(row.key))return {key:row.key,status:'error'};
      this.values.delete(row.key);return {key:row.key,status:'deleted'};
    });
    if(this.afterDelete)await this.afterDelete(input);
    if(this.deleteMode==='unsettled')return {settled:false,results};
    return {settled:true,requestSha256:input.requestSha256,results};
  }
}
const coverage=state=>({version:1,complete:true,registryId:state.registryId,atRevision:state.revision,
  currentSha256:rawDigest(state.catalog.current),previousSha256:rawDigest(state.catalog.previous),pointersSha256:rawDigest(state.pointers),
  writerInventorySha256:sha(20),pinInventorySha256:sha(21),objectInventorySha256:sha(22),legacyJobsComplete:true,legacyJobs:[],
  writers:RAW_COORDINATED_WRITERS.map(id=>({id,sourceSha:owner.sourceSha,mode:'coordinated',protocolVersion:1}))});

function fixture(parts=2){
  const io=new MemoryIo(),manifests=[0,1].map(n=>({version:2,generationId:'gen_'+(1000+n)+'_fixture'+n,markets:{}}));
  const provenance=manifests.map(manifest=>buildRawGenerationProvenance({manifest,paidReports:{generationId:manifest.generationId,
    manifestSha256:rawDigest(manifest),market:'korea',count:0,paidCount:0,chunkProofs:[],observations:[],references:[]}}));
  io.set('catalog/manifest.json',manifests[1]);io.set('catalog/previous-manifest.json',manifests[0]);
  manifests.forEach((manifest,index)=>io.set(rawGenerationKey(manifest.generationId),provenance[index]));
  let state=createRawCoordination({registryId:sha(999),current:rawCatalogDescriptor(manifests[1],provenance[1]),
    previous:rawCatalogDescriptor(manifests[0],provenance[0]),pointers:RAW_COORDINATED_POINTERS.map(id=>({id,
      current:id===RAW_INTERNAL_COORDINATION_ID?rawInternalPointerDescriptor(null):rawPointerDescriptor(null,[],{complete:true})}))});
  const receipts={};
  for(let n=1;n<=3;n++){
    const count=n===1?parts:2,date=new Date(Date.UTC(2026,0,n)).toISOString();
    const receipt={version:1,binding:sha(500+n),cursor:10,bytes:count,parts:Array.from({length:count},(_,index)=>({bytes:1,sha256:sha(index+1)}))};
    receipts[root(n)]=receipt;io.set(root(n)+'/manifest.json',receipt,date);
    for(let index=0;index<count;index++)io.set(root(n)+'/'+index+'.gz','fixture-'+index,date);
    state=step(state,{type:'register',...identity(n),references:[{kind:'che168-replica',root:root(n)}]}).state;
  }
  state=step(state,{type:'verify_coverage',report:coverage(state)}).state;
  for(let n=1;n<=3;n++){
    const row=state.roots.find(row=>row.root===root(n));
    state=step(state,{type:'prove_root',root:row.root,incarnation:row.incarnation,rootRevision:row.revision,
      inventorySha256:rawDigest(rowsOnly(io.rows(root(n)+'/'))),receiptSha256:rawDigest(receipts[root(n)]),
      writerProofSha256:sha(700+n),coverageProofSha256:state.coverage.proofSha256}).state;
  }
  io.saveState(state);io.set(RAW_GC_POLICY_KEY,{version:1,mode:'required',protocolVersion:1,registryId:state.registryId});
  const retentionInputs={inventory:{complete:true,prefixes:Object.values(RAW_PREFIXES),objects:[1,2,3].flatMap(n=>rowsOnly(io.rows(root(n)+'/'))),receipts},
    pinInventory:{complete:true,pins:[]},cursorInventory:{complete:true,references:[]},producerProtocolComplete:true,
    currentManifest:manifests[1],previousManifest:manifests[0],currentProvenance:provenance[1],previousProvenance:provenance[0]};
  return {io,retentionInputs,now:clock};
}
async function ready(parts=2){
  const value=fixture(parts),planned=await prepareRawGcPlan(value);assert.equal(planned.status,'ready',planned.reason);
  const evidence=planned.evidence;
  const arm={version:1,action:'delete_verified_unreferenced_raw',operationId:'reviewed_fixture_gc',owner,
    registryId:evidence.authority.registryId,coverageProofSha256:evidence.authority.coverageProofSha256,
    evidenceSha256:evidence.sha256,planSha256:evidence.planSha256,target:RAW_GC_TARGET};
  return {...value,evidence,arm,environment};
}
const writes=io=>io.calls.filter(row=>row.type==='write');
const deletes=io=>io.calls.filter(row=>row.type==='delete');

test('a legacy six-pointer registry cannot authorize raw GC without internal catalogue authority',async()=>{
  const value=fixture(),state=value.io.state();state.pointers=state.pointers.filter(row=>row.id!=='internal_catalog');value.io.saveState(state);
  const result=await runRawGc(value);assert.equal(result.status,'protected_unknown');assert.equal(result.reason,'internal_catalog_unproven');
  assert.equal(writes(value.io).length,0);assert.equal(deletes(value.io).length,0);
});
test('actual internal maintenance rows block GC even when public generations and six other pointers are complete',async()=>{
  for(const mode of ['ledger_absent','legacy','known_but_incomplete','forged_complete']){
    const value=fixture(),manifest={generationId:'gen_2000_internal',sources:{encar_direct:{count:1,
      chunks:['catalog/internal/offers/encar_direct/gen_1000_old-chunk-0001.json']}}};
    value.io.set(RAW_INTERNAL_MANIFEST_KEY,manifest);
    const proof=buildRawInternalProvenance({manifest,references:[{kind:'che168-replica',root:root(1)}]});
    if(mode!=='legacy')value.io.set(rawInternalProvenanceKey(manifest.generationId),mode==='forged_complete'?{...proof,complete:true}:proof);
    if(mode!=='ledger_absent'){
      const state=value.io.state(),pointer=state.pointers.find(row=>row.id===RAW_INTERNAL_COORDINATION_ID);
      pointer.current=rawInternalPointerDescriptor(manifest,mode==='legacy'?null:proof);
      if(mode==='forged_complete')pointer.current={...pointer.current,complete:true,provenanceSha256:rawDigest({...proof,complete:true})};
      value.io.saveState(state);
    }
    const result=await runRawGc(value);assert.equal(result.status,'protected_unknown',mode);assert.equal(result.reason,'internal_catalog_unproven',mode);
    assert.equal(writes(value.io).length,0);assert.equal(deletes(value.io).length,0);
  }
});
test('proved empty internal generation is read from its immutable proof and compared with the CAS descriptor',async()=>{
  const value=fixture(),manifest={generationId:'gen_2001_empty',sources:{}},proof=buildRawInternalProvenance({manifest});
  const state=value.io.state(),pointer=state.pointers.find(row=>row.id===RAW_INTERNAL_COORDINATION_ID);
  const pending=step(state,{type:'reserve_pointer',...identity(999),id:pointer.id,pointerRevision:pointer.revision,
    base:pointer.current,candidate:rawInternalPointerDescriptor(manifest,proof)});
  value.io.saveState(pending.state);value.io.set(RAW_INTERNAL_MANIFEST_KEY,manifest);value.io.set(rawInternalProvenanceKey(manifest.generationId),proof);
  value.io.saveState(step(pending.state,{type:'commit_pointer',id:pointer.id,ticket:pending.result,observedValue:manifest}).state);
  const planned=await runRawGc(value);assert.equal(planned.status,'ready');
  assert.ok(value.io.calls.some(row=>row.type==='read' && row.key===rawInternalProvenanceKey(manifest.generationId)));
  value.io.set(rawInternalProvenanceKey(manifest.generationId),{...proof,manifestSha256:sha(987)});
  const rejected=await runRawGc(value);assert.equal(rejected.reason,'internal_catalog_unproven');assert.equal(writes(value.io).length,0);
});
test('default runner is read-only and retains the two newest complete groups',async()=>{
  const value=fixture(),result=await runRawGc(value);
  assert.equal(result.mode,'plan');assert.equal(result.status,'ready');
  assert.deepEqual(result.evidence.plan.groups.map(row=>row.root),[root(1)]);
  assert.equal(result.selectedObjects,3);assert.equal(result.storageWrites,0);assert.equal(result.deleteRequests,0);
  assert.equal(writes(value.io).length,0);assert.equal(deletes(value.io).length,0);
});
test('bounded root inventory cannot substitute for a complete retention inventory',async()=>{
  const value=fixture();delete value.retentionInputs;
  const result=await prepareRawGcPlan(value);assert.equal(result.reason,'complete_retention_inventory_required');
  assert.equal(value.io.calls.filter(row=>row.type==='list').length,0);assert.equal(writes(value.io).length,0);
});
test('missing policy, registry, coverage, provenance and pointers preserve all raw data',async()=>{
  for(const mode of ['policy','registry','coverage','provenance','pointer','pending']){
    const value=fixture();
    if(mode==='policy')value.io.values.delete(RAW_GC_POLICY_KEY);
    if(mode==='registry')value.io.values.delete(RAW_COORDINATION_KEY);
    if(mode==='coverage')value.io.saveState(step(value.io.state(),{type:'invalidate_coverage',reason:'fixture_changed'}).state);
    if(mode==='provenance')value.io.values.delete(rawGenerationKey(value.retentionInputs.currentManifest.generationId));
    if(mode==='pointer')value.io.set('catalog/intake-cursors/v1/korea.json',{unknown:true});
    if(mode==='pending'){
      const state=value.io.state(),pointer=state.pointers[0];
      value.io.saveState(step(state,{type:'reserve_pointer',...identity(99),id:pointer.id,pointerRevision:pointer.revision,
        base:pointer.current,candidate:rawPointerDescriptor({fixture:1},[],{complete:true})}).state);
    }
    const result=await runRawGc(value);assert.equal(result.status,'protected_unknown',mode);
    assert.equal(deletes(value.io).length,0);assert.equal(writes(value.io).length,0);
  }
});
test('a changed actual previous generation and a policy ETag ABA both reject a captured plan',async()=>{
  for(const mode of ['previous','policy']){
    const value=await ready();
    if(mode==='previous')value.io.set('catalog/previous-manifest.json',value.retentionInputs.currentManifest);
    else value.io.set(RAW_GC_POLICY_KEY,clone(value.io.values.get(RAW_GC_POLICY_KEY).value));
    const result=await executeRawGcPlan(value);assert.equal(result.status,'protected_unknown');
    assert.equal(writes(value.io).length,0);assert.equal(deletes(value.io).length,0);
  }
});
test('authority snapshot is rejected when its registry changes while actual pointers are read',async()=>{
  const value=fixture();let changed=false;
  value.io.readOverride=async({key})=>{if(!changed && key==='catalog/intake-cursors/v1/uae.json'){
    changed=true;value.io.saveState(value.io.state());
  }};
  const result=await readRawGcAuthority(value);assert.equal(result.reason,'authority_changed_during_read');
});
test('scope rejects Japan, foreign buckets and control receipt prefixes before listing',async()=>{
  for(const badRoot of ['catalog/nonjp-intake/v1/japan/123/1','catalog/raw-feed-coordination/v1','crm/clients',root(1)+'/..']){
    const value=fixture();await assert.rejects(inventoryRawGcRoots({...value,roots:[badRoot]}),/root_scope/);
    assert.equal(value.io.calls.filter(row=>row.type==='list').length,0);
  }
  const value=fixture();value.io.target.bucket='another-bucket';await assert.rejects(runRawGc(value),/storage_target/);
  assert.equal(value.io.calls.length,0);
});
test('page, object and byte bounds never return a partial deletion group',async()=>{
  for(const config of [{pages:1},{objects:1000},{bytes:1}]){
    const value=fixture(1001),result=await inventoryRawGcRoots({...value,roots:[root(1)],config});
    assert.equal(result.status,'protected_unknown');assert.equal(writes(value.io).length,0);
  }
  const value=fixture(),result=await prepareRawGcPlan({...value,config:{objects:2}});
  assert.equal(result.status,'nothing_selected');
});
test('pagination token loops, duplicate keys, foreign keys and unknown leaf types preserve the group',async()=>{
  for(const mode of ['loop','duplicate','foreign','unknown']){
    const value=fixture(),rows=value.io.rows(root(1)+'/');let page=0;
    value.io.listOverride=async input=>{
      page++;
      if(mode==='loop')return {prefix:input.prefix,objects:[],truncated:true,nextCursor:'same'};
      if(mode==='duplicate')return {prefix:input.prefix,objects:[rows[0],rows[0]],truncated:false};
      return {prefix:input.prefix,objects:[{...rows[0],key:mode==='foreign'?root(2)+'/0.gz':root(1)+'/private.txt'}],truncated:false};
    };
    const result=await inventoryRawGcRoots({...value,roots:[root(1)]});assert.equal(result.status,'protected_unknown',mode);
    assert.ok(page<=2);assert.equal(writes(value.io).length,0);
  }
});
test('changed receipt, root proof or incarnation is never silently refreshed by the collector',async()=>{
  for(const mode of ['receipt','proof','incarnation']){
    const value=await ready();
    if(mode==='receipt')value.io.set(root(1)+'/manifest.json',{...value.retentionInputs.inventory.receipts[root(1)],cursor:11});
    else {
      const state=value.io.state(),row=state.roots.find(row=>row.root===root(1));
      if(mode==='proof')row.proof.inventorySha256=sha(912);else row.incarnation--;
      value.io.saveState(state);
    }
    try{const result=await executeRawGcPlan(value);assert.equal(result.status,'protected_unknown');}
    catch(error){assert.match(error.message,/raw_gc_root_proof/);}
    assert.equal(writes(value.io).length,0);assert.equal(deletes(value.io).length,0);
  }
});
test('execution requires exact explicit arming, repository, branch and workflow owner',async()=>{
  for(const mode of ['absent','digest','run','branch','repository','attempt','sha']){
    const value=await ready();
    if(mode==='absent')delete value.arm;
    if(mode==='digest')value.arm.evidenceSha256=sha(99);
    if(mode==='run')value.environment={...environment,GITHUB_RUN_ID:'43870000001'};
    if(mode==='branch')value.environment={...environment,GITHUB_REF:'refs/heads/feature'};
    if(mode==='repository')value.environment={...environment,GITHUB_REPOSITORY:'other/repo'};
    if(mode==='attempt')value.environment={...environment,GITHUB_RUN_ATTEMPT:'2'};
    if(mode==='sha')value.environment={...environment,GITHUB_SHA:'b'.repeat(40)};
    await assert.rejects(executeRawGcPlan(value),/raw_gc_(explicit_arming_required|controller_identity)/);
    assert.equal(writes(value.io).length,0);assert.equal(deletes(value.io).length,0);
  }
});
test('immutable plan collision fails before GC ownership or physical deletion',async()=>{
  const value=await ready();value.io.set(value.evidence.planKey,{changed:true});
  await assert.rejects(executeRawGcPlan(value),/immutable_plan_changed/);
  assert.equal(value.io.state().gc,null);assert.equal(deletes(value.io).length,0);
});
test('a producer winning the GC CAS race prevents all physical deletes',async()=>{
  const value=await ready();let injected=false;
  value.io.beforeWrite=async input=>{if(!injected && input.key===RAW_COORDINATION_KEY && input.value.gc?.state==='deleting'){
    injected=true;value.io.saveState(step(value.io.state(),{type:'claim',...identity(999),references:[{kind:'che168-replica',root:root(1)}]}).state);
  }};
  await assert.rejects(executeRawGcPlan(value),/raw_coord_gc_root_changed/);
  assert.equal(deletes(value.io).length,0);assert.equal(value.io.state().claims.length,1);
});
test('GC tombstones precede DELETE and stop new producer/publication references',async()=>{
  const value=await ready();let attempted=false;
  value.io.beforeHead=async()=>{
    if(attempted)return;attempted=true;const state=value.io.state();assert.equal(state.gc.inflight.phase,'active');
    assert.throws(()=>step(state,{type:'claim',...identity(1000),references:[{kind:'che168-replica',root:root(1)}]}),/deleting_or_deleted/);
    const pointer=state.pointers[0];
    assert.throws(()=>step(state,{type:'reserve_pointer',...identity(1001),id:pointer.id,pointerRevision:pointer.revision,base:pointer.current,
      candidate:rawPointerDescriptor({root:root(1)},[{kind:'che168-replica',root:root(1)}],{complete:true})}),/deleting_or_deleted/);
  };
  const result=await executeRawGcPlan(value);assert.equal(result.status,'completed');
  assert.equal(result.acknowledgedObjects,3);assert.equal(result.acknowledgedInventoryBytes,value.evidence.plan.groups[0].objects.reduce((sum,row)=>sum+row.size,0));
  assert.equal(value.io.state().roots.find(row=>row.root===root(1)).state,'deleted');
  assert.ok(value.io.rows(root(2)+'/').length && value.io.rows(root(3)+'/').length);
});
test('HEAD metadata mismatch pauses the exact batch without deleting any key',async()=>{
  const value=await ready();let changed=false;
  value.io.beforeHead=async({key})=>{if(!changed){changed=true;value.io.set(key,'changed');}};
  const result=await executeRawGcPlan(value);assert.equal(result.status,'paused');assert.equal(deletes(value.io).length,0);
  assert.equal(value.io.state().gc.inflight.phase,'paused');assert.equal(value.io.state().roots.find(row=>row.root===root(1)).state,'deleting');
});
test('partial terminal deletion acknowledges only re-read absence and resumes without double counting',async()=>{
  const value=await ready(),failed=root(1)+'/1.gz';value.io.failKeys.add(failed);
  const first=await executeRawGcPlan(value);assert.equal(first.status,'paused');assert.equal(first.acknowledgedObjects,2);
  value.io.failKeys.clear();const second=await executeRawGcPlan({...value,resumeTicket:first.ticket});
  assert.equal(second.status,'completed');assert.equal(second.acknowledgedObjects,3);
  assert.deepEqual(deletes(value.io)[1].keys,[failed]);
  assert.equal(second.acknowledgedInventoryBytes,value.evidence.plan.groups[0].objects.reduce((sum,row)=>sum+row.size,0));
});
test('already absent objects are acknowledged without asking DELETE to touch them',async()=>{
  const value=await ready(),key=root(1)+'/0.gz';let changed=false;
  value.io.beforeHead=async()=>{if(!changed){changed=true;value.io.values.delete(key);}};
  const result=await executeRawGcPlan(value);assert.equal(result.status,'completed');assert.equal(result.acknowledgedObjects,3);
  assert.ok(!deletes(value.io)[0].keys.includes(key));
});
test('unknown transport result retains active ownership and cannot automatically resume or expire',async()=>{
  for(const deleteMode of ['throw','unsettled']){
    const value=await ready();value.io.deleteMode=deleteMode;
    const first=await executeRawGcPlan(value);assert.equal(first.status,'needs_terminal_request_evidence');
    assert.equal(value.io.state().gc.inflight.phase,'active');assert.equal(first.acknowledgedObjects,0);
    const second=await executeRawGcPlan({...value,resumeTicket:first.ticket,now:()=>now+86400000*30});
    assert.equal(second.status,'needs_terminal_request_evidence');assert.equal(deletes(value.io).length,1);
  }
});
test('changed evidence or another attempt cannot take over a paused batch',async()=>{
  const value=await ready();value.io.failKeys.add(root(1)+'/1.gz');const first=await executeRawGcPlan(value);
  const changed=clone(value.evidence);changed.inventory[0].objects[0].etag='new';const {sha256,...body}=changed;changed.sha256=rawDigest(body);
  await assert.rejects(executeRawGcPlan({...value,evidence:changed,arm:{...value.arm,evidenceSha256:changed.sha256},resumeTicket:first.ticket}),/resume_ownership/);
  await assert.rejects(executeRawGcPlan({...value,environment:{...environment,GITHUB_RUN_ATTEMPT:'2'},resumeTicket:first.ticket}),/explicit_arming/);
  assert.equal(deletes(value.io).length,1);
});
test('a context change after HEAD blocks DELETE and safely pauses a request that never started',async()=>{
  const value=await ready();let changed=false;
  value.io.beforeHead=async()=>{if(!changed){changed=true;value.io.set('catalog/intake-cursors/v1/uae.json',{changed:true});}};
  const result=await executeRawGcPlan(value);assert.equal(result.status,'paused');assert.equal(deletes(value.io).length,0);
});
test('settled progress can be recorded after coverage invalidation without allowing another DELETE',async()=>{
  const value=await ready();value.io.afterDelete=async()=>value.io.saveState(step(value.io.state(),{type:'invalidate_coverage',reason:'fixture_changed'}).state);
  const result=await executeRawGcPlan(value);assert.equal(result.status,'protected_unknown');assert.equal(result.acknowledgedObjects,3);
  assert.equal(value.io.state().gc.inflight,null);assert.equal(value.io.state().gc.state,'deleting');assert.equal(deletes(value.io).length,1);
});
test('one bounded batch does not claim completion; the same owner can resume the exact next batch',async()=>{
  const value=await ready(1001),first=await executeRawGcPlan(value);
  assert.equal(first.status,'bounded_progress');assert.equal(first.acknowledgedObjects,1000);assert.equal(deletes(value.io)[0].keys.length,1000);
  const second=await executeRawGcPlan({...value,resumeTicket:first.ticket});
  assert.equal(second.status,'completed');assert.equal(second.acknowledgedObjects,1002);assert.equal(deletes(value.io)[1].keys.length,2);
});
test('an unexpected object after the batch is preserved; empty proof is required for final tombstone',async()=>{
  const value=await ready();value.io.afterDelete=async()=>value.io.set(root(1)+'/99.gz','unexpected');
  const result=await executeRawGcPlan(value);assert.equal(result.status,'needs_reconciliation');assert.equal(result.reason,'root_not_proved_empty');
  assert.equal(value.io.state().gc.state,'deleting');assert.equal(deletes(value.io).length,1);assert.ok(value.io.values.has(root(1)+'/99.gz'));
});
test('known old keys are never expanded to a fresh root-wide delete on resume',async()=>{
  const value=await ready();value.io.failKeys.add(root(1)+'/1.gz');const first=await executeRawGcPlan(value);
  value.io.set(root(1)+'/88.gz','unexpected');value.io.failKeys.clear();
  const second=await executeRawGcPlan({...value,resumeTicket:first.ticket});assert.equal(second.status,'needs_reconciliation');
  assert.deepEqual(deletes(value.io)[1].keys,[root(1)+'/1.gz']);assert.ok(value.io.values.has(root(1)+'/88.gz'));
});
