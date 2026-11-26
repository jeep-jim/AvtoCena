import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createChinaState} from '../scripts/catalog-next/china-state.mjs';
import {EXACT, MARKER, REPORT, OPERATION, verifyInvocation, createReadonlyStateReader,
  summarizeHostOutcome, runOutcomeCapture} from '../scripts/catalog-next/inspect-code-outcome-45841493341.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile), copy = value => structuredClone(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const bytes = value => Buffer.from(JSON.stringify(ordered(value)));
const absent = () => ({found: false, etag: null, sha256: null, value: null});
const WORKFLOW = 'jeep-jim/AvtoCena/.github/workflows/catalog-next-code-outcome-45841493341-readonly.yml@refs/heads/main';
const PRIVATE = 'synthetic-private-token-do-not-echo';
const now = () => '2026-11-26T15:30:00.000Z';

function acceptance(reference, nonce, intent) {
  const speed = Buffer.from(JSON.stringify({release: reference.runtimeSha, passed: true, browserPassed: true, speedGuard: {passed: true}}));
  const details = Buffer.from(JSON.stringify({kind: 'china-browser-details-v1', release: reference.runtimeSha,
    nonce, passed: true, generationManifestSha256: reference.generationManifestSha256, precedingSpeedReportSha256: hash(speed), private: PRIVATE}));
  const receipt = {version: 1, kind: 'china-host-acceptance-v1', release: reference.runtimeSha,
    pricingRuntimeSha: reference.pricingRuntimeSha, generationId: reference.generationId,
    generationManifestSha256: reference.generationManifestSha256, privateGenerationReceiptSha256: reference.receiptSha256,
    sourceDescriptorSha256: reference.sourceDescriptorSha256, imageId: reference.imageId, sourceCursor: reference.sourceCursor,
    sourceObservedAt: reference.sourceObservedAt, nonce, acceptedAt: intent ? '2026-11-26T15:05:00.000Z' : '2026-11-26T14:00:00.000Z',
    retainedContainerId: '3'.repeat(64), browser: {release: reference.runtimeSha, nonce, passed: true, functionalPassed: true,
      speedPassed: true, speedReportSha256: hash(speed), detailsReportSha256: hash(details), reportSha256: hash(Buffer.concat([speed, details]))},
    private: PRIVATE};
  if (intent) Object.assign(receipt, {transition: 'code-update', previousAcceptedETag: intent.value.previous.etag,
    previousAcceptedStateSha256: intent.value.previous.sha256, retainedRuntimeSha: EXACT.retainedRuntimeSha,
    retainedImageId: intent.value.previous.value.current.imageId});
  const raw = Buffer.from(JSON.stringify(receipt));
  return {hostReceiptBase64: raw.toString('base64'), hostReceiptSha256: hash(raw), browserSpeedBytes: speed, browserDetailsBytes: details};
}

function rollback(intent, overrides = {}) {
  const value = intent.value, candidate = value.candidate;
  const receipt = {version: 1, kind: 'china-host-rollback-v1', nonce: EXACT.nonce, release: EXACT.runtimeSha,
    imageId: EXACT.imageId, pricingRuntimeSha: candidate.pricingRuntimeSha, generationId: candidate.generationId,
    generationManifestSha256: candidate.generationManifestSha256, privateGenerationReceiptSha256: candidate.receiptSha256,
    sourceDescriptorSha256: candidate.sourceDescriptorSha256, previousAcceptedETag: value.previous.etag,
    previousAcceptedStateSha256: value.previous.sha256, retainedContainerId: '3'.repeat(64),
    retainedRuntimeSha: EXACT.retainedRuntimeSha, retainedImageId: value.previous.value.current.imageId,
    rolledBackAt: '2026-11-26T15:05:30.000Z', retainedRunning: true, ingressRestored: true, candidateRemoved: true,
    private: PRIVATE, ...overrides};
  const raw = Buffer.from(JSON.stringify(receipt));
  return {status: 'rolled_back', hostRollbackBase64: raw.toString('base64'), hostRollbackSha256: hash(raw)};
}

