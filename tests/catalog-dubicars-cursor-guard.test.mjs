import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createDubicarsDeltaCursorGuard,prepareDubicarsDeltaCursorCommit,DUBICARS_CURSOR_KEY} from '../scripts/lib/catalog-dubicars-cursor-guard.mjs';
import {commitCoordinatedIntakeCursor} from '../scripts/lib/catalog-raw-cursor.mjs';
import {publishedIntakeCheckpoint} from '../scripts/lib/catalog-intake-checkpoint.mjs';
import {commitRawPointer} from '../scripts/lib/catalog-raw-session.mjs';
import {prepareRawPublication} from '../scripts/lib/catalog-raw-publication.mjs';
import {archiveIntakeDirectory,attachIntakeArchiveReceipt} from '../scripts/lib/nonjp-intake-archive.mjs';
import {rawDigest,rawGenerationKey,buildRawGenerationProvenance,rawReferences} from '../scripts/lib/catalog-raw-provenance.mjs';
import {RAW_COORDINATION_KEY,createRawCoordination,rawCatalogDescriptor,rawPointerDescriptor} from '../scripts/lib/catalog-raw-coordination.mjs';
import {RAW_COORDINATION_POLICY_KEY} from '../apps/web/lib/catalog/raw-coordination-gate.mjs';

const owner={runId:'45076401719',attempt:'1',revision:'a'.repeat(40)};
const operationId='catalog_v3_publish_uae_test';
const snapshotStartedAt='2026-11-17T00:34:23.387Z';
const root='catalog/nonjp-intake/v1/uae/45076401719/1';
const manifest=n=>({version:2,generationId:`gen_${1000+n}_test`,updatedAt:'2026-11-23T00:00:00Z',
  markets:{uae:{count:n,chunks:['chunk-0001'],updatedAt:'2026-11-23T00:00:00Z'}}});
class MemoryStorage {
  driver='object';values=new Map();versions=new Map();writes=[];beforeWrite=null;
  seed(key,value){this.values.set(key,structuredClone(value));this.versions.set(key,(this.versions.get(key)||0)+1);}
  async readJson(key,fallback){return this.values.has(key)?structuredClone(this.values.get(key)):fallback;}
  async readJsonWithMeta(key,fallback){return {found:this.values.has(key),value:await this.readJson(key,fallback),
    etag:this.values.has(key)?String(this.versions.get(key)):null};}
  async writeJson(key,value,condition={}) {
    await this.beforeWrite?.(key,value,condition);
    if(condition?.ifMatch&&condition.ifMatch!==String(this.versions.get(key))||condition?.ifNoneMatch==='*'&&this.values.has(key)) {
      const error=Error('storage_conflict');error.name='StorageConflictError';throw error;
    }
    this.seed(key,value);this.writes.push({key,value:structuredClone(value),condition});
  }
}

function fixture() {
  const storage=new MemoryStorage(),current=manifest(1),next=manifest(2);
  const source={sourceId:'dubicars_uae_exact',provider:'auto_api_dubicars',syncMode:'delta',
    initialCursor:320763,cursor:328970,snapshotStartedAt,pages:0,rejectedIdentity:0,stopReason:'source_changes_finished'};
  const plain={version:1,market:'uae',provider:'auto_api_dubicars',completed:true,completedAt:'2026-11-22T22:54:43.652Z',sources:[source]};
  const references=rawReferences([{kind:'nonjp-intake',root,sha256:'b'.repeat(64)}]);
  const handoff={version:1,key:'catalog/raw-feed-pins/v1/test-intake.json',operationId:'test-intake',owner,
    readyAt:plain.completedAt,references,referencesSha256:rawDigest(references)};
  const intake={...plain,durableIntakeArchive:{version:1,market:'uae',owner,root,manifestSha256:'b'.repeat(64),
    reportDigest:rawDigest(plain),handoff},rawStoragePins:[handoff]};
  const base={version:1,market:'uae',updatedAt:'2026-11-21T00:00:00Z',generationId:current.generationId,
    sources:[{sourceId:source.sourceId,provider:source.provider,cursor:source.initialCursor,snapshotStartedAt,
      stopReason:'source_changes_finished'}]};
  storage.seed(DUBICARS_CURSOR_KEY,base);storage.seed('catalog/manifest.json',current);
  storage.seed('catalog/import-lock.json',{operationId,operationType:'catalog_v3_publish_uae',lockedUntil:'2099-01-01T00:00:00Z'});
  const guard=createDubicarsDeltaCursorGuard({storage,intake,operationId});
  return {storage,intake,plain,base,current,next,guard};
}
async function published(f) {
  await f.guard.capture();await f.guard.verify();f.storage.seed('catalog/manifest.json',f.next);
  const publication={published:true,market:'uae',generationId:f.next.generationId,dubicarsCursor:f.guard.receipt(f.next)};
  return {publication,checkpoint:publishedIntakeCheckpoint(f.intake,publication)};
}
function enableCoordination(f) {
  const registryId='f'.repeat(32);
  f.storage.seed(RAW_COORDINATION_POLICY_KEY,{version:1,mode:'required',protocolVersion:1,registryId});
  f.storage.seed(RAW_COORDINATION_KEY,createRawCoordination({registryId,current:rawCatalogDescriptor(f.current),
    previous:rawCatalogDescriptor(null),pointers:[{id:'intake_cursor:uae',current:rawPointerDescriptor(f.base,[],{complete:false})}]}));
}

