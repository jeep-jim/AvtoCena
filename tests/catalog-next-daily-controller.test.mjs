import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createChinaState, CHINA_STATE_KEYS, inspectChinaPublicationState} from '../scripts/catalog-next/china-state.mjs';
import {runChinaDailyCycle, chinaDailyIsDue} from '../scripts/catalog-next/daily-controller.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const digest = value => hash(JSON.stringify(ordered(value)));
const copy = value => JSON.parse(JSON.stringify(value));
const empty = () => ({found: false, etag: null, sha256: null, value: null});
const firstAt = '2026-11-23T12:00:00.000Z', nextAt = '2026-11-24T12:00:00.000Z';
const firstNonce = 'a'.repeat(32), nextNonce = 'b'.repeat(32);
const owner = id => ({runId: String(1000 + id), attempt: '1', revision: '1'.repeat(40)});
const plan = {version: 1, market: 'china', minimumYear: 2014, runtimeSha: '2'.repeat(40)};
function candidate(id = 1) {
  return {market: 'china', generationId: `gen_china_${owner(id).runId}_1`, owner: owner(id),
    receiptSha256: hash('receipt' + id), sourceDescriptorSha256: hash('source' + id), generationManifestSha256: hash('generation' + id),
    sourceCursor: id * 100, sourceObservedAt: id === 1 ? '2026-11-23T11:00:00.000Z' : '2026-11-24T11:00:00.000Z',
    runtimeSha: '3'.repeat(40), pricingRuntimeSha: plan.runtimeSha, imageId: 'sha256:' + '4'.repeat(64)};
}
function acceptance(reference, nonce, at) {
  const browserSpeedBytes = Buffer.from(JSON.stringify({release: reference.runtimeSha, passed: true, browserPassed: true, speedGuard: {passed: true}}));
  const browserDetailsBytes = Buffer.from(JSON.stringify({kind: 'china-browser-details-v1', release: reference.runtimeSha,
    nonce, passed: true, generationManifestSha256: reference.generationManifestSha256, precedingSpeedReportSha256: hash(browserSpeedBytes)}));
  const raw = Buffer.from(JSON.stringify({version: 1, kind: 'china-host-acceptance-v1', release: reference.runtimeSha,
    pricingRuntimeSha: reference.pricingRuntimeSha, generationId: reference.generationId,
    generationManifestSha256: reference.generationManifestSha256, privateGenerationReceiptSha256: reference.receiptSha256,
    sourceDescriptorSha256: reference.sourceDescriptorSha256, sourceCursor: reference.sourceCursor,
    sourceObservedAt: reference.sourceObservedAt, imageId: reference.imageId, nonce, acceptedAt: at, retainedContainerId: '5'.repeat(64),
    browser: {release: reference.runtimeSha, nonce, passed: true, functionalPassed: true, speedPassed: true,
      speedReportSha256: hash(browserSpeedBytes), detailsReportSha256: hash(browserDetailsBytes),
      reportSha256: hash(Buffer.concat([browserSpeedBytes, browserDetailsBytes]))}}));
  return {hostReceiptBase64: raw.toString('base64'), hostReceiptSha256: hash(raw), browserSpeedBytes, browserDetailsBytes};
}
function acceptedReference(sourceObservedAt, acceptedAt = sourceObservedAt) {
  const reference = {...candidate(1), sourceObservedAt}, proof = acceptance(reference, firstNonce, acceptedAt);
  return {...reference, proof: {kind: 'china-accepted-proof-v1', hostReceiptBase64: proof.hostReceiptBase64,
    hostReceiptSha256: proof.hostReceiptSha256}};
}
function rollback(intent, at) {
  const ref = intent.value.candidate, previous = intent.value.previous.value.current;
  const raw = Buffer.from(JSON.stringify({version: 1, kind: 'china-host-rollback-v1', release: ref.runtimeSha,
    pricingRuntimeSha: ref.pricingRuntimeSha, generationId: ref.generationId, generationManifestSha256: ref.generationManifestSha256,
    privateGenerationReceiptSha256: ref.receiptSha256, sourceDescriptorSha256: ref.sourceDescriptorSha256, imageId: ref.imageId,
    nonce: intent.value.nonce, previousAcceptedETag: intent.value.previous.etag, previousAcceptedStateSha256: intent.value.previous.sha256,
    rolledBackAt: at, retainedContainerId: '5'.repeat(64), retainedRuntimeSha: previous.runtimeSha, retainedImageId: previous.imageId,
    retainedRunning: true, ingressRestored: true, candidateRemoved: true}));
  return {hostRollbackBase64: raw.toString('base64'), hostRollbackSha256: hash(raw)};
}
function memoryStorage() {
  let sequence = 0;
  const objects = new Map(), writes = [];
  const storage = {objects, writes, rejectWrite: null,
    async assertPrivateBucket() { return {verified: true}; },
    async read(name) { assert.ok(Object.hasOwn(CHINA_STATE_KEYS, name)); return copy(objects.get(name) ?? empty()); },
    async compareAndSwap(name, previous, value) {
      assert.ok(Object.hasOwn(CHINA_STATE_KEYS, name));
      writes.push({name, previous: copy(previous), value: copy(value)});
      if (storage.rejectWrite?.(name, value)) throw Error('fixture_lost_transport');
      const old = objects.get(name) ?? empty();
      if (old.etag !== previous.etag || old.found !== previous.found) throw Error('fixture_conflict');
      objects.set(name, {found: true, etag: '"native-' + ++sequence + '"', sha256: digest(value), value: copy(value)});
    },
    force(name, value) { objects.set(name, {found: true, etag: '"foreign-' + ++sequence + '"', sha256: digest(value), value: copy(value)}); },
  };
  return storage;
}
async function seed() {
  const storage = memoryStorage(), state = createChinaState({storage, now: () => firstAt});
  const lease = await state.acquireLease({previous: empty(), owner: owner(1), nonce: firstNonce, expiresAt: '2026-11-23T13:00:00Z'});
  const reserved = await state.reserve({lease, previous: empty(), previousIntent: empty(), candidate: candidate(1)});
  const first = await state.commit({lease, ...reserved, evidence: acceptance(candidate(1), firstNonce, firstAt)});
  await state.releaseLease({lease});
  return {storage, first};
}
function prepared(previous, id = 2) {
  const ref = candidate(id);
  return {version: 1, completed: true, published: false, liveCatalogWrites: 0, encyclopediaWrites: 0,
    calculatorFormulaChanges: 0, deletions: 0, runtime: {runtimeSha: plan.runtimeSha},
    sourceInput: {kind: 'accepted-generation', generationId: previous.generationId, owner: previous.owner,
      receiptSha256: previous.receiptSha256, sourceDescriptorSha256: previous.sourceDescriptorSha256,
      runtimeSha: previous.runtimeSha, pricingRuntimeSha: previous.pricingRuntimeSha,
      sourceCursor: previous.sourceCursor, sourceObservedAt: previous.sourceObservedAt},
    source: {sourceCursor: ref.sourceCursor, sourceObservedAt: ref.sourceObservedAt, sourceDescriptorSha256: ref.sourceDescriptorSha256,
      supplierLatestVerified: true, reconciliation: {sourceRows: 20}},
    pricing: {runtimeSha: plan.runtimeSha, generationId: ref.generationId,
      generationManifestSha256: ref.generationManifestSha256, sourceDescriptorSha256: ref.sourceDescriptorSha256},
    privateGeneration: {owner: ref.owner, generationId: ref.generationId, receiptSha256: ref.receiptSha256,
      generationManifestSha256: ref.generationManifestSha256, sourceDescriptorSha256: ref.sourceDescriptorSha256}};
}
async function fixture() {
  const {storage, first} = await seed(), events = [];
  let clock = nextAt, tick, stopped = false;
  const args = {runtimeRoot: '/unused-local-fixture', runnerTemp: '/unused-local-fixture', plan,
    invocation: {version: 1, sourceSha: owner(2).revision}, owner: owner(2), storage, nonce: nextNonce,
    now: () => clock, scheduleHeartbeat(fn) { tick = fn; return () => { stopped = true; }; },
    async prepare(input) {
      events.push('prepare'); assert.equal(input.sourceSelection.kind, 'accepted-generation');
      assert.deepEqual(input.sourceSelection.generation, first.accepted.value.current);
      await input.assertAuthority(); return prepared(input.sourceSelection.generation);
    },
    async stageRelease(input) {
      events.push('stage'); assert.deepEqual(input.candidate, candidate(2));
      const before = await storage.read('accepted'); assert.equal(before.value.pending, null);
      assert.equal(before.value.current.generationId, candidate(1).generationId);
      await input.assertAuthority();
      return {candidate: input.candidate,
        async activate({intent, reservation, assertAuthority}) {
          events.push('activate'); await assertAuthority();
          const current = await storage.read('accepted'); assert.equal(current.etag, reservation.etag);
          assert.equal(current.value.pending.nonce, nextNonce); assert.equal(intent.value.status, 'pending');
          return {kind: 'accepted', evidence: acceptance(input.candidate, nextNonce, clock)};
        },
        async close() { events.push('close'); },
      };
    },
    async recoverRelease() { events.push('recover'); return null; },
  };
  return {storage, first, args, events, clock: value => { clock = value; }, tick: () => tick(), stopped: () => stopped};
}

