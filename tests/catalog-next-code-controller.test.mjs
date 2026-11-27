import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createChinaState, inspectChinaPublicationState} from '../scripts/catalog-next/china-state.mjs';
import {runChinaCodeCycle} from '../scripts/catalog-next/code-controller.mjs';
import {runChinaDailyCycle} from '../scripts/catalog-next/daily-controller.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const copy = value => structuredClone(value);
const empty = () => ({found: false, etag: null, sha256: null, value: null});
const sourceAt = '2026-11-24T10:00:00.000Z', seedAt = '2026-11-25T10:00:00.000Z', codeAt = '2026-11-25T11:00:00.000Z';
const owner = id => ({runId: String(id), attempt: '1', revision: '1'.repeat(40)});
const plan = {version: 1, market: 'china', minimumYear: 2014, runtimeSha: 'a'.repeat(40),
  retainedRuntime: '3'.repeat(40), pricingRuntimeSha: '6'.repeat(40)};
const imageId = 'sha256:' + 'b'.repeat(64), seedNonce = '1'.repeat(32), codeNonce = '2'.repeat(32);
const reference = () => ({market: 'china', generationId: 'gen_china_1001_1', owner: owner(1001),
  receiptSha256: hash('receipt'), sourceDescriptorSha256: hash('source'), generationManifestSha256: hash('generation'),
  sourceCursor: 10, sourceObservedAt: sourceAt, runtimeSha: plan.retainedRuntime,
  pricingRuntimeSha: plan.pricingRuntimeSha, imageId: 'sha256:' + '4'.repeat(64)});

// These fixtures represent bytes returned by a mocked authenticated host. The
// real controller still validates their hashes, identities and CAS transitions.
function acceptance(ref, nonce, at, extra = {}) {
  const browserSpeedBytes = Buffer.from(JSON.stringify({release: ref.runtimeSha, passed: true, browserPassed: true, speedGuard: {passed: true}}));
  const browserDetailsBytes = Buffer.from(JSON.stringify({kind: 'china-browser-details-v1', release: ref.runtimeSha, nonce,
    passed: true, generationManifestSha256: ref.generationManifestSha256, precedingSpeedReportSha256: hash(browserSpeedBytes)}));
  const receipt = {version: 1, kind: 'china-host-acceptance-v1', release: ref.runtimeSha, pricingRuntimeSha: ref.pricingRuntimeSha,
    generationId: ref.generationId, generationManifestSha256: ref.generationManifestSha256,
    privateGenerationReceiptSha256: ref.receiptSha256, sourceDescriptorSha256: ref.sourceDescriptorSha256,
    sourceCursor: ref.sourceCursor, sourceObservedAt: ref.sourceObservedAt, imageId: ref.imageId,
    nonce, acceptedAt: at, retainedContainerId: '5'.repeat(64), browser: {release: ref.runtimeSha, nonce,
      passed: true, functionalPassed: true, speedPassed: true, speedReportSha256: hash(browserSpeedBytes),
      detailsReportSha256: hash(browserDetailsBytes), reportSha256: hash(Buffer.concat([browserSpeedBytes, browserDetailsBytes]))}, ...extra};
  const raw = Buffer.from(JSON.stringify(receipt));
  return {hostReceiptBase64: raw.toString('base64'), hostReceiptSha256: hash(raw), browserSpeedBytes, browserDetailsBytes};
}
function rollback(intent, overrides = {}) {
  const ref = intent.value.candidate, previous = intent.value.previous.value.current;
  const raw = Buffer.from(JSON.stringify({version: 1, kind: 'china-host-rollback-v1', release: ref.runtimeSha,
    pricingRuntimeSha: ref.pricingRuntimeSha, generationId: ref.generationId, generationManifestSha256: ref.generationManifestSha256,
    privateGenerationReceiptSha256: ref.receiptSha256, sourceDescriptorSha256: ref.sourceDescriptorSha256, imageId: ref.imageId,
    nonce: intent.value.nonce, previousAcceptedETag: intent.value.previous.etag, previousAcceptedStateSha256: intent.value.previous.sha256,
    rolledBackAt: codeAt, retainedContainerId: '5'.repeat(64), retainedRuntimeSha: previous.runtimeSha, retainedImageId: previous.imageId,
    retainedRunning: true, ingressRestored: true, candidateRemoved: true, ...overrides}));
  return {hostRollbackBase64: raw.toString('base64'), hostRollbackSha256: hash(raw)};
}
function memoryStorage() {
  const values = new Map(), writes = []; let sequence = 0;
  return {
    values, writes, beforeWrite: null,
    async assertPrivateBucket() { return {verified: true}; },
    async read(name) { return copy(values.get(name) ?? empty()); },
    async compareAndSwap(name, previous, value) {
      writes.push({name, previous: copy(previous), value: copy(value)});
      await this.beforeWrite?.(name, previous, value);
      const actual = await this.read(name);
      if (actual.etag !== previous.etag || actual.found !== previous.found) throw Error('fixture_conflict');
      values.set(name, {found: true, etag: '"native-' + ++sequence + '"',
        sha256: hash(JSON.stringify(ordered(value))), value: copy(value)});
    },
    force(name, value) { values.set(name, {found: true, etag: '"foreign-' + ++sequence + '"',
      sha256: hash(JSON.stringify(ordered(value))), value: copy(value)}); },
  };
}

function terminalImageReport(publication, {status = 'already_absent', reason = 'already_absent'} = {}) {
  const intent = publication.intent.value, target = intent.status === 'committed'
    ? intent.previous.value.rollback : intent.candidate;
  const removed = status === 'removed' ? 1 : 0, before = 4096, after = before + removed * 1024;
  return {version: 1, kind: 'china-terminal-app-image-cleanup-v1', completed: true, status, uncertain: false,
    imagesRemoved: removed, runtimeSha: target.runtimeSha, imageId: target.imageId,
    witnessSha256: hash(JSON.stringify(ordered(publication))), diskFreeBytesBefore: before,
    diskFreeBytesAfter: after, measuredFreeBytesChange: after - before, reason};
}
async function absentTerminalImage({publication, readState, assertAuthority}) {
  await assertAuthority(); assert.deepEqual(await readState(), publication);
  return terminalImageReport(publication);
}

