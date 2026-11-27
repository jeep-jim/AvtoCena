import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createChinaState, inspectChinaPublicationState} from '../scripts/catalog-next/china-state.mjs';
import {maintainChinaGenerationGcQueue} from '../scripts/catalog-next/china-generation-gc-queue.mjs';
import {createChinaGenerationGcStorage} from '../scripts/catalog-next/china-generation-gc.mjs';
import {hash, copy, ordered, empty} from './helpers/catalog-next-gc-fixture.mjs';
import {PINS, MARKER, WORKFLOW, OPERATION, verifyInvocation, verifyState, leaseOnlyStorage, verifyTask,
  scopedQueueStorage, aggregateGc, readDeadline, runRetention}
  from '../scripts/catalog-next/resume-china-reg-retention-45875678028.mjs';

const ROOT = fileURLToPath(new URL('../',import.meta.url));
const PRIVATE = 'private-fixture-value-never-echo';
const bytes = value => Buffer.from(JSON.stringify(ordered(value)));
function queueStore() {
  let queue = empty(), sequence = 0;
  const tasks = new Map(), calls = [];
  const save = value => ({found:true,etag:'"q-' + ++sequence + '"',sha256:hash(bytes(value)),value:copy(value)});
  return {tasks,calls,
    assertPrivateBucket:async()=>({verified:true}),
    readQueue:async()=>copy(queue),
    async compareAndSwapQueue(previous,next) {
      assert.equal(previous.etag,queue.etag); assert.equal(previous.sha256,queue.sha256);
      calls.push('queue-cas'); queue=save(next);
    },
    async readTask(id) { const value=tasks.get(id); return value
      ? {found:true,etag:value.etag,data:Buffer.from(value.data),size:value.data.length} : {found:false}; },
    async createTask(id,data,condition) {
      assert.deepEqual(condition,{ifNoneMatch:'*'}); assert(!tasks.has(id)); calls.push('task-create');
      tasks.set(id,{etag:'"task-' + ++sequence + '"',data:Buffer.from(data)});
    },
    async deleteTask(id,condition) {
      const value=tasks.get(id); assert(value); assert.equal(condition.expectedETag,value.etag);
      assert.equal(condition.expectedSha256,hash(value.data)); calls.push('task-delete'); tasks.delete(id);
      return {settled:true,deleted:true};
    },
    current:()=>copy(queue),
    replace:value=>{queue=save(value);}
  };
}
async function fixture({codeAccepted=true,japanAccepted=codeAccepted,japanRuntime=PINS.expectedRuntime}={}) {
  const values=new Map(), writes=[], calls=[], reports=[];
  let sequence=0, setup=true, clock=Date.parse('2026-11-27T00:00:00.000Z'), callback;
  const storage={
    assertPrivateBucket:async()=>({verified:true}),
    read:async name=>copy(values.get(name)??empty()),
    async compareAndSwap(name,previous,value) {
      if(!setup) assert.equal(name,'lease','maintenance cannot publish state');
      const old=values.get(name)??empty(); assert.equal(old.etag,previous.etag); assert.equal(old.sha256,previous.sha256);
      writes.push(name); values.set(name,{found:true,etag:'"' + PRIVATE + '-' + ++sequence + '"',sha256:hash(bytes(value)),value:copy(value)});
    }
  };
  const now=()=>new Date(clock).toISOString(), state=createChinaState({storage,now});
  const b={market:'china',generationId:PINS.b,owner:PINS.bOwner,receiptSha256:PINS.bReceipt,
    sourceDescriptorSha256:'c771d329f4da26885ebe0939a02ec283a2efa7b7788d8edb095dcee88674a48e',
    generationManifestSha256:'b'.repeat(64),sourceCursor:13313207,sourceObservedAt:'2026-11-25T17:34:57.542Z',
    runtimeSha:PINS.retainedRuntime,pricingRuntimeSha:PINS.pricing,imageId:'sha256:'+'5'.repeat(64)};
  const c={...b,generationId:PINS.current,owner:PINS.currentOwner,receiptSha256:PINS.currentReceipt,
    sourceDescriptorSha256:PINS.currentDescriptor,generationManifestSha256:PINS.currentManifest,
    sourceCursor:PINS.currentCursor,sourceObservedAt:PINS.currentSourceDate};
  async function publish(candidate,code=false) {
    const nonce=String(sequence%8+1).repeat(32);
    const lease=await state.acquireLease({previous:await state.read('lease'),owner:candidate.owner,nonce,
      expiresAt:new Date(clock+3600000).toISOString()});
    const staged=await state.reserve({lease,previous:await state.read('accepted'),previousIntent:await state.read('intent'),
      candidate,...(code?{transition:'code-update'}:{})});
    const speed=Buffer.from(JSON.stringify({release:candidate.runtimeSha,passed:true,browserPassed:true,speedGuard:{passed:true}}));
    const detail=Buffer.from(JSON.stringify({kind:'china-browser-details-v1',release:candidate.runtimeSha,nonce,passed:true,
      generationManifestSha256:candidate.generationManifestSha256,precedingSpeedReportSha256:hash(speed)}));
    const receipt={version:1,kind:'china-host-acceptance-v1',nonce,release:candidate.runtimeSha,imageId:candidate.imageId,
      pricingRuntimeSha:candidate.pricingRuntimeSha,generationId:candidate.generationId,
      generationManifestSha256:candidate.generationManifestSha256,privateGenerationReceiptSha256:candidate.receiptSha256,
      sourceDescriptorSha256:candidate.sourceDescriptorSha256,sourceCursor:candidate.sourceCursor,
      sourceObservedAt:candidate.sourceObservedAt,acceptedAt:now(),retainedContainerId:'7'.repeat(64),
      browser:{release:candidate.runtimeSha,nonce,passed:true,functionalPassed:true,speedPassed:true,
        speedReportSha256:hash(speed),detailsReportSha256:hash(detail),reportSha256:hash(Buffer.concat([speed,detail]))}};
    if(code) Object.assign(receipt,{transition:'code-update',previousAcceptedETag:staged.intent.value.previous.etag,
      previousAcceptedStateSha256:staged.intent.value.previous.sha256,
      retainedRuntimeSha:staged.intent.value.previous.value.current.runtimeSha,
      retainedImageId:staged.intent.value.previous.value.current.imageId});
    const raw=Buffer.from(JSON.stringify(receipt));
    await state.commit({lease,...staged,evidence:{hostReceiptBase64:raw.toString('base64'),hostReceiptSha256:hash(raw),
      browserSpeedBytes:speed,browserDetailsBytes:detail}});
    await state.releaseLease({lease});
  }
  await publish(b); await publish(c);
  const beforeCode={accepted:await state.read('accepted'),intent:await state.read('intent')};
  const q=queueStore();
  if(codeAccepted) {
    await publish({...c,runtimeSha:PINS.codeRuntime,imageId:'sha256:'+'6'.repeat(64)},true);
    // Preserve B using its authentic a5ca publication witness before the next
    // code acceptance moves the rollback from 077 to a5ca.
    const historical={accepted:await state.read('accepted'),intent:await state.read('intent')};
    const remembered=await maintainChinaGenerationGcQueue({mode:'enqueue-only',queueStorage:q,
      readState:async()=>historical,assertAuthority:async()=>{},now});
    assert.equal(remembered.completed,true);assert.equal(remembered.pending,1);
  }
  if(japanAccepted) await publish({...c,runtimeSha:japanRuntime,imageId:'sha256:'+'8'.repeat(64)},true);
  const expected={accepted:await state.read('accepted'),intent:await state.read('intent')};
  setup=false; writes.length=0;q.calls.length=0;
  const environment={GITHUB_RUN_ID:'45900000001',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'a'.repeat(40),RUNNER_TEMP:'/tmp'};
  const f={storage,state,values,writes,calls,reports,q,environment,expected,beforeCode,now,
    advance:milliseconds=>{clock+=milliseconds;},
    heartbeat:async()=>{callback?.(); await Promise.resolve();},
    async collector(args) {
      calls.push('collect'); await args.assertAuthority();
      assert.equal(args.previousAccepted.value.rollback.generationId,PINS.b);
      return {completed:true,generationId:PINS.b,retirementSha256:hash('fixture-retirement'),deletedObjects:2,deletedBytes:1500,alreadyAbsentObjects:0};
    },
    async host(args) {
      calls.push('host'); await args.args.assertAuthority(); assert.equal(args.args.task.reference.generationId,PINS.b);
      return {completed:true,retiredContainers:0,filesDeleted:0,freedBytes:0};
    },
    options(extra={}) {
      return {root:ROOT,environment,now,scheduleHeartbeat:fn=>{callback=fn;return()=>{callback=null;};},
        capabilities:{
          verifyInvocation:()=>({version:1,event:'push',sourceSha:environment.GITHUB_SHA}),
          createStorage:()=>storage,createQueueStorage:()=>q,
          readDeadline:()=>new Date(clock+20*60000).toISOString(),
          collectQueue:args=>maintainChinaGenerationGcQueue({...args,collect:input=>f.collector(input)}),
          retireHost:args=>f.host(args),writeReport:value=>{reports.push(copy(value));},...extra
        }};
    }
  };
  return f;
}