test('daily cycle uses accepted source, reserves before activation and reuses the accepted image', async () => {
  const f = await fixture();
  f.args.retirePreviousHost = async () => assert.fail('there is no displaced rollback deployment');
  const result = await runChinaDailyCycle(f.args);
  assert.equal(result.status, 'accepted'); assert.equal(result.published, true); assert.equal(result.applicationBuilds, 0);
  assert.equal(result.hostCleanupBeforeReserve, undefined);
  assert.equal(result.acceptedGenerationId, candidate(2).generationId);
  assert.deepEqual(f.events, ['prepare', 'stage', 'activate', 'close']); assert.equal(f.stopped(), true);
  const accepted = await f.storage.read('accepted'), intent = await f.storage.read('intent'), lease = await f.storage.read('lease');
  assert.equal(accepted.value.current.imageId, f.first.accepted.value.current.imageId);
  assert.equal(accepted.value.current.runtimeSha, f.first.accepted.value.current.runtimeSha);
  assert.equal(accepted.value.current.pricingRuntimeSha, plan.runtimeSha);
  assert.deepEqual(accepted.value.rollback, f.first.accepted.value.current);
  assert.equal(inspectChinaPublicationState({accepted, intent}).status, 'resolved');
  assert.equal(lease.value.status, 'released');
  assert.deepEqual([...f.storage.objects.keys()].sort(), ['accepted', 'intent', 'lease']);
  assert.equal(JSON.stringify(result).includes('hostReceiptBase64'), false);
});

