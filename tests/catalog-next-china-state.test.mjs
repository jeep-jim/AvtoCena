import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CHINA_STATE_KEYS, createChinaStateStorage, createChinaState, validateChinaGenerationReference,
  validateChinaAcceptedState, validateChinaCodeTransition, inspectChinaPublicationState, protectedChinaGenerations,
  checkedChinaStateStorageFailure} from '../scripts/catalog-next/china-state.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const bytes = value => Buffer.from(JSON.stringify(ordered(value)));
const copy = value => JSON.parse(JSON.stringify(value));
const empty = () => ({found: false, etag: null, sha256: null, value: null});
const holder = {runId: '9000', attempt: '1', revision: '1'.repeat(40)};
const nonce = 'f'.repeat(32);
const now = '2026-11-24T12:00:00.000Z';
const expiry = '2026-11-24T13:00:00.000Z';
function candidate(id = 1) {
  return {market: 'china', generationId: `gen_china_${1000 + id}_1`, owner: {runId: String(1000 + id), attempt: '1', revision: '2'.repeat(40)},
    receiptSha256: sha('receipt' + id), sourceDescriptorSha256: sha('source' + id), generationManifestSha256: sha('generation' + id),
    sourceCursor: id * 1000, sourceObservedAt: '2026-11-24T11:00:00.000Z', runtimeSha: '3'.repeat(40),
    pricingRuntimeSha: '6'.repeat(40), imageId: 'sha256:' + '4'.repeat(64)};
}
function acceptance(reference, token = nonce, overrides = {}) {
  const browserSpeedBytes = Buffer.from(JSON.stringify({release: reference.runtimeSha, passed: true, browserPassed: true, speedGuard: {passed: true}}));
  const browserDetailsBytes = Buffer.from(JSON.stringify({version: 1, kind: 'china-browser-details-v1', release: reference.runtimeSha,
    nonce: token, passed: true, generationManifestSha256: reference.generationManifestSha256,
    precedingSpeedReportSha256: sha(browserSpeedBytes)}));
  const receipt = {version: 1, kind: 'china-host-acceptance-v1', release: reference.runtimeSha, pricingRuntimeSha: reference.pricingRuntimeSha,
    generationId: reference.generationId,
    generationManifestSha256: reference.generationManifestSha256, privateGenerationReceiptSha256: reference.receiptSha256,
    sourceDescriptorSha256: reference.sourceDescriptorSha256, imageId: reference.imageId, sourceCursor: reference.sourceCursor,
    sourceObservedAt: reference.sourceObservedAt, nonce: token, browser: {release: reference.runtimeSha, nonce: token,
      passed: true, functionalPassed: true, speedPassed: true, reportSha256: sha(Buffer.concat([browserSpeedBytes, browserDetailsBytes])),
      speedReportSha256: sha(browserSpeedBytes), detailsReportSha256: sha(browserDetailsBytes)},
    acceptedAt: '2026-11-24T12:00:01.123456Z', retainedContainerId: '5'.repeat(64), ...overrides};
  const raw = Buffer.from(JSON.stringify(receipt));
  return {hostReceiptBase64: raw.toString('base64'), hostReceiptSha256: sha(raw), browserSpeedBytes, browserDetailsBytes};
}
function rollback(intent, overrides = {}) {
  const reference = intent.value.candidate, previous = intent.value.previous.value?.current;
  const receipt = {version: 1, kind: 'china-host-rollback-v1', nonce: intent.value.nonce, release: reference.runtimeSha,
    pricingRuntimeSha: reference.pricingRuntimeSha, generationId: reference.generationId,
    generationManifestSha256: reference.generationManifestSha256, privateGenerationReceiptSha256: reference.receiptSha256,
    sourceDescriptorSha256: reference.sourceDescriptorSha256, imageId: reference.imageId,
    previousAcceptedETag: intent.value.previous.etag, previousAcceptedStateSha256: intent.value.previous.sha256,
    rolledBackAt: '2026-11-24T12:00:03.123456Z', retainedContainerId: '8'.repeat(64),
    retainedRuntimeSha: previous?.runtimeSha ?? '9'.repeat(40), retainedImageId: previous?.imageId ?? 'sha256:' + '9'.repeat(64),
    retainedRunning: true, ingressRestored: true, candidateRemoved: true, ...overrides};
  const raw = Buffer.from(JSON.stringify(receipt));
  return {hostRollbackBase64: raw.toString('base64'), hostRollbackSha256: sha(raw)};
}
function memoryStore() {
  const saved = new Map(), writes = []; let sequence = 0;
  const storage = {
    saved, writes, beforeWrite: null, loseResponse: null,
    async read(name) { assert.ok(Object.hasOwn(CHINA_STATE_KEYS, name)); return copy(saved.get(name) ?? empty()); },
    async compareAndSwap(name, previous, value) {
      assert.ok(Object.hasOwn(CHINA_STATE_KEYS, name)); writes.push({name, previous: copy(previous), value: copy(value)});
      if (storage.beforeWrite) await storage.beforeWrite(name, previous, value);
      const actual = await storage.read(name);
      if (actual.etag !== previous.etag || actual.found !== previous.found) throw Error('conditional_conflict');
      saved.set(name, {found: true, etag: '"native-' + ++sequence + '"', sha256: sha(bytes(value)), value: copy(value)});
      if (storage.loseResponse?.(name, value)) throw Error('lost_response_with_secret');
    },
    force(name, value) { saved.set(name, {found: true, etag: '"foreign-' + ++sequence + '"', sha256: sha(bytes(value)), value: copy(value)}); }
  };
  return storage;
}
async function setup({clock = () => now, token = nonce} = {}) {
  const storage = memoryStore(), state = createChinaState({storage, now: clock});
  const lease = await state.acquireLease({previous: empty(), owner: holder, nonce: token, expiresAt: expiry});
  return {storage, state, lease};
}
const reserve = (state, lease, ref = candidate()) => state.reserve({lease, previous: empty(), previousIntent: empty(), candidate: ref});

