import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createChinaState} from '../scripts/catalog-next/china-state.mjs';
import {hash, empty, stateStore} from './helpers/catalog-next-gc-fixture.mjs';
import * as production from '../scripts/catalog-next/cleanup-resolved-failed-uploads.mjs';

const clock = '2026-11-24T20:00:00.000Z', controller = '1'.repeat(40);
const REPORT = 'catalog-next-china-resolved-failed-upload-cleanup-report.json';
const WORKFLOW = 'jeep-jim/AvtoCena/.github/workflows/catalog-next-china-resolved-failed-upload-cleanup.yml@refs/heads/main';
const target = production.RESOLVED_CLEANUP_TARGETS[1];
const candidate = {market: 'china', generationId: target.generationId,
  owner: {runId: '45369451603', attempt: '1', revision: controller},
  receiptSha256: target.privateGenerationReceiptSha256, sourceDescriptorSha256: '4'.repeat(64),
  generationManifestSha256: target.generationManifestSha256, sourceCursor: 101, sourceObservedAt: '2026-11-23T12:00:00.000Z',
  runtimeSha: target.runtimeSha, pricingRuntimeSha: target.pricingRuntimeSha, imageId: target.imageId};
const rollback = {version: 1, kind: 'china-host-rollback-v1', nonce: target.nonce, release: target.runtimeSha,
  pricingRuntimeSha: target.pricingRuntimeSha, generationId: target.generationId,
  generationManifestSha256: target.generationManifestSha256, privateGenerationReceiptSha256: target.privateGenerationReceiptSha256,
  sourceDescriptorSha256: candidate.sourceDescriptorSha256, imageId: target.imageId,
  previousAcceptedETag: null, previousAcceptedStateSha256: null, rolledBackAt: clock,
  retainedContainerId: '7'.repeat(64), retainedRuntimeSha: production.RESOLVED_CLEANUP_LIVE_RUNTIME,
  retainedImageId: 'sha256:' + '8'.repeat(64), retainedRunning: true, ingressRestored: true, candidateRemoved: true};
const rollbackBytes = Buffer.from(JSON.stringify(rollback));
// The real private rollback bytes are deliberately absent from public fixtures.
// Remap only their literal digest in an in-memory module. All production state,
// proof, invocation and reporting validators execute unchanged; no CLI override.
const sourceUrl = new URL('../scripts/catalog-next/cleanup-resolved-failed-uploads.mjs', import.meta.url);
const source = (await fs.readFile(sourceUrl, 'utf8'))
  .replaceAll(target.rollbackSha256, hash(rollbackBytes))
  .replace(/from '(\.[^']+)'/g, (_match, relative) => `from '${new URL(relative, sourceUrl).href}'`)
  .replaceAll('import.meta.url', JSON.stringify(sourceUrl.href));
const fixtureModule = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const {runResolvedCleanup, verifyResolvedCleanupState, validateResolvedCleanupPreparation,
  validateResolvedCleanupStep, validateResolvedCleanupReport} = fixtureModule;
const fileBytes = [6000000000, 6000000000, 1000000000, 41561344, 6000000000, 6000000000, 1000000000, 41562880];
const identity = {liveRuntimeSha: production.RESOLVED_CLEANUP_LIVE_RUNTIME,
  protectedFailedAttempt: fixtureModule.RESOLVED_CLEANUP_WITNESS, protectedFilesVerified: 11,
  targetFailedAttempts: fixtureModule.RESOLVED_CLEANUP_TARGETS};