test('missing real accepted state or missing release hooks cannot start preparation', async () => {
  const f = await fixture(); f.args.storage = memoryStorage();
  await assert.rejects(runChinaDailyCycle(f.args), error => error.message === 'china_daily_accepted_source_required' && error.report.published === false);
  assert.deepEqual(f.events, []); assert.equal((await f.args.storage.read('accepted')).found, false);
  await assert.rejects(runChinaDailyCycle({...f.args, stageRelease: undefined}), /china_daily_capabilities/);
  assert.deepEqual(f.events, []);
});

test('preparation failure leaves the prior pointer and source intact and sanitizes the public error', async () => {
  const f = await fixture(); f.args.prepare = async () => { throw Error('credential=private_supplier_value'); };
  await assert.rejects(runChinaDailyCycle(f.args), error => error.message === 'china_daily_failed'
    && error.report.published === false && !JSON.stringify(error.report).includes('private_supplier_value'));
  assert.deepEqual(await f.storage.read('accepted'), f.first.accepted);
  assert.deepEqual(await f.storage.read('intent'), f.first.intent); assert.deepEqual(f.events, []);
});

test('a changed accepted ETag during preparation prevents staging and is never rebased', async () => {
  const f = await fixture(), prepare = f.args.prepare;
  f.args.prepare = async args => { const output = await prepare(args);
    f.storage.force('accepted', {...f.first.accepted.value, revision: 99}); return output; };
  await assert.rejects(runChinaDailyCycle(f.args), error => error.message === 'china_daily_state_changed'
    && error.report.status === 'needs_reconciliation');
  assert.deepEqual(f.events, ['prepare']); assert.equal((await f.storage.read('accepted')).value.revision, 99);
  assert.equal(f.storage.writes.filter(row => row.name === 'intent').length, 2, 'only the first seeded acceptance intent was written');
});

test('actual host rollback after activation failure restores the old pointer, without fabricating success', async () => {
  const f = await fixture(); let pending;
  f.args.retireTerminalAppImage = async () => assert.fail('a data-generation rollback cannot delete its reused application image');
  f.args.stageRelease = async ({candidate: ref}) => ({candidate: ref,
    async activate({intent}) { pending = intent; f.events.push('activate'); throw Error('connection_lost'); },
    async close() { f.events.push('close'); },
  });
  f.args.recoverRelease = async () => { f.events.push('recover'); assert.equal(f.events.at(-2), 'close');
    return {kind: 'rolled_back', evidence: rollback(pending, nextAt)}; };
  await assert.rejects(runChinaDailyCycle(f.args), error => error.report.status === 'rolled_back' && error.report.published === false);
  const accepted = await f.storage.read('accepted'), intent = await f.storage.read('intent');
  assert.deepEqual(accepted.value.current, f.first.accepted.value.current); assert.equal(accepted.value.pending, null);
  assert.equal(intent.value.resolution.kind, 'rolled_back');
});