async function fixture() {
  const storage = memoryStorage(), state = createChinaState({storage, now: () => seedAt});
  const lease = await state.acquireLease({previous: empty(), owner: owner(1001), nonce: seedNonce, expiresAt: '2026-11-25T10:30:00Z'});
  const first = await state.commit({lease, ...await state.reserve({lease, previous: empty(), previousIntent: empty(), candidate: reference()}),
    evidence: acceptance(reference(), seedNonce, seedAt)});
  await state.releaseLease({lease}); storage.writes.length = 0;
  const f = {storage, first, events: [], hostOutcome: null, activation: 'accept', afterStage: null, stopped: false};
  f.args = {plan, imageId, invocation: {version: 1, sourceSha: owner(2001).revision}, owner: owner(2001), storage, nonce: codeNonce,
    now: () => codeAt, scheduleHeartbeat() { return () => { f.stopped = true; }; },
    retireTerminalAppImage: absentTerminalImage,
    async preserveRetention({readState, assertAuthority}) {
      f.events.push('preserve'); await assertAuthority();
      assert.equal(inspectChinaPublicationState(await readState()).status, 'resolved');
      return {market: 'china', mode: 'enqueue-only', completed: true, witnessRemembered: true, deletedObjects: 0, collected: 0, pruned: 0};
    },
    async stageCodeRelease(input) {
      f.events.push('stage'); await input.assertAuthority();
      const {proof, ...original} = first.accepted.value.current;
      assert.deepEqual(input.candidate, {...original, runtimeSha: plan.runtimeSha, imageId});
      assert.equal((await storage.read('accepted')).value.pending, null);
      await f.afterStage?.(input);
      return {candidate: input.candidate,
        async activate({intent, reservation, assertAuthority}) {
          f.events.push('activate'); await assertAuthority();
          assert.equal((await storage.read('accepted')).etag, reservation.etag);
          assert.equal(intent.value.transition, 'code-update');
          if (f.activation === 'rollback' || f.activation === 'bad-rollback') {
            f.hostOutcome = {kind: 'rolled_back', evidence: rollback(intent,
              f.activation === 'bad-rollback' ? {retainedImageId: 'sha256:' + '9'.repeat(64)} : {})};
            throw Error('china_code_browser_failed');
          }
          if (f.activation === 'unknown') throw Error('china_code_disconnected');
          f.hostOutcome = {kind: 'accepted', evidence: acceptance(input.candidate, intent.value.nonce, codeAt,
            {transition: 'code-update', previousAcceptedETag: input.previous.etag, previousAcceptedStateSha256: input.previous.sha256,
              retainedRuntimeSha: input.previous.value.current.runtimeSha, retainedImageId: input.previous.value.current.imageId})};
          if (f.activation === 'lost-accept') throw Error('china_code_accept_response_lost');
          return f.hostOutcome;
        },
        async afterCommit({accepted, intent, assertAuthority}) {
          f.events.push('afterCommit'); await assertAuthority();
          assert.equal(inspectChinaPublicationState({accepted, intent}).status, 'resolved');
          return {completed: true, retiredContainers: 0};
        },
        async close() { f.events.push('close'); },
      };
    },
    async recoverRelease({intent, assertAuthority}) {
      f.events.push('recover'); await assertAuthority(); assert.equal(intent.value.candidate.runtimeSha, plan.runtimeSha);
      return f.hostOutcome;
    },
  };
  return f;
}

test('code acceptance keeps the exact generation, then the real daily cycle retains the accepted new application', async () => {
  const f = await fixture(), result = await runChinaCodeCycle(f.args);
  assert.equal(result.status, 'accepted'); assert.equal(result.published, true); assert.equal(result.retentionPreserved, true);
  assert.deepEqual(f.events, ['preserve', 'stage', 'activate', 'afterCommit', 'close']); assert.equal(f.stopped, true);
  const updated = await f.storage.read('accepted'), {proof: _oldProof, ...oldData} = f.first.accepted.value.current;
  const {proof: _newProof, ...newData} = updated.value.current;
  assert.deepEqual(newData, {...oldData, runtimeSha: plan.runtimeSha, imageId});
  assert.deepEqual(updated.value.rollback, f.first.accepted.value.current);
  for (const key of ['sourceRequests', 'generationRestores', 'priceCalculations', 'generationWrites', 'deletions']) assert.equal(result[key], 0);
  const dailyOwner = owner(3001), dailyNonce = '3'.repeat(32), next = {...newData,
    generationId: 'gen_china_3001_1', owner: dailyOwner, receiptSha256: hash('daily-receipt'), sourceDescriptorSha256: hash('daily-source'),
    generationManifestSha256: hash('daily-generation'), sourceCursor: 20, sourceObservedAt: codeAt};
  let preparations = 0;
  const daily = await runChinaDailyCycle({runtimeRoot: '/test/pricing', runnerTemp: '/test/temp',
    plan: {version: 1, market: 'china', minimumYear: 2014, runtimeSha: plan.pricingRuntimeSha},
    invocation: {version: 1, sourceSha: dailyOwner.revision}, owner: dailyOwner, storage: f.storage, nonce: dailyNonce,
    now: () => codeAt, scheduleHeartbeat: () => () => {}, retireTerminalAppImage: absentTerminalImage,
    async prepare(input) {
      preparations++; await input.assertAuthority(); assert.deepEqual(input.sourceSelection.generation, updated.value.current);
      return {completed: true, published: false, liveCatalogWrites: 0, encyclopediaWrites: 0, calculatorFormulaChanges: 0, deletions: 0,
        runtime: {runtimeSha: plan.pricingRuntimeSha}, sourceInput: {kind: 'accepted-generation', ...newData},
        source: {supplierLatestVerified: true, sourceCursor: next.sourceCursor, sourceObservedAt: next.sourceObservedAt,
          sourceDescriptorSha256: next.sourceDescriptorSha256},
        pricing: {runtimeSha: plan.pricingRuntimeSha, generationId: next.generationId,
          generationManifestSha256: next.generationManifestSha256, sourceDescriptorSha256: next.sourceDescriptorSha256},
        privateGeneration: {owner: dailyOwner, generationId: next.generationId, receiptSha256: next.receiptSha256,
          generationManifestSha256: next.generationManifestSha256, sourceDescriptorSha256: next.sourceDescriptorSha256}};
    },
    async stageRelease({candidate, previous}) {
      assert.deepEqual(candidate, next); assert.deepEqual(previous.value.current, updated.value.current);
      return {candidate, close: async () => {}, activate: async () => ({kind: 'accepted', evidence: acceptance(next, dailyNonce, codeAt)})};
    }, recoverRelease: async () => assert.fail('normal daily must not recover'),
  });
  assert.equal(daily.status, 'accepted'); assert.equal(preparations, 1);
  const final = await f.storage.read('accepted');
  assert.equal(final.value.current.runtimeSha, plan.runtimeSha); assert.equal(final.value.current.imageId, imageId);
  assert.equal(final.value.current.generationId, next.generationId); assert.deepEqual(final.value.rollback, updated.value.current);
});

