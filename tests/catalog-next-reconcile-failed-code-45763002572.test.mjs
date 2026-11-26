import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createChinaState, inspectChinaPublicationState} from '../scripts/catalog-next/china-state.mjs';
import {EXACT, checkedTargetView, checkedRollbackOutcome, reconcileExact, publicHealth} from '../scripts/catalog-next/reconcile-failed-code-45763002572.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const bytes = value => Buffer.from(JSON.stringify(ordered(value)));
const empty = () => ({found: false, etag: null, sha256: null, value: null});
const recoveryOwner = {runId: '9999999', attempt: '1', revision: 'f'.repeat(40)};

function memoryStore() {
  const values = new Map(), writes = []; let sequence = 0;
  const storage = {writes, failFinalization: false,
    async read(name) { return copy(values.get(name) ?? empty()); },
    force(name, value) {
      values.set(name, {found: true, etag: '"revision-' + ++sequence + '"', sha256: sha(bytes(value)), value: copy(value)});
    },
    async compareAndSwap(name, previous, value) {
      const actual = await storage.read(name);
      assert.equal(actual.etag, previous.etag, 'CAS must use exact prior observation');
      writes.push({name, value: copy(value)});
      if (storage.failFinalization && name === 'intent' && value.status === 'aborted') throw Error('interrupted finalization');
      storage.force(name, value);
    }};
  return storage;
}

function generation(which) {
  const isB = which === 'B', runId = isB ? '45655051136' : '45369451603';
  return {market: 'china', generationId: isB ? EXACT.generationId : EXACT.rollbackGenerationId,
    owner: {runId, attempt: '1', revision: '1'.repeat(40)}, receiptSha256: sha('receipt-' + which),
    sourceDescriptorSha256: sha('source-' + which), generationManifestSha256: isB ? EXACT.manifestSha256 : EXACT.rollbackManifestSha256,
    sourceCursor: isB ? 200 : 100, sourceObservedAt: '2026-11-26T03:00:00.000Z',
    runtimeSha: EXACT.previousRuntime, pricingRuntimeSha: EXACT.previousRuntime, imageId: EXACT.previousImage};
}

function acceptance(reference, nonce) {
  const browserSpeedBytes = Buffer.from(JSON.stringify({release: reference.runtimeSha, passed: true, browserPassed: true, speedGuard: {passed: true}}));
  const browserDetailsBytes = Buffer.from(JSON.stringify({version: 1, kind: 'china-browser-details-v1', release: reference.runtimeSha,
    nonce, passed: true, generationManifestSha256: reference.generationManifestSha256, precedingSpeedReportSha256: sha(browserSpeedBytes)}));
  const receipt = {version: 1, kind: 'china-host-acceptance-v1', release: reference.runtimeSha, pricingRuntimeSha: reference.pricingRuntimeSha,
    generationId: reference.generationId, generationManifestSha256: reference.generationManifestSha256,
    privateGenerationReceiptSha256: reference.receiptSha256, sourceDescriptorSha256: reference.sourceDescriptorSha256,
    imageId: reference.imageId, sourceCursor: reference.sourceCursor, sourceObservedAt: reference.sourceObservedAt, nonce,
    acceptedAt: '2026-11-26T04:00:01.000Z', retainedContainerId: '3'.repeat(64),
    browser: {release: reference.runtimeSha, nonce, passed: true, functionalPassed: true, speedPassed: true,
      reportSha256: sha(Buffer.concat([browserSpeedBytes, browserDetailsBytes])), speedReportSha256: sha(browserSpeedBytes), detailsReportSha256: sha(browserDetailsBytes)}};
  const raw = Buffer.from(JSON.stringify(receipt));
  return {hostReceiptBase64: raw.toString('base64'), hostReceiptSha256: sha(raw), browserSpeedBytes, browserDetailsBytes};
}

function rollback(intent, overrides = {}) {
  const reference = intent.value.candidate;
  const receipt = {version: 1, kind: 'china-host-rollback-v1', nonce: EXACT.nonce, release: EXACT.runtimeSha,
    pricingRuntimeSha: reference.pricingRuntimeSha, generationId: reference.generationId,
    generationManifestSha256: reference.generationManifestSha256, privateGenerationReceiptSha256: reference.receiptSha256,
    sourceDescriptorSha256: reference.sourceDescriptorSha256, imageId: reference.imageId,
    previousAcceptedETag: intent.value.previous.etag, previousAcceptedStateSha256: intent.value.previous.sha256,
    rolledBackAt: '2026-11-26T06:04:00.000Z', retainedContainerId: EXACT.retainedContainerId,
    retainedRuntimeSha: EXACT.previousRuntime, retainedImageId: EXACT.previousImage,
    retainedRunning: true, ingressRestored: true, candidateRemoved: true, ...overrides};
  const raw = Buffer.from(JSON.stringify(receipt));
  return {status: 'rolled_back', hostRollbackBase64: raw.toString('base64'), hostRollbackSha256: sha(raw)};
}