test('lost activation response commits only the actual retained host acceptance and exact browser bytes', async () => {
  const f = await fixture(); let evidence;
  f.args.stageRelease = async ({candidate: ref}) => ({candidate: ref,
    async activate() { evidence = acceptance(ref, nextNonce, nextAt); throw Error('connection_lost_after_accept'); },
    async close() { f.events.push('close'); },
  });
  f.args.recoverRelease = async () => ({kind: 'accepted', evidence});
  const result = await runChinaDailyCycle(f.args);
  assert.equal(result.status, 'accepted'); assert.equal(result.recovered, true); assert.equal(result.published, true);
  assert.equal((await f.storage.read('accepted')).value.current.proof.hostReceiptSha256, evidence.hostReceiptSha256);
});

test('a close response failure after committed acceptance reports the persisted outcome instead of a false rollback', async () => {
  const f = await fixture(), stage = f.args.stageRelease;
  f.args.stageRelease = async input => ({...await stage(input), async close() { throw Error('close_response_lost'); }});
  const result = await runChinaDailyCycle(f.args);
  assert.equal(result.status, 'accepted'); assert.equal(result.published, true); assert.equal(result.recovered, true);
  assert.equal(result.leaseReleased, true);
  assert.equal((await f.storage.read('accepted')).value.current.generationId, candidate(2).generationId);
  assert.equal(f.events.includes('recover'), false, 'the complete accepted state already carries the verified real proof');
});

test('unresolved host outcome keeps the reservation protected and prevents a second source refresh', async () => {
  const f = await fixture(), state = createChinaState({storage: f.storage, now: () => nextAt});
  const lease = await state.acquireLease({previous: await state.read('lease'), owner: owner(9), nonce: 'c'.repeat(32), expiresAt: '2026-11-24T13:00:00Z'});
  const reserved = await state.reserve({lease, previous: f.first.accepted, previousIntent: f.first.intent, candidate: candidate(9)});
  await state.releaseLease({lease});
  await assert.rejects(runChinaDailyCycle(f.args), error => error.message === 'china_daily_pending_host_outcome'
    && error.report.status === 'needs_reconciliation' && error.report.protectedGenerations === 2);
  assert.ok(f.events.every(event => event === 'recover')); assert.equal(f.events.includes('prepare'), false);
  assert.deepEqual(await f.storage.read('accepted'), reserved.reservation);
  assert.equal((await f.storage.read('intent')).value.status, 'pending');
});

test('real accepted-state with interrupted intent finalization is repaired before any new daily work', async () => {
  const f = await fixture(), state = createChinaState({storage: f.storage, now: () => nextAt});
  const lease = await state.acquireLease({previous: await state.read('lease'), owner: owner(2), nonce: nextNonce, expiresAt: '2026-11-24T13:00:00Z'});
  const reserved = await state.reserve({lease, previous: f.first.accepted, previousIntent: f.first.intent, candidate: candidate(2)});
  f.storage.rejectWrite = (name, value) => name === 'intent' && value.status === 'committed';
  await assert.rejects(state.commit({lease, ...reserved, evidence: acceptance(candidate(2), nextNonce, nextAt)}), /write_not_committed/);
  f.storage.rejectWrite = null; await state.releaseLease({lease});
  const result = await runChinaDailyCycle({...f.args, owner: owner(3), nonce: 'd'.repeat(32)});
  assert.equal(result.status, 'not_due'); assert.equal(result.recovered, true); assert.equal(result.published, false);
  assert.deepEqual(f.events, []); assert.equal((await f.storage.read('intent')).value.status, 'committed');
});