test('disabled-coordination UAE delta uses the captured ETag and an exact replay performs zero writes',async()=>{
  const f=fixture(),p=await published(f);
  const first=await commitCoordinatedIntakeCursor({storage:f.storage,intake:f.intake,...p,owner});
  assert.equal(first.cursorCommitted,true);
  assert.deepEqual(f.storage.writes.map(row=>({key:row.key,condition:row.condition})),[{key:DUBICARS_CURSOR_KEY,condition:{ifMatch:'1'}}]);
  const checkpoint=await f.storage.readJson(DUBICARS_CURSOR_KEY,null),count=f.storage.writes.length;
  f.storage.seed('catalog/import-lock.json',{lockedUntil:''});f.storage.seed('catalog/manifest.json',manifest(3));
  const repeated=await commitCoordinatedIntakeCursor({storage:f.storage,intake:f.intake,...p,owner});
  assert.equal(repeated.cursorCommitted,true);assert.equal(repeated.idempotent,true);
  assert.equal(f.storage.writes.length,count);assert.deepEqual(await f.storage.readJson(DUBICARS_CURSOR_KEY,null),checkpoint);
});

test('an advanced, intersecting, missing or different snapshot base stops before publication',async()=>{
  for(const mutation of [value=>{value.sources[0].cursor=400000;},value=>{value.sources[0].cursor=320764;},
    value=>{value.sources[0].cursor=328970;},value=>{value.sources[0].snapshotStartedAt='2026-11-18T00:00:00Z';},
    value=>{value.sources[0].cursor='320763';},value=>{value.updatedAt='2026-11-23T00:00:00Z';}]) {
    const f=fixture(),changed=structuredClone(f.base);mutation(changed);f.storage.seed(DUBICARS_CURSOR_KEY,changed);
    let published=false;
    await assert.rejects(async()=>{await f.guard.capture();published=true;},/dubicars_cursor_/);
    assert.equal(published,false);assert.equal(f.storage.writes.length,0);
    assert.deepEqual(await f.storage.readJson(DUBICARS_CURSOR_KEY,null),changed);
  }
  const f=fixture();f.storage.values.delete(DUBICARS_CURSOR_KEY);
  await assert.rejects(f.guard.capture(),/base_missing_or_invalid/);assert.equal(f.storage.writes.length,0);
});

test('fresh same-cursor metadata and numeric advancement during preparation invalidate the candidate',async()=>{
  for(const advanced of [false,true]) {
    const f=fixture();await f.guard.capture();
    const changed=structuredClone(f.base);if(advanced)changed.sources[0].cursor=400000;
    f.storage.seed(DUBICARS_CURSOR_KEY,changed);
    await assert.rejects(f.guard.verify(),advanced?/newer_preserved/:/base_changed/);
    assert.equal(f.storage.writes.length,0);assert.deepEqual(await f.storage.readJson('catalog/manifest.json',null),f.current);
  }
});

test('a write-time CAS race preserves the newer cursor and cannot report a completed commit',async()=>{
  const f=fixture(),p=await published(f),newer=structuredClone(f.base);newer.sources[0].cursor=400000;
  f.storage.beforeWrite=async key=>{if(key===DUBICARS_CURSOR_KEY){f.storage.beforeWrite=null;f.storage.seed(key,newer);}};
  await assert.rejects(commitCoordinatedIntakeCursor({storage:f.storage,intake:f.intake,...p,owner}),{name:'StorageConflictError'});
  assert.deepEqual(await f.storage.readJson(DUBICARS_CURSOR_KEY,null),newer);assert.equal(f.storage.writes.length,0);
  assert.deepEqual(await f.storage.readJson('catalog/manifest.json',null),f.next,'a committed manifest is not falsely rolled back');
});