function deferred() {
  let resolve, reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

test('exact marker-only invocation is required; foreign workflow/repository/ref/attempt/manual/dirty source fail',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'china-retention-guard-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','-q']); git(['config','user.name','Fixture']); git(['config','user.email','fixture@example.invalid']);
  await fs.writeFile(path.join(root,'controller.txt'),'reviewed'); git(['add','controller.txt']); git(['commit','-qm','reviewed controller']);
  const approved=git(['rev-parse','HEAD']);
  await fs.mkdir(path.dirname(path.join(root,MARKER)),{recursive:true});
  await fs.writeFile(path.join(root,MARKER),JSON.stringify({version:1,operation:OPERATION,approvedSourceSha:approved}));
  git(['add',MARKER]);git(['commit','-qm','authorized marker']);
  const head=git(['rev-parse','HEAD']),event=path.join(root,'event.json');
  await fs.writeFile(event,JSON.stringify({before:approved,after:head,ref:'refs/heads/main',created:false,deleted:false,forced:false}));
  const env={GITHUB_REPOSITORY:'jeep-jim/AvtoCena',GITHUB_REPOSITORY_ID:'1289722938',GITHUB_REF:'refs/heads/main',
    GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'push',GITHUB_SHA:head,GITHUB_EVENT_PATH:event,GITHUB_WORKFLOW_REF:WORKFLOW,GITHUB_JOB:'resume-retention'};
  assert.equal(verifyInvocation({root,environment:env}).approvedSourceSha,approved);
  for(const patch of [{GITHUB_WORKFLOW_REF:'other'}, {GITHUB_JOB:'verify'}, {GITHUB_REPOSITORY:'someone/AvtoCena'},
    {GITHUB_REPOSITORY_ID:'1'},{GITHUB_REF:'refs/heads/other'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_EVENT_NAME:'workflow_dispatch'}])
    assert.throws(()=>verifyInvocation({root,environment:{...env,...patch}}));
  await fs.writeFile(path.join(root,'controller.txt'),'unreviewed');
  assert.throws(()=>verifyInvocation({root,environment:env}));
});