function codeCandidate(previous) {
  const {proof, ...reference} = previous.value.current;
  return {...reference, runtimeSha: 'a'.repeat(40), imageId: 'sha256:' + 'b'.repeat(64)};
}
function codeAcceptance(reference, previous, token = nonce, overrides = {}) {
  return acceptance(reference, token, {transition: 'code-update', previousAcceptedETag: previous.etag,
    previousAcceptedStateSha256: previous.sha256, retainedRuntimeSha: previous.value.current.runtimeSha,
    retainedImageId: previous.value.current.imageId, ...overrides});
}

async function setupCodeTransition() {
  const initialToken = 'e'.repeat(32);
  const {state, storage, lease: initialLease} = await setup({token: initialToken});
  const first = await state.commit({lease: initialLease, ...await reserve(state, initialLease),
    evidence: acceptance(candidate(), initialToken)});
  await state.releaseLease({lease: initialLease});
  const lease = await state.acquireLease({previous: await state.read('lease'), owner: holder, nonce, expiresAt: expiry});
  return {state, storage, lease, first};
}

test('an explicit code update preserves the complete accepted data identity and admits the next daily generation', async () => {
  const {state, lease, first} = await setupCodeTransition();
  const changed = codeCandidate(first.accepted);
  await assert.rejects(state.reserve({lease, previous: first.accepted, previousIntent: first.intent, candidate: changed}), /candidate_is_current/);
  const staged = await state.reserve({lease, previous: first.accepted, previousIntent: first.intent,
    candidate: changed, transition: 'code-update'});
  assert.equal(staged.intent.value.transition, 'code-update');
  await assert.rejects(state.commit({lease, ...staged, evidence: acceptance(changed)}), /code_update_predecessor/);
  const updated = await state.commit({lease, ...staged, evidence: codeAcceptance(changed, first.accepted)});
  assert.equal(updated.accepted.value.current.generationId, updated.accepted.value.rollback.generationId);
  assert.equal(updated.accepted.value.current.runtimeSha, changed.runtimeSha);
  assert.deepEqual(updated.accepted.value.rollback, first.accepted.value.current);
  assert.equal(inspectChinaPublicationState(updated).status, 'resolved');
  assert.equal(protectedChinaGenerations(updated).references.length, 1, 'data GC protects one shared generation');
  const next = {...candidate(2), runtimeSha: changed.runtimeSha, imageId: changed.imageId};
  const daily = await state.reserve({lease, previous: updated.accepted, previousIntent: updated.intent, candidate: next});
  assert.ok(!Object.hasOwn(daily.intent.value, 'transition'));
  const done = await state.commit({lease, ...daily, evidence: acceptance(next)});
  assert.equal(done.accepted.value.current.generationId, next.generationId);
  assert.deepEqual(done.accepted.value.rollback, updated.accepted.value.current);
  assert.equal(inspectChinaPublicationState(done).status, 'resolved');
});

test('code updates cannot relabel data, reuse application identity or accept an unrelated predecessor receipt', async () => {
  const {state, lease, storage, first} = await setupCodeTransition();
  const changed = codeCandidate(first.accepted), original = first.accepted.value.current;
  const invalid = [
    {...changed, receiptSha256: 'c'.repeat(64)}, {...changed, sourceDescriptorSha256: 'c'.repeat(64)},
    {...changed, generationManifestSha256: 'c'.repeat(64)}, {...changed, sourceCursor: changed.sourceCursor + 1},
    {...changed, sourceObservedAt: '2026-11-24T11:01:00Z'}, {...changed, pricingRuntimeSha: 'c'.repeat(40)},
    {...changed, owner: {...changed.owner, revision: 'c'.repeat(40)}},
    {...changed, owner: {...changed.owner, attempt: '2'}, generationId: changed.generationId.replace(/_1$/, '_2')},
  ];
  for (const reference of invalid) assert.throws(() => validateChinaCodeTransition(reference, original), /code_update_data_identity/);
  for (const reference of [{...changed, runtimeSha: original.runtimeSha}, {...changed, imageId: original.imageId}])
    assert.throws(() => validateChinaCodeTransition(reference, original), /code_update_runtime/);
  const baseline = storage.writes.length;
  await assert.rejects(state.reserve({lease, previous: first.accepted, previousIntent: first.intent,
    candidate: changed, transition: 'generation-update'}), /code_update_previous_required/);
  assert.equal(storage.writes.length, baseline);
  const staged = await state.reserve({lease, previous: first.accepted, previousIntent: first.intent,
    candidate: changed, transition: 'code-update'});
  for (const overrides of [{previousAcceptedETag: '"different"'}, {previousAcceptedStateSha256: 'c'.repeat(64)},
    {retainedRuntimeSha: 'c'.repeat(40)}, {retainedImageId: 'sha256:' + 'c'.repeat(64)}])
    await assert.rejects(state.commit({lease, ...staged, evidence: codeAcceptance(changed, first.accepted, nonce, overrides)}), /code_update_predecessor/);
  assert.deepEqual((await state.read('accepted')).value.current, original);
});