async function fixture({interruptedFinalization = false, previousRevision} = {}) {
  const storage = memoryStore(); let clock = '2026-11-26T04:00:00.000Z';
  const now = () => clock, state = createChinaState({storage, now});
  let previous = {accepted: empty(), intent: empty()};
  for (const [which, token] of [['A', '1'.repeat(32)], ['B', '2'.repeat(32)]]) {
    const reference = generation(which);
    const lease = await state.acquireLease({previous: await state.read('lease'), owner: reference.owner, nonce: token, expiresAt: '2026-11-26T05:00:00.000Z'});
    const staged = await state.reserve({lease, previous: previous.accepted, previousIntent: previous.intent, candidate: reference});
    previous = await state.commit({lease, ...staged, evidence: acceptance(reference, token)});
    await state.releaseLease({lease});
  }
  if (previousRevision !== undefined) {
    storage.force('accepted', {...previous.accepted.value, revision: previousRevision});
    const accepted = await state.read('accepted');
    storage.force('intent', {...previous.intent.value, resolution: {...previous.intent.value.resolution,
      acceptedETag: accepted.etag, acceptedSha256: accepted.sha256}});
    previous = {accepted, intent: await state.read('intent')};
  }
  clock = '2026-11-26T05:42:00.000Z';
  const failedLease = await state.acquireLease({previous: await state.read('lease'),
    owner: {runId: EXACT.runId, attempt: EXACT.attempt, revision: EXACT.controllerSha}, nonce: EXACT.nonce,
    expiresAt: '2026-11-26T06:42:00.000Z'});
  const {proof, ...priorCandidate} = previous.accepted.value.current;
  const candidate = {...priorCandidate, runtimeSha: EXACT.runtimeSha, imageId: EXACT.imageId};
  const staged = await state.reserve({lease: failedLease, previous: previous.accepted, previousIntent: previous.intent,
    candidate, transition: 'code-update'});
  const evidence = rollback(staged.intent);
  if (interruptedFinalization) {
    storage.failFinalization = true;
    await assert.rejects(state.abortReserved({lease: failedLease, ...staged, evidence}), /write_not_committed/);
    storage.failFinalization = false;
  }
  await state.releaseLease({lease: failedLease}); clock = '2026-11-26T06:15:00.000Z';
  storage.writes.length = 0;
  const observations = [], calls = [];
  const args = {state, now, owner: recoveryOwner,
    readHostOutcome: async () => { calls.push('recover'); return evidence; },
    health: async () => { calls.push('public-health'); return {status: 200, runtimeSha: EXACT.previousRuntime, calculationVersion: EXACT.calculationVersion}; },
    onProgress: (phase, value) => observations.push({phase, ...value})};
  return {storage, state, previous, staged, evidence, args, observations, calls,
    pair: async () => ({accepted: await state.read('accepted'), intent: await state.read('intent')})};
}

test('exact reserved code failure restores complete B/A through existing conditional transitions, without revision guesses', async () => {
  const f = await fixture({previousRevision: 137});
  assert.equal(checkedTargetView(await f.pair()), 'reserved');
  const result = await reconcileExact(f.args), final = await f.pair();
  assert.equal(result.status, 'resolved'); assert.equal(result.leaseReleased, true);
  assert.deepEqual(final.accepted.value.current, f.previous.accepted.value.current);
  assert.deepEqual(final.accepted.value.rollback, f.previous.accepted.value.rollback);
  assert.deepEqual(final.accepted.value.commit, f.previous.accepted.value.commit);
  assert.equal(final.accepted.value.pending, null);
  assert.equal(inspectChinaPublicationState(final).status, 'resolved');
  assert.deepEqual(f.storage.writes.map(row => row.name), ['lease', 'accepted', 'intent', 'lease']);
  assert.equal(f.calls.filter(value => value === 'recover').length, 1);
  assert.equal(result.hostMutations, 0); assert.equal(result.newPublicationCreated, false);
});

test('interrupted accepted-state rollback finalizes only the existing intent', async () => {
  const f = await fixture({interruptedFinalization: true});
  const initial = await f.pair(); assert.equal(checkedTargetView(initial), 'rollback_needs_evidence');
  const result = await reconcileExact(f.args), final = await f.pair();
  assert.equal(result.acceptedStateWrites, 0);
  assert.equal(final.accepted.etag, initial.accepted.etag);
  assert.deepEqual(f.storage.writes.map(row => row.name), ['lease', 'intent', 'lease']);
});

test('host pending or accepted is never interpreted as rollback and no accepted/intent write occurs', async () => {
  for (const status of ['pending', 'accepted']) {
    const f = await fixture(); f.args.readHostOutcome = async () => ({status});
    const initial = await f.pair();
    await assert.rejects(reconcileExact(f.args), /host_outcome/);
    assert.deepEqual(await f.pair(), initial);
    assert.deepEqual(f.storage.writes.map(row => row.name), ['lease', 'lease']);
  }
});