test('lease-only storage rejects publication CAS and foreign read names before transport',()=>{
  const calls=[];
  const storage=leaseOnlyStorage({assertPrivateBucket(){},read:name=>calls.push(name),compareAndSwap:name=>calls.push(name)});
  for(const name of ['accepted','intent','catalog/manifest.json']) assert.throws(()=>storage.compareAndSwap(name,{},{}));
  assert.throws(()=>storage.read('arbitrary-private-key'));assert.deepEqual(calls,[]);
  storage.compareAndSwap('lease',{},{});assert.deepEqual(calls,['lease']);
});

test('A is bound to the known task hash; B is bound to the exact owner and receipt; unknown targets fail',()=>{
  const a={version:1,kind:'china-generation-gc-task-v1',market:'china',id:PINS.aTask,
    reference:{market:'china',generationId:PINS.a,owner:{runId:'45369451603',attempt:'1',revision:'1'.repeat(40)},receiptSha256:'2'.repeat(64)}};
  assert.equal(verifyTask(a).generationId,PINS.a);
  assert.throws(()=>verifyTask({...a,id:'3'.repeat(64)}));
  const b={...a,id:'4'.repeat(64),reference:{market:'china',generationId:PINS.b,owner:PINS.bOwner,receiptSha256:PINS.bReceipt}};
  assert.equal(verifyTask(b).generationId,PINS.b);
  for(const reference of [{...b.reference,generationId:'gen_china_999_1'},
    {...b.reference,owner:{...PINS.bOwner,revision:'f'.repeat(40)}},
    {...b.reference,receiptSha256:'f'.repeat(64)},{...b.reference,market:'korea'}])
    assert.throws(()=>verifyTask({...b,reference}));
});