function preparation(absent = []) {
  return {version: 1, kind: 'china-resolved-cleanup-prepared-v1', prepared: true, ...identity,
    targetFileBytes: fileBytes, alreadyAbsentFiles: absent.length, alreadyAbsentBytes: absent.reduce((sum, index) => sum + fileBytes[index], 0)};
}
function step(index, absent = []) {
  return {version: 1, kind: 'china-resolved-cleanup-step-v1', index, deleted: !absent.includes(index),
    alreadyAbsent: absent.includes(index), logicalBytesUnlinked: absent.includes(index) ? 0 : fileBytes[index]};
}
function result(absent = []) {
  const prepared = preparation(absent);
  return {version: 1, kind: 'china-resolved-failed-upload-prune-v1', phase: 'after-resolved-rollback', completed: true, ...identity,
    filesDeleted: 8 - absent.length, logicalBytesUnlinked: 26083124224 - prepared.alreadyAbsentBytes,
    alreadyAbsentFiles: absent.length, alreadyAbsentBytes: prepared.alreadyAbsentBytes,
    diskFreeBytesBefore: 10467188736, diskFreeBytesAfter: 36500000001,
    retiredContainers: 0, imagesDeleted: 0, directoriesDeleted: 0, privateGenerationDeletes: 0, acceptedStateWrites: 0, intentStateWrites: 0};
}
async function fixture(t, {resolved = true, absent = []} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'china-resolved-cleanup-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const raw = stateStore(), state = createChinaState({storage: raw, now: () => clock});
  if (resolved) {
    const lease = await state.acquireLease({previous: empty(), owner: {runId: '45439516316', attempt: '1', revision: controller},
      nonce: target.nonce, expiresAt: '2026-11-24T21:00:00.000Z'});
    const reservation = await state.reserve({lease, previous: empty(), previousIntent: empty(), candidate});
    await state.abortReserved({lease, ...reservation, evidence: {hostRollbackBase64: rollbackBytes.toString('base64'), hostRollbackSha256: hash(rollbackBytes)}});
    await state.releaseLease({lease});
  }
  const calls = [], requests = [], hooks = {};
  const storage = {async assertPrivateBucket() { calls.push('privacy'); return {verified: true}; },
    async read(name) { calls.push('read:' + name); await hooks.read?.(name); return raw.read(name); },
    async compareAndSwap(name, previous, next) {
      assert.equal(name, 'lease', 'cleanup must never write accepted or intent'); calls.push('lease:' + next.status);
      return raw.compareAndSwap(name, previous, next);
    }};
  const session = {
    async call(method, params) {
      assert.equal(method, 'prune_resolved_failed_uploads'); calls.push(params.action + (params.index === undefined ? '' : ':' + params.index));
      requests.push(structuredClone(params));
      assert.deepEqual(params.authority.publicationState, {accepted: await state.read('accepted'), intent: await state.read('intent')});
      assert.deepEqual(params.authority.lease, await state.read('lease'));
      await hooks.call?.(params);
      if (hooks.reply) return hooks.reply(params);
      return params.action === 'prepare' ? preparation(absent) : params.action === 'finish' ? result(absent) : step(params.index, absent);
    },
    async close() { calls.push('close'); await hooks.close?.(); return {closed: true, readOnly: false}; },
    abort() { calls.push('abort'); }, exited: Promise.resolve({code: 0}),
  };
  const capabilities = {verifyInvocation() { calls.push('verify'); return {sourceSha: controller, approvedSourceSha: controller}; },
    verifyBaselines() { calls.push('baselines'); }, createStorage() { calls.push('storage'); return storage; },
    async openSession() { calls.push('open'); await hooks.open?.(); return session; }};
  const options = {root, environment: {GITHUB_RUN_ID: '45490000000', GITHUB_RUN_ATTEMPT: '1', RUNNER_TEMP: root,
    SSH_PRIVATE_KEY: 'private test key'}, capabilities, now: () => clock};
  return {root, raw, state, calls, requests, hooks, session, options};
}
async function mutate(f, name, change) {
  const previous = await f.raw.read(name), value = structuredClone(previous.value);
  change(value); await f.raw.compareAndSwap(name, previous, value);
}

