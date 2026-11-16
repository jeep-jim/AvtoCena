import assert from 'node:assert/strict';
import {rawDigest, rawGenerationKey} from './catalog-raw-provenance.mjs';
import {RAW_COORDINATION_KEY, RAW_COORDINATION_LIMITS, RAW_COORDINATED_POINTERS,
  assertRawCoordination, coordinatedRawRootKind, rawCatalogDescriptor, rawGcPlan,
  mutateRawCoordination} from './catalog-raw-coordination.mjs';
import {planRawFeedRetention, rawInventoryGroupForObject, completeRawInventoryGroup} from './catalog-raw-retention-plan.mjs';
import {RAW_INTERNAL_MANIFEST_KEY,RAW_INTERNAL_COORDINATION_ID,rawInternalProvenanceKey,
  rawInternalPointerDescriptor} from '../../apps/web/lib/catalog/raw-internal-provenance.mjs';

export const RAW_GC_TARGET = Object.freeze({endpoint:'https://s3.regru.cloud',bucket:'avtocena-staging-8120751',
  prefix:'migration-staging/full-20261011/'});
export const RAW_GC_POLICY_KEY = 'catalog/raw-feed-coordination/v1/policy.json';
export const RAW_GC_DEFAULTS = Object.freeze({groups:2,objects:20000,bytes:10*1024**3,pages:40,
  jsonBytes:64*1024**2,batches:1,workMs:120000});
const HASH = /^[a-f0-9]{64}$/, COMMIT = /^[a-f0-9]{40}$/;
const same = (a,b) => rawDigest(a) === rawDigest(b);
const integer = n => Number.isSafeInteger(n) && n >= 0;
const pointerKey = id => id===RAW_INTERNAL_COORDINATION_ID?RAW_INTERNAL_MANIFEST_KEY
  : id === 'che168_snapshot_config' ? 'catalog/raw-feed-config/v1/che168-snapshot.json'
  : `catalog/intake-cursors/v1/${id.slice('intake_cursor:'.length)}.json`;
const receiptLeaf = kind => kind === 'che168-journal' ? 'head.json'
  : ['che168-snapshot','che168-replica'].includes(kind) ? 'manifest.json' : 'complete.json';
function limits(input = {}) {
  const value = {...RAW_GC_DEFAULTS,...input};
  for (const [key,max] of Object.entries({groups:10,objects:250000,bytes:100*1024**3,pages:1000,
    jsonBytes:256*1024**2,batches:250,workMs:600000})) {
    assert.ok(Number.isSafeInteger(value[key]) && value[key] > 0 && value[key] <= max,'raw_gc_limit_'+key);
  }
  return value;
}
function assertIo(io,write = false) {
  assert.ok(io && same(io.target,RAW_GC_TARGET),'raw_gc_storage_target');
  for (const method of ['readJson','listPage','headObject',...(write?['writeJson','deleteBatch']:[])]) {
    assert.equal(typeof io[method],'function','raw_gc_bounded_io_required');
  }
}
function budget(config,now) {
  return {limits:limits(config),startedAt:now(),now,pages:0,objects:0,inventoryBytes:0,jsonBytes:0,heads:0,writes:0,deletes:0};
}
function time(b) {const elapsed=b.now()-b.startedAt;assert.ok(Number.isFinite(elapsed) && elapsed>=0 && elapsed<=b.limits.workMs,'raw_gc_time_budget');}
async function read(io,key,maxBytes,b) {
  assertIo(io);time(b);
  const meta = await io.readJson({target:RAW_GC_TARGET,key,maxBytes,deadline:b.startedAt+b.limits.workMs});
  assert.ok(meta && typeof meta.found === 'boolean','raw_gc_read_result');
  if (meta.found) {
    assert.ok(typeof meta.etag === 'string' && meta.etag.length > 0 && meta.etag.length <= 256,'raw_gc_etag_required');
    const bytes = Buffer.byteLength(JSON.stringify(meta.value));b.jsonBytes += bytes;
    assert.ok(bytes <= maxBytes && b.jsonBytes <= b.limits.jsonBytes,'raw_gc_json_budget');
  } else assert.equal(meta.value,null,'raw_gc_absent_value');
  return meta;
}
const unknown = reason => ({status:'protected_unknown',reason});