test('browser rejection requires authentic rollback proof before restoring the exact prior accepted state', async () => {
  const f = await fixture(); f.activation = 'rollback';
  await assert.rejects(runChinaCodeCycle(f.args), error => error.message === 'china_code_browser_failed' && error.report.status === 'rolled_back');
  const accepted = await f.storage.read('accepted'), intent = await f.storage.read('intent');
  assert.deepEqual(accepted.value.current, f.first.accepted.value.current); assert.deepEqual(accepted.value.rollback, f.first.accepted.value.rollback);
  assert.equal(inspectChinaPublicationState({accepted, intent}).status, 'resolved');
  assert.deepEqual(f.events, ['preserve', 'stage', 'activate', 'close', 'recover']);
  const bad = await fixture(); bad.activation = 'bad-rollback';
  await assert.rejects(runChinaCodeCycle(bad.args), error => error.report.status === 'needs_reconciliation');
  assert.equal((await bad.storage.read('intent')).value.status, 'pending');
  assert.ok((await bad.storage.read('accepted')).value.pending);
});

test('a resolved rollback admits a fresh candidate from the same retained runtime with a new lease and exact restored CAS basis',async()=>{
  const f=await fixture();f.activation='rollback';
  await assert.rejects(runChinaCodeCycle(f.args),error=>error.report.status==='rolled_back'&&error.report.leaseReleased===true);
  const restored=await f.storage.read('accepted'),aborted=await f.storage.read('intent');
  assert.equal(inspectChinaPublicationState({accepted:restored,intent:aborted}).status,'resolved');
  assert.equal(aborted.value.status,'aborted');assert.notEqual(restored.etag,f.first.accepted.etag);
  const nextPlan={...plan,runtimeSha:'c'.repeat(40)},nextImage='sha256:'+'d'.repeat(64),nextNonce='3'.repeat(32);
  const {proof,...retained}=restored.value.current;let stageCalls=0,acceptCalls=0;
  const result=await runChinaCodeCycle({...f.args,plan:nextPlan,imageId:nextImage,owner:owner(2002),nonce:nextNonce,
    retirePreviousHost:async()=>assert.fail('an aborted intent has no committed host retirement to replay'),
    recoverRelease:async()=>{assert.fail('a resolved rollback must not replay the old host operation');},
    stageCodeRelease:async input=>{
      stageCalls++;await input.assertAuthority();
      assert.deepEqual(input.previous,restored);assert.equal(input.nonce,nextNonce);
      assert.deepEqual(input.candidate,{...retained,runtimeSha:nextPlan.runtimeSha,imageId:nextImage});
      return {candidate:input.candidate,async close(){},async activate({intent,reservation,assertAuthority}){
        acceptCalls++;await assertAuthority();
        assert.equal(intent.value.revision,aborted.value.revision+1);
        assert.equal(intent.value.previous.etag,restored.etag);assert.equal(intent.value.nonce,nextNonce);
        assert.equal((await f.storage.read('accepted')).etag,reservation.etag);
        return {kind:'accepted',evidence:acceptance(input.candidate,nextNonce,codeAt,
          {transition:'code-update',previousAcceptedETag:restored.etag,previousAcceptedStateSha256:restored.sha256,
            retainedRuntimeSha:retained.runtimeSha,retainedImageId:retained.imageId})};
      }};
    }});
  assert.equal(result.status,'accepted');assert.equal(result.leaseReleased,true);
  assert.equal(stageCalls,1);assert.equal(acceptCalls,1);
  const accepted=await f.storage.read('accepted');
  assert.deepEqual(accepted.value.rollback,restored.value.current);
  assert.equal(accepted.value.current.runtimeSha,nextPlan.runtimeSha);
  assert.equal(accepted.value.current.generationManifestSha256,retained.generationManifestSha256);
  assert.equal(accepted.value.current.pricingRuntimeSha,retained.pricingRuntimeSha);
  assert.equal(inspectChinaPublicationState({accepted,intent:await f.storage.read('intent')}).status,'resolved');
});

async function nextCodeArguments(f, {runtime = 'e'.repeat(40), image = 'sha256:' + 'f'.repeat(64),
  nonce = '4'.repeat(32), failAfterCommit = false, rollbackActivation = false, retirePreviousHost} = {}) {
  const previous = await f.storage.read('accepted');
  const nextPlan = {...plan, runtimeSha: runtime, retainedRuntime: previous.value.current.runtimeSha};
  let hostRollback;
  return {...f.args, plan: nextPlan, imageId: image, owner: owner(2003), nonce, retirePreviousHost,
    async stageCodeRelease(input) {
      f.events.push('stage'); await input.assertAuthority(); assert.deepEqual(input.previous, previous);
      return {candidate: input.candidate,
        async activate({intent, assertAuthority}) {
          f.events.push('activate'); await assertAuthority();
          if (rollbackActivation) { hostRollback = rollback(intent); throw Error('china_code_fixture_browser_failed'); }
          return {kind: 'accepted', evidence: acceptance(input.candidate, intent.value.nonce, codeAt,
            {transition: 'code-update', previousAcceptedETag: previous.etag, previousAcceptedStateSha256: previous.sha256,
              retainedRuntimeSha: previous.value.current.runtimeSha, retainedImageId: previous.value.current.imageId})};
        },
        async afterCommit({assertAuthority}) {
          f.events.push('afterCommit'); await assertAuthority();
          if (failAfterCommit) throw Error('china_host_retirement_unknown');
          return {completed: true, retiredContainers: 0, filesDeleted: 0, freedBytes: 0};
        },
        async close() { f.events.push('close'); },
      };
    },
    async recoverRelease() {
      if (hostRollback) return {kind: 'rolled_back', evidence: hostRollback};
      assert.fail('a stable preflight must not replay publication');
    },
  };
}

