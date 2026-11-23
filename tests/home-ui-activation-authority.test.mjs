import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireHomeAuthority,resumeHomeAuthority,waitForHomePublication} from '../.github/operations/home-ui-activation-20261123/authority.mjs';

test('an existing index preparation delays the release until both checks succeed', async () => {
  let checks=0, attempts=0;
  const waited=[];
  const result=await waitForHomePublication(async()=>{
    if(++checks===1)throw Error('home_evidence_other_workflow_active');
    return {otherWriterRuns:0};
  },async()=>{
    if(++attempts===1)throw Error('home_authority_publisher_busy');
    return {generationId:'latest'};
  },async reason=>{waited.push(reason);});
  assert.deepEqual(waited,['home_evidence_other_workflow_active','home_authority_publisher_busy']);
  assert.deepEqual(result,{quiescence:{otherWriterRuns:0},authority:{generationId:'latest'}});
  assert.equal(checks,3);
  await assert.rejects(waitForHomePublication(async()=>{throw Error('home_evidence_historical_run_changed');},
    ()=>assert.fail('acquisition attempted'),()=>assert.fail('unexpected retry')),/historical_run_changed/);
});
import {HOME_UI} from '../.github/operations/home-ui-only-20261123/contract.mjs';

function fixture() {
  let clock = Date.parse('2026-11-23T10:00:00Z'), version = 1, live = HOME_UI.retainedSource;
  const values = new Map([['catalog/import-lock.json',{lockedUntil:''}],
    ['catalog/manifest.json',{version:2,generationId:'gen_1790000000000_fixture',markets:{korea:{count:2,chunks:['public-shard']}}}]]);
  const writes = [];
  const storage = {driver:'object', async readJsonWithMeta(key, fallback) {
    return {found:values.has(key), etag:key === 'catalog/manifest.json' ? 'manifest-etag' : String(version),
      value:structuredClone(values.get(key) ?? fallback)};
  }, async writeJson(key, value, condition) {
    assert.equal(key, 'catalog/import-lock.json'); assert.deepEqual(condition, {ifMatch:String(version)});
    writes.push({key,value:structuredClone(value),condition}); version++; values.set(key,structuredClone(value));
  }};
  return {storage, values, writes, now:()=>clock, tick:ms=>clock+=ms, setLive:value=>live=value,
    options:{storage,nonce:'a'.repeat(32),now:()=>clock,heartbeat:false,
      readLiveIdentity:async()=>({release:live,calculationVersion:HOME_UI.servingCalculationVersion})}};
}

test('owned lease uses conditional writes, captures the actual manifest and retains calculator identity', async () => {
  const f = fixture(), authority = await acquireHomeAuthority(f.options);
  assert.equal(authority.generationId,'gen_1790000000000_fixture');
  await authority.guard(); f.tick(60000); await authority.renew();
  f.setLive(HOME_UI.source);
  await assert.rejects(authority.guard(),/runtime_changed/);
  authority.setIngress('candidate'); await authority.guard();
  await authority.release(); await authority.release();
  assert.equal(f.writes.length,3);
  assert.equal(f.values.get('catalog/import-lock.json').lockedUntil,'');
  assert.ok(f.writes.every(row=>row.key==='catalog/import-lock.json'));
});

test('a busy/invalid publisher or acquire conflict cannot reach a manifest or write over its owner', async () => {
  for (const until of ['2026-11-23T11:00:00Z','not-a-date']) {
    const f = fixture(); f.values.set('catalog/import-lock.json',{operationId:'foreign',lockedUntil:until});
    await assert.rejects(acquireHomeAuthority(f.options),/publisher_busy|invalid_existing_lease/);
    assert.deepEqual(f.writes,[]);
  }
  const f=fixture();f.storage.writeJson=async()=>{throw Error('private transport detail');};
  await assert.rejects(acquireHomeAuthority(f.options),{message:'home_authority_acquire_conflict'});
});

test('same-generation content change, foreign owner and expired ownership fail closed without data writes', async () => {
  const f=fixture(), authority=await acquireHomeAuthority(f.options);
  f.values.get('catalog/manifest.json').markets.korea.count++;
  await assert.rejects(authority.guard(),/accepted_generation_changed/);
  f.values.get('catalog/manifest.json').markets.korea.count--;
  f.values.get('catalog/import-lock.json').operationId='foreign';
  await assert.rejects(authority.renew(),/lease_lost/);
  await assert.rejects(authority.release(),/foreign_release_refused/);
  assert.equal(f.writes.length,1);
  const expired=fixture(), own=await acquireHomeAuthority(expired.options);expired.tick(100*60000);
  await assert.rejects(own.guard(),/lease_lost/);await assert.rejects(own.renew(),/lease_lost/);
  await own.release();
});

test('the same run may resume only its unexpired preparation owner and exact manifest after artifact upload',async()=>{
  const f=fixture(),first=await acquireHomeAuthority(f.options);await first.stopHeartbeat();
  const resume={generationId:first.generationId,acceptedReadModelFingerprint:first.acceptedReadModelFingerprint};
  const second=await resumeHomeAuthority({...f.options,resume});assert.equal(f.writes.length,1);await second.guard();
  await assert.rejects(resumeHomeAuthority({...f.options,nonce:'b'.repeat(32),resume}),/resume_owner/);
  await second.release();
  await assert.rejects(resumeHomeAuthority({...f.options,resume}),/resume_owner/);
});