/** Actual payload hashes are compared with the existing ledger. No bootstrap,
 * registration, root proof or coverage assertion is performed by this module. */
export async function readRawGcAuthority({io,expected,budget:work,now = Date.now,config}) {
  assertIo(io);const b = work || budget(config,now);
  const policy = await read(io,RAW_GC_POLICY_KEY,4096,b),registry = await read(io,RAW_COORDINATION_KEY,RAW_COORDINATION_LIMITS.bytes,b);
  if (!policy.found || !registry.found) return unknown(!policy.found?'coordination_policy_missing':'coordination_registry_missing');
  // Public current/previous and cursors are not the entire next-refresh input:
  // internal maintenance rows require their own coordinated dependency proof.
  // A legacy six-pointer registry cannot authorize this collector.
  if (!registry.value?.pointers?.some(row=>row.id===RAW_INTERNAL_COORDINATION_ID && row.current?.complete===true)) {
    return unknown('internal_catalog_unproven');
  }
  const state = assertRawCoordination(registry.value);
  const required = {version:1,mode:'required',protocolVersion:1,registryId:state.registryId};
  if (!same(policy.value,required)) return unknown('coordination_policy_not_required');
  if (state.coverage.status !== 'verified') return unknown('writer_coverage_unknown');
  if (state.catalog.pending || state.pointers.some(row => row.pending)) return unknown('publication_or_pointer_pending');
  if (![state.catalog.current,state.catalog.previous].every(row => row.complete)
      || !state.pointers.every(row => row.current.complete)) return unknown('catalog_or_pointer_unknown');
  const catalog = {};
  for (const [name,key] of [['current','catalog/manifest.json'],['previous','catalog/previous-manifest.json']]) {
    const manifest = await read(io,key,16*1024**2,b);
    const provenance = manifest.found ? await read(io,rawGenerationKey(manifest.value.generationId),16*1024**2,b) : {value:null};
    const actual = rawCatalogDescriptor(manifest.value,provenance.value);
    if (!actual.complete || !same(actual,state.catalog[name])) return unknown('actual_'+name+'_provenance_changed');
    catalog[name] = actual;
  }
  const pointers = [];
  for (const id of RAW_COORDINATED_POINTERS) {
    const value = await read(io,pointerKey(id),4*1024**2,b),stored = state.pointers.find(row => row.id === id);
    if(id===RAW_INTERNAL_COORDINATION_ID) {
      try {
        const proof=value.found?await read(io,rawInternalProvenanceKey(value.value?.generationId),4*1024**2,b):{value:null};
        const actual=rawInternalPointerDescriptor(value.value,proof.value);
        if(!actual.complete || !same(actual,stored.current)) return unknown('internal_catalog_unproven');
      } catch {return unknown('internal_catalog_unproven');}
    }
    if (rawDigest(value.value) !== stored.current.sha256) return unknown('actual_pointer_changed');
    pointers.push({id,current:stored.current});
  }
  const finalPolicy = await read(io,RAW_GC_POLICY_KEY,4096,b),finalRegistry = await read(io,RAW_COORDINATION_KEY,RAW_COORDINATION_LIMITS.bytes,b);
  if (!finalPolicy.found || !finalRegistry.found || finalPolicy.etag !== policy.etag || finalRegistry.etag !== registry.etag
      || !same(finalPolicy.value,policy.value) || !same(finalRegistry.value,state)) return unknown('authority_changed_during_read');
  const binding = {registryId:state.registryId,coverageProofSha256:state.coverage.proofSha256,
    policy:{etag:policy.etag,sha256:rawDigest(policy.value)},catalog,pointers};
  if (expected && !same(binding,expected)) return unknown('captured_authority_changed');
  return {status:'ready',state,binding,registryEtag:registry.etag};
}
function rootScope(root) {
  const kind = coordinatedRawRootKind(root);assert.ok(kind,'raw_gc_root_scope');return kind;
}
function objectRow(value,root,now) {
  const member = rawInventoryGroupForObject(value?.key);
  assert.equal(member.root,root,'raw_gc_listing_outside_root');
  assert.ok(integer(value.size) && typeof value.lastModified === 'string' && value.lastModified.length <= 50
    && Number.isFinite(Date.parse(value.lastModified)) && Date.parse(value.lastModified) > 0
    && Date.parse(value.lastModified) <= now && typeof value.etag === 'string' && value.etag.length > 0
    && value.etag.length <= 256,'raw_gc_object_metadata');
  return {key:value.key,size:value.size,lastModified:value.lastModified,etag:value.etag};
}
const contractRows = rows => rows.map(({key,size,lastModified}) => ({key,size,lastModified}));
async function listing(io,root,b,{expectEmpty = false} = {}) {
  rootScope(root);const objects = [],seen = new Set(),tokens = new Set();let cursor = null;
  while (true) {
    assertIo(io);time(b);assert.ok(++b.pages <= b.limits.pages,'raw_gc_page_budget');
    const remaining = expectEmpty ? 1 : b.limits.objects-b.objects;
    assert.ok(remaining > 0,'raw_gc_object_budget');
    const maxKeys = Math.min(1000,remaining);
    const page = await io.listPage({target:RAW_GC_TARGET,prefix:root+'/',cursor,maxKeys,deadline:b.startedAt+b.limits.workMs});
    assert.ok(page?.prefix === root+'/' && Array.isArray(page.objects) && page.objects.length <= maxKeys
      && typeof page.truncated === 'boolean','raw_gc_list_page');
    for (const value of page.objects) {
      const row = objectRow(value,root,b.now());assert.ok(!seen.has(row.key),'raw_gc_duplicate_inventory_key');seen.add(row.key);
      objects.push(row);b.objects++;b.inventoryBytes+=row.size;
      assert.ok(b.objects <= b.limits.objects && b.inventoryBytes <= b.limits.bytes,'raw_gc_inventory_budget');
    }
    if (expectEmpty && (objects.length || page.truncated)) return {complete:false,objects,reason:'root_not_proved_empty'};
    if (!page.truncated) {
      assert.ok(page.nextCursor === undefined || page.nextCursor === null,'raw_gc_unexpected_cursor');
      return {complete:true,objects:objects.sort((a,b)=>a.key.localeCompare(b.key))};
    }
    assert.ok(typeof page.nextCursor === 'string' && page.nextCursor.length > 0 && page.nextCursor.length <= 4096
      && page.nextCursor !== cursor && !tokens.has(page.nextCursor),'raw_gc_pagination_stalled');
    tokens.add(page.nextCursor);cursor=page.nextCursor;
  }
}
/** Explicit roots only. Unknown/incomplete members preserve the whole group;
 * no returned partial listing can become a deletion plan. */