test('actual state CAS and actual GC queue drain B after code acceptance; repeated cleanup is idempotent',async()=>{
  const f=await fixture(),first=await runRetention(f.options());
  assert.equal(first.completed,true);assert.equal(first.leaseReleased,true);
  assert.equal(first.retention.collected,1);assert.equal(first.retention.pending,0);
  assert.equal(first.retention.deletedObjects,2);assert.equal(f.q.tasks.size,0);
  assert.deepEqual(f.calls,['host','collect']);assert(f.writes.every(name=>name==='lease'));
  assert.deepEqual(await f.storage.read('accepted'),f.expected.accepted);
  assert.deepEqual(await f.storage.read('intent'),f.expected.intent);
  const second=await runRetention(f.options());
  assert.equal(second.completed,true);assert.equal(second.retention.collected,0);
  assert.deepEqual(f.calls,['host','collect']);
  assert.equal(JSON.stringify(first).includes(PRIVATE),false);
  for(const key of ['supplierRequests','sourcePreparations','applicationBuilds','publicationReservations','acceptedStateWrites','intentStateWrites'])
    assert.equal(first[key],0);
});

test('old accepted077 C with protected rollback B is outside this exact maintenance profile',async()=>{
  const f=await fixture({codeAccepted:false}),report=await runRetention(f.options());
  assert.equal(report.completed,false);assert.equal(report.errorCode,'current_binding');assert.equal(report.leaseReleased,true);
  assert.deepEqual(f.calls,[]);assert.equal(f.q.calls.length,0);
});

test('the retained runtime alone and a candidate with the historical rollback cannot authorize cleanup',async()=>{
  for(const options of [{japanAccepted:false},{codeAccepted:false,japanAccepted:true}]){
    const f=await fixture(options),before=f.q.current(),report=await runRetention(f.options());
    assert.equal(report.completed,false);assert.equal(report.leaseReleased,true);
    assert.equal(report.errorCode,options.codeAccepted===false?'rollback_binding':'current_binding');
    assert.deepEqual(f.calls,[]);assert.equal(f.q.calls.length,0);assert.deepEqual(f.q.current(),before);
  }
});