test('only fresh CAS lease writes accompany exact resolved-state checks before every bounded unlink', async t => {
  const f = await fixture(t), before = {accepted: await f.state.read('accepted'), intent: await f.state.read('intent')};
  const report = await runResolvedCleanup(f.options);
  assert.equal(report.completed, true); assert.equal(report.filesDeleted, 8); assert.equal(report.logicalBytesUnlinked, 26083124224);
  assert.equal(report.diskFreeBytesBefore, 10467188736); assert.equal(report.diskFreeBytesAfter, 36500000001);
  assert.equal(report.leaseRelease, 'released'); assert.equal(Object.hasOwn(report, 'partialSteps'), false);
  assert.deepEqual(f.requests.map(row => [row.action, row.index]), [['prepare', undefined], ...Array.from({length: 8}, (_, i) => ['unlink', i]), ['finish', undefined]]);
  for (let index = 0; index < 8; index++) {
    const end = f.calls.indexOf('unlink:' + index), start = f.calls.indexOf(index ? 'unlink:' + (index - 1) : 'prepare');
    const reads = f.calls.slice(start + 1, end);
    assert(reads.includes('read:accepted') && reads.includes('read:intent'));
    assert.equal(reads.filter(value => value === 'read:lease').length, 2);
  }
  assert.deepEqual({accepted: await f.state.read('accepted'), intent: await f.state.read('intent')}, before);
  const saved = await fs.readFile(path.join(f.root, REPORT), 'utf8');
  for (const secret of ['private test key', 'hostRollbackBase64', 'publicationState', 'acceptedETag']) assert(!saved.includes(secret));
  assert.equal((await fs.stat(path.join(f.root, REPORT))).mode & 0o777, 0o600);
});

test('production pins reject the valid but fabricated fixture rollback proof', async t => {
  const f = await fixture(t), view = {accepted: await f.state.read('accepted'), intent: await f.state.read('intent')};
  verifyResolvedCleanupState(view);
  assert.throws(() => production.verifyResolvedCleanupState(view), /china_resolved_cleanup_resolved_state/);
  assert.equal(production.RESOLVED_CLEANUP_TARGETS[1].rollbackSha256, 'f47f596c64647fb7dd47e47c3d9b5b2d2d66808d51e74c3a690954076c619e04');
});

test('idle absence is not a resolved rollback and is rejected before lease acquisition', async t => {
  const f = await fixture(t, {resolved: false});
  await assert.rejects(runResolvedCleanup(f.options), /china_resolved_cleanup_resolved_state/);
  assert(!f.calls.includes('open') && !f.calls.includes('lease:held'));
});

for (const scenario of ['never_reserved', 'pending', 'revision', 'current', 'pending_state', 'rollback', 'proof_bytes', 'different_proof']) {
  test('unsafe state fails before authority acquisition: ' + scenario, async t => {
    const f = await fixture(t);
    if (scenario === 'never_reserved') await mutate(f, 'intent', value => { value.resolution.kind = 'never_reserved'; delete value.resolution.rollbackProof; });
    else if (scenario === 'pending') await mutate(f, 'intent', value => { value.status = 'pending'; value.resolution = null; });
    else if (scenario === 'revision') await mutate(f, 'accepted', value => { value.revision += 1; });
    else if (scenario === 'current') await mutate(f, 'accepted', value => { value.current = candidate; });
    else if (scenario === 'pending_state') await mutate(f, 'accepted', value => { value.pending = {nonce: target.nonce,
      intentSha256: 'a'.repeat(64), candidateSha256: 'b'.repeat(64), createdAt: clock}; });
    else if (scenario === 'rollback') await mutate(f, 'accepted', value => { value.rollback = candidate; });
    else if (scenario === 'proof_bytes') await mutate(f, 'intent', value => { value.resolution.rollbackProof.hostRollbackBase64 = Buffer.from('{}').toString('base64'); });
    else await mutate(f, 'intent', value => {
      const bytes = Buffer.from(JSON.stringify({...rollback, retainedContainerId: '9'.repeat(64)}));
      value.resolution.rollbackProof.hostRollbackBase64 = bytes.toString('base64'); value.resolution.rollbackProof.hostRollbackSha256 = hash(bytes);
    });
    await assert.rejects(runResolvedCleanup(f.options), /china_(?:resolved_cleanup|state)_/);
    assert(!f.calls.includes('open') && !f.calls.includes('lease:held'));
  });
}