export async function inventoryRawGcRoots({io,roots,authority,config,now = Date.now,budget:work}) {
  assertIo(io);const b = work || budget(config,now);
  assert.ok(Array.isArray(roots) && roots.length > 0 && roots.length <= b.limits.groups
    && new Set(roots).size === roots.length,'raw_gc_root_budget');
  roots.forEach(rootScope);const groups = [];
  try {
    for (const root of roots) {
      const kind = rootScope(root),listed = await listing(io,root,b);
      if (!listed.objects.length) return {...unknown('root_empty_or_missing'),groups};
      const receiptKey = root+'/'+receiptLeaf(kind),receipt = await read(io,receiptKey,4*1024**2,b);
      const receiptObject = listed.objects.find(row=>row.key===receiptKey);
      if (!receipt.found || !receiptObject || receiptObject.etag!==receipt.etag) return {...unknown('receipt_missing_or_changed'),groups};
      const row = authority?.state?.roots.find(item=>item.root===root);
      const terminal = authority?.status === 'ready' && row?.proof?.coverageProofSha256 === authority.binding.coverageProofSha256
        && HASH.test(row.proof.writerProofSha256) ? new Set([root]) : new Set();
      const receiptComplete = completeRawInventoryGroup({kind,root,receipt:receipt.value,
        objects:listed.objects.map(object=>({...object,leaf:object.key.slice(root.length+1)}))},terminal);
      if (!receiptComplete) return {...unknown('root_receipt_incomplete_or_unknown'),groups};
      groups.push({kind,root,receiptKey,receiptSha256:rawDigest(receipt.value),receiptEtag:receipt.etag,
        inventorySha256:rawDigest(contractRows(listed.objects)),objects:listed.objects});
    }
    return {status:'complete',groups,pages:b.pages,objects:groups.reduce((sum,g)=>sum+g.objects.length,0),
      inventoryBytes:groups.flatMap(g=>g.objects).reduce((sum,row)=>sum+row.size,0)};
  } catch (error) {
    const reason = String(error?.message||'').split('\n')[0];
    if (!/^raw_(?:gc|inventory|coord)_/.test(reason)) throw error;
    return {...unknown(reason),groups,complete:false};
  }
}
function proofGroup(state,group) {
  const row = state.roots.find(value=>value.root===group.root);
  assert.ok(row?.state==='live' && row.proof && row.proof.coverageProofSha256===state.coverage.proofSha256
    && row.proof.inventorySha256===group.inventorySha256 && row.proof.receiptSha256===group.receiptSha256,'raw_gc_root_proof_missing_or_changed');
  return {kind:group.kind,root:group.root,incarnation:row.incarnation,revision:row.revision,
    receiptSha256:group.receiptSha256,objects:contractRows(group.objects)};
}
function currentlyProtected(state,roots) {
  const references = [state.catalog.current,state.catalog.previous,state.catalog.pending?.candidate].filter(Boolean)
    .flatMap(row=>row.references).concat(state.pointers.flatMap(row=>[...row.current.references,...(row.pending?.candidate.references||[])]),
      state.claims.flatMap(row=>row.references));
  return !!(state.gc && state.gc.state !== 'completed') || references.some(row=>roots.includes(row.root));
}
/** Uses the existing retention decision (including recent-group retention).
 * Full retention inputs are never inferred from a bounded partial root scan. */
