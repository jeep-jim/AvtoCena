import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createChinaState} from '../scripts/catalog-next/china-state.mjs';
import {hash, empty, stateStore} from './helpers/catalog-next-gc-fixture.mjs';
import {FAILED_WITNESS_CLEANUP_CURRENT as CURRENT, FAILED_WITNESS_CLEANUP_TARGET as TARGET, FAILED_WITNESS_CLEANUP_TARGETS as TARGETS, verifyFailedWitnessCleanupInvocation,
  validateFailedWitnessCleanupReport, runFailedWitnessCleanup} from '../scripts/catalog-next/cleanup-failed-witness.mjs';

const clock = '2026-11-24T20:00:00.000Z', controller = '1'.repeat(40), nonce = 'c'.repeat(32);
const REPORT = 'catalog-next-china-failed-witness-cleanup-report.json';
const WORKFLOW = 'jeep-jim/AvtoCena/.github/workflows/catalog-next-china-failed-witness-cleanup.yml@refs/heads/main';
function result(targetIndex = 0) {
  return {version: 1, kind: 'china-failed-witness-prune-v1', phase: 'after-first-acceptance', completed: true, ...CURRENT,
    targetIndex, targetFailedAttempt: {...TARGETS[targetIndex]}, earlierBulkFilesAbsent: 8,
    filesDeleted: 4, freedBytes: [13041560320, 13041559296][targetIndex], alreadyAbsentFiles: 0,
    diskFreeBytesBefore: [14000000000, 26000000000][targetIndex], diskFreeBytesAfter: [27000000001, 39000000002][targetIndex],
    retiredContainers: 0, imagesDeleted: 0, directoriesDeleted: 0, privateGenerationDeletes: 0, acceptedStateWrites: 0, intentStateWrites: 0};
}