test('not_due keeps an eligible committed host witness without retrying retirement or preparing a source', async () => {
  const f = await fixture(), state = createChinaState({storage: f.storage, now: () => nextAt});
  for (const id of [2, 3]) {
    const nonce = String(id).repeat(32);
    const lease = await state.acquireLease({previous: await state.read('lease'), owner: owner(id), nonce,
      expiresAt: '2026-11-24T13:00:00.000Z'});
    const reserved = await state.reserve({lease, previous: await state.read('accepted'),
      previousIntent: await state.read('intent'), candidate: candidate(id)});
    await state.commit({lease, ...reserved, evidence: acceptance(candidate(id), nonce, nextAt)});
    await state.releaseLease({lease});
  }
  const publication = {accepted: await state.read('accepted'), intent: await state.read('intent')};
  assert.equal(publication.intent.value.status, 'committed');
  assert.ok(publication.intent.value.previous.value.rollback);
  assert.equal(chinaDailyIsDue(publication.accepted.value.current, nextAt), false);
  f.storage.writes.length = 0;
  const result = await runChinaDailyCycle({...f.args, owner: owner(4), nonce: '4'.repeat(32),
    retirePreviousHost: async () => assert.fail('not_due cannot attempt host cleanup'),
    retireTerminalAppImage: async () => assert.fail('not_due cannot attempt app-image cleanup'),
    prepare: async () => assert.fail('not_due cannot read a source'),
  });
  assert.equal(result.status, 'not_due'); assert.equal(result.published, false); assert.equal(result.sourcePrepared, false);
  assert.equal(result.hostCleanupBeforeReserve, undefined); assert.equal(result.leaseReleased, true);
  assert.equal(result.appImageCleanup, undefined); assert.equal(result.appImageCleanupBeforeReserve, undefined);
  assert.deepEqual(f.events, []);
  assert.deepEqual({accepted: await state.read('accepted'), intent: await state.read('intent')}, publication);
  assert.equal(f.storage.writes.filter(row => row.name === 'accepted' || row.name === 'intent').length, 0);
});

test('heartbeat renews the exact lease observation during preparation and later commit uses its new ETag', async () => {
  const f = await fixture(), prepare = f.args.prepare;
  f.args.prepare = async args => {
    const output = await prepare(args);
    f.clock('2026-11-24T12:08:00Z'); f.tick(); await args.assertAuthority(); return output;
  };
  const result = await runChinaDailyCycle(f.args);
  assert.equal(result.status, 'accepted');
  const leases = f.storage.writes.filter(row => row.name === 'lease');
  assert.equal(leases.length, 5, 'seed acquire/release plus daily acquire/renew/release');
  assert.equal(leases.at(-2).value.expiresAt, '2026-11-24T12:23:00.000Z');
  assert.notEqual(leases.at(-1).previous.etag, leases.at(-2).previous.etag);
  assert.equal(leases.at(-1).value.epoch, leases.at(-2).value.epoch);
});

test('a source refreshed after midnight covers the delayed schedule but is due at the next 21:00 window', () => {
  const accepted = acceptedReference('2026-11-25T17:34:57.542Z', '2026-11-25T19:24:32.246Z');
  for (const [at, due] of [
    ['2026-11-25T19:24:32.246Z', false],
    ['2026-11-25T22:59:01.000Z', false], // Delayed run: 26 November, 05:59 Krasnoyarsk.
    ['2026-11-26T13:59:59.999Z', false],
    ['2026-11-26T14:00:00.000Z', true],
    ['2026-11-26T14:00:00.001Z', true],
  ]) assert.equal(chinaDailyIsDue(accepted, at), due, at);
});

test('source observations on the 21:00 boundary cover that window and local midnight does not start another', () => {
  const accepted = acceptedReference('2026-11-25T14:00:00.000Z');
  for (const [at, due] of [
    ['2026-11-25T14:00:00.000Z', false],
    ['2026-11-25T14:00:00.001Z', false],
    ['2026-11-25T16:59:59.999Z', false],
    ['2026-11-25T17:00:00.000Z', false], // Local midnight remains inside the same window.
    ['2026-11-26T13:59:59.999Z', false],
    ['2026-11-26T14:00:00.000Z', true],
  ]) assert.equal(chinaDailyIsDue(accepted, at), due, at);
  const beforeBoundary = acceptedReference('2026-11-26T13:59:59.999Z');
  assert.equal(chinaDailyIsDue(beforeBoundary, '2026-11-26T13:59:59.999Z'), false);
  assert.equal(chinaDailyIsDue(beforeBoundary, '2026-11-26T14:00:00.000Z'), true);
});

test('21:00 daily windows continue through month, year and leap-day boundaries', () => {
  for (const [sourceAt, beforeBoundary, boundary] of [
    ['2026-11-30T14:05:00Z', '2026-12-01T13:59:59.999Z', '2026-12-01T14:00:00Z'],
    ['2026-12-31T14:05:00Z', '2027-01-01T13:59:59.999Z', '2027-01-01T14:00:00Z'],
    ['2027-02-28T14:05:00Z', '2027-03-01T13:59:59.999Z', '2027-03-01T14:00:00Z'],
    ['2028-02-28T14:05:00Z', '2028-02-29T13:59:59.999Z', '2028-02-29T14:00:00Z'],
    ['2028-02-29T14:05:00Z', '2028-03-01T13:59:59.999Z', '2028-03-01T14:00:00Z'],
  ]) {
    const accepted = acceptedReference(sourceAt);
    assert.equal(chinaDailyIsDue(accepted, beforeBoundary), false, beforeBoundary);
    assert.equal(chinaDailyIsDue(accepted, boundary), true, boundary);
  }
  assert.equal(chinaDailyIsDue(acceptedReference('2026-11-25T14:00:00Z'), '2026-12-25T14:00:00Z'), true);
});