test('a same-generation rollback pair needs code proof and interrupted code acceptance finalizes without another switch', async () => {
  const {state, lease, storage, first} = await setupCodeTransition();
  const changed = codeCandidate(first.accepted);
  const staged = await state.reserve({lease, previous: first.accepted, previousIntent: first.intent,
    candidate: changed, transition: 'code-update'});
  storage.beforeWrite = async (name, previous, value) => { if (name === 'intent' && value.status === 'committed') throw Error('offline'); };
  await assert.rejects(state.commit({lease, ...staged, evidence: codeAcceptance(changed, first.accepted)}), /write_not_committed/);
  const saved = await state.read('accepted');
  assert.equal(inspectChinaPublicationState({accepted: saved, intent: staged.intent}).status, 'accepted_needs_finalization');
  const withoutProof = copy(saved.value), ordinary = acceptance(changed);
  withoutProof.current.proof = {kind: 'china-accepted-proof-v1', hostReceiptBase64: ordinary.hostReceiptBase64,
    hostReceiptSha256: ordinary.hostReceiptSha256};
  assert.throws(() => validateChinaAcceptedState(withoutProof), /rollback_identity/);
  const changedCommit = copy(saved.value); changedCommit.commit.previousStateSha256 = 'c'.repeat(64);
  assert.throws(() => validateChinaAcceptedState(changedCommit), /code_update_predecessor/);
  storage.beforeWrite = null;
  const done = await state.finalize({lease, accepted: saved, intent: staged.intent});
  assert.equal(inspectChinaPublicationState({accepted: saved, intent: done}).status, 'resolved');
});

test('code-update rollback requires actual rollback proof and restores the previous application and data', async () => {
  const {state, lease, first} = await setupCodeTransition();
  const staged = await state.reserve({lease, previous: first.accepted, previousIntent: first.intent,
    candidate: codeCandidate(first.accepted), transition: 'code-update'});
  await assert.rejects(state.abortReserved({lease, ...staged, evidence: rollback(staged.intent,
    {retainedRuntimeSha: 'a'.repeat(40)})}), /rollback_previous/);
  const done = await state.abortReserved({lease, ...staged, evidence: rollback(staged.intent)});
  assert.deepEqual(done.accepted.value.current, first.accepted.value.current);
  assert.deepEqual(done.accepted.value.rollback, first.accepted.value.rollback);
  assert.equal(inspectChinaPublicationState(done).status, 'resolved');
});

test('only a bound host receipt makes a reference accepted; bootstrap reservation is not accepted', async () => {
  const {state, lease} = await setup();
  const reserved = await reserve(state, lease);
  assert.equal(reserved.reservation.value.current, null);
  assert.ok(validateChinaAcceptedState(reserved.reservation.value));
  assert.throws(() => validateChinaGenerationReference(candidate(), {requireAccepted: true}), /accepted_proof_required/);
  const result = await state.commit({lease, ...reserved, evidence: acceptance(candidate())});
  const reference = validateChinaGenerationReference(result.accepted.value.current, {requireAccepted: true});
  assert.equal(reference.proof.hostReceiptSha256, acceptance(candidate()).hostReceiptSha256);
  assert.ok(Object.isFrozen(reference.owner));
  for (const field of ['receiptSha256', 'sourceDescriptorSha256', 'generationManifestSha256', 'runtimeSha', 'pricingRuntimeSha', 'imageId', 'sourceCursor', 'sourceObservedAt']) {
    const wrong = copy(reference);
    wrong[field] = field === 'sourceCursor' ? 123 : field === 'sourceObservedAt' ? '2026-11-24T10:00:00Z'
      : field === 'imageId' ? 'sha256:' + 'a'.repeat(64) : ['runtimeSha', 'pricingRuntimeSha'].includes(field) ? 'a'.repeat(40) : 'a'.repeat(64);
    assert.throws(() => validateChinaGenerationReference(wrong, {requireAccepted: true}), /host_binding/, field);
  }
  const wrong = copy(reference); wrong.owner.attempt = '2';
  assert.throws(() => validateChinaGenerationReference(wrong), /reference_binding/);
  const corrupt = copy(reference); corrupt.proof.hostReceiptBase64 += 'Z';
  assert.throws(() => validateChinaGenerationReference(corrupt), /proof_bytes/);
});