async function publication(mode = 'reserved') {
  const values = new Map(), reads = [], writes = []; let sequence = 0, clock = '2026-11-26T14:00:00.000Z';
  const storage = {stopFinalization: false,
    async read(name) { reads.push(name); return copy(values.get(name) ?? absent()); },
    force(name, value) { values.set(name, {found: true, etag: '"' + PRIVATE + '-' + ++sequence + '"', sha256: hash(bytes(value)), value: copy(value)}); },
    async compareAndSwap(name, previous, value) {
      assert.equal((await storage.read(name)).etag, previous.etag); writes.push(name);
      if (storage.stopFinalization && name === 'intent' && value.status !== 'pending') throw Error('synthetic interruption');
      storage.force(name, value);
    }};
  const state = createChinaState({storage, now: () => clock});
  const base = {market: 'china', generationId: 'gen_china_45655051136_1', owner: {runId: '45655051136', attempt: '1', revision: '1'.repeat(40)},
    receiptSha256: '2'.repeat(64), sourceDescriptorSha256: '4'.repeat(64), generationManifestSha256: '5'.repeat(64),
    sourceCursor: 12345, sourceObservedAt: '2026-11-26T13:00:00.000Z', runtimeSha: EXACT.retainedRuntimeSha,
    pricingRuntimeSha: '6'.repeat(40), imageId: 'sha256:' + '7'.repeat(64)};
  let lease = await state.acquireLease({previous: absent(), owner: base.owner, nonce: '8'.repeat(32), expiresAt: '2026-11-26T14:30:00.000Z'});
  const initial = await state.reserve({lease, previous: absent(), previousIntent: absent(), candidate: base});
  const previous = await state.commit({lease, ...initial, evidence: acceptance(base, '8'.repeat(32))});
  await state.releaseLease({lease}); clock = '2026-11-26T15:00:00.000Z';
  lease = await state.acquireLease({previous: await state.read('lease'),
    owner: {runId: EXACT.runId, attempt: EXACT.attempt, revision: '9'.repeat(40)}, nonce: EXACT.nonce,
    expiresAt: '2026-11-26T15:20:00.000Z'});
  const candidate = {...base, runtimeSha: EXACT.runtimeSha, imageId: EXACT.imageId};
  const staged = await state.reserve({lease, previous: previous.accepted, previousIntent: previous.intent,
    candidate, transition: 'code-update'});
  const rollbackOutcome = rollback(staged.intent), acceptedEvidence = acceptance(candidate, EXACT.nonce, staged.intent);
  if (mode !== 'reserved') {
    storage.stopFinalization = mode.endsWith('_pending');
    const work = mode.startsWith('accepted')
      ? state.commit({lease, ...staged, evidence: acceptedEvidence}) : state.abortReserved({lease, ...staged, evidence: rollbackOutcome});
    if (storage.stopFinalization) await assert.rejects(work, /write_not_committed/); else await work;
    storage.stopFinalization = false;
  }
  await state.releaseLease({lease}); reads.length = 0; writes.length = 0;
  return {storage, values, reads, writes, staged, rollbackOutcome,
    acceptedOutcome: {status: 'accepted', hostReceiptBase64: acceptedEvidence.hostReceiptBase64,
      hostReceiptSha256: acceptedEvidence.hostReceiptSha256, browserSpeedBase64: acceptedEvidence.browserSpeedBytes.toString('base64'),
      browserDetailsBase64: acceptedEvidence.browserDetailsBytes.toString('base64')}};
}