test('invalid invocation or frozen baseline stops before reading credentials', async t => {
  for (const name of ['verifyInvocation', 'verifyBaselines']) {
    const f = await fixture(t); f.options.capabilities[name] = () => { throw Error('private exception'); };
    Object.defineProperty(f.options.environment, 'SSH_PRIVATE_KEY', {get() { assert.fail('secret read'); }});
    await assert.rejects(runResolvedCleanup(f.options), error => error.message === 'china_resolved_cleanup_failed');
    assert(!f.calls.includes('storage') && !f.calls.includes('open'));
  }
});

test('REG drift after SSH open blocks host preparation', async t => {
  const f = await fixture(t); f.hooks.open = () => mutate(f, 'intent', () => {});
  await assert.rejects(runResolvedCleanup(f.options), /china_resolved_cleanup_state_changed/);
  assert.equal(f.requests.length, 0); assert(f.calls.includes('abort'));
});

test('lease replacement during preparation blocks the first unlink', async t => {
  const f = await fixture(t); f.hooks.call = params => {
    assert.equal(params.action, 'prepare'); return mutate(f, 'lease', value => { value.nonce = 'd'.repeat(32); });
  };
  await assert.rejects(runResolvedCleanup(f.options), /china_resolved_cleanup_lease_lost/);
  assert.deepEqual(f.requests.map(row => row.action), ['prepare']);
});

test('intent drift after one successful unlink retains partial evidence and blocks subsequent unlinks', async t => {
  const f = await fixture(t); f.hooks.call = params => {
    if (params.action === 'unlink' && params.index === 0) return mutate(f, 'intent', () => {});
  };
  await assert.rejects(runResolvedCleanup(f.options), error => {
    assert.deepEqual(error.report.partialSteps, [step(0)]); assert.equal(error.report.completed, false);
    assert.equal(error.report.filesDeleted, null); assert.equal(error.report.logicalBytesUnlinked, null);
    assert.equal(error.report.leaseRelease, 'released'); return error.message === 'china_resolved_cleanup_state_changed';
  });
  assert.equal(f.requests.filter(row => row.action === 'unlink').length, 1);
});

for (const lost of ['prepare', 'unlink', 'finish']) {
  test('lost ' + lost + ' reply keeps the lease through expiry and aggregates unknown', async t => {
    const f = await fixture(t); f.hooks.call = params => {
      if (params.action === lost) throw Error('china_ssh_closed');
    };
    await assert.rejects(runResolvedCleanup(f.options), error => {
      assert.equal(error.report.completed, false); assert.equal(error.report.leaseRelease, 'expires');
      for (const key of ['filesDeleted', 'logicalBytesUnlinked', 'alreadyAbsentFiles', 'alreadyAbsentBytes', 'diskFreeBytesBefore', 'diskFreeBytesAfter']) assert.equal(error.report[key], null);
      assert.equal(error.report.partialSteps.length, lost === 'finish' ? 8 : 0); return error.message === 'china_ssh_closed';
    });
    assert.equal((await f.state.read('lease')).value.status, 'held'); assert(!f.calls.includes('lease:released'));
  });
}

test('authenticated host refusal releases only after the SSH process has exited', async t => {
  const f = await fixture(t); let exited;
  f.session.exited = new Promise(resolve => { exited = resolve; });
  f.session.abort = () => { f.calls.push('abort'); queueMicrotask(() => { f.calls.push('exited'); exited({code: 1}); }); };
  f.hooks.call = params => { if (params.action === 'unlink') throw Error('china_host_resolved_files_mounted'); };
  await assert.rejects(runResolvedCleanup(f.options), error => {
    assert.equal(error.report.leaseRelease, 'released'); assert.equal(error.report.logicalBytesUnlinked, null);
    return error.message === 'china_host_resolved_files_mounted';
  });
  assert(f.calls.indexOf('exited') < f.calls.indexOf('lease:released'));
});