test('two real publications retain the previous accepted generation and bind the original ETag', async () => {
  const {state, lease, storage} = await setup();
  const first = await state.commit({lease, ...await reserve(state, lease), evidence: acceptance(candidate())});
  const released = await state.releaseLease({lease});
  const token = 'e'.repeat(32), nextLease = await state.acquireLease({previous: released, owner: holder, nonce: token, expiresAt: expiry});
  const second = await state.reserve({lease: nextLease, previous: first.accepted, previousIntent: first.intent, candidate: candidate(2)});
  assert.equal(second.reservation.value.current.generationId, candidate().generationId);
  assert.equal(second.intent.value.previous.etag, first.accepted.etag);
  const protect = protectedChinaGenerations({accepted: second.reservation, intent: second.intent});
  assert.equal(protect.deletionPermitted, false);
  assert.deepEqual(protect.references.map(ref => ref.generationId).sort(), [candidate().generationId, candidate(2).generationId].sort());
  const done = await state.commit({lease: nextLease, ...second, evidence: acceptance(candidate(2), token)});
  assert.equal(done.accepted.value.current.generationId, candidate(2).generationId);
  assert.equal(done.accepted.value.rollback.generationId, candidate().generationId);
  assert.equal(done.accepted.value.commit.previousETag, first.accepted.etag);
  assert.equal(inspectChinaPublicationState(done).status, 'resolved');
  const write = storage.writes.filter(row => row.name === 'accepted').at(-1);
  assert.equal(write.previous.etag, second.reservation.etag);
  assert.notEqual(write.previous.etag, first.accepted.etag);
  assert.deepEqual([...storage.saved.keys()].sort(), ['accepted', 'intent', 'lease']);
});

test('altered or false browser evidence never promotes a reserved candidate', async () => {
  const {state, lease, storage} = await setup(), reserved = await reserve(state, lease);
  const baseline = storage.writes.length;
  const wrongHash = acceptance(candidate()); wrongHash.browserDetailsBytes = Buffer.from('{}');
  await assert.rejects(state.commit({lease, ...reserved, evidence: wrongHash}), /report_hashes/);
  await assert.rejects(state.commit({lease, ...reserved, evidence: acceptance(candidate(), 'a'.repeat(32))}), /acceptance_intent/);
  await assert.rejects(state.commit({lease, ...reserved, evidence: acceptance(candidate(), nonce, {acceptedAt: '2026-11-24T11:59:59Z'})}), /acceptance_intent/);
  const falseReport = acceptance(candidate());
  const receipt = JSON.parse(Buffer.from(falseReport.hostReceiptBase64, 'base64'));
  receipt.browser.speedPassed = false;
  const raw = Buffer.from(JSON.stringify(receipt)); falseReport.hostReceiptBase64 = raw.toString('base64'); falseReport.hostReceiptSha256 = sha(raw);
  await assert.rejects(state.commit({lease, ...reserved, evidence: falseReport}), /browser_binding/);
  assert.equal(storage.writes.length, baseline);
  assert.equal((await state.read('accepted')).value.current, null);
});

test('a lost conditional PUT reply is reconciled by exact readback with no second PUT', async () => {
  const {state, lease, storage} = await setup();
  storage.loseResponse = name => name === 'intent' || name === 'accepted';
  const reserved = await reserve(state, lease);
  const done = await state.commit({lease, ...reserved, evidence: acceptance(candidate())});
  assert.equal(done.accepted.value.current.generationId, candidate().generationId);
  assert.deepEqual(storage.writes.map(row => row.name), ['lease', 'intent', 'accepted', 'accepted', 'intent']);
});

test('a foreign CAS change is not rebased or overwritten, even with a still-live lease', async () => {
  const {state, lease, storage} = await setup();
  const reserved = await reserve(state, lease), expected = reserved.reservation.etag;
  storage.beforeWrite = async (name, previous, value) => {
    if (name === 'accepted' && value.current) {
      storage.beforeWrite = null;
      storage.force(name, {...reserved.reservation.value, revision: 41});
    }
  };
  await assert.rejects(state.commit({lease, ...reserved, evidence: acceptance(candidate())}), /conflict/);
  const writes = storage.writes.filter(row => row.name === 'accepted' && row.value.current);
  assert.equal(writes.length, 1); assert.equal(writes[0].previous.etag, expected);
  assert.equal((await state.read('accepted')).value.revision, 41);
  assert.equal(inspectChinaPublicationState({accepted: await state.read('accepted'), intent: reserved.intent}).status, 'conflict');
});