test('a valid previous Japan runtime with the expected rollback is rejected before host or GC work',async()=>{
  const previousRuntime='73321a180c16d1d432559d572a2ac2b7fdf5cc2b';
  assert.notEqual(previousRuntime,PINS.expectedRuntime);
  // Build an authentic accepted pair through reserve/commit and its matching
  // host proofs. Editing runtimeSha on an existing receipt would only test a
  // corrupt proof, not rejection of a valid but unapproved runtime.
  const f=await fixture({japanRuntime:previousRuntime});
  assert.equal(inspectChinaPublicationState(f.expected).status,'resolved');
  assert.equal(f.expected.intent.value.status,'committed');
  assert.equal(f.expected.accepted.value.pending,null);
  assert.equal(f.expected.accepted.value.current.runtimeSha,previousRuntime);
  assert.equal(f.expected.accepted.value.rollback.runtimeSha,PINS.expectedRollbackRuntime);
  const stateBefore=copy([...f.values]),queueBefore=f.q.current(),tasksBefore=JSON.stringify([...f.q.tasks]);
  assert.throws(()=>verifyState(f.expected),/china_retention_resume_current_binding/);
  assert.deepEqual([...f.values],stateBefore);assert.deepEqual(f.writes,[]);
  assert.deepEqual(f.calls,[]);assert.equal(f.q.calls.length,0);
  const report=await runRetention(f.options({createQueueStorage:()=>{assert.fail('must reject before opening the GC queue');}}));
  assert.equal(report.completed,false);assert.equal(report.errorCode,'current_binding');
  assert.equal(report.leaseAcquired,true);assert.equal(report.leaseReleased,true);
  assert.deepEqual(f.writes,['lease','lease']);
  assert.deepEqual(await f.storage.read('accepted'),f.expected.accepted);
  assert.deepEqual(await f.storage.read('intent'),f.expected.intent);
  assert.deepEqual(f.calls,[]);assert.equal(f.q.calls.length,0);
  assert.deepEqual(f.q.current(),queueBefore);assert.equal(JSON.stringify([...f.q.tasks]),tasksBefore);
});

test('foreign queue item fails before host/collector and leaves the exact queue intact',async()=>{
  const f=await fixture();
  f.q.replace({version:1,kind:'china-generation-gc-queue-v1',market:'china',revision:1,rememberedPublication:null,items:[
    {id:'1'.repeat(64),generationId:'gen_china_999_1',owner:{runId:'999',attempt:'1',revision:'2'.repeat(40)},
      receiptSha256:'3'.repeat(64),publicationNonce:'4'.repeat(32),taskSha256:'5'.repeat(64),phase:'pending'}]});
  const before=f.q.current(),report=await runRetention(f.options());
  assert.equal(report.completed,false);assert.equal(report.leaseReleased,true);assert.deepEqual(f.calls,[]);
  assert.deepEqual(f.q.current(),before);assert.equal(f.q.calls.length,0);
});

for(const mode of ['transport','unknown']) test('collector '+mode+' preserves durable task and releases lease, then resumes through existing queue',async()=>{
  const f=await fixture(),good=f.collector;
  f.collector=async args=>{
    await args.assertAuthority();const error=Error(mode==='transport'?'china_gc_storage_transport':'china_gc_delete_outcome_unknown');
    error.report={status:mode==='unknown'?'needs_reconciliation':'paused',deletedObjects:0,deletedBytes:0,alreadyAbsentObjects:0};
    throw error;
  };
  const first=await runRetention(f.options());
  assert.equal(first.completed,false);assert.equal(first.leaseReleased,true);assert.equal(first.retention.pending,1);
  assert.equal(first.retention.status,mode==='unknown'?'needs_reconciliation':'paused');
  assert.equal(f.q.tasks.size,1);const id=f.q.current().value.items[0].id;
  f.collector=good;
  const second=await runRetention(f.options());assert.equal(second.completed,true);assert.equal(second.retention.pending,0);
  assert(!f.q.tasks.has(id));assert.deepEqual(await f.storage.read('accepted'),f.expected.accepted);
});