async function sameGenerationFailedCleanup() {
  const f = await fixture();
  await runChinaCodeCycle(f.args);
  const failed = await runChinaCodeCycle(await nextCodeArguments(f, {runtime: 'c'.repeat(40), image: 'sha256:' + 'd'.repeat(64),
    nonce: '3'.repeat(32), failAfterCommit: true}));
  assert.equal(failed.status, 'accepted'); assert.equal(failed.hostCleanupPending, true);
  const publication = {accepted: await f.storage.read('accepted'), intent: await f.storage.read('intent')};
  assert.equal(publication.intent.value.status, 'committed');
  assert.equal(publication.intent.value.previous.value.rollback.generationId, publication.accepted.value.current.generationId);
  assert.equal(publication.accepted.value.rollback.generationId, publication.accepted.value.current.generationId);
  f.events.length = 0; f.storage.writes.length = 0;
  return {...f, publication};
}

async function nextDailyArguments(f, retirePreviousHost) {
  const previous = await f.storage.read('accepted'), {proof, ...data} = previous.value.current;
  const dailyOwner = owner(3001), nonce = '5'.repeat(32), next = {...data, generationId: 'gen_china_3001_1', owner: dailyOwner,
    receiptSha256: hash('gate-daily-receipt'), sourceDescriptorSha256: hash('gate-daily-source'),
    generationManifestSha256: hash('gate-daily-generation'), sourceCursor: 20, sourceObservedAt: codeAt};
  return {runtimeRoot: '/test/pricing', runnerTemp: '/test/temp',
    plan: {version: 1, market: 'china', minimumYear: 2014, runtimeSha: plan.pricingRuntimeSha},
    invocation: {version: 1, sourceSha: dailyOwner.revision}, owner: dailyOwner, storage: f.storage, nonce,
    now: () => codeAt, scheduleHeartbeat: () => () => {}, retirePreviousHost, retireTerminalAppImage: absentTerminalImage,
    async prepare(input) {
      f.events.push('prepare'); await input.assertAuthority(); assert.deepEqual(input.sourceSelection.generation, previous.value.current);
      return {completed: true, published: false, liveCatalogWrites: 0, encyclopediaWrites: 0, calculatorFormulaChanges: 0, deletions: 0,
        runtime: {runtimeSha: plan.pricingRuntimeSha}, sourceInput: {kind: 'accepted-generation', ...data},
        source: {supplierLatestVerified: true, sourceCursor: next.sourceCursor, sourceObservedAt: next.sourceObservedAt,
          sourceDescriptorSha256: next.sourceDescriptorSha256},
        pricing: {runtimeSha: plan.pricingRuntimeSha, generationId: next.generationId,
          generationManifestSha256: next.generationManifestSha256, sourceDescriptorSha256: next.sourceDescriptorSha256},
        privateGeneration: {owner: dailyOwner, generationId: next.generationId, receiptSha256: next.receiptSha256,
          generationManifestSha256: next.generationManifestSha256, sourceDescriptorSha256: next.sourceDescriptorSha256}};
    },
    async stageRelease(input) {
      f.events.push('stage'); await input.assertAuthority(); assert.deepEqual(input.previous, previous);
      return {candidate: input.candidate,
        async activate({assertAuthority}) {
          f.events.push('activate'); await assertAuthority(); return {kind: 'accepted', evidence: acceptance(next, nonce, codeAt)};
        }, async close() { f.events.push('close'); }};
    },
    async recoverRelease() { assert.fail('a stable preflight must not replay publication'); },
  };
}

for (const mode of ['code', 'daily']) {
  test(mode + ' retries a failed same-generation afterCommit before any new work and keeps its durable intent until success', async () => {
    const f = await sameGenerationFailedCleanup(), received = [];
    const failedRetry = async input => {
      f.events.push('retire'); received.push(input);
      assert.equal((await f.storage.read('lease')).value.status, 'held'); await input.assertAuthority();
      assert.deepEqual(input.previousAccepted, f.publication.intent.value.previous);
      assert.deepEqual(input.acceptedPublication, f.publication);
      assert.deepEqual(await input.readState(), f.publication);
      assert.equal(f.storage.writes.filter(row => row.name === 'accepted' || row.name === 'intent').length, 0);
      throw Error('china_host_retirement_unknown');
    };
    const args = mode === 'code' ? await nextCodeArguments(f, {retirePreviousHost: failedRetry}) : await nextDailyArguments(f, failedRetry);
    const cycle = mode === 'code' ? runChinaCodeCycle : runChinaDailyCycle;
    await assert.rejects(cycle(args), error => error.message === 'china_host_retirement_unknown' && error.report.published === false);
    assert.deepEqual(f.events, ['retire']);
    assert.deepEqual({accepted: await f.storage.read('accepted'), intent: await f.storage.read('intent')}, f.publication);
    assert.equal(f.storage.writes.filter(row => row.name === 'accepted' || row.name === 'intent').length, 0);
    assert.equal((await f.storage.read('lease')).value.status, 'released');
    f.events.length = 0; f.storage.writes.length = 0;
    args.retirePreviousHost = async input => {
      f.events.push('retire'); received.push(input); await input.assertAuthority();
      assert.deepEqual(await input.readState(), f.publication);
      assert.deepEqual(input.acceptedPublication, received[0].acceptedPublication);
      assert.deepEqual(input.previousAccepted, received[0].previousAccepted);
      return {completed: true, retiredContainers: 0, filesDeleted: 7, freedBytes: 1234};
    };
    const result = await cycle(args);
    assert.equal(result.status, 'accepted'); assert.equal(result.published, true);
    assert.equal(f.events[0], 'retire'); assert(f.events.includes(mode === 'daily' ? 'prepare' : 'stage'));
    assert.deepEqual(result.hostCleanupBeforeReserve, {completed: true, retiredContainers: 0, filesDeleted: 7, freedBytes: 1234});
    assert.equal(received.length, 2);
    assert.notEqual((await f.storage.read('intent')).sha256, f.publication.intent.sha256);
  });

  test(mode + ' refuses a missing, incomplete or uncertain host gate without source work or intent replacement', async () => {
    for (const behavior of ['missing', 'incomplete', 'uncertain', 'missing_counts']) {
      const f = await sameGenerationFailedCleanup();
      const retirePreviousHost = behavior === 'missing' ? undefined : async () => {
        f.events.push('retire');
        if (behavior === 'missing_counts') return {completed: true};
        return {completed: behavior !== 'incomplete', uncertain: behavior === 'uncertain', retiredContainers: 0, filesDeleted: 0, freedBytes: 0};
      };
      const args = mode === 'code' ? await nextCodeArguments(f, {retirePreviousHost}) : await nextDailyArguments(f, retirePreviousHost);
      await assert.rejects((mode === 'code' ? runChinaCodeCycle : runChinaDailyCycle)(args), /host_retirement_(capability|incomplete)/);
      assert.deepEqual(f.events, behavior === 'missing' ? [] : ['retire']);
      assert.deepEqual({accepted: await f.storage.read('accepted'), intent: await f.storage.read('intent')}, f.publication);
      assert.equal(f.storage.writes.filter(row => row.name === 'accepted' || row.name === 'intent').length, 0);
    }
  });

  test(mode + ' does not replay retirement for an aborted intent even when its previous state has a rollback', async () => {
    const f = await sameGenerationFailedCleanup();
    const rollbackArgs = await nextCodeArguments(f, {rollbackActivation: true,
      retirePreviousHost: async () => ({completed: true, retiredContainers: 0, filesDeleted: 0, freedBytes: 0})});
    await assert.rejects(runChinaCodeCycle(rollbackArgs), error => error.report.status === 'rolled_back');
    const aborted = await f.storage.read('intent');
    assert.equal(aborted.value.status, 'aborted'); assert.ok(aborted.value.previous.value.rollback);
    assert.equal(inspectChinaPublicationState({accepted: await f.storage.read('accepted'), intent: aborted}).status, 'resolved');
    f.events.length = 0;
    const retirePreviousHost = async () => assert.fail('the resolved abort must not replay a committed retirement');
    const args = mode === 'code' ? await nextCodeArguments(f, {nonce: '6'.repeat(32), retirePreviousHost})
      : await nextDailyArguments(f, retirePreviousHost);
    const result = await (mode === 'code' ? runChinaCodeCycle : runChinaDailyCycle)(args);
    assert.equal(result.status, 'accepted'); assert.equal(result.hostCleanupBeforeReserve, undefined);
    assert.ok(f.events.includes(mode === 'code' ? 'stage' : 'prepare'));
  });
}