test('a pending intent survives failure before reservation and can resume only its recorded previous ETag', async () => {
  const {state, lease, storage} = await setup();
  storage.beforeWrite = async name => { if (name === 'accepted') throw Error('offline'); };
  await assert.rejects(reserve(state, lease), /write_not_committed/);
  const intent = await state.read('intent');
  assert.equal(inspectChinaPublicationState({accepted: empty(), intent}).status, 'unreserved');
  await assert.rejects(state.reserve({lease, previous: empty(), previousIntent: intent, candidate: candidate(2)}), /unresolved_intent/);
  storage.beforeWrite = null;
  const reservation = await state.reserveSavedIntent({lease, intent});
  assert.equal(inspectChinaPublicationState({accepted: reservation, intent}).status, 'reserved');
  assert.equal((await state.reserveSavedIntent({lease, intent})).etag, reservation.etag);
});

test('fenced abandonment of an unreserved intent prevents its delayed writer from reserving', async () => {
  const {state, lease, storage} = await setup();
  storage.beforeWrite = async name => { if (name === 'accepted') throw Error('offline'); };
  await assert.rejects(reserve(state, lease), /write_not_committed/);
  const intent = await state.read('intent'); storage.beforeWrite = null;
  const aborted = await state.abandonUnreserved({lease, intent});
  assert.equal(aborted.accepted.value.current, null); assert.equal(aborted.intent.value.status, 'aborted');
  await assert.rejects(state.reserveSavedIntent({lease, intent}), /conflict/);
  await assert.rejects(storage.compareAndSwap('accepted', empty(), {...aborted.accepted.value, pending: {
    nonce, intentSha256: 'a'.repeat(64), candidateSha256: 'b'.repeat(64), createdAt: now}}), /conditional_conflict/);
  const next = await state.reserve({lease, previous: aborted.accepted, previousIntent: aborted.intent, candidate: candidate(2)});
  assert.equal(next.reservation.value.current, null);
});

test('reserved intent cannot be abandoned by timeout; a lost finalization uses actual accepted state', async () => {
  const {state, lease, storage} = await setup(), reserved = await reserve(state, lease);
  await assert.rejects(state.abandonUnreserved({lease, intent: reserved.intent}), /conflict/);
  storage.beforeWrite = async (name, previous, value) => { if (name === 'intent' && value.status === 'committed') throw Error('offline'); };
  await assert.rejects(state.commit({lease, ...reserved, evidence: acceptance(candidate())}), /write_not_committed/);
  const accepted = await state.read('accepted');
  assert.equal(inspectChinaPublicationState({accepted, intent: reserved.intent}).status, 'accepted_needs_finalization');
  storage.beforeWrite = null;
  const completed = await state.finalize({lease, accepted, intent: reserved.intent});
  assert.equal(completed.value.status, 'committed');
  assert.equal(storage.writes.filter(row => row.name === 'accepted').length, 2);
});

test('expired or replaced leases cannot renew or release another holder and never erase pending protection', async () => {
  let time = now;
  const {state, lease} = await setup({clock: () => time}), reserved = await reserve(state, lease);
  time = '2026-11-24T13:01:00Z';
  await assert.rejects(state.renewLease({lease, expiresAt: '2026-11-24T14:00:00Z'}), /lease_not_active/);
  const next = await state.acquireLease({previous: lease, owner: holder, nonce: 'e'.repeat(32), expiresAt: '2026-11-24T14:00:00Z'});
  assert.equal(next.value.epoch, 2);
  await assert.rejects(state.releaseLease({lease}), /conflict/);
  await assert.rejects(state.commit({lease, ...reserved, evidence: acceptance(candidate())}), /conflict/);
  const protectedState = protectedChinaGenerations({accepted: await state.read('accepted'), intent: await state.read('intent')});
  assert.equal(protectedState.references[0].generationId, candidate().generationId);
  assert.equal(protectedState.reconciliation, 'reserved');
});

test('bootstrap reserved abort requires an exact host rollback receipt and stays explicitly unaccepted', async () => {
  const {state, lease, storage} = await setup(), reserved = await reserve(state, lease);
  const before = storage.writes.length;
  await assert.rejects(state.abortReserved({lease, ...reserved}), /rollback_proof/);
  for (const changed of [{candidateRemoved: false}, {ingressRestored: false}, {retainedRunning: false},
    {previousAcceptedETag: '"wrong"'}, {previousAcceptedStateSha256: 'a'.repeat(64)}, {nonce: 'a'.repeat(32)},
    {generationManifestSha256: 'b'.repeat(64)}, {privateGenerationReceiptSha256: 'b'.repeat(64)},
    {pricingRuntimeSha: 'b'.repeat(40)}, {rolledBackAt: '2026-11-24T11:59:59Z'}])
    await assert.rejects(state.abortReserved({lease, ...reserved, evidence: rollback(reserved.intent, changed)}), /rollback_binding/);
  assert.equal(storage.writes.length, before);
  const result = await state.abortReserved({lease, ...reserved, evidence: rollback(reserved.intent)});
  assert.equal(result.accepted.value.current, null); assert.equal(result.accepted.value.pending, null);
  assert.equal(result.intent.value.status, 'aborted'); assert.equal(result.intent.value.resolution.kind, 'rolled_back');
  assert.equal(inspectChinaPublicationState(result).status, 'resolved');
  assert.equal(storage.writes.filter(row => row.name === 'accepted').at(-1).previous.etag, reserved.reservation.etag);
  await assert.rejects(state.commit({lease, ...reserved, evidence: acceptance(candidate())}), /conflict/);
});