test('host refusal cannot fall through to REG deletion and a changed accepted observation stops later work',async()=>{
  for(const mode of ['host','state']){
    const f=await fixture();
    f.host=async args=>{
      await args.args.assertAuthority();
      if(mode==='host') throw Error(PRIVATE);
      const changed=copy(f.values.get('accepted'));changed.value.revision++;changed.sha256=hash(bytes(changed.value));
      changed.etag='"changed"';f.values.set('accepted',changed);
      return {completed:true,retiredContainers:0,filesDeleted:0,freedBytes:0};
    };
    const report=await runRetention(f.options());
    assert.equal(report.completed,false);assert.equal(report.leaseReleased,true);
    assert(!f.calls.includes('collect'));assert.equal(f.q.tasks.size,1);
    assert(!JSON.stringify(report).includes(PRIVATE));
  }
});

test('foreign lease replacement is never released or used to continue collection',async()=>{
  const f=await fixture();
  f.host=async()=>{
    const foreign=copy(f.values.get('lease'));foreign.value.owner={runId:'9999',attempt:'1',revision:'f'.repeat(40)};
    foreign.value.nonce='f'.repeat(32);foreign.value.epoch++;foreign.sha256=hash(bytes(foreign.value));
    foreign.etag='"foreign"';f.values.set('lease',foreign);
    return {completed:true,retiredContainers:0,filesDeleted:0,freedBytes:0};
  };
  const report=await runRetention(f.options());
  assert.equal(report.completed,false);assert.equal(report.leaseReleased,false);assert.equal(report.leaseReleasePending,true);
  assert.equal((await f.storage.read('lease')).value.owner.runId,'9999');
  assert.equal((await f.storage.read('lease')).value.status,'held');assert(!f.calls.includes('collect'));
});


test('first heartbeat renewal failure survives later authority checks while the owned lease remains valid',{timeout:5000},async()=>{
  const f=await fixture(), entered=deferred(), finish=deferred(), renewalFailed=deferred();
  const originalCas=f.storage.compareAndSwap.bind(f.storage);
  let collectorArgs, renewalAttempts=0;
  f.storage.compareAndSwap=async(name,previous,next)=>{
    if(name==='lease' && previous.value?.status==='held' && next.status==='held'){
      renewalAttempts++;renewalFailed.resolve();
      throw Error('china_state_storage_transport');
    }
    return originalCas(name,previous,next);
  };
  f.collector=async args=>{
    collectorArgs=args;entered.resolve();await finish.promise;
    await args.assertAuthority();
    throw Error('collector_must_not_continue_after_authority_failure');
  };
  const running=runRetention(f.options());
  await entered.promise;f.advance(8*60000);await f.heartbeat();await renewalFailed.promise;
  await assert.rejects(collectorArgs.assertAuthority,/china_retention_resume_lease_lost/);
  await f.heartbeat();
  const held=await f.storage.read('lease');
  assert.equal(held.value.status,'held');assert.equal(held.value.owner.runId,f.environment.GITHUB_RUN_ID);
  assert(Date.parse(held.value.expiresAt)>Date.parse(f.now()));
  finish.resolve();
  const report=await running;
  assert.equal(report.completed,false);assert.equal(report.errorCode,'lease_lost');
  assert.deepEqual(report.authorityFailure,{phase:'lease_renew',reason:'write_not_committed'});
  assert.equal(renewalAttempts,1);assert.equal(report.leaseReleased,true);
  assert.equal(report.gcTransportFailure,undefined);
  assert.equal(report.retention.pending,1);assert.equal(f.q.tasks.size,1);
  assert.deepEqual(await f.storage.read('accepted'),f.expected.accepted);
  assert.deepEqual(await f.storage.read('intent'),f.expected.intent);
  assert(f.writes.every(name=>name==='lease'));
  assert(!JSON.stringify(report).includes(PRIVATE));
});