test('daily freshness uses the source window rather than acceptance and rejects invalid clock ordering', () => {
  // On first publication the source was still from 24 November, even though
  // acceptance happened at lunchtime on 25 November. The 21:00 local schedule
  // must refresh that older feed rather than misclassify it as already fresh.
  const justAccepted = acceptedReference('2026-11-24T10:22:41.417Z', '2026-11-25T05:38:49.555Z');
  assert.equal(chinaDailyIsDue(justAccepted,'2026-11-25T14:00:00Z'),true);
  assert.throws(()=>chinaDailyIsDue(justAccepted,'2026-11-24T16:59:59Z'),/clock_before_acceptance/);
  // A valid accepted receipt cannot precede its source observation: malformed
  // source chronology is rejected by receipt validation before the due check.
  const futureSource = acceptedReference('2026-11-26T14:00:00Z', '2026-11-26T13:00:00Z');
  assert.throws(() => chinaDailyIsDue(futureSource, '2026-11-26T13:30:00Z'), /china_state_host_binding/);
});

test('a live foreign lease skips daily work without mutation', async () => {
  const f = await fixture(), state = createChinaState({storage: f.storage, now: () => nextAt});
  await state.acquireLease({previous: await state.read('lease'), owner: owner(9), nonce: 'e'.repeat(32), expiresAt: '2026-11-24T13:00:00Z'});
  const count = f.storage.writes.length, result = await runChinaDailyCycle(f.args);
  assert.equal(result.status, 'lease_busy'); assert.equal(result.published, false);
  assert.equal(f.storage.writes.length, count); assert.deepEqual(f.events, []);
});

test('a fresh scheduled window skips preparation while an explicit manual cycle still publishes through the normal gates', async () => {
  const f = await fixture();
  await runChinaDailyCycle(f.args);
  const prior = await f.storage.read('accepted'), events = [], nonce = 'f'.repeat(32);
  assert.equal(chinaDailyIsDue(prior.value.current, nextAt), false);
  const args = {...f.args, owner: owner(4), nonce,
    async prepare(input) {
      events.push('prepare');
      assert.deepEqual(input.sourceSelection.generation, prior.value.current);
      await input.assertAuthority(); return prepared(input.sourceSelection.generation, 4);
    },
    async stageRelease(input) {
      events.push('stage'); assert.deepEqual(input.candidate, candidate(4));
      assert.deepEqual(await f.storage.read('accepted'), prior);
      await input.assertAuthority();
      return {candidate: input.candidate,
        async activate({intent, reservation, assertAuthority}) {
          events.push('activate'); await assertAuthority();
          assert.equal((await f.storage.read('accepted')).etag, reservation.etag);
          assert.equal(intent.value.nonce, nonce);
          return {kind: 'accepted', evidence: acceptance(input.candidate, nonce, nextAt)};
        },
        async close() { events.push('close'); },
      };
    },
  };
  const scheduled = await runChinaDailyCycle({...args, owner: owner(3), nonce: 'e'.repeat(32), trigger: 'schedule'});
  assert.equal(scheduled.status, 'not_due'); assert.equal(scheduled.published, false);
  assert.equal(scheduled.sourcePrepared, false); assert.equal(scheduled.leaseReleased, true);
  assert.deepEqual(events, []); assert.deepEqual(await f.storage.read('accepted'), prior);
  const manual = await runChinaDailyCycle({...args, trigger: 'manual'});
  assert.equal(manual.status, 'accepted'); assert.equal(manual.published, true);
  assert.equal(manual.leaseReleased, true); assert.equal(manual.applicationBuilds, 0);
  assert.deepEqual(events, ['prepare', 'stage', 'activate', 'close']);
  const current = (await f.storage.read('accepted')).value;
  assert.equal(current.current.generationId, candidate(4).generationId);
  assert.equal(current.current.runtimeSha, prior.value.current.runtimeSha);
  assert.equal(current.current.imageId, prior.value.current.imageId);
  assert.deepEqual(current.rollback, prior.value.current);
});