test('rollback restores the exact previous accepted identity and lost finalization still needs the real rollback bytes', async () => {
  const {state, lease, storage} = await setup();
  const first = await state.commit({lease, ...await reserve(state, lease), evidence: acceptance(candidate())});
  const reserved = await state.reserve({lease, previous: first.accepted, previousIntent: first.intent, candidate: candidate(2)});
  await assert.rejects(state.abortReserved({lease, ...reserved, evidence: rollback(reserved.intent, {retainedRuntimeSha: 'a'.repeat(40)})}), /rollback_previous/);
  await assert.rejects(state.abortReserved({lease, ...reserved, evidence: rollback(reserved.intent, {retainedImageId: 'sha256:' + 'a'.repeat(64)})}), /rollback_previous/);
  const evidence = rollback(reserved.intent);
  storage.beforeWrite = async (name, previous, value) => { if (name === 'intent' && value.status === 'aborted') throw Error('offline'); };
  await assert.rejects(state.abortReserved({lease, ...reserved, evidence}), /write_not_committed/);
  const accepted = await state.read('accepted');
  assert.deepEqual(accepted.value.current, first.accepted.value.current);
  assert.deepEqual(accepted.value.rollback, first.accepted.value.rollback);
  assert.equal(inspectChinaPublicationState({accepted, intent: reserved.intent}).status, 'rollback_needs_evidence');
  await assert.rejects(state.finalize({lease, accepted, intent: reserved.intent}), /resolution_unproved/);
  await assert.rejects(state.finalizeRollback({lease, accepted, intent: reserved.intent}), /rollback_proof/);
  storage.beforeWrite = null;
  const result = await state.finalizeRollback({lease, accepted, intent: reserved.intent, evidence});
  assert.equal(result.intent.value.resolution.rollbackProof.hostRollbackSha256, evidence.hostRollbackSha256);
  assert.equal(inspectChinaPublicationState(result).status, 'resolved');
  assert.equal(storage.writes.filter(row => row.name === 'accepted').length, 4);
});

const environment = {YC_OBJECT_STORAGE_ENDPOINT: 'https://s3.regru.cloud', YC_OBJECT_STORAGE_REGION: 'us-east-1',
  YC_OBJECT_STORAGE_BUCKET: 'avtocena-staging-8120751', YC_OBJECT_STORAGE_PREFIX: 'migration-staging/full-20261011/',
  YC_OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access', YC_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret'};
const ACL = '<AccessControlPolicy><Owner><ID>owner</ID></Owner><AccessControlList><Grant>' +
  '<Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>owner</ID></Grantee>' +
  '<Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>';