test('a code publication with no displaced rollback performs no host retry', async () => {
  const f = await fixture();
  f.args.retirePreviousHost = async () => assert.fail('there is no obsolete rollback deployment');
  const result = await runChinaCodeCycle(f.args);
  assert.equal(result.status, 'accepted'); assert.equal(result.hostCleanupBeforeReserve, undefined);
});

test('changed fresh authority during host cleanup cannot authorize a subsequent code reservation', async () => {
  const f = await sameGenerationFailedCleanup();
  const args = await nextCodeArguments(f, {retirePreviousHost: async input => {
    await input.assertAuthority();
    const current = await f.storage.read('accepted');
    f.storage.force('accepted', {...current.value, revision: current.value.revision + 1});
    return {completed: true, retiredContainers: 0, filesDeleted: 0, freedBytes: 0};
  }});
  await assert.rejects(runChinaCodeCycle(args), /china_code_state_changed/);
  assert.deepEqual(f.events, []); assert.deepEqual(await f.storage.read('intent'), f.publication.intent);
  assert.equal(f.storage.writes.filter(row => row.name === 'accepted' || row.name === 'intent').length, 0);
});

test('code report revalidates injected optional evidence independently without replacing the original failure', async () => {
  for (const invalid of ['serverSpeed', 'homePhaseTiming', 'foreignTiming', 'throwingSpeed']) {
    const f = await fixture();
    const speed = {present: true, sha256: hash('saved speed'), exitCode: 1, rejectedSamples: 0,
      samples: [{performanceRequest: 'failed', path: '/cars?market=china', seconds: 90, errorType: 'TimeoutError'}]};
    const timing = {version: 1, kind: 'china-home-phase-timing-v1', runtimeSha: plan.runtimeSha, nonce: codeNonce,
      logBytes: 0, logLines: 0, rejectedRows: 0, limited: false, rows: []};
    const original = Object.assign(Error('china_host_server_speed_failed'), {serverSpeed: copy(speed), homePhaseTiming: copy(timing)});
    if (invalid === 'foreignTiming') original.homePhaseTiming.nonce = seedNonce;
    else if (invalid === 'throwingSpeed') Object.defineProperty(original, 'serverSpeed', {get() { throw Error('PRIVATE_GETTER'); }});
    else original[invalid].privateOutput = 'PRIVATE';
    f.afterStage = async () => { throw original; };
    await assert.rejects(runChinaCodeCycle(f.args), error => {
      assert.equal(error.message, original.message); assert.equal(error.report.errorCode, original.message);
      assert.deepEqual(error.report.serverSpeedFailure, ['serverSpeed', 'throwingSpeed'].includes(invalid) ? undefined : speed);
      assert.deepEqual(error.report.homePhaseTiming, ['homePhaseTiming', 'foreignTiming'].includes(invalid) ? undefined : timing);
      assert.equal(error.report.status, 'failed'); assert.equal(error.report.leaseReleased, true);
      assert.doesNotMatch(JSON.stringify(error.report), /PRIVATE/); return true;
    });
    assert.deepEqual(await f.storage.read('accepted'), f.first.accepted);
    assert.deepEqual(f.events, ['preserve', 'stage']); assert.equal(f.stopped, true);
  }
});

test('a lost host acceptance response commits the exact durable proof without staging or activating twice', async () => {
  const f = await fixture(); f.activation = 'lost-accept';
  const result = await runChinaCodeCycle(f.args);
  assert.equal(result.published, true); assert.equal(result.recovered, true); assert.equal(result.status, 'accepted');
  assert.deepEqual(f.events, ['preserve', 'stage', 'activate', 'close', 'recover']);
  assert.equal((await f.storage.read('accepted')).value.current.proof.hostReceiptSha256, f.hostOutcome.evidence.hostReceiptSha256);
  assert.equal(f.storage.writes.filter(row => row.name === 'accepted' && row.value.current?.runtimeSha === plan.runtimeSha).length, 1);
});

