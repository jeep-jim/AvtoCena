import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolveChinaReleaseReuse, validateChinaReleaseReuseResult, resumeChinaHostAttempt} from '../scripts/catalog-next/release-reuse.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const raw = value => Buffer.from(JSON.stringify(value) + '\n');
const FILES = ['GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json', 'FX_RECEIPT.json',
  'RECONCILIATION.json', 'DISPOSITIONS.ndjson', 'image.tar', 'acceptance.json', 'regcloud-performance-gate.py', 'accepted-speed-baseline.json'];

function fixture() {
  const servingPlan = {runtimeSha: 'a'.repeat(40), pricingRuntimeSha: 'b'.repeat(40), retainedRuntime: 'c'.repeat(40),
    runtimeTree: 'd'.repeat(40), runtimeDiffSha256: 'e'.repeat(64)};
  const source = {runtimeSha: servingPlan.runtimeSha, nonce: '1'.repeat(32), planSha256: '2'.repeat(64), rollbackSha256: '3'.repeat(64)};
  const reuse = {source, imageId: 'sha256:' + '4'.repeat(64)};
  const generation = {version: 1, kind: 'china-local-generation-v1', market: 'china', generationId: 'gen_china_100_1',
    runtimeSha: servingPlan.pricingRuntimeSha, prepared: true, rows: 20, sourceRows: 21,
    source: {cursor: 200, sourceObservedAt: '2026-11-24T10:22:00.000Z', supplierLatestVerified: true},
    pricingAsOf: '2026-11-24T10:24:00.000Z', privateFixtureSentinel: 'private-generation-do-not-log'};
  const generationBytes = raw(generation);
  const release = {version: 1, market: 'china', runtimeSha: servingPlan.runtimeSha, pricingRuntimeSha: servingPlan.pricingRuntimeSha,
    owner: {runId: '100', attempt: '1', revision: '9'.repeat(40)}, generationId: generation.generationId,
    receiptSha256: '5'.repeat(64), generationManifestSha256: hash(generationBytes), reuseHostAttempt: reuse};
  const nonce = '6'.repeat(32), controllerSha = '7'.repeat(40), previous = {found: false, etag: null, sha256: null, value: null};
  const oracle = {version: 1, kind: 'local-native-reader-http-expectations-v1', runtimeSha: servingPlan.runtimeSha,
    pricingRuntimeSha: servingPlan.pricingRuntimeSha, generationManifestSha256: release.generationManifestSha256,
    expectedGeneration: release.generationId, syntheticExpectations: true, httpVerified: false,
    cases: Array.from({length: 8}, (_, i) => ({name: i === 0 ? 'china-first-page' : i === 1 ? 'china-power-to-160' : 'case-' + i,
      path: '/api/catalog/search?market=china&preparedCut=' + release.generationId, total: 20, ids: ['8'.repeat(24)], totalRub: [1234567]}))};
  const oracleBytes = raw(oracle);
  const files = FILES.map(name => {
    const content = name === 'GENERATION.json' ? generationBytes : name === 'acceptance.json' ? oracleBytes : Buffer.from('private ' + name);
    return {name, bytes: content.length, sha256: hash(content), compressedBytes: content.length + 20, compressedSha256: hash('compressed ' + name)};
  });
  const plan = {version: 1, market: 'china', ...servingPlan, controllerSha,
    servingCalculationVersion: '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90',
    generationId: release.generationId, generationManifestSha256: release.generationManifestSha256,
    privateGenerationReceiptSha256: release.receiptSha256, sourceDescriptorSha256: 'f'.repeat(64), imageId: reuse.imageId, nonce,
    previousAcceptedETag: previous.etag, previousAcceptedStateSha256: previous.sha256, files, reuseSource: source};
  const result = {initialized: true, reused: true, plan, generationBase64: generationBytes.toString('base64'),
    oracleBase64: oracleBytes.toString('base64'), copiedFiles: 11, copiedBytes: files.reduce((sum, file) => sum + file.bytes, 0)};
  return {servingPlan, release, reuse, nonce, controllerSha, previous, result, generation, oracle, oracleBytes};
}