export async function prepareRawGcPlan({io,retentionInputs,config,now = Date.now}) {
  const b = budget(config,now),authority = await readRawGcAuthority({io,budget:b});
  if (authority.status !== 'ready') return {mode:'plan',...authority};
  if (!retentionInputs) return {mode:'plan',...unknown('complete_retention_inventory_required')};
  for (const name of ['current','previous']) {
    if (!same(rawCatalogDescriptor(retentionInputs[name+'Manifest'],retentionInputs[name+'Provenance']),authority.binding.catalog[name])) {
      return {mode:'plan',...unknown('retention_generation_context_changed')};
    }
  }
  const retained = planRawFeedRetention({...retentionInputs,now:b.now(),maxGroups:b.limits.groups,
    maxObjects:b.limits.objects,maxBytes:b.limits.bytes});
  if (retained.summary.status !== 'ready') return {mode:'plan',...unknown(retained.summary.reason)};
  if (!retained.summary.selectedGroups.length) return {mode:'plan',status:'nothing_selected',selectedObjects:0,selectedBytes:0};
  const inventory = await inventoryRawGcRoots({io,roots:retained.summary.selectedGroups,authority,budget:b});
  if (inventory.status !== 'complete') return {mode:'plan',...inventory};
  const selected = inventory.groups.flatMap(g=>contractRows(g.objects).map(row=>({...row,kind:g.kind,root:g.root})));
  if (!same(selected,retained.selected)) return {mode:'plan',...unknown('retention_inventory_changed')};
  let planned;
  try {planned=rawGcPlan(inventory.groups.map(group=>proofGroup(authority.state,group)));}
  catch {return {mode:'plan',...unknown('root_proof_missing_or_changed')};}
  const final = await readRawGcAuthority({io,expected:authority.binding,budget:b});
  if (final.status !== 'ready') return {mode:'plan',...final};
  if (currentlyProtected(final.state,planned.plan.groups.map(row=>row.root))) return {mode:'plan',...unknown('root_or_gc_currently_protected')};
  try {
    const refreshed=rawGcPlan(inventory.groups.map(group=>proofGroup(final.state,group)));
    if (refreshed.sha256!==planned.sha256) return {mode:'plan',...unknown('root_incarnation_or_revision_changed')};
  } catch {return {mode:'plan',...unknown('root_proof_missing_or_changed')};}
  const body = {version:1,kind:'bounded_raw_gc_execution_v1',target:RAW_GC_TARGET,authority:authority.binding,
    plan:planned.plan,planSha256:planned.sha256,planKey:planned.key,
    retention:{fenceDigest:retained.summary.fenceDigest,selectionDigest:retained.summary.selectionDigest,
      graceMs:retained.summary.graceMs},inventory:inventory.groups.map(group=>({...group,
      writerProofSha256:final.state.roots.find(row=>row.root===group.root).proof.writerProofSha256}))};
  return {mode:'plan',status:'ready',evidence:{...body,sha256:rawDigest(body)},selectedObjects:planned.objects.length,
    selectedBytes:planned.bytes,storageWrites:0,deleteRequests:0};
}