async function fixture(t, {runtimeSha = CURRENT.runtimeSha, generationId = CURRENT.generationId, accepted = true, pricingRuntimeSha = TARGET.pricingRuntimeSha,
  manifest = TARGET.generationManifestSha256, receiptSha256 = TARGET.privateGenerationReceiptSha256} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'china-failed-cleanup-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const raw = stateStore(), state = createChinaState({storage: raw, now: () => clock});
  if (accepted) {
    const candidate = {market: 'china', ...CURRENT, runtimeSha, generationId,
      owner: {runId: generationId.split('_')[2], attempt: generationId.split('_')[3], revision: controller},
      pricingRuntimeSha, receiptSha256, sourceDescriptorSha256: '4'.repeat(64),
      generationManifestSha256: manifest, sourceCursor: 101, sourceObservedAt: '2026-11-23T12:00:00.000Z', imageId: 'sha256:' + '6'.repeat(64)};
    const lease = await state.acquireLease({previous: empty(), owner: {runId: '1001', attempt: '1', revision: controller},
      nonce, expiresAt: '2026-11-24T21:00:00.000Z'});
    const reservation = await state.reserve({lease, previous: empty(), previousIntent: empty(), candidate});
    const browserSpeedBytes = Buffer.from(JSON.stringify({release: runtimeSha, passed: true, browserPassed: true, speedGuard: {passed: true}}));
    const browserDetailsBytes = Buffer.from(JSON.stringify({version: 1, kind: 'china-browser-details-v1', release: runtimeSha,
      nonce, passed: true, generationManifestSha256: candidate.generationManifestSha256, precedingSpeedReportSha256: hash(browserSpeedBytes)}));
    const receipt = Buffer.from(JSON.stringify({version: 1, kind: 'china-host-acceptance-v1', release: runtimeSha,
      pricingRuntimeSha: candidate.pricingRuntimeSha, generationId: candidate.generationId,
      generationManifestSha256: candidate.generationManifestSha256, privateGenerationReceiptSha256: candidate.receiptSha256,
      sourceDescriptorSha256: candidate.sourceDescriptorSha256, sourceCursor: candidate.sourceCursor,
      sourceObservedAt: candidate.sourceObservedAt, imageId: candidate.imageId, nonce, acceptedAt: clock, retainedContainerId: '7'.repeat(64),
      browser: {release: runtimeSha, nonce, passed: true, functionalPassed: true, speedPassed: true,
        reportSha256: hash(Buffer.concat([browserSpeedBytes, browserDetailsBytes])), speedReportSha256: hash(browserSpeedBytes),
        detailsReportSha256: hash(browserDetailsBytes)}}));
    await state.commit({lease, ...reservation, evidence: {hostReceiptBase64: receipt.toString('base64'),
      hostReceiptSha256: hash(receipt), browserSpeedBytes, browserDetailsBytes}});
    await state.releaseLease({lease});
  }
  const calls = [], targets = [], hooks = {};
  const storage = {async assertPrivateBucket() { calls.push('privacy'); return {verified: true}; },
    async read(name) { calls.push('read:' + name); await hooks.read?.(name); return raw.read(name); },
    async compareAndSwap(name, previous, next) {
      assert.equal(name, 'lease', 'cleanup must never write accepted/intent'); calls.push('lease:' + next.status);
      return raw.compareAndSwap(name, previous, next);
    }};
  const session = {
    async call(method, parameters) { calls.push(method); assert.equal(method, 'prune_failed_witness');
      assert.deepEqual(Object.keys(parameters).sort(), ['currentState', 'leaseExpiresAt', 'targetIndex']);
      assert.equal(parameters.targetIndex, targets.length); targets.push(parameters.targetIndex);
      assert.deepEqual(parameters.currentState.accepted, await state.read('accepted'));
      assert.equal(parameters.leaseExpiresAt, '2026-11-24T21:00:00.000Z');
      await hooks.call?.(parameters.targetIndex);
      return typeof hooks.result === 'function' ? hooks.result(parameters.targetIndex) : hooks.result ?? result(parameters.targetIndex); },
    async close() { calls.push('close'); await hooks.close?.(); return {closed: true, readOnly: false}; },
    abort() { calls.push('abort'); }, exited: Promise.resolve({code: 0, signal: null}),
  };
  const capabilities = {verifyInvocation() { calls.push('verify'); return {version: 1, sourceSha: controller, approvedSourceSha: controller}; },
    verifyBaselines() { calls.push('baselines'); }, createStorage() { calls.push('storage'); return storage; },
    async openSession() { calls.push('open'); await hooks.open?.(); return session; }};
  const options = {root, environment: {GITHUB_RUN_ID: '1002', GITHUB_RUN_ATTEMPT: '1', RUNNER_TEMP: root,
    SSH_PRIVATE_KEY: 'test secret never printed'}, capabilities, now: () => clock};
  return {root, raw, state, calls, targets, hooks, session, options};
}

test('exact accepted state and China lease fence local cleanup; only lease is written', async t => {
  const f = await fixture(t), before = await f.state.read('accepted');
  const report = await runFailedWitnessCleanup(f.options);
  assert.equal(report.completed, true); assert.equal(report.freedBytes, 26083119616); assert.equal(report.filesDeleted, 8);
  assert.equal(report.diskFreeBytesBefore, 14000000000); assert.equal(report.diskFreeBytesAfter, 39000000002);
  assert.deepEqual(f.targets, [0, 1]); assert.deepEqual(report.results.map(value => value.targetIndex), [0, 1]);
  assert.equal(Object.hasOwn(report, 'partialResults'), false);
  assert.equal(report.leaseRelease, 'released'); assert.deepEqual(await f.state.read('accepted'), before);
  assert.deepEqual(f.calls.filter(name => !name.startsWith('read:')), ['verify', 'baselines', 'storage', 'privacy',
    'lease:held', 'open', 'prune_failed_witness', 'prune_failed_witness', 'close', 'lease:released']);
  assert.equal((await f.state.read('lease')).value.status, 'released');
  const output = await fs.readFile(path.join(f.root, REPORT), 'utf8');
  assert(!output.includes('test secret') && !output.includes('hostReceiptBase64'));
});