async function fixture(run, mode = 'reserved') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'code-outcome-test-'));
  try {
    const root = path.join(directory, 'root'), runner = path.join(directory, 'runner');
    await fs.mkdir(root); await fs.mkdir(runner);
    const f = await publication(mode), calls = [], logs = [];
    const session = {async call(method, selector) { calls.push({method, selector}); return f.rollbackOutcome; },
      async close() { calls.push({method: 'close'}); return {closed: true, readOnly: true}; },
      abort() { calls.push({method: 'abort'}); }, exited: Promise.resolve({code: 0})};
    const capabilities = {verifyInvocation: () => ({sourceSha: 'a'.repeat(40), approvedSourceSha: 'b'.repeat(40)}),
      verifyBaselines() {}, createReader: () => ({assertPrivateBucket: async () => ({verified: true}), read: name => f.storage.read(name)}),
      openSession: async input => { f.sessionDirectory = input.directory; assert.equal(input.privateKey, PRIVATE); return session; }};
    const args = {root, environment: {RUNNER_TEMP: runner, SSH_PRIVATE_KEY: PRIVATE}, capabilities, now, log: value => logs.push(value)};
    await run({...f, root, runner, calls, logs, session, capabilities, args});
  } finally { await fs.rm(directory, {recursive: true, force: true}); }
}