function evidencePlan(evidence,b) {
  const {sha256,...body}=evidence || {};
  assert.ok(HASH.test(sha256) && rawDigest(body)===sha256,'raw_gc_evidence_digest');
  assert.ok(body.version===1 && body.kind==='bounded_raw_gc_execution_v1' && same(body.target,RAW_GC_TARGET),'raw_gc_evidence_scope');
  const planned=rawGcPlan(body.plan?.groups);
  assert.ok(same(planned.plan,body.plan) && planned.sha256===body.planSha256 && planned.key===body.planKey,'raw_gc_evidence_plan');
  assert.ok(planned.plan.groups.length<=b.limits.groups && planned.objects.length<=b.limits.objects
    && planned.bytes<=b.limits.bytes,'raw_gc_execution_plan_budget');
  assert.ok(Array.isArray(body.inventory) && body.inventory.length===planned.plan.groups.length
    && new Set(body.inventory.map(row=>row.root)).size===body.inventory.length,'raw_gc_evidence_inventory');
  for (const group of planned.plan.groups) {
    const captured=body.inventory.find(row=>row.root===group.root);
    assert.ok(captured && captured.kind===group.kind && captured.receiptKey===group.root+'/'+receiptLeaf(group.kind)
      && captured.receiptSha256===group.receiptSha256 && captured.inventorySha256===group.inventorySha256
      && HASH.test(captured.writerProofSha256),'raw_gc_evidence_group');
    assert.ok(Array.isArray(captured.objects) && same(contractRows(captured.objects),group.objects),'raw_gc_evidence_objects');
    for (const row of captured.objects) objectRow(row,group.root,b.now());
    assert.equal(captured.objects.find(row=>row.key===captured.receiptKey)?.etag,captured.receiptEtag,'raw_gc_evidence_receipt');
  }
  assert.ok(HASH.test(body.retention?.fenceDigest) && HASH.test(body.retention?.selectionDigest)
    && Number.isSafeInteger(body.retention.graceMs) && body.retention.graceMs>=86400000,'raw_gc_retention_evidence');
  return planned;
}
function armedIdentity(arm,evidence,environment) {
  const owner={runId:environment.GITHUB_RUN_ID,attempt:environment.GITHUB_RUN_ATTEMPT,sourceSha:environment.GITHUB_SHA};
  assert.ok(environment.GITHUB_REPOSITORY==='jeep-jim/AvtoCena' && environment.GITHUB_REF==='refs/heads/main'
    && /^\d{1,20}$/.test(owner.runId||'') && /^[1-9]\d{0,5}$/.test(owner.attempt||'')
    && COMMIT.test(owner.sourceSha),'raw_gc_controller_identity');
  assert.ok(typeof arm?.operationId==='string' && /^[A-Za-z0-9_-]{1,150}$/.test(arm.operationId),'raw_gc_explicit_arming_required');
  const expected={version:1,action:'delete_verified_unreferenced_raw',operationId:arm.operationId,owner,
    registryId:evidence.authority.registryId,coverageProofSha256:evidence.authority.coverageProofSha256,
    evidenceSha256:evidence.sha256,planSha256:evidence.planSha256,target:RAW_GC_TARGET};
  assert.ok(same(arm,expected),'raw_gc_explicit_arming_required');
  // The coordinator's owner token binds the richer ETag evidence without
  // changing its existing plan/state schema or introducing another GC ledger.
  return {operationId:arm.operationId,owner,token:rawDigest({scope:'raw_gc_evidence_v1',
    evidenceSha256:evidence.sha256,owner,operationId:arm.operationId})};
}
function gcTicket(state) {
  const gc=state.gc;
  return {registryId:state.registryId,operationId:gc.operationId,owner:gc.owner,token:gc.token,
    grantRevision:gc.grantRevision,revision:gc.revision};
}
function ownedGc(state,identity,planned,supplied) {
  const gc=state.gc;
  assert.ok(gc && gc.operationId===identity.operationId && same(gc.owner,identity.owner) && gc.token===identity.token
    && gc.planSha256===planned.sha256 && same(gcTicket(state),supplied),'raw_gc_resume_ownership');
  return gc;
}
function safeReason(error) {
  const code=String(error?.message||'').split('\n')[0];
  return /^raw_(gc|coord|inventory)_[a-z_]+$/.test(code)?code:'raw_gc_transport_failure';
}
async function immutable(io,key,value,b,{existing=false}={}) {
  const maxBytes=Buffer.byteLength(JSON.stringify(value));
  assert.ok(maxBytes<=b.limits.jsonBytes,'raw_gc_immutable_size');
  let meta=await read(io,key,maxBytes,b);
  if (!meta.found) {
    assert.ok(!existing,'raw_gc_saved_plan_missing');assertIo(io,true);time(b);
    try {await io.writeJson({target:RAW_GC_TARGET,key,value,condition:{ifNoneMatch:'*'},
      deadline:b.startedAt+b.limits.workMs});b.writes++;}
    catch(error) {if(error?.name!=='StorageConflictError') throw error;}
    meta=await read(io,key,maxBytes,b);
  }
  assert.ok(meta.found && same(meta.value,value),'raw_gc_immutable_plan_changed');
}
async function mutate(io,command,b,expected,{record=false}={}) {
  const storage={driver:'object',
    async readJsonWithMeta(key) {
      assert.equal(key,RAW_COORDINATION_KEY,'raw_gc_state_key');
      if (record) return read(io,key,RAW_COORDINATION_LIMITS.bytes,b);
      const authority=await readRawGcAuthority({io,expected,budget:b});
      assert.equal(authority.status,'ready','raw_gc_fresh_authority_required');
      return {found:true,value:authority.state,etag:authority.registryEtag};
    },
    async writeJson(key,value,condition) {
      assert.equal(key,RAW_COORDINATION_KEY,'raw_gc_state_key');
      assert.ok(typeof condition?.ifMatch==='string' && Object.keys(condition).length===1,'raw_gc_state_cas_required');
      assertIo(io,true);time(b);assertRawCoordination(value);
      await io.writeJson({target:RAW_GC_TARGET,key,value,condition,deadline:b.startedAt+b.limits.workMs});b.writes++;
    }};
  return mutateRawCoordination({storage,command});
}
async function head(io,row,b) {
  assertIo(io);time(b);assert.ok(++b.heads<=b.limits.objects*2,'raw_gc_head_budget');
  const meta=await io.headObject({target:RAW_GC_TARGET,key:row.key,deadline:b.startedAt+b.limits.workMs});
  assert.ok(meta && typeof meta.found==='boolean','raw_gc_head_result');
  if (!meta.found) return false;
  assert.ok(meta.etag===row.etag && meta.size===row.size && meta.lastModified===row.lastModified,'raw_gc_object_changed');
  return true;
}
async function heads(io,rows,b) {
  const results=new Array(rows.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,rows.length)},async()=>{
    while(cursor<rows.length) {const index=cursor++;
      try {results[index]={present:await head(io,rows[index].row,b)};}
      catch(error) {results[index]={error:safeReason(error)};}
    }
  }));
  return results;
}
function settledDelete(result,rows) {
  const keys=rows.map(row=>row.key);
  return result?.settled===true && result.requestSha256===rawDigest(rows)
    && Array.isArray(result.results) && result.results.length===keys.length
    && new Set(result.results.map(row=>row.key)).size===keys.length
    && result.results.every(row=>keys.includes(row.key) && ['deleted','error'].includes(row.status));
}