test('a failed read-only attempt can be resumed under a new lease while the exact original intent remains pinned', async () => {
  const f = await fixture(); f.args.readHostOutcome = async () => ({status: 'pending'});
  await assert.rejects(reconcileExact(f.args), /host_outcome/);
  assert.equal((await f.state.read('lease')).value.owner.runId, recoveryOwner.runId);
  f.args.readHostOutcome = async () => f.evidence;
  assert.equal((await reconcileExact(f.args)).status, 'resolved');
  const foreignNonce = await fixture();
  foreignNonce.storage.force('intent', {...foreignNonce.staged.intent.value, nonce: 'a'.repeat(32)});
  await assert.rejects(reconcileExact(foreignNonce.args), /failed_intent/);
  assert.equal(foreignNonce.storage.writes.length, 0);
});

test('different nonce/image/predecessor/retained container and missing proof flags all refuse before state reconciliation', async () => {
  const f = await fixture();
  for (const overrides of [{nonce: 'a'.repeat(32)}, {imageId: 'sha256:' + 'a'.repeat(64)},
    {previousAcceptedETag: '"different"'}, {previousAcceptedStateSha256: 'a'.repeat(64)},
    {retainedContainerId: 'a'.repeat(64)}, {candidateRemoved: false}, {retainedRunning: false}, {ingressRestored: false}]) {
    assert.throws(() => checkedRollbackOutcome(rollback(f.staged.intent, overrides), f.staged.intent), /host_proof_binding/);
  }
  assert.throws(() => checkedRollbackOutcome({...f.evidence, hostRollbackSha256: '0'.repeat(64)}, f.staged.intent), /host_proof_hash/);
  assert.equal(f.storage.writes.length, 0);
});

test('another failed owner or a conflicting accepted pair cannot acquire the reconciliation lease', async () => {
  const wrongOwner = await fixture();
  wrongOwner.storage.force('intent', {...wrongOwner.staged.intent.value, owner: {...wrongOwner.staged.intent.value.owner, runId: '555'}});
  await assert.rejects(reconcileExact(wrongOwner.args), /failed_intent/);
  assert.equal(wrongOwner.storage.writes.length, 0);
  const conflict = await fixture();
  conflict.storage.force('accepted', {...conflict.staged.reservation.value, rollback: null});
  await assert.rejects(reconcileExact(conflict.args), /unrecoverable_state/);
  assert.equal(conflict.storage.writes.length, 0);
});

test('an active lease or a state change during host proof reading is never overwritten', async () => {
  const busy = await fixture(), released = await busy.state.read('lease');
  busy.storage.force('lease', {...released.value, status: 'held', releasedAt: null});
  await assert.rejects(reconcileExact(busy.args), /lease_busy/); assert.equal(busy.storage.writes.length, 0);
  const changed = await fixture();
  changed.args.readHostOutcome = async () => {
    changed.storage.force('accepted', {...changed.staged.reservation.value, revision: 876});
    return changed.evidence;
  };
  await assert.rejects(reconcileExact(changed.args), /state_changed/);
  assert.equal((await changed.state.read('accepted')).value.revision, 876);
  assert.deepEqual(changed.storage.writes.map(row => row.name), ['lease', 'lease']);
});

test('already resolved exact rollback is a verified no-op and still requires the same durable proof', async () => {
  const f = await fixture(); await reconcileExact(f.args); f.storage.writes.length = 0;
  const result = await reconcileExact(f.args);
  assert.equal(result.status, 'already_resolved'); assert.equal(result.leaseReleased, false);
  assert.equal(f.storage.writes.length, 0);
  f.args.readHostOutcome = async () => rollback(f.staged.intent, {rolledBackAt: '2026-11-26T06:05:00.000Z'});
  await assert.rejects(reconcileExact(f.args), /resolved_proof_changed/);
});

test('public health checks exact unchanged runtime and calculator, without accepting timeout or an unrelated body', async () => {
  const good = {ok: true, releaseSha: EXACT.previousRuntime, calculationVersion: EXACT.calculationVersion};
  const fetcher = async (url, options) => {
    assert.equal(url, 'https://avtocena.com/api/health'); assert.equal(options.cache, 'no-store');
    return new Response(JSON.stringify(good), {status: 200});
  };
  assert.equal((await publicHealth(fetcher)).runtimeSha, EXACT.previousRuntime);
  await assert.rejects(publicHealth(async () => new Response(JSON.stringify({...good, releaseSha: EXACT.runtimeSha}), {status: 200})), /public_identity/);
  await assert.rejects(publicHealth(async () => new Response('x'.repeat(65537), {status: 200})), /public_health_bound/);
});

test('operational source exposes only exact recover plus close and never a publisher or host cleanup call', async () => {
  const source = await readFile(new URL('../scripts/catalog-next/reconcile-failed-code-45763002572.mjs', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/session\.call\('([^']+)'/g)].map(match => match[1]), ['recover']);
  assert.match(source, /await session\.close\(\)/);
  for (const forbidden of ['state.reserve(', 'state.commit(', 'state.abandonUnreserved(', 'state.finalize(', 'stageCodeRelease(', 'retireHost('])
    assert.equal(source.includes(forbidden), false, forbidden);
});