test('a prepared result with the wrong predecessor or unverified fresh source cannot reach release staging', async () => {
  for (const mutate of [value => { value.sourceInput.receiptSha256 = 'a'.repeat(64); },
    value => { value.source.supplierLatestVerified = false; }, value => { value.source.sourceCursor = 1; }]) {
    const f = await fixture(), prepare = f.args.prepare;
    f.args.prepare = async args => { const output = await prepare(args); mutate(output); return output; };
    await assert.rejects(runChinaDailyCycle(f.args), /source_predecessor|source_not_complete/);
    assert.deepEqual(f.events, ['prepare']); assert.deepEqual(await f.storage.read('accepted'), f.first.accepted);
  }
});

test('cleanup runs after committed acceptance under the current lease and a failure cannot undo publication', async () => {
  const f = await fixture(); let attempts = 0;
  f.args.afterAccepted = async ({previousAccepted, accepted, intent, readState, assertAuthority}) => {
    attempts++; assert.deepEqual(previousAccepted, f.first.accepted);
    assert.equal(accepted.value.current.generationId, candidate(2).generationId); assert.equal(intent.value.status, 'committed');
    assert.equal((await f.storage.read('lease')).value.status, 'held');
    await assertAuthority(); assert.deepEqual(await readState(), {accepted, intent});
    const error = Error('china_gc_delete_outcome_unknown');
    error.report = {status: 'needs_reconciliation', uncertainKey: 'private-object-must-not-be-logged'}; throw error;
  };
  const result = await runChinaDailyCycle(f.args);
  assert.equal(result.status, 'accepted'); assert.equal(result.published, true); assert.equal(attempts, 1);
  assert.deepEqual(result.retention, {completed: false, status: 'needs_reconciliation', errorCode: 'china_gc_delete_outcome_unknown'});
  assert.ok(!JSON.stringify(result).includes('private-object')); assert.equal(result.leaseReleased, true);
});

test('host container-retirement failure is reported after commit without cancelling the accepted data or private cleanup', async () => {
  const f = await fixture(), stage = f.args.stageRelease; let gc = false;
  f.args.stageRelease = async input => ({...await stage(input), async afterCommit({accepted, assertAuthority}) {
    await assertAuthority(); assert.equal(accepted.value.current.generationId, candidate(2).generationId); throw Error('host_cleanup_failure');
  }});
  f.args.afterAccepted = async () => { gc = true; return {market: 'china', completed: true, status: 'no_previous_rollback', deletedObjects: 0}; };
  const result = await runChinaDailyCycle(f.args);
  assert.equal(result.published, true); assert.equal(result.hostCleanupPending, true); assert.equal(gc, true);
  assert.equal((await f.storage.read('accepted')).value.current.generationId, candidate(2).generationId);
});

test('preparation records the old cleanup witness first but cleanup transport failure is not a source refresh gate', async () => {
  const f = await fixture();
  f.args.resumeCleanup = async ({readState, assertAuthority}) => {
    f.events.push('enqueue'); await assertAuthority();
    assert.deepEqual(await readState(), f.first); assert.equal((await f.storage.read('lease')).value.status, 'held');
    return {market: 'china', completed: false, status: 'paused', witnessRemembered: false,
      errorCode: 'china_gc_queue_storage_transport'};
  };
  f.args.afterAccepted = async ({assertAuthority}) => {
    f.events.push('drain'); await assertAuthority();
    return {market: 'china', completed: true, status: 'complete', witnessRemembered: true,
      pending: 0, collected: 1, filesDeleted: 2, freedBytes: 512};
  };
  const result = await runChinaDailyCycle(f.args);
  assert.equal(result.published, true); assert.equal(result.retentionResume.completed, false);
  assert.equal(result.retentionResume.witnessRemembered, false);
  assert.equal(result.retentionResume.errorCode, 'china_gc_queue_storage_transport');
  assert.deepEqual(f.events, ['enqueue', 'prepare', 'stage', 'activate', 'close', 'drain']);
  assert.deepEqual(result.retention, {status: 'complete', completed: true, witnessRemembered: true,
    collected: 1, pending: 0, filesDeleted: 2, freedBytes: 512});
  assert.ok(!JSON.stringify(result).includes('private-cleanup'));
});