for (const settings of [{accepted: false}, {runtimeSha: '9'.repeat(40)}, {generationId: 'gen_china_999_1'}, {pricingRuntimeSha: '9'.repeat(40)},
  {manifest: '9'.repeat(64)}, {receiptSha256: '9'.repeat(64)}]) {
  test('unaccepted or different current runtime cannot acquire cleanup authority ' + JSON.stringify(settings), async t => {
    const f = await fixture(t, settings);
    await assert.rejects(runFailedWitnessCleanup(f.options), /china_failed_witness_cleanup_accepted_state/);
    assert(!f.calls.includes('open') && !f.calls.includes('lease:held'));
  });
}

test('invalid invocation and frozen baseline fail before any credentials or storage', async t => {
  for (const name of ['verifyInvocation', 'verifyBaselines']) {
    const f = await fixture(t);
    f.options.capabilities[name] = () => { throw Error('untrusted private exception'); };
    Object.defineProperty(f.options.environment, 'SSH_PRIVATE_KEY', {get() { assert.fail('secret read'); }});
    await assert.rejects(runFailedWitnessCleanup(f.options), error => error.message === 'china_failed_witness_cleanup_failed');
    assert(!f.calls.includes('storage') && !f.calls.includes('open'));
  }
});

test('a resolved intent with a different candidate cannot authorize the accepted runtime', async t => {
  const f = await fixture(t), observed = await f.state.read('intent');
  await f.raw.compareAndSwap('intent', observed, {...observed.value,
    candidate: {...observed.value.candidate, imageId: 'sha256:' + '9'.repeat(64)}});
  await assert.rejects(runFailedWitnessCleanup(f.options), /china_failed_witness_cleanup_accepted_state/);
  assert(!f.calls.includes('open') && !f.calls.includes('lease:held'));
});

test('a pending publication rejects cleanup before acquiring the lease', async t => {
  const f = await fixture(t), observed = await f.state.read('accepted');
  await f.raw.compareAndSwap('accepted', observed, {...observed.value,
    pending: {nonce: 'd'.repeat(32), intentSha256: '8'.repeat(64), candidateSha256: '9'.repeat(64), createdAt: clock}});
  await assert.rejects(runFailedWitnessCleanup(f.options), /china_failed_witness_cleanup_accepted_state/);
  assert(!f.calls.includes('open') && !f.calls.includes('lease:held'));
});

test('accepted state drift after SSH opens stops before any unlink request', async t => {
  const f = await fixture(t);
  f.hooks.open = async () => { const observed = await f.state.read('accepted');
    await f.raw.compareAndSwap('accepted', observed, {...observed.value, revision: observed.value.revision + 1}); };
  await assert.rejects(runFailedWitnessCleanup(f.options), /china_failed_witness_cleanup_accepted_state/);
  assert(!f.calls.includes('prune_failed_witness')); assert(f.calls.includes('abort'));
  assert.equal((await f.state.read('lease')).value.status, 'released');
});

test('lease takeover between SSH open and command stops before any prune call', async t => {
  const f = await fixture(t);
  f.hooks.open = async () => { const old = await f.state.read('lease');
    await f.raw.compareAndSwap('lease', old, {...old.value, nonce: 'd'.repeat(32)}); };
  await assert.rejects(runFailedWitnessCleanup(f.options), /china_failed_witness_cleanup_lease_lost/);
  assert(!f.calls.includes('prune_failed_witness')); assert(f.calls.includes('abort'));
});

test('lost response leaves counts unknown and keeps the lease until expiry', async t => {
  const f = await fixture(t);
  f.hooks.call = () => { throw Error('china_ssh_closed'); };
  await assert.rejects(runFailedWitnessCleanup(f.options), error => {
    assert.equal(error.report.status, 'needs_recheck'); assert.equal(error.report.completed, false);
    assert.equal(error.report.filesDeleted, null); assert.equal(error.report.freedBytes, null);
    assert.equal(error.report.diskFreeBytesBefore, null); assert.equal(error.report.diskFreeBytesAfter, null);
    assert.equal(error.report.leaseRelease, 'expires'); return error.message === 'china_ssh_closed';
  });
  assert.equal((await f.state.read('lease')).value.status, 'held');
  assert(!f.calls.includes('lease:released')); assert(f.calls.includes('abort'));
});