function transportFixture() {
  const data = new Map(), calls = []; let sequence = 0;
  const fixture = {data, calls, corruptAcl: false, conflict: false, loseWrite: false,
    async fetcher(url, options) {
      const parsed = new URL(url), name = Object.entries(CHINA_STATE_KEYS).find(([, key]) => parsed.pathname.endsWith('/' + key))?.[0];
      calls.push({url, options, name});
      assert.equal(parsed.hostname, 's3.regru.cloud');
      assert.equal(options.redirect, 'error');
      assert.match(options.headers.authorization, /^AWS4-HMAC-SHA256 Credential=test-access\//);
      if (parsed.searchParams.has('policy')) return new Response('<Error><Code>NoSuchBucketPolicy</Code></Error>', {status: 404});
      if (parsed.searchParams.has('acl')) return new Response(fixture.corruptAcl ? ACL.replace(/owner/g, 'stranger') : ACL,
        {status: name && !data.has(name) ? 404 : 200});
      assert.ok(name);
      if (options.method === 'GET') {
        const saved = data.get(name);
        return saved ? new Response(saved.bytes, {headers: {etag: saved.etag}}) : new Response('', {status: 404});
      }
      assert.equal(options.method, 'PUT'); assert.equal(options.headers['x-amz-acl'], 'private');
      const saved = data.get(name), condition = options.headers['if-match'];
      if (fixture.conflict || (saved ? condition !== saved.etag.slice(1, -1) : options.headers['if-none-match'] !== '*'))
        return new Response('private details must not be logged', {status: 412});
      if (saved) {
        assert.ok(!condition.includes('"'));
        assert.match(options.headers.authorization, /SignedHeaders=[^,]*if-match/);
      }
      data.set(name, {bytes: Buffer.from(options.body), etag: '"reg-etag-' + ++sequence + '"'});
      if (fixture.loseWrite) throw Error('S3 credentials test-secret must not leak');
      return new Response('', {status: 200});
    }
  };
  return fixture;
}

test('native REG transport signs conditional ETag writes and exposes only three private keys', async () => {
  const fake = transportFixture(), transport = createChinaStateStorage({environment, fetcher: fake.fetcher});
  await assert.rejects(transport.read('lease'), /privacy_not_checked/);
  await transport.assertPrivateBucket();
  const state = createChinaState({storage: transport, now: () => now});
  const lease = await state.acquireLease({previous: await state.read('lease'), owner: holder, nonce, expiresAt: expiry});
  assert.equal(lease.etag, '"reg-etag-1"');
  const renewed = await state.renewLease({lease, expiresAt: '2026-11-24T14:00:00Z'});
  assert.equal(renewed.etag, '"reg-etag-2"');
  assert.equal(fake.calls.filter(call => call.options.method === 'PUT').length, 2);
  await assert.rejects(transport.read('catalog/manifest.json'), /key/);
  assert.deepEqual(Object.keys(transport).sort(), ['assertPrivateBucket', 'compareAndSwap', 'read']);
  assert.ok(fake.calls.every(call => call.options.method === 'GET' || call.options.method === 'PUT'));
});

test('native REG conflicts, ACL drift and transport errors remain safe and do not trigger an unconditional retry', async () => {
  const fake = transportFixture(), transport = createChinaStateStorage({environment, fetcher: fake.fetcher});
  await transport.assertPrivateBucket();
  const state = createChinaState({storage: transport, now: () => now});
  const lease = await state.acquireLease({previous: empty(), owner: holder, nonce, expiresAt: expiry});
  fake.conflict = true;
  await assert.rejects(state.renewLease({lease, expiresAt: '2026-11-24T14:00:00Z'}), /write_not_committed/);
  assert.equal(fake.calls.filter(call => call.options.method === 'PUT').length, 2);
  fake.conflict = false; fake.loseWrite = true;
  const renewed = await state.renewLease({lease, expiresAt: '2026-11-24T14:00:00Z'});
  assert.equal(renewed.value.expiresAt, '2026-11-24T14:00:00Z');
  assert.equal(fake.calls.filter(call => call.options.method === 'PUT').length, 3);
  fake.corruptAcl = true;
  await assert.rejects(transport.read('lease'), /object_acl/);
  await assert.rejects(transport.assertPrivateBucket(), /privacy_changed/);
});

const networkFailure = (code = 'ECONNRESET') => Object.assign(new TypeError('private endpoint credential=test-secret'),
  {cause: {code, message: 'private cause test-secret'}});

test('other state-storage callers keep the original one-attempt read behavior by default', async () => {
  let attempts = 0;
  const transport = createChinaStateStorage({environment, pause: async () => assert.fail('retry not enabled'),
    fetcher: async () => { attempts++; throw networkFailure(); }});
  await assert.rejects(transport.assertPrivateBucket(), error => error.stateStorageFailure.attempts === 1);
  assert.equal(attempts, 1);
});

test('a transient state GET is retried once with a fresh signature and no weakened read validation', async () => {
  const fake = transportFixture(), attempts = [], pauses = []; let time = Date.parse(now), armed = false;
  const transport = createChinaStateStorage({environment, retryTransientReads: true, clock: () => time,
    pause: async ms => { pauses.push(ms); time += ms; },
    fetcher: async (url, options) => {
      if (armed && options.method === 'GET' && new URL(url).pathname.endsWith('/lease.json') && !new URL(url).search) {
        attempts.push({url, options});
        if (attempts.length === 1) { time += 30_000; throw networkFailure('UND_ERR_SOCKET'); }
      }
      return fake.fetcher(url, options);
    }});
  await transport.assertPrivateBucket();
  const state = createChinaState({storage: transport, now: () => new Date(time).toISOString()});
  const lease = await state.acquireLease({previous: empty(), owner: holder, nonce, expiresAt: expiry});
  armed = true;
  assert.deepEqual(await state.read('lease'), lease);
  assert.equal(attempts.length, 2); assert.deepEqual(pauses, [250]);
  assert.equal(attempts[0].url, attempts[1].url);
  assert.notEqual(attempts[0].options.headers['x-amz-date'], attempts[1].options.headers['x-amz-date']);
  assert.ok(attempts.every(item => item.options.redirect === 'error' && item.options.body === undefined));
  assert.equal(fake.calls.filter(item => item.options.method === 'PUT').length, 1);
});

test('GET retries stop at two attempts or the total deadline and retain only bounded failure facts', async () => {
  for (const consumeBudget of [false, true]) {
    let time = Date.parse(now), attempts = 0, pauses = 0;
    const transport = createChinaStateStorage({environment, retryTransientReads: true, clock: () => time,
      pause: async ms => { pauses++; time += ms; }, fetcher: async () => {
        attempts++; if (consumeBudget) time += 45_000; throw networkFailure('ETIMEDOUT');
      }});
    await assert.rejects(transport.assertPrivateBucket(), error => {
      assert.equal(error.message, 'china_state_storage_transport');
      assert.deepEqual(error.stateStorageFailure, {version: 1, kind: 'china-state-storage-failure-v1',
        method: 'GET', target: 'bucket', part: 'acl', phase: 'headers', attempts: consumeBudget ? 1 : 2, cause: 'ETIMEDOUT'});
      assert.equal(JSON.stringify(error).includes('test-secret'), false); return true;
    });
    assert.equal(attempts, consumeBudget ? 1 : 2); assert.equal(pauses, consumeBudget ? 0 : 1);
  }
});

test('unknown failures, redirects, HTTP rejection and invalid ACLs are never retried', async () => {
  for (const behavior of ['unknown', 'redirect', 'forbidden', 'unavailable', 'acl']) {
    let attempts = 0;
    const transport = createChinaStateStorage({environment, retryTransientReads: true, pause: async () => assert.fail('not retryable'),
      fetcher: async () => {
        attempts++;
        if (behavior === 'unknown') throw Error('private test-secret');
        if (behavior === 'redirect') throw Object.assign(new TypeError('fetch failed'), {cause: Error('unexpected redirect')});
        if (behavior === 'acl') return new Response('<private>test-secret</private>');
        return new Response('test-secret', {status: behavior === 'forbidden' ? 403 : 503});
      }});
    await assert.rejects(transport.assertPrivateBucket(), error => {
      assert.equal(String(error).includes('test-secret'), false); return true;
    });
    assert.equal(attempts, 1, behavior);
  }
});

test('a truncated transient GET discards partial bytes before revalidating the complete response', async () => {
  const fake = transportFixture(); let armed = false, attempts = 0;
  const transport = createChinaStateStorage({environment, retryTransientReads: true, pause: async () => {}, fetcher: async (url, options) => {
    if (armed && options.method === 'GET' && !new URL(url).search) {
      attempts++;
      if (attempts === 1) return {status: 200, headers: new Headers(), body: (async function* () {
        yield Buffer.from('partial private test-secret'); throw networkFailure('UND_ERR_BODY_TIMEOUT');
      })()};
    }
    return fake.fetcher(url, options);
  }});
  await transport.assertPrivateBucket(); const state = createChinaState({storage: transport, now: () => now});
  const lease = await state.acquireLease({previous: empty(), owner: holder, nonce, expiresAt: expiry});
  armed = true;
  assert.deepEqual(await state.read('lease'), lease); assert.equal(attempts, 2);
});

test('even an allowlisted transient lost PUT reply gets one write and exact readback, never a replay', async () => {
  const fake = transportFixture(); let puts = 0;
  const transport = createChinaStateStorage({environment, retryTransientReads: true, pause: async () => assert.fail('PUT must not retry'),
    fetcher: async (url, options) => {
      const response = await fake.fetcher(url, options);
      if (options.method === 'PUT') { puts++; throw networkFailure('ECONNRESET'); }
      return response;
    }});
  await transport.assertPrivateBucket(); const state = createChinaState({storage: transport, now: () => now});
  const lease = await state.acquireLease({previous: empty(), owner: holder, nonce, expiresAt: expiry});
  assert.equal(lease.value.status, 'held'); assert.equal(puts, 1);
  assert.equal(fake.calls.filter(item => item.options.method === 'PUT').length, 1);
});

test('a successful retry cannot rebase a changed ETag or revive an expired lease', async () => {
  for (const change of ['etag', 'expiry']) {
    const fake = transportFixture(); let time = Date.parse(now), armed = false, failed = false;
    const transport = createChinaStateStorage({environment, retryTransientReads: true, clock: () => time, pause: async ms => { time += ms; },
      fetcher: async (url, options) => {
        if (armed && !failed && options.method === 'GET' && !new URL(url).search) {
          failed = true;
          if (change === 'etag') {
            const value = JSON.parse(fake.data.get('lease').bytes);
            fake.data.set('lease', {bytes: bytes({...value, epoch: value.epoch + 1, nonce: 'a'.repeat(32)}), etag: '"foreign"'});
          } else time += 2_000;
          throw networkFailure();
        }
        return fake.fetcher(url, options);
      }});
    await transport.assertPrivateBucket();
    const state = createChinaState({storage: transport, now: () => new Date(time).toISOString()});
    const lease = await state.acquireLease({previous: empty(), owner: holder, nonce,
      expiresAt: new Date(time + 1_000).toISOString()});
    armed = true;
    await assert.rejects(state.renewLease({lease, expiresAt: expiry}), change === 'etag' ? /conflict/ : /lease_not_active/);
    assert.equal(fake.calls.filter(item => item.options.method === 'PUT').length, 1);
  }
});

test('failure evidence rejects extra fields, unknown operations, PUT retries and private values', () => {
  const base = {version: 1, kind: 'china-state-storage-failure-v1', method: 'GET', target: 'lease',
    part: 'document', phase: 'headers', attempts: 2, cause: 'ECONNRESET'};
  assert.deepEqual(checkedChinaStateStorageFailure(base), base);
  for (const change of [{url: 'private://secret'}, {method: 'DELETE'}, {target: 'catalog/raw/private'}, {cause: 'secret'},
    {attempts: 3}, {method: 'PUT'}, {part: 'policy'}])
    assert.throws(() => checkedChinaStateStorageFailure({...base, ...change}), /storage_failure_evidence/);
});