test('unknown host outcome keeps its reservation protected and a later cycle reconciles without another activation', async () => {
  const f = await fixture(); f.activation = 'unknown';
  await assert.rejects(runChinaCodeCycle(f.args), error => error.report.status === 'needs_reconciliation');
  const intent = await f.storage.read('intent'), candidate = intent.value.candidate;
  assert.ok((await f.storage.read('accepted')).value.pending); assert.equal(intent.value.status, 'pending');
  f.hostOutcome = {kind: 'accepted', evidence: acceptance(candidate, intent.value.nonce, codeAt,
    {transition: 'code-update', previousAcceptedETag: intent.value.previous.etag,
      previousAcceptedStateSha256: intent.value.previous.sha256, retainedRuntimeSha: plan.retainedRuntime,
      retainedImageId: f.first.accepted.value.current.imageId})};
  f.events.length = 0;
  const result = await runChinaCodeCycle({...f.args, nonce: '4'.repeat(32), owner: owner(2002)});
  assert.equal(result.status, 'already_accepted'); assert.equal(result.recovered, true); assert.deepEqual(f.events, ['recover']);
  assert.equal((await f.storage.read('accepted')).value.current.proof.hostReceiptSha256, f.hostOutcome.evidence.hostReceiptSha256);
});

test('retention preservation failure prevents staging and does not overwrite the prior intent', async () => {
  for (const behavior of ['throw', 'unremembered', 'deleted']) {
    const f = await fixture();
    f.args.preserveRetention = async ({readState, assertAuthority}) => {
      await assertAuthority(); assert.equal((await readState()).intent.sha256, f.first.intent.sha256);
      if (behavior === 'throw') throw Error('china_gc_queue_conflict');
      return {market: 'china', mode: 'enqueue-only', completed: true, witnessRemembered: behavior !== 'unremembered',
        deletedObjects: behavior === 'deleted' ? 1 : 0, collected: 0, pruned: 0};
    };
    await assert.rejects(runChinaCodeCycle(f.args));
    assert.deepEqual(f.events, []); assert.deepEqual(await f.storage.read('intent'), f.first.intent);
    assert.equal(f.storage.writes.filter(row => row.name === 'intent' || row.name === 'accepted').length, 0);
  }
});

test('a pre-stage state read failure preserves safe operation evidence, including a heartbeat failure, without publishing', async () => {
  for (const throughHeartbeat of [false, true]) for (const validEvidence of [false, true]) {
    const f = await fixture(), originalRead = f.storage.read.bind(f.storage), preserve = f.args.preserveRetention;
    const facts = {version: 1, kind: 'china-state-storage-failure-v1', method: 'GET', target: 'lease',
      part: 'document', phase: 'headers', attempts: 2, cause: 'UND_ERR_SOCKET'};
    let armed = false, heartbeat;
    f.args.scheduleHeartbeat = callback => { heartbeat = callback; return () => { f.stopped = true; }; };
    f.storage.read = async name => {
      if (armed && name === 'lease') {
        armed = false;
        const error = Error('china_state_storage_transport');
        error.cause = Error('private body credential=test-secret');
        error.stateStorageFailure = {...facts, ...(validEvidence ? {} : {url: 'private://test-secret'})};
        throw error;
      }
      return originalRead(name);
    };
    f.args.preserveRetention = async input => {
      const result = await preserve(input); armed = true;
      if (throughHeartbeat) { heartbeat(); await new Promise(resolve => setImmediate(resolve)); }
      return result;
    };
    await assert.rejects(runChinaCodeCycle(f.args), error => {
      assert.equal(error.message, 'china_state_storage_transport');
      assert.equal(error.report.published, false); assert.equal(error.report.retentionPreserved, true);
      assert.equal(error.report.leaseReleased, true);
      assert.deepEqual(error.report.stateStorageFailure, validEvidence ? facts : undefined);
      assert.equal(JSON.stringify(error.report).includes('test-secret'), false); return true;
    });
    assert.deepEqual(f.events, ['preserve']); assert.equal(f.stopped, true);
    assert.deepEqual(await f.storage.read('accepted'), f.first.accepted);
    assert.deepEqual(await f.storage.read('intent'), f.first.intent);
    assert.equal(f.storage.writes.filter(row => row.name === 'accepted' || row.name === 'intent').length, 0);
  }
});

test('a state change after staging or a stale conditional commit is never rebased over a foreign writer', async () => {
  const beforeReserve = await fixture();
  beforeReserve.afterStage = async () => beforeReserve.storage.force('accepted', {...beforeReserve.first.accepted.value, revision: 90});
  await assert.rejects(runChinaCodeCycle(beforeReserve.args), error => error.report.status === 'needs_reconciliation');
  assert.deepEqual(beforeReserve.events, ['preserve', 'stage', 'close']);
  assert.equal((await beforeReserve.storage.read('accepted')).value.revision, 90);
  assert.equal(beforeReserve.storage.writes.filter(row => row.name === 'accepted').length, 0);
  const duringCommit = await fixture();
  duringCommit.storage.beforeWrite = async (name, previous, value) => {
    if (name === 'accepted' && value.current?.runtimeSha === plan.runtimeSha) {
      duringCommit.storage.beforeWrite = null;
      duringCommit.storage.force('accepted', {...previous.value, revision: 91});
    }
  };
  await assert.rejects(runChinaCodeCycle(duringCommit.args), error => error.report.status === 'needs_reconciliation');
  assert.equal((await duringCommit.storage.read('accepted')).value.revision, 91);
  assert.equal(duringCommit.storage.writes.filter(row => row.name === 'accepted' && row.value.current?.runtimeSha === plan.runtimeSha).length, 1);
});

test('a repeated code cycle accepts only the same exact image and does not publish or stage again', async () => {
  const f = await fixture(); await runChinaCodeCycle(f.args); f.events.length = 0;
  const result = await runChinaCodeCycle({...f.args, nonce: '5'.repeat(32)});
  assert.equal(result.status, 'already_accepted'); assert.equal(result.published, false); assert.deepEqual(f.events, []);
  await assert.rejects(runChinaCodeCycle({...f.args, nonce: '6'.repeat(32), imageId: 'sha256:' + 'c'.repeat(64)}), /accepted_image_changed/);
  assert.deepEqual(f.events, []);
});