test('authenticated refusal is resumable, does not change acceptance and releases only after session exit', async t => {
  const f = await fixture(t), before = await f.state.read('accepted');
  let exited;
  f.session.exited = new Promise(resolve => { exited = resolve; });
  f.session.abort = () => { f.calls.push('abort'); queueMicrotask(() => { f.calls.push('exited'); exited({code: 1}); }); };
  f.hooks.call = () => { throw Error('china_host_prune_files_mounted'); };
  await assert.rejects(runFailedWitnessCleanup(f.options), error => {
    assert.equal(error.report.freedBytes, null); assert.equal(error.report.leaseRelease, 'released');
    return error.message === 'china_host_prune_files_mounted';
  });
  assert(f.calls.indexOf('exited') < f.calls.indexOf('lease:released'));
  assert.deepEqual(await f.state.read('accepted'), before);
});

test('lost close retains only explicit per-target results and cannot claim an aggregate', async t => {
  const f = await fixture(t); f.hooks.close = () => { throw Error('china_ssh_closed'); };
  await assert.rejects(runFailedWitnessCleanup(f.options), error => {
    assert.equal(error.report.completed, false); assert.equal(error.report.freedBytes, null);
    assert.deepEqual(error.report.partialResults.map(value => value.targetIndex), [0, 1]);
    assert.equal(error.report.diskFreeBytesBefore, null); assert.equal(error.report.diskFreeBytesAfter, null);
    assert.equal(error.report.leaseRelease, 'released'); return true;
  });
});

test('a resumed host observation never counts absent files as newly freed', async t => {
  const f = await fixture(t); f.hooks.result = index => ({...result(index), filesDeleted: 0, freedBytes: 0, alreadyAbsentFiles: 4});
  const report = await runFailedWitnessCleanup(f.options);
  assert.equal(report.completed, true); assert.equal(report.freedBytes, 0); assert.equal(report.alreadyAbsentFiles, 8);
});

test('host result rejects arbitrary data, scope changes and inconsistent totals', () => {
  for (const changed of [{extra: 'private'}, {privateGenerationDeletes: 1}, {targetFailedAttempt: {...TARGET, nonce: 'a'.repeat(32)}}, {earlierBulkFilesAbsent: 7}, {phase: 'before-first-acceptance'}, {intentStateWrites: 1},
    {filesDeleted: 5}, {freedBytes: 13041560321}, {filesDeleted: 0}, {completed: false}, {runtimeSha: '8'.repeat(40)},
    {diskFreeBytesBefore: undefined}, {diskFreeBytesAfter: null}, {diskFreeBytesBefore: -1}, {diskFreeBytesAfter: Number.MAX_SAFE_INTEGER + 1}]) {
    assert.throws(() => validateFailedWitnessCleanupReport({...result(), ...changed}), /china_failed_witness_cleanup_report_/);
  }
  // Concurrent live writes can make either measurement differ from logical unlinked bytes.
  assert.equal(validateFailedWitnessCleanupReport({...result(), diskFreeBytesBefore: 20, diskFreeBytesAfter: 0}).diskFreeBytesAfter, 0);
  assert.throws(() => validateFailedWitnessCleanupReport(result(1), 0), /report_identity/);
  assert.throws(() => validateFailedWitnessCleanupReport(result(0), 1), /report_identity/);
  assert.throws(() => validateFailedWitnessCleanupReport(result(1), 2), /report_target/);
  assert.throws(() => validateFailedWitnessCleanupReport({...result(1), freedBytes: 13041559297}, 1), /report_counts/);
  assert.equal(validateFailedWitnessCleanupReport(result(1), 1).targetFailedAttempt.planSha256,
    '27888989f2a0e90e235f7a497fcce912ece493e9f5add5c40005e02ad991d9b2');
});