test('close failure preserves eight explicit partial steps without claiming completion', async t => {
  const f = await fixture(t); f.hooks.close = () => { throw Error('china_ssh_closed'); };
  await assert.rejects(runResolvedCleanup(f.options), error => {
    assert.equal(error.report.completed, false); assert.equal(error.report.filesDeleted, null);
    assert.equal(error.report.partialSteps.length, 8); assert.equal(error.report.leaseRelease, 'released'); return true;
  });
});

test('resumed absent files are not reported as newly unlinked logical bytes', async t => {
  const absent = [0, 1, 7], f = await fixture(t, {absent});
  const report = await runResolvedCleanup(f.options);
  assert.equal(report.filesDeleted, 5); assert.equal(report.alreadyAbsentFiles, 3);
  assert.equal(report.alreadyAbsentBytes, 12041562880); assert.equal(report.logicalBytesUnlinked, 14041561344);
});

test('sanitized reporting rejects identity, sequence, byte, extra-data and mutation-scope changes', () => {
  for (const changed of [{extra: 'private'}, {protectedFilesVerified: 10}, {targetFileBytes: [1, 2]},
    {alreadyAbsentFiles: 0, alreadyAbsentBytes: 1}, {protectedFailedAttempt: {...identity.protectedFailedAttempt, nonce: 'f'.repeat(32)}}]) {
    assert.throws(() => validateResolvedCleanupPreparation({...preparation(), ...changed}), /china_resolved_cleanup_report_/);
  }
  for (const changed of [{index: 1}, {deleted: false}, {logicalBytesUnlinked: fileBytes[0] - 1}, {path: '/private'}]) {
    assert.throws(() => validateResolvedCleanupStep({...step(0), ...changed}, 0, preparation()), /report_step/);
  }
  const steps = Array.from({length: 8}, (_, index) => step(index));
  for (const changed of [{acceptedStateWrites: 1}, {intentStateWrites: 1}, {privateGenerationDeletes: 1}, {directoriesDeleted: 1},
    {imagesDeleted: 1}, {filesDeleted: 7}, {logicalBytesUnlinked: 26083124223}, {alreadyAbsentBytes: 1}, {diskFreeBytesBefore: -1},
    {diskFreeBytesAfter: Number.MAX_SAFE_INTEGER + 1}, {extra: 'private'}]) {
    assert.throws(() => validateResolvedCleanupReport({...result(), ...changed}, preparation(), steps), /china_resolved_cleanup_report_/);
  }
  assert.equal(validateResolvedCleanupReport({...result(), diskFreeBytesBefore: 20, diskFreeBytesAfter: 0}, preparation(), steps).diskFreeBytesAfter, 0);
});

test('manual invocation binds reviewed clean main source and the dedicated workflow', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'china-resolved-invocation-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const git = args => execFileSync('git', ['-c', 'user.name=Cleanup test', '-c', 'user.email=cleanup@example.invalid', ...args],
    {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git(['init', '-b', 'main']); await fs.writeFile(path.join(root, 'source.txt'), 'reviewed'); git(['add', 'source.txt']); git(['commit', '-m', 'fixture']);
  const sourceSha = git(['rev-parse', 'HEAD']), environment = {GITHUB_REPOSITORY: 'jeep-jim/AvtoCena', GITHUB_REPOSITORY_ID: '1289722938',
    GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: sourceSha,
    EXPECTED_CONTROLLER_SHA: sourceSha, GITHUB_WORKFLOW_REF: WORKFLOW};
  assert.equal(production.verifyResolvedCleanupInvocation({root, environment}).sourceSha, sourceSha);
  assert.throws(() => production.verifyResolvedCleanupInvocation({root, environment: {...environment, EXPECTED_CONTROLLER_SHA: 'a'.repeat(40)}}), /manual_source/);
  assert.throws(() => production.verifyResolvedCleanupInvocation({root, environment: {...environment, GITHUB_WORKFLOW_REF: WORKFLOW + '-other'}}), /workflow/);
  await fs.writeFile(path.join(root, 'source.txt'), 'unreviewed');
  assert.throws(() => production.verifyResolvedCleanupInvocation({root, environment}), /git_unverified/);
});