test('only the fixed reviewed profile enables reuse; original upload profile remains the default', () => {
  const f = fixture();
  assert.deepEqual(resolveChinaReleaseReuse(f.release, f.servingPlan), f.reuse);
  const ordinary = {...f.release}; delete ordinary.reuseHostAttempt;
  assert.equal(resolveChinaReleaseReuse(ordinary, f.servingPlan), null);
  for (const change of [v => { v.reuseHostAttempt = null; }, v => { v.reuseHostAttempt.source.path = '/arbitrary'; },
    v => { v.reuseHostAttempt.source.runtimeSha = '8'.repeat(40); }, v => { v.reuseHostAttempt.imageId = 'another:tag'; },
    v => { v.reuseHostAttempt.source.nonce = '../'; }, v => { v.reuseHostAttempt.source.rollbackSha256 = null; }]) {
    const release = structuredClone(f.release); change(release);
    assert.throws(() => resolveChinaReleaseReuse(release, f.servingPlan), /china_release_reuse_profile/);
  }
});

test('host reply binds fresh controller/fence, installed image, generation, metadata bytes and copied census', () => {
  const f = fixture(), verified = validateChinaReleaseReuseResult(f);
  assert.deepEqual(verified.generation, f.generation); assert.deepEqual(verified.oracle, f.oracle);
  assert.deepEqual(verified.oracleBytes, f.oracleBytes); assert.equal(verified.copiedFiles, 11);
  verified.plan.files[0].bytes = 1; assert.notEqual(f.result.plan.files[0].bytes, 1);
  const changes = [v => { v.result.plan.runtimeSha = '0'.repeat(40); }, v => { v.result.plan.pricingRuntimeSha = '0'.repeat(40); },
    v => { v.result.plan.controllerSha = '0'.repeat(40); }, v => { v.result.plan.nonce = v.reuse.source.nonce; },
    v => { v.result.plan.previousAcceptedETag = '"foreign"'; }, v => { v.result.plan.imageId = 'sha256:' + '0'.repeat(64); },
    v => { v.result.plan.reuseSource = {...v.reuse.source, planSha256: '0'.repeat(64)}; },
    v => { v.result.plan.privateGenerationReceiptSha256 = '0'.repeat(64); },
    v => { v.result.plan.files[0].sha256 = '0'.repeat(64); }, v => { v.result.plan.files.pop(); },
    v => { v.result.plan.files[1].name = v.result.plan.files[0].name; }, v => { v.result.copiedFiles--; },
    v => { v.result.copiedBytes++; }, v => { v.result.oracleBase64 = raw({not: 'oracle'}).toString('base64'); },
    v => { v.result.generationBase64 += '\n'; }, v => { v.result.logs = 'unapproved raw logs'; }];
  for (const change of changes) {
    const value = fixture(); change(value);
    assert.throws(() => validateChinaReleaseReuseResult(value), /china_release_reuse_/);
  }
});

test('matching checksums cannot substitute another generation or weaken the saved query oracle', () => {
  for (const alter of [
    value => { value.generation.runtimeSha = '0'.repeat(40); },
    value => { value.generation.source.supplierLatestVerified = false; },
    value => { value.oracle.httpVerified = true; },
    value => { value.oracle.expectedGeneration = 'gen_china_999_1'; },
    value => { value.oracle.cases[0].total--; },
    value => { value.oracle.cases[1].name = 'missing-power-case'; },
    value => { value.oracle.cases[2].path = 'https://foreign.invalid/private'; },
  ]) {
    const value = fixture(); alter(value);
    const generationBytes = raw(value.generation); value.release.generationManifestSha256 = hash(generationBytes);
    value.result.plan.generationManifestSha256 = value.release.generationManifestSha256;
    value.oracle.generationManifestSha256 = value.release.generationManifestSha256;
    for (const [name, data, field] of [['GENERATION.json', generationBytes, 'generationBase64'], ['acceptance.json', raw(value.oracle), 'oracleBase64']]) {
      const descriptor = value.result.plan.files.find(row => row.name === name);
      descriptor.bytes = data.length; descriptor.sha256 = hash(data); value.result[field] = data.toString('base64');
    }
    value.result.copiedBytes = value.result.plan.files.reduce((sum, file) => sum + file.bytes, 0);
    assert.throws(() => validateChinaReleaseReuseResult(value), /china_release_reuse_(?:generation_binding|oracle_binding|oracle_inventory|oracle_case)/);
  }
});