test('independent collector transport and heartbeat read failure retain separate bounded causes',{timeout:5000},async()=>{
  const f=await fixture(), transport=deferred(), started=deferred(), heartbeatFailed=deferred();
  const originalRead=f.storage.read.bind(f.storage);
  let collectorArgs, failLeaseRead=false, requests=0;
  f.storage.read=async name=>{
    if(name==='lease' && failLeaseRead){
      failLeaseRead=false;heartbeatFailed.resolve();throw Error('china_state_storage_transport');
    }
    return originalRead(name);
  };
  f.collector=async args=>{
    collectorArgs=args;await args.assertAuthority();
    const storage=createChinaGenerationGcStorage({owner:args.previousAccepted.value.rollback.owner,
      assertAuthority:args.assertAuthority,fetcher:args.fetcher,environment:{
        YC_OBJECT_STORAGE_ENDPOINT:'https://s3.regru.cloud',YC_OBJECT_STORAGE_REGION:'us-east-1',
        YC_OBJECT_STORAGE_BUCKET:'avtocena-staging-8120751',YC_OBJECT_STORAGE_PREFIX:'migration-staging/full-20261011/',
        YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:PRIVATE}});
    await storage.assertPrivateBucket();
    throw Error('collector_must_not_continue_after_transport_failure');
  };
  const running=runRetention({...f.options(),fetcher:async(_url,options)=>{
    requests++;assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    assert.equal(options.signal.aborted,false);started.resolve();return transport.promise;
  }});
  await started.promise;failLeaseRead=true;await f.heartbeat();await heartbeatFailed.promise;
  await assert.rejects(collectorArgs.assertAuthority,/china_retention_resume_lease_lost/);
  const held=await f.storage.read('lease');
  assert.equal(held.value.status,'held');assert.equal(held.value.owner.runId,f.environment.GITHUB_RUN_ID);
  transport.reject(new TypeError(PRIVATE,{cause:{code:'ECONNRESET',message:PRIVATE,secret:PRIVATE}}));
  const report=await running;
  assert.equal(report.completed,false);assert.equal(report.errorCode,'lease_lost');
  assert.deepEqual(report.authorityFailure,{phase:'lease_read',reason:'storage_transport'});
  assert.equal(report.retention.errorCode,'storage_transport');
  assert.equal(report.gcTransportFailure.category,'connection');assert.equal(report.gcTransportFailure.method,'GET');
  assert(Number.isSafeInteger(report.gcTransportFailure.durationMs) && report.gcTransportFailure.durationMs>=0);
  assert.deepEqual(Object.keys(report.gcTransportFailure).sort(),['category','durationMs','method']);
  assert.equal(requests,1);assert.equal(report.leaseReleased,true);
  assert.equal(report.retention.pending,1);assert.equal(f.q.tasks.size,1);
  assert.deepEqual(await f.storage.read('accepted'),f.expected.accepted);
  assert.deepEqual(await f.storage.read('intent'),f.expected.intent);
  assert(f.writes.every(name=>name==='lease'));
  assert(!JSON.stringify(report).includes(PRIVATE));
});

test('deadline stops before collector while renewed owned lease is released in finally',async()=>{
  const f=await fixture();
  f.host=async args=>{await args.args.assertAuthority();f.advance(11*60000);
    return {completed:true,retiredContainers:0,filesDeleted:0,freedBytes:0};};
  const report=await runRetention(f.options({collectQueue:async args=>{
    f.advance(10*60000);await args.assertAuthority();
    return maintainChinaGenerationGcQueue({...args,collect:input=>f.collector(input)});
  }}));
  assert.equal(report.completed,false);assert.equal(report.retention.status,'deadline');
  assert.equal(report.leaseReleased,true);assert(!f.calls.includes('collect'));
  assert.equal((await f.storage.read('lease')).value.status,'released');
});