/** Dormant transport-independent executor. It does not construct an S3 client.
 * Default runRawGc() remains read-only. A throwing DELETE is never retried or
 * marked drained: the durable active batch must receive separate terminal
 * evidence through the existing coordinator before it can be resumed. */
export async function executeRawGcPlan({io,evidence,arm,resumeTicket,config,now=Date.now,environment=process.env}) {
  assertIo(io,true);const b=budget(config,now),planned=evidencePlan(evidence,b),identity=armedIdentity(arm,evidence,environment);
  let authority=await readRawGcAuthority({io,expected:evidence.authority,budget:b}),state=authority.state,ticket=resumeTicket;
  const result=(status,reason)=>({mode:'execute',status,...(reason?{reason}:{}),ticket:ticket||null,
    evidenceSha256:evidence.sha256,planSha256:planned.sha256,
    acknowledgedObjects:state?.gc?.token===identity.token?state.gc.acknowledgedObjects:0,
    acknowledgedInventoryBytes:state?.gc?.token===identity.token?state.gc.acknowledgedInventoryBytes:0,
    storageWrites:b.writes,deleteRequests:b.deletes});
  if(authority.status!=='ready') return result('protected_unknown',authority.reason);
  if(ticket) {
    ownedGc(state,identity,planned,ticket);
    if(state.gc.inflight?.phase==='active') return result('needs_terminal_request_evidence','active_request_not_proved_drained');
  } else {
    if(currentlyProtected(state,planned.plan.groups.map(row=>row.root))) return result('protected_unknown','root_or_gc_currently_protected');
    const current=await inventoryRawGcRoots({io,roots:evidence.inventory.map(row=>row.root),authority,budget:b});
    if(current.status!=='complete') return result('protected_unknown',current.reason);
    const captured=evidence.inventory.map(({writerProofSha256,...row})=>row);
    if(!same(current.groups,captured)) return result('protected_unknown','captured_inventory_changed');
    const rebuilt=rawGcPlan(current.groups.map(group=>proofGroup(state,group)));
    if(rebuilt.sha256!==planned.sha256) return result('protected_unknown','root_incarnation_or_revision_changed');
    for(const group of evidence.inventory) if(state.roots.find(row=>row.root===group.root)?.proof?.writerProofSha256!==group.writerProofSha256) {
      return result('protected_unknown','writer_proof_changed');
    }
  }
  await immutable(io,planned.key,planned.plan,b,{existing:!!ticket});
  await immutable(io,'catalog/raw-feed-gc-plans/v1/evidence/'+evidence.sha256+'.json',evidence,b,{existing:!!ticket});
  if(!ticket) {
    const claimed=await mutate(io,{type:'claim_gc',...identity,plan:planned.plan,planSha256:planned.sha256},b,evidence.authority);
    state=claimed.state;ticket=claimed.result;
  }
  if(state.gc.state==='completed') return result('completed');
  const metadata=new Map(evidence.inventory.flatMap(group=>group.objects).map(row=>[row.key,row]));
  for(let batch=0;batch<b.limits.batches && state.gc.nextBatch<state.gc.batches.length;batch++) {
    authority=await readRawGcAuthority({io,expected:evidence.authority,budget:b});
    if(authority.status!=='ready') return result('protected_unknown',authority.reason);
    ownedGc(authority.state,identity,planned,ticket);
    const started=await mutate(io,{type:'begin_gc_batch',ticket,plan:planned.plan},b,evidence.authority);
    state=started.state;ticket=started.result.ticket;const attempt=started.result.attempt,work=state.gc.inflight;
    const absent=new Set(work.absent),remaining=work.objects.map((row,index)=>({index,row:metadata.get(row.key)}))
      .filter(row=>!absent.has(row.index));
    const before=await heads(io,remaining,b);
    before.forEach((row,index)=>{if(row.present===false) absent.add(remaining[index].index);});
    let error=before.some(row=>row.error)?'cancelled':null;
    if(!error) {
      // The last fresh authority/ownership read occurs after every HEAD and
      // immediately before the only destructive transport call in this batch.
      try {
        authority=await readRawGcAuthority({io,expected:evidence.authority,budget:b});
        if(authority.status!=='ready') error='cancelled';
        else ownedGc(authority.state,identity,planned,ticket);
      } catch {error='cancelled';}
    }
    const requested=remaining.filter(row=>!absent.has(row.index));
    if(!error && requested.length) {
      const rows=requested.map(row=>row.row);let response;
      try {
        assertIo(io,true);time(b);b.deletes++;
        response=await io.deleteBatch({target:RAW_GC_TARGET,objects:rows,requestSha256:rawDigest(rows),
          operation:{...ticket,attempt},deadline:b.startedAt+b.limits.workMs});
      } catch {return result('needs_terminal_request_evidence','delete_transport_outcome_unknown');}
      if(!settledDelete(response,rows)) return result('needs_terminal_request_evidence','delete_response_not_proved_settled');
      const after=await heads(io,requested,b);
      after.forEach((row,index)=>{if(row.present===false) absent.add(requested[index].index);});
      error=after.some(row=>row.error)?'unknown_result':absent.size<work.objects.length?'delete_failed':null;
    }
    try {
      const recorded=await mutate(io,{type:'record_gc_batch',ticket,attempt,requestSettled:true,
        absent:[...absent],...(absent.size<work.objects.length?{error:error||'cancelled'}:{})},b,evidence.authority,{record:true});
      state=recorded.state;ticket=recorded.result;
    } catch {return result('needs_reconciliation','settled_progress_not_confirmed');}
    if(state.gc.inflight) return result('paused',error||'cancelled');
  }
  if(state.gc.nextBatch<state.gc.batches.length) return result('bounded_progress');
  authority=await readRawGcAuthority({io,expected:evidence.authority,budget:b});
  if(authority.status!=='ready') return result('protected_unknown',authority.reason);
  ownedGc(authority.state,identity,planned,ticket);const emptyRoots=[];
  for(const group of planned.plan.groups) {
    const actual=await listing(io,group.root,b,{expectEmpty:true});
    if(!actual.complete || actual.objects.length) return result('needs_reconciliation','root_not_proved_empty');
    emptyRoots.push({root:group.root,complete:true,count:0,inventorySha256:rawDigest([])});
  }
  const completed=await mutate(io,{type:'complete_gc',ticket,emptyRoots},b,evidence.authority);
  state=completed.state;ticket=completed.result;return result('completed');
}

export async function runRawGc({mode='plan',...options}) {
  assert.ok(['plan','execute'].includes(mode),'raw_gc_mode');
  return mode==='plan'?prepareRawGcPlan(options):executeRawGcPlan(options);
}