test('resume calls only the scoped host operation under authority and writes one private oracle', async t => {
  const f = fixture(), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-reuse-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const oraclePath = path.join(directory, 'acceptance.json'), calls = [];
  const session = {async call(method, params) {
    calls.push(method); assert.equal(method, 'resume_init');
    assert.deepEqual(params, {source: f.reuse.source, nonce: f.nonce, controllerSha: f.controllerSha,
      previousAcceptedETag: null, previousAcceptedStateSha256: null}); return f.result;
  }};
  const value = await resumeChinaHostAttempt({...f, session, oraclePath, assertAuthority: async () => calls.push('authority')});
  assert.deepEqual(calls, ['authority', 'resume_init', 'authority']);
  assert.deepEqual(await fs.readFile(oraclePath), f.oracleBytes); assert.equal((await fs.stat(oraclePath)).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(directory), ['acceptance.json']); assert.equal(value.oracleBytes, undefined);
  assert.equal(value.generation.rows, 20); assert.equal(value.copiedFiles, 11);
});

test('lost authority or corrupt host metadata stops before exposing an oracle to later release phases', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-reuse-fail-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  for (const mode of ['before', 'after', 'corrupt']) {
    const f = fixture(), oraclePath = path.join(directory, mode + '.json'); let checks = 0, calls = 0;
    const session = {async call() { calls++; if (mode === 'corrupt') f.result.oracleBase64 = Buffer.from('{}').toString('base64'); return f.result; }};
    await assert.rejects(resumeChinaHostAttempt({...f, session, oraclePath, assertAuthority: async () => {
      checks++; if (mode === 'before' || mode === 'after' && checks === 2) throw Error('china_release_lease_lost');
    }}), /china_release_(?:lease_lost|reuse_oracle_checksum)/);
    assert.equal(calls, mode === 'before' ? 0 : 1); await assert.rejects(fs.stat(oraclePath), {code: 'ENOENT'});
  }
});

test('the fixed mode step skips only image daemon/build; complete first-release acceptance remains common', async () => {
  const [workflow, controller] = await Promise.all([
    fs.readFile(path.join(ROOT, '.github/workflows/catalog-next-china-release.yml'), 'utf8'),
    fs.readFile(path.join(ROOT, 'scripts/catalog-next/release.mjs'), 'utf8'),
  ]);
  assert.equal((workflow.match(/if: steps\.release_profile\.outputs\.reuse_host != 'true'/g) ?? []).length, 2);
  assert.match(workflow, /id: release_profile/);
  assert.match(workflow, /node scripts\/catalog-next\/release-reuse\.mjs --workflow-mode >> "\$GITHUB_OUTPUT"/);
  const select = workflow.indexOf('release-reuse.mjs --workflow-mode');
  assert.ok(select > workflow.indexOf('verifyReadonlyInvocation'));
  assert.ok(select > workflow.indexOf('node --import tsx --test'));
  assert.ok(select < workflow.indexOf('secrets.REGCLOUD_SSH_KEY'));
  assert.match(workflow, /check-runtime-tests\.mjs/); assert.match(workflow, /npm run typecheck/);
  const branch = controller.indexOf('if (reuse) {'), common = controller.indexOf('const candidate =', branch);
  assert.ok(branch > 0 && common > branch);
  const reuseBranch = controller.slice(branch, controller.indexOf('} else {', branch));
  assert.match(reuseBranch, /acquireFirstReleaseFence\(\)/); assert.match(reuseBranch, /resumeChinaHostAttempt/);
  assert.doesNotMatch(reuseBranch, /restorePrivateChinaGeneration|packFile|session\.upload|acceptance-oracle|build-release-image/);
  let previous = common;
  for (const phase of ['start_candidate_preserving_live', 'exact_rows_prices_and_filters', 'unchanged_server_speed_baseline',
    'reserve_china_publication', 'switch_china_with_rollback_armed', 'live_mobile_desktop_browser',
    'general_catalog_power_city_detail_back', 'persist_exact_browser_evidence', 'accept_checked_china', 'commit_accepted_china_pointer']) {
    const index = controller.indexOf("'" + phase + "'", previous); assert.ok(index > previous, phase); previous = index;
  }
  assert.match(controller.slice(common), /state\.abortReserved/); assert.match(controller.slice(common), /state\.finalizeRollback/);
});