test('terminal accepted code image cleanup follows host retirement and session close under the same lease', async () => {
  const f = await fixture(); await runChinaCodeCycle(f.args); f.events.length = 0; let calls = 0, observed;
  const args = await nextCodeArguments(f);
  args.retireTerminalAppImage = async input => {
    calls++; f.events.push('image'); observed = input.publication;
    assert.deepEqual(Object.keys(input).sort(), ['assertAuthority', 'publication', 'readState']);
    assert.equal(f.events.at(-2), 'close'); assert(f.events.indexOf('afterCommit') < f.events.indexOf('close'));
    assert.equal((await f.storage.read('lease')).value.status, 'held'); await input.assertAuthority();
    assert.deepEqual(await input.readState(), observed);
    assert.equal(observed.intent.value.status, 'committed');
    assert.deepEqual(observed.intent.value.previous.value.rollback, f.first.accepted.value.current);
    return terminalImageReport(observed, {status: 'removed', reason: 'exact_terminal_image'});
  };
  const result = await runChinaCodeCycle(args);
  assert.equal(calls, 1); assert.equal(result.status, 'accepted'); assert.equal(result.published, true);
  assert.equal(result.appImageCleanup.imagesRemoved, 1); assert.equal(result.appImageCleanup.completed, true);
  assert.equal(result.appImageCleanup.witnessSha256, hash(JSON.stringify(ordered(observed))));
  assert.equal(result.appImageCleanupPending, undefined); assert.equal(result.leaseReleased, true);
  for (const key of ['sourceRequests', 'generationRestores', 'priceCalculations', 'generationWrites',
    'encyclopediaWrites', 'otherMarketWrites', 'deletions']) assert.equal(result[key], 0);
});

test('confirmed code rollback cleans only its candidate and preserves the original browser failure', async () => {
  const f = await fixture(); f.activation = 'rollback'; let calls = 0;
  f.args.retireTerminalAppImage = async input => {
    calls++; assert.equal(f.events.includes('close'), true); assert.equal(f.events.at(-1), 'recover');
    assert.equal((await f.storage.read('lease')).value.status, 'held'); await input.assertAuthority();
    assert.equal(input.publication.intent.value.resolution.kind, 'rolled_back');
    assert.equal(input.publication.intent.value.transition, 'code-update');
    assert.equal(input.publication.intent.value.candidate.runtimeSha, plan.runtimeSha);
    assert.equal(input.publication.accepted.value.current.runtimeSha, plan.retainedRuntime);
    return terminalImageReport(input.publication, {status: 'removed', reason: 'exact_terminal_image'});
  };
  await assert.rejects(runChinaCodeCycle(f.args), error => {
    assert.equal(error.message, 'china_code_browser_failed'); assert.equal(error.report.status, 'rolled_back');
    assert.equal(error.report.appImageCleanup.imageId, imageId); assert.equal(error.report.appImageCleanup.imagesRemoved, 1);
    assert.equal(error.report.leaseReleased, true); assert.equal(error.report.published, false); return true;
  });
  assert.equal(calls, 1); assert.deepEqual((await f.storage.read('accepted')).value.current, f.first.accepted.value.current);
});

test('uncertain terminal image cleanup is bounded pending evidence and cannot replace the rollback error', async () => {
  const f = await fixture(); f.activation = 'rollback'; let calls = 0;
  f.args.retireTerminalAppImage = async () => {
    calls++; const error = Error('private-docker-output credential=secret');
    error.report = {status: 'accepted', private: 'secret'};
    error.appImageCleanup = {version: 1, kind: 'china-terminal-app-image-cleanup-v1',
      completed: false, status: 'pending', uncertain: true, errorCode: 'delete_not_confirmed'};
    throw error;
  };
  await assert.rejects(runChinaCodeCycle(f.args), error => {
    assert.equal(error.message, 'china_code_browser_failed'); assert.equal(error.report.status, 'rolled_back');
    assert.equal(error.report.appImageCleanupPending, true);
    assert.deepEqual(error.report.appImageCleanup, {version: 1, kind: 'china-terminal-app-image-cleanup-v1',
      completed: false, status: 'pending', uncertain: true, errorCode: 'delete_not_confirmed'});
    assert.equal(JSON.stringify(error.report).includes('secret'), false);
    assert.equal(error.report.leaseReleased, true); return true;
  });
  assert.equal(calls, 1); assert.equal((await f.storage.read('intent')).value.resolution.kind, 'rolled_back');
});

test('accepted code remains accepted when image cleanup fails and an uncertain close cannot open another host session', async () => {
  for (const failure of ['cleanup', 'close']) {
    const f = await fixture(); await runChinaCodeCycle(f.args); f.events.length = 0;
    const args = await nextCodeArguments(f), stage = args.stageCodeRelease; let calls = 0;
    if (failure === 'close') args.stageCodeRelease = async input => ({...await stage(input),
      async close() { f.events.push('close-unknown'); throw Error('private-close-error'); }});
    args.retireTerminalAppImage = async () => { calls++; throw Error('private-cleanup-error'); };
    const result = await runChinaCodeCycle(args);
    assert.equal(result.status, 'accepted'); assert.equal(result.published, true); assert.equal(result.completed, true);
    assert.equal(result.appImageCleanupPending, true); assert.equal(result.appImageCleanup.completed, false);
    assert.equal(calls, failure === 'cleanup' ? 1 : 0); assert.equal(result.leaseReleased, true);
    assert.equal(JSON.stringify(result).includes('private-'), false);
    assert.equal((await f.storage.read('accepted')).value.current.runtimeSha, args.plan.runtimeSha);
  }
});

