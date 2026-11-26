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
async function fixture() {
  const storage = memoryStorage(), state = createChinaState({storage, now: () => seedAt});
  const lease = await state.acquireLease({previous: empty(), owner: owner(1001), nonce: seedNonce, expiresAt: '2026-11-25T10:30:00Z'});
  const first = await state.commit({lease, ...await state.reserve({lease, previous: empty(), previousIntent: empty(), candidate: reference()}),
    evidence: acceptance(reference(), seedNonce, seedAt)});
  await state.releaseLease({lease}); storage.writes.length = 0;
  const f = {storage, first, events: [], hostOutcome: null, activation: 'accept', afterStage: null, stopped: false};
  f.args = {plan, imageId, invocation: {version: 1, sourceSha: owner(2001).revision}, owner: owner(2001), storage, nonce: codeNonce,
    now: () => codeAt, scheduleHeartbeat() { return () => { f.stopped = true; }; },
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
    now: () => codeAt, scheduleHeartbeat: () => () => {},
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