for (const mode of ['initial', 'reuse', 'functional-failure', 'startup-failure', 'retained-failure']) test('real release entrypoint with native state machine: ' + mode, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-release-flow-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  await fs.writeFile(path.join(directory, 'fixture.json'), JSON.stringify(fixture()));
  await execute(process.execPath, ['--experimental-vm-modules', path.join(ROOT, 'tests/helpers/catalog-next-release-flow.mjs'), directory, mode],
    {cwd: ROOT, env: {PATH: process.env.PATH}, timeout: 10000});
  const value = JSON.parse(await fs.readFile(path.join(directory, 'result.json'), 'utf8'));
  assert.equal(value.privateDataLeaked, false); assert.ok(value.lease.value, JSON.stringify({calls: value.calls, report: value.report}));
  assert.equal(value.lease.value.status, 'released');
  if (mode === 'functional-failure' || mode === 'startup-failure' || mode === 'retained-failure') {
    assert.equal(value.report.accepted, false); assert.equal(value.exitCode, 1); assert.equal(value.aborted, true);
    assert.equal(value.report.errorCode, { 'functional-failure': 'china_host_functional_fixture',
      'startup-failure': 'china_host_candidate_startup', 'retained-failure': 'china_host_reuse_retained_changed'}[mode]);
    assert.equal(value.accepted.value, null);
    assert.ok(!value.calls.includes('switch')); assert.ok(!value.calls.includes('state:reserve'));
  } else {
    assert.equal(value.report.accepted, true, JSON.stringify(value.report)); assert.equal(value.exitCode, 0); assert.equal(value.closed, true);
    assert.equal(value.accepted.value.current.generationId, 'gen_china_100_1'); assert.equal(value.accepted.value.pending, null);
    const ordered = ['state:acquireLease', 'start', 'functional', 'speed', 'state:reserve', 'switch',
      'child:owner-filter-speed-live.mjs', 'child:browser-acceptance.mjs', 'browser_evidence', 'accept', 'state:commit', 'close', 'state:releaseLease'];
    let at = -1;
    for (const call of ordered) { const next = value.calls.indexOf(call, at + 1); assert.ok(next > at, call); at = next; }
  }
  if (mode === 'startup-failure') {
    assert.equal(value.report.startupFailure.reason, 'exited'); assert.equal(value.report.startupFailure.candidate.exitCode, 1);
    assert.equal(value.report.startupFailure.elapsedSeconds, 2); assert.ok(!value.calls.includes('functional'));
  }
  if (mode === 'retained-failure') {
    assert.equal(value.report.phase, 'reuse_verified_server_files');
    assert.deepEqual(value.report.retainedFenceFailure, {version: 1, kind: 'china-host-retained-fence-v1',
      ingressChanged: false, changedFields: ['Pid', 'StartedAt'], mountOrderOnly: false,
      beforePid: 123, afterPid: 124, beforeStartedAt: '2026-11-24T00:00:00Z', afterStartedAt: '2026-11-24T12:00:00Z'});
    for (const call of ['start', 'functional', 'speed', 'state:reserve', 'switch', 'accept', 'state:commit'])
      assert.ok(!value.calls.includes(call), call);
  }
  if (mode === 'initial') {
    assert.ok(value.calls.includes('restore-generation')); assert.ok(value.calls.includes('child:acceptance-oracle.mjs'));
    assert.equal(value.calls.filter(call => call.startsWith('upload:')).length, 11); assert.ok(value.calls.includes('init'));
    assert.ok(!value.calls.includes('resume_init'));
  } else {
    assert.ok(value.calls.indexOf('resume_init') > value.calls.indexOf('state:acquireLease'));
    assert.ok(!value.calls.includes('restore-generation')); assert.ok(!value.calls.includes('child:acceptance-oracle.mjs'));
    assert.equal(value.calls.filter(call => call.startsWith('upload:')).length, 0); assert.ok(!value.calls.includes('init'));
  }
});