async function dailyImageCleanupFixture() {
  const f = await fixture(); await runChinaDailyCycle(f.args);
  const previous = await f.storage.read('accepted'), nonce = 'c'.repeat(32);
  f.events.length = 0; f.storage.writes.length = 0;
  f.args = {...f.args, owner: owner(3), nonce, trigger: 'manual',
    async prepare(input) {
      f.events.push('prepare'); await input.assertAuthority(); assert.deepEqual(input.sourceSelection.generation, previous.value.current);
      return prepared(input.sourceSelection.generation, 3);
    },
    async stageRelease(input) {
      f.events.push('stage'); await input.assertAuthority(); assert.deepEqual(input.candidate, candidate(3));
      return {candidate: input.candidate,
        async activate({assertAuthority}) { f.events.push('activate'); await assertAuthority();
          return {kind: 'accepted', evidence: acceptance(input.candidate, nonce, nextAt)}; },
        async afterCommit({assertAuthority}) { f.events.push('retire'); await assertAuthority();
          return {completed: true, retiredContainers: 1, filesDeleted: 2, freedBytes: 256}; },
        async close() { f.events.push('close'); },
      };
    }};
  return {...f, previous};
}
function protectedImageReport(publication) {
  const target = publication.intent.value.previous.value.rollback;
  return {version: 1, kind: 'china-terminal-app-image-cleanup-v1', completed: true, status: 'protected', uncertain: false,
    imagesRemoved: 0, runtimeSha: target.runtimeSha, imageId: target.imageId, witnessSha256: digest(publication),
    diskFreeBytesBefore: 4096, diskFreeBytesAfter: 4096, measuredFreeBytesChange: 0, reason: 'current_or_rollback'};
}

test('daily terminal image phase uses its committed witness after closing the host and protects the reused image', async () => {
  const f = await dailyImageCleanupFixture(); let calls = 0;
  f.args.retireTerminalAppImage = async input => {
    calls++; f.events.push('image'); assert.equal(f.events.at(-2), 'close');
    assert.equal((await f.storage.read('lease')).value.status, 'held'); await input.assertAuthority();
    assert.deepEqual(await input.readState(), input.publication);
    assert.equal(inspectChinaPublicationState(input.publication).status, 'resolved');
    const target = input.publication.intent.value.previous.value.rollback;
    assert.equal(target.imageId, input.publication.accepted.value.current.imageId);
    assert.equal(target.imageId, input.publication.accepted.value.rollback.imageId);
    return protectedImageReport(input.publication);
  };
  f.args.afterAccepted = async ({assertAuthority}) => {
    f.events.push('retention'); await assertAuthority();
    return {market: 'china', completed: true, status: 'complete', deletedObjects: 0};
  };
  const result = await runChinaDailyCycle(f.args);
  assert.equal(result.status, 'accepted'); assert.equal(result.published, true); assert.equal(calls, 1);
  assert.deepEqual(f.events, ['prepare', 'stage', 'activate', 'retire', 'close', 'image', 'retention']);
  assert.equal(result.appImageCleanup.status, 'protected'); assert.equal(result.appImageCleanup.imagesRemoved, 0);
  assert.equal(result.appImageCleanupPending, undefined); assert.equal(result.leaseReleased, true);
  assert.equal(result.applicationBuilds, 0); assert.equal(result.encyclopediaWrites, 0); assert.equal(result.otherMarketWrites, 0);
  assert.equal(result.deletions, 0);
});

test('daily acceptance and private retention survive a separate image cleanup failure or uncertain primary close', async () => {
  for (const failure of ['cleanup', 'close']) {
    const f = await dailyImageCleanupFixture(); let calls = 0, retained = 0;
    const stage = f.args.stageRelease;
    if (failure === 'close') f.args.stageRelease = async input => ({...await stage(input),
      async close() { throw Error('private-close-output'); }});
    f.args.retireTerminalAppImage = async () => { calls++; throw Error('private-image-output'); };
    f.args.afterAccepted = async ({assertAuthority}) => { retained++; await assertAuthority();
      return {market: 'china', completed: true, status: 'complete', deletedObjects: 0}; };
    const result = await runChinaDailyCycle(f.args);
    assert.equal(result.status, 'accepted'); assert.equal(result.published, true); assert.equal(result.completed, true);
    assert.equal(result.appImageCleanupPending, true); assert.equal(result.appImageCleanup.completed, false);
    assert.equal(result.appImageCleanup.status, 'pending'); assert.equal(result.leaseReleased, true);
    assert.equal(retained, 1); assert.equal(calls, failure === 'close' ? 0 : 1);
    assert.equal(JSON.stringify(result).includes('private-'), false);
    assert.equal((await f.storage.read('accepted')).value.current.generationId, candidate(3).generationId);
  }
});

test('daily initial publication with no displaced rollback has no application-image cleanup call', async () => {
  const f = await fixture();
  f.args.retireTerminalAppImage = async () => assert.fail('no eligible terminal image witness');
  const result = await runChinaDailyCycle(f.args);
  assert.equal(result.status, 'accepted'); assert.equal(result.appImageCleanup, undefined);
  assert.equal(result.appImageCleanupBeforeReserve, undefined);
});