test('an existing held lease is a clean refusal with no queue or host access',async()=>{
  const f=await fixture();
  const held=await f.state.acquireLease({previous:await f.state.read('lease'),owner:{runId:'9999',attempt:'1',revision:'f'.repeat(40)},
    nonce:'f'.repeat(32),expiresAt:new Date(Date.parse(f.now())+600000).toISOString()});
  const report=await runRetention(f.options());
  assert.equal(report.status,'lease_busy');assert.equal(report.leaseAcquired,false);
  assert.deepEqual(await f.storage.read('lease'),held);assert.deepEqual(f.calls,[]);assert.equal(f.q.calls.length,0);
});

test('deadline is bound to the actual successful verify job and in-progress cleanup job',async()=>{
  const environment={GITHUB_RUN_ID:'123',GITHUB_SHA:'a'.repeat(40),GITHUB_TOKEN:PRIVATE};
  const start=Date.parse('2026-11-27T00:00:00.000Z');
  const jobs=[
    {name:'verify',run_id:123,head_sha:environment.GITHUB_SHA,status:'completed',conclusion:'success'},
    {name:'resume-retention',run_id:123,head_sha:environment.GITHUB_SHA,status:'in_progress',conclusion:null,started_at:new Date(start).toISOString()}];
  let calls=0;
  const fetcher=async(url,options)=>{
    calls++;assert.equal(url,'https://api.github.com/repos/jeep-jim/AvtoCena/actions/runs/123/jobs?filter=latest&per_page=100');
    assert.equal(options.redirect,'error');return new Response(JSON.stringify({total_count:2,jobs}),{status:200});
  };
  assert.equal(await readDeadline({environment,fetcher,now:()=>start+60000}),new Date(start+28*60000).toISOString());
  jobs[0].conclusion='failure';await assert.rejects(readDeadline({environment,fetcher,now:()=>start+60000}));
  jobs[0].conclusion='success';await assert.rejects(readDeadline({environment,fetcher,now:()=>start+29*60000}));
  assert.equal(calls,3);
});

test('aggregate projection never echoes private task/error/proof fields',()=>{
  const value={version:1,kind:'china-generation-gc-queue-report-v1',market:'china',mode:'drain',completed:false,
    status:'paused',pending:1,otherMarketWrites:0,encyclopediaWrites:0,liveCatalogWrites:0,
    enqueued:0,collected:0,pruned:0,deletedObjects:0,deletedBytes:0,alreadyAbsentObjects:0,
    hostCleanupsCompleted:0,retiredContainers:0,filesDeleted:0,freedBytes:0,errorCode:PRIVATE,
    uncertainKey:PRIVATE,receiptBase64:PRIVATE,errors:[{private:PRIVATE}]};
  const result=aggregateGc(value);assert.equal(result.errorCode,'operation_failed');assert(!JSON.stringify(result).includes(PRIVATE));
  assert.throws(()=>aggregateGc({...value,completed:true,status:'complete',pending:1}));
});

test('workflow gates all offline controller tests before secrets and has no source/build/release commands',async()=>{
  const text=await fs.readFile(path.join(ROOT,'.github/workflows/china-reg-retention-resume-45875678028.yml'),'utf8');
  assert.match(text,/group: catalog-next-china/);assert.match(text,/needs: verify/);
  assert.match(text,/tests\/catalog-next-\*\.test\.mjs tests\/release-speed-guard-contract\.test\.mjs/);
  const verify=text.slice(text.indexOf('  verify:'),text.indexOf('  resume-retention:'));
  assert(!verify.includes('secrets.'));assert(!verify.includes('environment: regcloud-staging'));
  assert(!/AUTO_API|refresh_complete_source|prepare-generation|--checkout|npm run build|docker build|stageRelease|activate/.test(text));
  assert.match(text,/fetch-depth: 2/);assert.match(text,/node --import tsx scripts\/catalog-next\/resume-china-reg-retention-45875678028\.mjs --run/);
  assert.doesNotMatch(text.slice(0,text.indexOf('jobs:')), /^concurrency:/m);
  const production=text.slice(text.indexOf('  resume-retention:'));
  assert.match(production,/concurrency:\n\s+group: catalog-next-china/);
});