for (const mode of ['code', 'daily']) {
  test(mode + ' cannot replace the terminal image witness until cleanup retry succeeds', async () => {
    const f = await sameGenerationFailedCleanup(), retire = async () => {
      f.events.push('retire'); return {completed: true, retiredContainers: 0, filesDeleted: 0, freedBytes: 0};
    };
    const args = mode === 'code' ? await nextCodeArguments(f, {retirePreviousHost: retire}) : await nextDailyArguments(f, retire);
    const cycle = mode === 'code' ? runChinaCodeCycle : runChinaDailyCycle; let attempts = 0;
    args.retireTerminalAppImage = async input => {
      attempts++; f.events.push('image'); await input.assertAuthority();
      assert.deepEqual(input.publication, f.publication); assert.deepEqual(await input.readState(), f.publication);
      assert.equal(f.storage.writes.filter(row => row.name === 'accepted' || row.name === 'intent').length, 0);
      throw Error('private-image-cleanup-uncertain');
    };
    await assert.rejects(cycle(args), error => {
      assert.equal(error.message, 'china_' + mode + '_app_image_cleanup_pending');
      assert.equal(error.report.published, false); assert.equal(error.report.appImageCleanupPending, true);
      assert.equal(error.report.appImageCleanupBeforeReserve.completed, false);
      assert.equal(JSON.stringify(error.report).includes('private-'), false); return true;
    });
    assert.equal(attempts, 1); assert.deepEqual(f.events, ['retire', 'image']);
    assert.deepEqual({accepted: await f.storage.read('accepted'), intent: await f.storage.read('intent')}, f.publication);
    assert.equal(f.storage.writes.filter(row => row.name === 'accepted' || row.name === 'intent').length, 0);
    assert.equal((await f.storage.read('lease')).value.status, 'released');
    f.events.length = 0;
    args.retireTerminalAppImage = async input => {
      attempts++; f.events.push('image'); await input.assertAuthority();
      return terminalImageReport(input.publication);
    };
    const result = await cycle(args);
    assert.equal(result.status, 'accepted'); assert.equal(result.appImageCleanupBeforeReserve.completed, true);
    assert.deepEqual(f.events.slice(0, 2), ['retire', 'image']);
    assert(f.events.indexOf('image') < f.events.indexOf(mode === 'code' ? 'stage' : 'prepare'));
    assert.notEqual((await f.storage.read('intent')).sha256, f.publication.intent.sha256);
    assert.equal(result.appImageCleanupPending, undefined);
  });

  test(mode + ' refuses a missing or malformed image result before source preparation or reservation', async () => {
    for (const malformed of [false, true]) {
      const f = await sameGenerationFailedCleanup();
      const retire = async () => ({completed: true, retiredContainers: 0, filesDeleted: 0, freedBytes: 0});
      const args = mode === 'code' ? await nextCodeArguments(f, {retirePreviousHost: retire}) : await nextDailyArguments(f, retire);
      args.retireTerminalAppImage = malformed ? async input => ({...terminalImageReport(input.publication),
        imagesRemoved: 2, privateUrl: 'private://must-not-escape'}) : undefined;
      await assert.rejects((mode === 'code' ? runChinaCodeCycle : runChinaDailyCycle)(args), error => {
        assert.equal(error.report.appImageCleanupPending, true); assert.equal(error.report.published, false);
        assert.equal(JSON.stringify(error.report).includes('private://'), false); return true;
      });
      assert.equal(f.events.includes('prepare') || f.events.includes('stage'), false);
      assert.deepEqual({accepted: await f.storage.read('accepted'), intent: await f.storage.read('intent')}, f.publication);
      assert.equal(f.storage.writes.filter(row => row.name === 'accepted' || row.name === 'intent').length, 0);
    }
  });
}

test('changed authority during image cleanup prevents a subsequent code stage or witness replacement', async () => {
  const f = await sameGenerationFailedCleanup();
  const args = await nextCodeArguments(f, {retirePreviousHost: async () => ({completed: true, retiredContainers: 0, filesDeleted: 0, freedBytes: 0})});
  args.retireTerminalAppImage = async input => {
    await input.assertAuthority();
    const old = await f.storage.read('accepted'); f.storage.force('accepted', {...old.value, revision: old.value.revision + 1});
    return terminalImageReport(input.publication);
  };
  await assert.rejects(runChinaCodeCycle(args), error => error.report.appImageCleanupPending === true && error.report.published === false);
  assert.equal(f.events.includes('stage'), false); assert.deepEqual(await f.storage.read('intent'), f.publication.intent);
  assert.equal(f.storage.writes.filter(row => row.name === 'accepted' || row.name === 'intent').length, 0);
});

test('a durable never-reserved abort cannot authorize image cleanup even with an older rollback', async () => {
  const f = await sameGenerationFailedCleanup(), state = createChinaState({storage: f.storage, now: () => codeAt});
  const lease = await state.acquireLease({previous: await state.read('lease'), owner: owner(2009), nonce: '9'.repeat(32),
    expiresAt: '2026-11-25T11:30:00.000Z'});
  const {proof, ...current} = f.publication.accepted.value.current;
  f.storage.beforeWrite = (name, previous, value) => { if (name === 'accepted' && value.pending) throw Error('fixture_before_reservation'); };
  await assert.rejects(state.reserve({lease, previous: f.publication.accepted, previousIntent: f.publication.intent,
    candidate: {...current, runtimeSha: '7'.repeat(40), imageId: 'sha256:' + '8'.repeat(64)}, transition: 'code-update'}), /write_not_committed/);
  f.storage.beforeWrite = null; await state.releaseLease({lease});
  const args = await nextCodeArguments(f);
  args.retirePreviousHost = async () => assert.fail('an abandoned unreserved intent is not a committed retirement');
  args.retireTerminalAppImage = async () => assert.fail('never_reserved has no terminal image cleanup permission');
  args.stageCodeRelease = async () => { throw Error('china_code_fixture_stop_before_reserve'); };
  await assert.rejects(runChinaCodeCycle(args), /china_code_fixture_stop_before_reserve/);
  assert.equal((await f.storage.read('intent')).value.resolution.kind, 'never_reserved');
});

test('already accepted, no displaced rollback and unresolved outcomes do not call image cleanup', async () => {
  const first = await fixture();
  first.args.retireTerminalAppImage = async () => assert.fail('initial accepted publication has no obsolete app image');
  assert.equal((await runChinaCodeCycle(first.args)).status, 'accepted');
  for (const activation of ['unknown', 'bad-rollback']) {
    const f = await fixture(); f.activation = activation;
    f.args.retireTerminalAppImage = async () => assert.fail('unconfirmed host outcome cannot clean an image');
    await assert.rejects(runChinaCodeCycle(f.args), error => error.report.status === 'needs_reconciliation');
  }
  const f = await sameGenerationFailedCleanup();
  const result = await runChinaCodeCycle({...f.args, plan: {...plan, runtimeSha: 'c'.repeat(40), retainedRuntime: plan.runtimeSha},
    imageId: 'sha256:' + 'd'.repeat(64),
    retireTerminalAppImage: async () => assert.fail('already_accepted preserves its terminal witness without a cleanup call')});
  assert.equal(result.status, 'already_accepted'); assert.equal(result.appImageCleanup, undefined);
  assert.deepEqual(f.events, []);
});