test('losing the second reply keeps first proof explicitly partial and every aggregate unknown', async t => {
  const f = await fixture(t), before = await f.state.read('accepted');
  f.hooks.call = index => { if (index === 1) throw Error('china_ssh_closed'); };
  await assert.rejects(runFailedWitnessCleanup(f.options), error => {
    assert.equal(error.report.completed, false); assert.equal(error.report.leaseRelease, 'expires');
    assert.deepEqual(error.report.partialResults, [result(0)]);
    for (const key of ['filesDeleted', 'freedBytes', 'alreadyAbsentFiles', 'diskFreeBytesBefore', 'diskFreeBytesAfter']) assert.equal(error.report[key], null);
    return error.message === 'china_ssh_closed';
  });
  assert.deepEqual(f.targets, [0, 1]); assert.equal((await f.state.read('lease')).value.status, 'held');
  assert.deepEqual(await f.state.read('accepted'), before);
});

test('an authenticated second refusal keeps the first result partial and releases after exit', async t => {
  const f = await fixture(t);
  f.hooks.call = index => { if (index === 1) throw Error('china_host_witness_file_changed'); };
  await assert.rejects(runFailedWitnessCleanup(f.options), error => {
    assert.equal(error.report.freedBytes, null); assert.equal(error.report.leaseRelease, 'released');
    assert.deepEqual(error.report.partialResults, [result(0)]); return error.message === 'china_host_witness_file_changed';
  });
});

test('changed authority after the first target blocks the second and the aggregate', async t => {
  const f = await fixture(t);
  f.hooks.call = async index => {
    assert.equal(index, 0);
    const observed = await f.state.read('accepted');
    await f.raw.compareAndSwap('accepted', observed, {...observed.value, revision: observed.value.revision + 1});
  };
  await assert.rejects(runFailedWitnessCleanup(f.options), error => {
    assert.equal(error.report.completed, false); assert.equal(error.report.freedBytes, null);
    assert.deepEqual(error.report.partialResults, [result(0)]); return /accepted_state/.test(error.message);
  });
  assert.deepEqual(f.targets, [0]);
});

test('resuming both fixed targets aggregates only newly removed files', async t => {
  const f = await fixture(t);
  f.hooks.result = index => ({...result(index), filesDeleted: index ? 1 : 0,
    freedBytes: index ? 258520064 : 0, alreadyAbsentFiles: index ? 3 : 4});
  const report = await runFailedWitnessCleanup(f.options);
  assert.equal(report.completed, true); assert.equal(report.filesDeleted, 1);
  assert.equal(report.freedBytes, 258520064); assert.equal(report.alreadyAbsentFiles, 7);
});

test('manual invocation binds the real clean main HEAD and fixed workflow before use', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'china-cleanup-invocation-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const git = args => execFileSync('git', ['-c', 'user.name=Cleanup test', '-c', 'user.email=cleanup@example.invalid', ...args],
    {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git(['init', '-b', 'main']); await fs.writeFile(path.join(root, 'source.txt'), 'reviewed'); git(['add', 'source.txt']); git(['commit', '-m', 'fixture']);
  const source = git(['rev-parse', 'HEAD']), environment = {GITHUB_REPOSITORY: 'jeep-jim/AvtoCena', GITHUB_REPOSITORY_ID: '1289722938',
    GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: source,
    EXPECTED_CONTROLLER_SHA: source, GITHUB_WORKFLOW_REF: WORKFLOW};
  assert.equal(verifyFailedWitnessCleanupInvocation({root, environment}).sourceSha, source);
  assert.throws(() => verifyFailedWitnessCleanupInvocation({root, environment: {...environment, EXPECTED_CONTROLLER_SHA: 'a'.repeat(40)}}), /manual_source/);
  assert.throws(() => verifyFailedWitnessCleanupInvocation({root, environment: {...environment, GITHUB_WORKFLOW_REF: WORKFLOW + '-other'}}), /workflow/);
  await fs.writeFile(path.join(root, 'source.txt'), 'unreviewed');
  assert.throws(() => verifyFailedWitnessCleanupInvocation({root, environment}), /git_unverified/);
});