test('fixed failed runtime/image/nonce/run never follows the current candidate plan', async () => {
  assert.deepEqual(EXACT, {runId: '45841493341', attempt: '1', runtimeSha: 'cf932b18644b5317c142ffdeb8f1586526644012',
    imageId: 'sha256:8f385c14a1c0015575f5c33fa2865efa4495d7bd70d64974cde852c262297505',
    nonce: 'ea36fb55d3528a0181a5d7690f441d8a', retainedRuntimeSha: '077cbb17626ab0c64e7f06db055fef9252ad21c0'});
  assert.ok(Object.isFrozen(EXACT));
  const script = await fs.readFile(path.join(ROOT, 'scripts/catalog-next/inspect-code-outcome-45841493341.mjs'), 'utf8');
  assert.doesNotMatch(script, /code-serving-plan|source-plan|code-entry|\.compareAndSwap\(|\.acquireLease\(|\.renewLease\(|\.reserve\(|\.cleanup\(|\.upload\(/);
  assert.deepEqual([...script.matchAll(/session\.call\('([^']+)'/g)].map(row => row[1]), ['recover']);
});

test('reserved state and exact rollback witness are captured without any state mutation or private echo', async () => fixture(async f => {
  const original = copy([...f.values]);
  const report = await runOutcomeCapture(f.args);
  assert.equal(report.completed, true); assert.equal(report.conclusion, 'rollback_proof_available_state_reserved');
  assert.equal(report.before.state, 'reserved'); assert.equal(report.after.state, 'reserved'); assert.equal(report.stateStable, true);
  assert.equal(report.host.proofSha256, f.rollbackOutcome.hostRollbackSha256); assert.equal(report.hostClosedReadOnly, true);
  assert.equal(report.reconciledByThisOperation, false);
  assert.deepEqual(report.hostReadCapabilities, ['saved_plan_and_outcome', 'docker_get', 'local_health_get']);
  assert.deepEqual(f.calls, [{method: 'recover', selector: {runtimeSha: EXACT.runtimeSha, nonce: EXACT.nonce}}, {method: 'close'}]);
  assert.deepEqual(f.reads.sort(), ['accepted', 'accepted', 'intent', 'intent', 'lease', 'lease']);
  assert.deepEqual(f.writes, []); assert.deepEqual([...f.values], original);
  const raw = await fs.readFile(path.join(f.root, REPORT), 'utf8');
  assert.doesNotMatch(raw, new RegExp(PRIVATE)); assert.doesNotMatch(raw, /Base64|"etag"|sourceCursor|sourceObservedAt/);
  assert.ok(Buffer.byteLength(raw) < 64 * 1024); assert.equal((await fs.stat(path.join(f.root, REPORT))).mode & 0o777, 0o600);
  assert.equal((await fs.readdir(f.runner)).length, 0);
  assert.deepEqual(f.logs, [report]);
}));

for (const [mode, state, expected] of [['rollback_pending', 'rollback_needs_evidence', 'rollback_proof_available_intent_pending'],
  ['rollback_resolved', 'resolved', 'rollback_reconciled'], ['accepted_pending', 'accepted_needs_finalization', 'acceptance_proof_available_intent_pending'],
  ['accepted_resolved', 'resolved', 'acceptance_reconciled']]) {
  test('existing native state classifier preserves ' + mode + ' without completing it', async () => fixture(async f => {
    if (mode.startsWith('accepted')) f.session.call = async () => f.acceptedOutcome;
    const report = await runOutcomeCapture(f.args);
    assert.equal(report.before.state, state); assert.equal(report.conclusion, expected); assert.deepEqual(f.writes, []);
    assert.equal(report.reconciledByThisOperation, false); assert.equal(report.stateStable, true);
  }, mode));
}

test('pending host outcome remains pending, even with a previously accepted retained state', async () => fixture(async f => {
  f.session.call = async () => ({status: 'pending'});
  const report = await runOutcomeCapture(f.args);
  assert.equal(report.completed, true); assert.equal(report.conclusion, 'host_outcome_pending');
  assert.deepEqual(report.host, {status: 'pending', durableProofPresent: false}); assert.deepEqual(f.writes, []);
}));

test('changed lease or accepted observation prevents a stable-state conclusion and preserves both observations', async () => {
  for (const name of ['lease', 'accepted']) await fixture(async f => {
    f.session.call = async () => { const value = copy(f.values.get(name).value);
      if (name === 'lease') value.epoch++; else value.revision++;
      f.storage.force(name, value); return f.rollbackOutcome; };
    await assert.rejects(runOutcomeCapture(f.args), /code_outcome_capture_state_changed/);
    const report = JSON.parse(await fs.readFile(path.join(f.root, REPORT), 'utf8'));
    assert.equal(report.completed, false); assert.equal(report.stateStable, false); assert.equal(report.conclusion, 'unverified');
    assert.notEqual(report.before.observations[name].sha256, report.after.observations[name].sha256);
    assert.equal(report.host.proofSha256, f.rollbackOutcome.hostRollbackSha256); assert.deepEqual(f.writes, []);
  });
});

test('a foreign failed intent, image or nonce is recorded safely and rejected before SSH', async () => {
  for (const modify of [value => { value.nonce = 'e'.repeat(32); }, value => { value.owner.runId = '123'; },
    value => { value.candidate.imageId = 'sha256:' + 'f'.repeat(64); }, value => { value.candidate.runtimeSha = 'f'.repeat(40); }]) {
    await fixture(async f => {
      const value = copy(f.values.get('intent').value); modify(value); f.storage.force('intent', value);
      f.capabilities.openSession = async () => assert.fail('must refuse before SSH');
      await assert.rejects(runOutcomeCapture(f.args), /code_outcome_capture_target_mismatch/);
      const report = JSON.parse(await fs.readFile(path.join(f.root, REPORT), 'utf8'));
      assert.equal(report.before.targetMatches, false); assert.equal(report.stateStable, true); assert.deepEqual(f.writes, []);
    });
  }
});

test('wrong hashes, identity, predecessor, dates and rollback flags cannot become a valid witness', async () => {
  const f = await publication();
  for (const changes of [{nonce: 'f'.repeat(32)}, {release: 'f'.repeat(40)}, {imageId: 'sha256:' + 'f'.repeat(64)},
    {previousAcceptedETag: '"other"'}, {previousAcceptedStateSha256: 'f'.repeat(64)}, {retainedRuntimeSha: 'f'.repeat(40)},
    {retainedImageId: 'sha256:' + 'f'.repeat(64)}, {retainedContainerId: PRIVATE}, {rolledBackAt: '2026-11-26T14:00:00Z'},
    {retainedRunning: false}, {ingressRestored: false}, {candidateRemoved: false}]) {
    assert.throws(() => summarizeHostOutcome(rollback(f.staged.intent, changes), f.staged.intent), /code_outcome_capture_proof_binding/);
  }
  for (const bad of [{...f.rollbackOutcome, hostRollbackSha256: '0'.repeat(64)},
    {...f.rollbackOutcome, hostRollbackBase64: PRIVATE}, {...f.rollbackOutcome, hostRollbackBase64: 'a'.repeat(400000)},
    {...f.rollbackOutcome, private: PRIVATE}, {status: 'pending', private: PRIVATE}]) {
    assert.throws(() => summarizeHostOutcome(bad, f.staged.intent), /code_outcome_capture_(?:proof_|outcome_shape)/);
  }
});

test('accepted host status still requires the real receipt and bound browser bytes', async () => {
  const f = await publication();
  assert.equal(summarizeHostOutcome(f.acceptedOutcome, f.staged.intent).status, 'accepted');
  assert.throws(() => summarizeHostOutcome({...f.acceptedOutcome, browserDetailsBase64: Buffer.from('{}').toString('base64')}, f.staged.intent),
    /code_outcome_capture_browser_binding/);
  assert.throws(() => summarizeHostOutcome({status: 'accepted'}, f.staged.intent), /code_outcome_capture_outcome_shape/);
});

test('transport/private errors preserve safe state snapshots and remove only the runner secret directory', async () => {
  for (const message of [PRIVATE, 'china_host_' + PRIVATE, 'china_host_recovery_rollback']) await fixture(async f => {
    f.session.call = async () => { throw Error(message); };
    const expected = message === 'china_host_recovery_rollback' ? message : 'code_outcome_capture_failed';
    await assert.rejects(runOutcomeCapture(f.args), error => error.message === expected);
    const raw = await fs.readFile(path.join(f.root, REPORT), 'utf8'), report = JSON.parse(raw);
    assert.doesNotMatch(raw, new RegExp(PRIVATE)); assert.equal(report.errorCode, expected);
    assert.equal(report.failureStage, 'host_recover'); assert.equal(report.before.complete, true); assert.equal(report.after.complete, true);
    assert.equal(report.completed, false); assert.equal(report.stateStable, true); assert.equal(report.host, undefined);
    assert.deepEqual(f.calls, [{method: 'abort'}]); assert.deepEqual(await fs.readdir(f.runner), []); assert.deepEqual(f.writes, []);
  });
});

test('a malformed proof cannot leak its private receipt in a persisted failure report', async () => fixture(async f => {
  f.session.call = async () => rollback(f.staged.intent, {retainedContainerId: PRIVATE});
  await assert.rejects(runOutcomeCapture(f.args), /code_outcome_capture_proof_binding/);
  const raw = await fs.readFile(path.join(f.root, REPORT), 'utf8');
  assert.doesNotMatch(raw, new RegExp(PRIVATE)); assert.doesNotMatch(raw, /Base64/);
  assert.equal(JSON.parse(raw).host, undefined); assert.deepEqual(f.calls, [{method: 'abort'}]);
}));

test('capture cannot complete without an explicit read-only close acknowledgement', async () => fixture(async f => {
  f.session.close = async () => ({closed: true, accepted: false});
  await assert.rejects(runOutcomeCapture(f.args), /code_outcome_capture_host_close/);
  const report = JSON.parse(await fs.readFile(path.join(f.root, REPORT), 'utf8'));
  assert.equal(report.completed, false); assert.equal(report.hostClosedReadOnly, undefined);
  assert.equal(report.host.status, 'rolled_back'); assert.equal(report.stateStable, true);
}));

test('one unavailable or malformed state key keeps the other bounded observations without opening SSH', async () => {
  for (const malformed of [false, true]) await fixture(async f => {
    f.capabilities.createReader = () => ({assertPrivateBucket: async () => ({verified: true}), async read(name) {
      if (name !== 'lease') return f.storage.read(name);
      if (malformed) return {found: true, etag: PRIVATE, sha256: PRIVATE, value: {secret: PRIVATE}};
      throw Error(PRIVATE);
    }});
    f.capabilities.openSession = async () => assert.fail('must refuse before SSH');
    await assert.rejects(runOutcomeCapture(f.args), /code_outcome_capture_state_read_incomplete/);
    const raw = await fs.readFile(path.join(f.root, REPORT), 'utf8'), report = JSON.parse(raw);
    assert.equal(report.before.complete, false); assert.equal(report.before.observations.accepted.valid, true);
    assert.equal(report.before.observations.intent.valid, true); assert.equal(report.before.observations.lease.valid, false);
    assert.equal(report.after.complete, false); assert.doesNotMatch(raw, new RegExp(PRIVATE));
  });
});

test('real storage adapter exposes only reads and makes GET requests solely for private exact state keys', async () => {
  const f = await publication(), calls = [];
  const acl = '<AccessControlPolicy><Owner><ID>fixture-owner</ID></Owner><AccessControlList><Grant>'
    + '<Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>fixture-owner</ID></Grantee>'
    + '<Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>';
  const reader = createReadonlyStateReader({environment: {YC_OBJECT_STORAGE_ENDPOINT: 'https://s3.regru.cloud',
    YC_OBJECT_STORAGE_REGION: 'us-east-1', YC_OBJECT_STORAGE_BUCKET: 'avtocena-staging-8120751',
    YC_OBJECT_STORAGE_PREFIX: 'migration-staging/full-20261011/', YC_OBJECT_STORAGE_ACCESS_KEY_ID: 'synthetic', YC_OBJECT_STORAGE_SECRET_ACCESS_KEY: PRIVATE},
    fetcher: async (url, init) => {
      calls.push({url, method: init.method}); const target = new URL(url);
      assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
      if (target.searchParams.has('acl')) return new Response(acl);
      if (target.searchParams.has('policy')) return new Response('<Error><Code>NoSuchBucketPolicy</Code></Error>', {status: 404});
      const name = path.basename(target.pathname, '.json'), saved = f.values.get(name);
      assert.ok(saved); return new Response(bytes(saved.value), {headers: {etag: saved.etag}});
    }});
  assert.deepEqual(Object.keys(reader).sort(), ['assertPrivateBucket', 'read']);
  assert.equal((await reader.assertPrivateBucket()).verified, true);
  for (const name of ['accepted', 'intent', 'lease']) assert.deepEqual(await reader.read(name), f.values.get(name));
  assert.equal(calls.length, 8);
  const before = calls.length; await assert.rejects(reader.read('../supplier'), /china_state_key/); assert.equal(calls.length, before);
});

test('existing fresh-session recover protocol never initializes Host and closes read-only', async () => {
  const program = `import importlib.util, io, json, sys\nfrom pathlib import Path\np=Path('scripts/catalog-next/release-host.py')\nspec=importlib.util.spec_from_file_location('release_host_readonly_test', p)\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\ncalls=[]\ndef forbidden(*args, **kwargs):\n raise AssertionError('no host writes or initialization')\ndef recover(params):\n assert params == ${JSON.stringify({runtimeSha: EXACT.runtimeSha, nonce: EXACT.nonce})}\n calls.append('recover')\n return {'status':'pending'}\nm.Host=forbidden\nm.docker=forbidden\nm.new_file=forbidden\nm.read_outcome=recover\nrows=[{'id':1,'method':'recover','params':${JSON.stringify({runtimeSha: EXACT.runtimeSha, nonce: EXACT.nonce})}},{'id':2,'method':'close'}]\nsys.stdin=io.TextIOWrapper(io.BytesIO(('\\n'.join(json.dumps(row) for row in rows)+'\\n').encode()))\nm.main()\nassert calls == ['recover']\n`;
  const {stdout, stderr} = await execute('python3', ['-I', '-B', '-c', program], {cwd: ROOT});
  assert.equal(stderr, ''); const events = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(events.map(row => row.kind), ['ready', 'result', 'result']);
  assert.deepEqual(events[2].value, {closed: true, readOnly: true});
});

test('workflow uses one immutable marker trigger and gives credentials only after local verification', async () => {
  const workflow = await fs.readFile(path.join(ROOT, '.github/workflows/catalog-next-code-outcome-45841493341-readonly.yml'), 'utf8');
  assert.match(workflow, /on:\n  push:\n    branches: \[main\]\n    paths: \['\.github\/market-runs\/catalog-next-code-outcome-45841493341-readonly\.json'\]/);
  assert.match(workflow, /permissions:\n  contents: read/); assert.match(workflow, /group: catalog-next-china\n  cancel-in-progress: false/);
  assert.match(workflow, /github\.repository_id == '1289722938'.*github\.ref == 'refs\/heads\/main'.*github\.run_attempt == '1'/);
  assert.match(workflow, /timeout-minutes: 15/); assert.match(workflow, /environment: regcloud-staging/);
  assert.match(workflow, /fetch-depth: 2/); assert.match(workflow, /persist-credentials: false/);
  const verify = workflow.indexOf('inspect-code-outcome-45841493341.mjs --verify'), tests = workflow.indexOf('node --test');
  const secret = workflow.indexOf('secrets.REGCLOUD_SSH_KEY'), run = workflow.indexOf('inspect-code-outcome-45841493341.mjs --run');
  assert.ok(verify > 0 && tests > verify && secret > tests && run > secret);
  assert.deepEqual(workflow.match(/secrets\.[A-Z_0-9]+/g), ['secrets.REGCLOUD_SSH_KEY', 'secrets.REGCLOUD_S3_ACCESS_KEY_ID', 'secrets.REGCLOUD_S3_SECRET_ACCESS_KEY']);
  assert.doesNotMatch(workflow, /workflow_dispatch|schedule:|repository_dispatch|\bcurl\b|\bscp\b|AUTO_API|prepare-generation|code-entry|daily-entry/);
  assert.match(workflow, /path: catalog-next-code-outcome-45841493341-readonly-report\.json/);
});

test('immutable marker-only verification rejects manual triggers, other jobs and combined code changes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'code-outcome-git-test-'));
  const git = async args => (await execute('git', ['-c', 'user.name=Readonly test', '-c', 'user.email=readonly@example.invalid', ...args], {cwd: directory})).stdout.trim();
  try {
    await fs.mkdir(path.join(directory, '.github/market-runs'), {recursive: true}); await git(['init', '-q', '--initial-branch=main']);
    await fs.writeFile(path.join(directory, 'reviewed.txt'), 'reviewed'); await git(['add', '--all']); await git(['commit', '-qm', 'reviewed']);
    const parent = await git(['rev-parse', 'HEAD']);
    await fs.writeFile(path.join(directory, MARKER), JSON.stringify({version: 1, operation: OPERATION, approvedSourceSha: parent}));
    await git(['add', '--all']); await git(['commit', '-qm', 'marker']); const head = await git(['rev-parse', 'HEAD']);
    const eventPath = path.join(directory, 'event.json');
    await fs.writeFile(eventPath, JSON.stringify({before: parent, after: head, ref: 'refs/heads/main', created: false, deleted: false, forced: false}));
    const environment = {GITHUB_REPOSITORY: 'jeep-jim/AvtoCena', GITHUB_REPOSITORY_ID: '1289722938', GITHUB_REF: 'refs/heads/main',
      GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'push', GITHUB_SHA: head, GITHUB_EVENT_PATH: eventPath, GITHUB_WORKFLOW_REF: WORKFLOW, GITHUB_JOB: 'inspect'};
    assert.equal(verifyInvocation({root: directory, environment}).approvedSourceSha, parent);
    for (const change of [{GITHUB_EVENT_NAME: 'workflow_dispatch'}, {GITHUB_JOB: 'reconcile'}, {GITHUB_RUN_ATTEMPT: '2'},
      {GITHUB_WORKFLOW_REF: WORKFLOW.replace('main', 'other')}, {GITHUB_REPOSITORY_ID: '1'}])
      assert.throws(() => verifyInvocation({root: directory, environment: {...environment, ...change}}), /(?:code_outcome_capture|readonly_invocation)_/);
    await fs.writeFile(path.join(directory, 'reviewed.txt'), 'unreviewed');
    assert.throws(() => verifyInvocation({root: directory, environment}), /readonly_invocation_git_unverified/);
  } finally { await fs.rm(directory, {recursive: true, force: true}); }
});

test('CLI selector overrides are rejected before any transport or credential access', async () => {
  await assert.rejects(execute(process.execPath, ['scripts/catalog-next/inspect-code-outcome-45841493341.mjs', '--run', '--runtimeSha=other'],
    {cwd: ROOT, env: {PATH: process.env.PATH}}), error => error.code === 1
      && error.stderr.trim() === 'code_outcome_capture_cli_arguments' && error.stdout === '');
});