test('a historical/mismatched publication receipt or an expired lease cannot write a cursor',async()=>{
  for(const mutation of [f=>f.storage.seed('catalog/manifest.json',manifest(3)),
    f=>f.storage.seed('catalog/manifest.json',{...f.next,markets:{uae:{...f.next.markets.uae,count:9}}}),
    f=>f.storage.seed('catalog/import-lock.json',{operationId,operationType:'catalog_v3_publish_uae',lockedUntil:'2000-01-01T00:00:00Z'}),
    (f,p)=>{p.publication.dubicarsCursor.input.archive.reportDigest='d'.repeat(64);},
    (f,p)=>{delete p.publication.dubicarsCursor;}]) {
    const f=fixture(),p=await published(f);mutation(f,p);
    await assert.rejects(commitCoordinatedIntakeCursor({storage:f.storage,intake:f.intake,...p,owner}),/dubicars_cursor_/);
    assert.equal(f.storage.writes.length,0);assert.deepEqual(await f.storage.readJson(DUBICARS_CURSOR_KEY,null),f.base);
  }
});

test('the same cursor number with different publication provenance is not accepted as idempotent',async()=>{
  const f=fixture(),p=await published(f),other=structuredClone(p.checkpoint);
  other.generationId=manifest(4).generationId;f.storage.seed(DUBICARS_CURSOR_KEY,other);
  await assert.rejects(commitCoordinatedIntakeCursor({storage:f.storage,intake:f.intake,...p,owner}),/initial_changed/);
  assert.deepEqual(await f.storage.readJson(DUBICARS_CURSOR_KEY,null),other);assert.equal(f.storage.writes.length,0);
});

test('coordinated pointer checks the supplied base before reserving; a failed lease hook cannot leave a pending write',async()=>{
  const f=fixture();enableCoordination(f);
  const base=await f.guard.capture(),args={storage:f.storage,id:'intake_cursor:uae',key:DUBICARS_CURSOR_KEY,
    value:{...f.base,updatedAt:'2026-11-23T00:00:00Z'},references:[],complete:false,owner,operationId:'test-cursor',expectedBase:base};
  await assert.rejects(commitRawPointer({...args,beforeWrite:async()=>{throw Error('lease_lost');}}),/lease_lost/);
  assert.equal(f.storage.writes.length,0);assert.equal(f.storage.values.get(RAW_COORDINATION_KEY).pointers.find(row=>row.id==='intake_cursor:uae').pending,null);
  const newer=structuredClone(f.base);newer.sources[0].cursor=400000;f.storage.seed(DUBICARS_CURSOR_KEY,newer);
  await assert.rejects(commitRawPointer(args),/expected_base_changed/);assert.equal(f.storage.writes.length,0);
});

test('losing the publication lease after reservation aborts only the owned unstarted pointer write',async()=>{
  const f=fixture(),p=await published(f);enableCoordination(f);
  const state=f.storage.values.get(RAW_COORDINATION_KEY);state.catalog.current=rawCatalogDescriptor(f.next);
  f.storage.seed(RAW_COORDINATION_KEY,state);
  const prepared=await prepareDubicarsDeltaCursorCommit({storage:f.storage,intake:f.intake,...p});let expired=false;
  f.storage.beforeWrite=async(key,value)=>{
    if(!expired&&key===RAW_COORDINATION_KEY&&value.pointers.find(row=>row.id==='intake_cursor:uae').pending) {
      expired=true;f.storage.seed('catalog/import-lock.json',{operationId,operationType:'catalog_v3_publish_uae',lockedUntil:'2000-01-01T00:00:00Z'});
    }
  };
  await assert.rejects(commitRawPointer({storage:f.storage,id:'intake_cursor:uae',key:DUBICARS_CURSOR_KEY,
    value:p.checkpoint,references:[],complete:false,owner,operationId:'test-cursor',...prepared}),/publication_lease_required/);
  assert.deepEqual(await f.storage.readJson(DUBICARS_CURSOR_KEY,null),f.base);
  assert.ok(!f.storage.writes.some(row=>row.key===DUBICARS_CURSOR_KEY));
  const pointer=f.storage.values.get(RAW_COORDINATION_KEY).pointers.find(row=>row.id==='intake_cursor:uae');
  assert.equal(pointer.pending,null);assert.equal(pointer.current.sha256,rawDigest(f.base));
  const proof=f.storage.writes.find(row=>row.value?.kind==='pointer_write_not_started');
  assert.ok(proof);assert.equal(proof.value.writeStarted,false);assert.equal(proof.condition.ifNoneMatch,'*');
});

test('failed abort or a changed actual base retains pending protection and never claims an unstarted write was cleaned up',async()=>{
  for(const changeBase of [false,true]) {
    const f=fixture(),p=await published(f);enableCoordination(f);
    const state=f.storage.values.get(RAW_COORDINATION_KEY);state.catalog.current=rawCatalogDescriptor(f.next);
    f.storage.seed(RAW_COORDINATION_KEY,state);
    const prepared=await prepareDubicarsDeltaCursorCommit({storage:f.storage,intake:f.intake,...p});let expired=false;
    const newer=structuredClone(f.base);newer.sources[0].cursor=400000;
    f.storage.beforeWrite=async(key,value)=>{
      if(key!==RAW_COORDINATION_KEY)return;
      const pending=value.pointers.find(row=>row.id==='intake_cursor:uae').pending;
      if(!expired&&pending) {
        expired=true;f.storage.seed('catalog/import-lock.json',{lockedUntil:''});
        if(changeBase)f.storage.seed(DUBICARS_CURSOR_KEY,newer);
      } else if(expired&&!pending)throw Error('abort_unavailable');
    };
    await assert.rejects(commitRawPointer({storage:f.storage,id:'intake_cursor:uae',key:DUBICARS_CURSOR_KEY,
      value:p.checkpoint,references:[],complete:false,owner,operationId:'test-cursor',...prepared}),/prewrite_abort_pending/);
    assert.ok(f.storage.values.get(RAW_COORDINATION_KEY).pointers.find(row=>row.id==='intake_cursor:uae').pending);
    assert.ok(!f.storage.writes.some(row=>row.key===DUBICARS_CURSOR_KEY));
    assert.deepEqual(await f.storage.readJson(DUBICARS_CURSOR_KEY,null),changeBase?newer:f.base);
  }
});

test('real coordinated archive/publication/cursor chain commits under the lease and replays without extra writes',async()=>{
  const f=fixture();enableCoordination(f);
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dubicars-cursor-'));
  const keys=['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA'],saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{GITHUB_RUN_ID:owner.runId,GITHUB_RUN_ATTEMPT:owner.attempt,GITHUB_SHA:owner.revision});
  try {
    await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(f.plain));
    await fs.writeFile(path.join(directory,'source-000001.jsonl'),'{}\n');
    const archive=await archiveIntakeDirectory({storage:f.storage,directory,market:'uae',owner});
    f.intake=attachIntakeArchiveReceipt(f.plain,archive);
    const paidReports={generationId:f.current.generationId,manifestSha256:rawDigest(f.current),market:'korea',count:0,
      paidCount:0,chunkProofs:[],observations:[],references:[]};
    const proof=buildRawGenerationProvenance({manifest:f.current,paidReports});
    f.storage.seed(rawGenerationKey(f.current.generationId),proof);
    const state=f.storage.values.get(RAW_COORDINATION_KEY);state.catalog.current=rawCatalogDescriptor(f.current,proof);
    f.storage.seed(RAW_COORDINATION_KEY,state);
    f.guard=createDubicarsDeltaCursorGuard({storage:f.storage,intake:f.intake,operationId});await f.guard.capture();
    const staged=await prepareRawPublication({storage:f.storage,manifest:f.next,expectedBaseGenerationId:f.current.generationId,
      market:'uae',intake:f.intake,owner,operationId});
    await staged.verify();await f.guard.verify();
    f.storage.seed('catalog/previous-manifest.json',f.current);f.storage.seed('catalog/manifest.json',f.next);
    const publication={published:true,market:'uae',generationId:f.next.generationId,dubicarsCursor:f.guard.receipt(f.next),
      rawCoordination:staged.binding,rawPinRelease:await staged.afterCommit()};
    const checkpoint=publishedIntakeCheckpoint(f.intake,publication);
    const result=await commitCoordinatedIntakeCursor({storage:f.storage,intake:f.intake,publication,checkpoint,owner});
    assert.equal(result.cursorCommitted,true);assert.equal(result.rawPinRelease.status,'pins_released');
    const pointer=f.storage.values.get(RAW_COORDINATION_KEY).pointers.find(row=>row.id==='intake_cursor:uae');
    assert.equal(pointer.pending,null);assert.equal(pointer.current.sha256,rawDigest(checkpoint));
    const written=f.storage.writes.length;f.storage.seed('catalog/import-lock.json',{lockedUntil:''});
    assert.equal((await commitCoordinatedIntakeCursor({storage:f.storage,intake:f.intake,publication,checkpoint,owner})).idempotent,true);
    assert.equal(f.storage.writes.length,written);
  } finally {
    for(const key of keys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];
    await fs.rm(directory,{recursive:true,force:true});
  }
});

test('Europe opaque cursors keep their existing semantics',async()=>{
  const storage=new MemoryStorage(),intake={version:1,market:'europe',completed:true,completedAt:'2026-11-22T22:25:00Z',
    sources:[{sourceId:'autoscout_europe_open',cursor:'route:page:opaque',stopReason:'source_finished'}]};
  const publication={market:'europe',published:true,generationId:'gen_1002_test'},checkpoint=publishedIntakeCheckpoint(intake,publication);
  await commitCoordinatedIntakeCursor({storage,intake,publication,checkpoint,owner});
  assert.deepEqual(await storage.readJson('catalog/intake-cursors/v1/europe.json',null),checkpoint);
  assert.equal(storage.writes.length,1);assert.deepEqual(storage.writes[0].condition,{});
});
