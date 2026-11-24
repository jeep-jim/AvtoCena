import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {CHINA_STARTUP_DIAGNOSIS_SELECTOR as SELECTOR, verifyChinaStartupDiagnosisInvocation,
  validateChinaStartupDiagnosis, runChinaStartupDiagnosis} from '../scripts/catalog-next/diagnose-startup.mjs';

const execute = promisify(execFile);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MARKER = '.github/market-runs/catalog-next-china-startup-diagnosis.json';
const WORKFLOW = 'jeep-jim/AvtoCena/.github/workflows/catalog-next-china-startup-diagnosis.yml@refs/heads/main';
const REPORT = 'catalog-next-china-startup-diagnosis-report.json';
const FILES = ['GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json',
  'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson', 'image.tar', 'acceptance.json',
  'regcloud-performance-gate.py', 'accepted-speed-baseline.json'];
const git = async (root, args) => (await execute('git', ['-c', 'user.name=Startup diagnosis test',
  '-c', 'user.email=diagnosis@example.invalid', ...args], {cwd: root})).stdout.trim();
const fixedNow = () => '2026-11-24T15:40:00.000Z';

function diagnostic() {
  return {version: 1, kind: 'china-host-startup-diagnosis-v1', readOnly: true, selector: {...SELECTOR},
    nonce: 'c'.repeat(32), planSha256: 'a'.repeat(64), rollbackSha256: 'b'.repeat(64),
    outcome: 'rolled_back', files: FILES.map(name => ({name, present: true, bytes: 17, expectedBytes: 17,
      sizeMatches: true, private: true})), generationVerified: true, diskFreeBytes: 10 * 1024 ** 3,
    image: {present: true, identityMatches: true}, retained: {identityConfirmed: true, running: true},
    candidate: {present: false, running: null, status: null, exitCode: null, oomKilled: null},
    events: {available: true, reason: 'empty', rows: []}, startup: null,
    serverSpeed: {present: false, sha256: null, exitCode: null, samples: [], rejectedSamples: 0}};
}

function timingDiagnostic() {
  const value = diagnostic();
  value.startup = {version: 1, kind: 'china-host-startup-v1', ready: true, elapsedSeconds: 0.8, attempts: 1,
    health: 'ok', reason: 'ready', candidate: {running: true, status: 'running', exitCode: 0, oomKilled: false, restartCount: 0}};
  const baseline = {speedBaseline: 'warm', path: '/api/health', referenceSeconds: 0.1, measurementNoiseSeconds: 0.05,
    ceilingSeconds: 0.15, seconds: 0.25, blocking: true, passed: false};
  value.serverSpeed = {present: true, sha256: 'd'.repeat(64), exitCode: 1, rejectedSamples: 1, samples: [
    {performanceRequest: 'started', path: '/api/health'},
    {performanceRequest: 'complete', path: '/api/health', seconds: 0.2, functionalPassed: true},
    {performanceRequest: 'failed', path: '/cars?market=china', seconds: 90, errorType: 'TimeoutError'},
    baseline, {...baseline, recheckSeconds: [0.2, 0.3, 0.4], recheckMedianSeconds: 0.3},
    {performanceGate: 'after_ttl', path: '/cars?market=china', seconds: 1, ceiling: 2,
      passed: true, functionalPassed: true, latencyBlocking: false},
    {performanceGate: 'summary', marketScope: 'china', routes: ['/api/health', '/cars?market=china'],
      acceptedBaselineRoutes: ['/api/health'], samples: 6, slowSamples: 1, functionalPassed: true,
      performanceAccepted: false, latencyBlocking: false, acceptedBaselineEnforced: true},
  ]};
  return value;
}

async function fixture(run, {markerExtra = false, markerOperation = 'inspect-china-startup'} = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-diagnosis-test-'));
  const root = path.join(directory, 'repo'), runnerTemp = path.join(directory, 'runner');
  const eventPath = path.join(directory, 'event.json');
  try {
    await fs.mkdir(path.join(root, '.github/market-runs'), {recursive: true});
    await fs.mkdir(runnerTemp);
    await git(root, ['init', '-q', '--initial-branch=main']);
    await fs.writeFile(path.join(root, 'controller.txt'), 'reviewed controller\n');
    const commit = async () => {
      await git(root, ['add', '--all']); await git(root, ['commit', '-qm', 'synthetic test only']);
      return git(root, ['rev-parse', 'HEAD']);
    };
    const approvedSourceSha = await commit();
    await fs.writeFile(path.join(root, MARKER), JSON.stringify({version: 1, operation: markerOperation, approvedSourceSha}));
    if (markerExtra) await fs.appendFile(path.join(root, 'controller.txt'), 'unreviewed mutation\n');
    const sourceSha = await commit();
    await fs.writeFile(eventPath, JSON.stringify({before: approvedSourceSha, after: sourceSha,
      ref: 'refs/heads/main', created: false, deleted: false, forced: false}));
    const environment = {GITHUB_REPOSITORY: 'jeep-jim/AvtoCena', GITHUB_REPOSITORY_ID: '1289722938',
      GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'push',
      GITHUB_SHA: sourceSha, GITHUB_EVENT_PATH: eventPath, GITHUB_WORKFLOW_REF: WORKFLOW,
      RUNNER_TEMP: runnerTemp, SSH_PRIVATE_KEY: 'synthetic-private-key-do-not-log'};
    await run({root, directory, runnerTemp, eventPath, environment, approvedSourceSha, sourceSha});
  } finally { await fs.rm(directory, {recursive: true, force: true}); }
}

test('exact immutable marker-only push authorizes this fixed diagnosis without a manual bypass', async () => fixture(async f => {
  assert.deepEqual(SELECTOR, {
    runtimeSha: '5e62f9ff3a0079b07cd13b8ab912c5720dd22250',
    pricingRuntimeSha: '64c6338e0db23c8999096bceefbf113c0136fe15',
    generationId: 'gen_china_45369451603_1',
    generationManifestSha256: 'd5745797cc162b82e0c0f0b1f49fef65f18f0d6649666562337183b18084dd75',
    controllerSha: 'ef855201583c250061aed4412421dddc4e6ea732',
    imageId: 'sha256:7af5df7fa93163687fcb5c0e1ad834176234319de13a4dd92ddc1d954fcc9381',
    since: '2026-11-24T15:30:00Z', until: '2026-11-24T15:35:00Z',
  });
  assert.deepEqual(verifyChinaStartupDiagnosisInvocation(f), {version: 1, event: 'push',
    sourceSha: f.sourceSha, approvedSourceSha: f.approvedSourceSha, markerPath: MARKER});
  for (const [key, value] of [['GITHUB_EVENT_NAME', 'workflow_dispatch'], ['GITHUB_EVENT_NAME', 'schedule'],
    ['GITHUB_WORKFLOW_REF', WORKFLOW.replace('@refs/heads/main', '@refs/heads/other')],
    ['GITHUB_REPOSITORY_ID', '1'], ['GITHUB_REF', 'refs/heads/other'], ['GITHUB_RUN_ATTEMPT', '2']]) {
    assert.throws(() => verifyChinaStartupDiagnosisInvocation({...f, environment: {...f.environment, [key]: value}}),
      /(?:china_startup_diagnosis|readonly_invocation)_/);
  }
}));

test('a marker cannot include a controller change or authorize another operation', async () => {
  await fixture(f => assert.throws(() => verifyChinaStartupDiagnosisInvocation(f), /marker_only_diff/), {markerExtra: true});
  await fixture(f => assert.throws(() => verifyChinaStartupDiagnosisInvocation(f), /marker_contract/),
    {markerOperation: 'release-china'});
});

test('a changed push transition is rejected before the SSH key can be read', async () => fixture(async f => {
  const event = JSON.parse(await fs.readFile(f.eventPath, 'utf8')); event.forced = true;
  await fs.writeFile(f.eventPath, JSON.stringify(event));
  let opened = false, keyRead = false;
  Object.defineProperty(f.environment, 'SSH_PRIVATE_KEY', {get() { keyRead = true; throw Error('must not read'); }});
  await assert.rejects(runChinaStartupDiagnosis({...f, now: fixedNow, capabilities: {
    verifyBaselines() { throw Error('must not reach baselines'); },
    openSession() { opened = true; throw Error('must not connect'); },
  }}), /readonly_invocation_push_transition/);
  assert.equal(opened, false); assert.equal(keyRead, false);
  const report = JSON.parse(await fs.readFile(path.join(f.root, REPORT), 'utf8'));
  assert.equal(report.completed, false); assert.equal(report.errorCode, 'readonly_invocation_push_transition');
}));

test('real invocation then frozen baseline gate precede the secret and only diagnose/close are called', async () => fixture(async f => {
  const calls = [], logs = []; let privateDirectory;
  Object.defineProperty(f.environment, 'SSH_PRIVATE_KEY', {get() { calls.push('key'); return 'synthetic-private-key-do-not-log'; }});
  f.environment.DIAGNOSIS_RUNTIME_SHA = 'f'.repeat(40);
  const report = await runChinaStartupDiagnosis({...f, now: fixedNow, log: row => logs.push(row), capabilities: {
    verifyInvocation(input) { calls.push('verify'); return verifyChinaStartupDiagnosisInvocation(input); },
    verifyBaselines(root) { assert.equal(root, f.root); calls.push('baselines'); },
    async openSession({root, directory, privateKey}) {
      calls.push('open'); assert.equal(root, f.root); assert.equal(privateKey, 'synthetic-private-key-do-not-log');
      privateDirectory = directory; assert.equal(path.dirname(directory), f.runnerTemp);
      assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
      await fs.writeFile(path.join(directory, 'synthetic-key'), privateKey, {mode: 0o600});
      return {async call(method, selector) {
        calls.push(method); assert.equal(method, 'diagnose'); assert.deepEqual(selector, SELECTOR); return timingDiagnostic();
      }, async close() { calls.push('close'); return {closed: true, readOnly: true}; },
      abort() { assert.fail('successful session must close normally'); }, exited: Promise.resolve({code: 0})};
    },
  }});
  assert.deepEqual(calls, ['verify', 'baselines', 'key', 'open', 'diagnose', 'close']);
  assert.equal(report.completed, true); assert.equal(report.status, 'complete');
  assert.deepEqual(report.diagnosis.startup, timingDiagnostic().startup);
  assert.deepEqual(report.diagnosis.serverSpeed, timingDiagnostic().serverSpeed);
  assert.equal(report.failedRunId, '45419783209'); assert.deepEqual(report.selector, SELECTOR);
  for (const field of ['hostMutations', 'storageWrites', 'providerCalls', 'pageRequests']) assert.equal(report[field], 0);
  assert.equal(report.finishedAt, fixedNow()); assert.equal(report.diagnosisControllerSha, f.sourceSha);
  assert.equal(report.approvedControllerSha, f.approvedSourceSha);
  const saved = await fs.readFile(path.join(f.root, REPORT), 'utf8');
  assert.deepEqual(JSON.parse(saved), report); assert.deepEqual(logs, [report]);
  assert.equal((await fs.stat(path.join(f.root, REPORT))).mode & 0o777, 0o600);
  assert.ok(!saved.includes('synthetic-private-key-do-not-log')); assert.ok(!saved.includes(privateDirectory));
  await assert.rejects(fs.stat(privateDirectory), {code: 'ENOENT'});
}));

test('baseline failure prevents both key access and SSH, while retaining only a safe failed report', async () => fixture(async f => {
  let opened = false, keyRead = false;
  Object.defineProperty(f.environment, 'SSH_PRIVATE_KEY', {get() { keyRead = true; throw Error('private key'); }});
  await assert.rejects(runChinaStartupDiagnosis({...f, now: fixedNow, capabilities: {
    verifyBaselines() { throw Error('frozen_speed_baseline_changed: private path'); },
    openSession() { opened = true; },
  }}), /^Error: china_startup_diagnosis_failed$/);
  assert.equal(opened, false); assert.equal(keyRead, false);
  const saved = await fs.readFile(path.join(f.root, REPORT), 'utf8');
  assert.ok(!saved.includes('private path')); assert.equal(JSON.parse(saved).completed, false);
}));

test('only bounded typed metadata is accepted, and returned values are detached from transport objects', () => {
  const good = diagnostic(), copied = validateChinaStartupDiagnosis(good);
  assert.deepEqual(copied, good); copied.files[0].bytes = 1; assert.equal(good.files[0].bytes, 17);
  const changes = [value => { value.logs = 'raw log'; }, value => { value.env = {secret: 'no'}; },
    value => { value.selector.runtimeSha = 'f'.repeat(40); }, value => { value.selector.path = '/root/private'; },
    value => { value.files[0].path = '/root/private'; }, value => { value.files.pop(); },
    value => { value.files[1].name = value.files[0].name; }, value => { value.files[0].sizeMatches = false; },
    value => { value.candidate.id = 'unapproved-id'; }, value => { value.candidate.present = true; },
    value => { value.image.environment = []; }, value => { value.retained.running = false; },
    value => { value.diskFreeBytes = -1; }, value => { delete value.diskFreeBytes; },
    value => { value.events.rows = [{action: 'exec_create', time: 1795520161, exitCode: null, oom: false}]; value.events.reason = null; },
    value => { value.events.rows = [{action: 'start', time: 1, exitCode: null, oom: false}]; value.events.reason = null; },
    value => { value.events.available = false; value.events.reason = 'empty'; }];
  for (const change of changes) {
    const bad = diagnostic(); change(bad);
    assert.throws(() => validateChinaStartupDiagnosis(bad), /china_startup_diagnosis_report_/);
  }
});

test('missing image/files and unavailable/empty event history remain findings, without inventing a cause', () => {
  for (const events of [{available: false, reason: 'unavailable', rows: []}, {available: true, reason: 'empty', rows: []}]) {
    const value = diagnostic(); value.events = events;
    value.image = {present: false, identityMatches: false};
    value.files[1] = {...value.files[1], present: false, bytes: null, sizeMatches: false, private: false};
    value.files[2].private = false;
    assert.deepEqual(validateChinaStartupDiagnosis(value), value);
  }
  const value = diagnostic();
  value.candidate = {present: true, running: false, status: 'exited', exitCode: 137, oomKilled: true};
  value.events = {available: true, reason: null, rows: [{action: 'oom',
    time: Date.parse(SELECTOR.since) / 1000 + 40, exitCode: null, oom: true}, {action: 'die',
    time: Date.parse(SELECTOR.since) / 1000 + 41, exitCode: 137, oom: false}]};
  assert.deepEqual(validateChinaStartupDiagnosis(value), value);
});

test('saved startup and every typed server timing variant survive without raw host content', async () => {
  const good = timingDiagnostic(), copied = validateChinaStartupDiagnosis(good);
  assert.deepEqual(copied, good);
  copied.serverSpeed.samples[4].recheckSeconds[0] = 30;
  assert.equal(good.serverSpeed.samples[4].recheckSeconds[0], 0.2);
  copied.startup.candidate.running = false; assert.equal(good.startup.candidate.running, true);
  const baseline = JSON.parse(await fs.readFile(path.join(ROOT, 'docs/operations/2026-11-11-accepted-speed-baseline.json'), 'utf8'));
  const paths = new Set([...baseline.samples.map(row => row.path), '/cars?market=china']);
  assert.equal(paths.size, 18);
  good.serverSpeed.samples = [...paths].map(route => ({performanceRequest: 'started', path: route}));
  assert.deepEqual(validateChinaStartupDiagnosis(good), good);
});

test('extra private fields, foreign paths and unbounded saved timing values are rejected before publication', () => {
  const changes = [
    value => { value.startup.logs = 'private raw log'; },
    value => { value.startup.candidate.env = ['SECRET=value']; },
    value => { value.startup.elapsedSeconds = 3601; },
    value => { value.startup.health = 'connection_refused'; },
    value => { value.serverSpeed.raw = 'private raw stdout'; },
    value => { value.serverSpeed.sha256 = null; },
    value => { value.serverSpeed.sha256 = ['d'.repeat(64)]; },
    value => { value.serverSpeed.exitCode = 256; },
    value => { value.serverSpeed.exitCode = 1.5; },
    value => { value.serverSpeed.rejectedSamples = -1; },
    value => { value.serverSpeed.rejectedSamples = 512; },
    value => { value.serverSpeed.samples = Array(513).fill({performanceRequest: 'started', path: '/api/health'}); },
    value => { value.serverSpeed.samples[0].headers = {authorization: 'secret'}; },
    value => { value.serverSpeed.samples[0].path = '/api/health?secret=private'; },
    value => { value.serverSpeed.samples[1].seconds = NaN; },
    value => { value.serverSpeed.samples[1].seconds = Infinity; },
    value => { value.serverSpeed.samples[1].seconds = 86401; },
    value => { value.serverSpeed.samples[1].functionalPassed = 1; },
    value => { value.serverSpeed.samples[2].errorType = 'private exception message'; },
    value => { value.serverSpeed.samples[3].speedBaseline = 'warm_1'; },
    value => { value.serverSpeed.samples[4].recheckSeconds.pop(); },
    value => { delete value.serverSpeed.samples[4].recheckMedianSeconds; },
    value => { value.serverSpeed.samples[5].ceiling = -1; },
    value => { value.serverSpeed.samples[6].routes = ['/crm/site']; },
    value => { value.serverSpeed.samples[6].acceptedBaselineRoutes = ['/root/private']; },
    value => { value.serverSpeed.samples[6].marketScope = 'all'; },
    value => { value.serverSpeed.samples[6].samples = 10001; },
    value => { value.serverSpeed.samples[6].slowSamples = false; },
  ];
  for (const change of changes) {
    const bad = timingDiagnostic(); change(bad);
    assert.throws(() => validateChinaStartupDiagnosis(bad), /china_startup_diagnosis_report_/);
  }
  const absent = diagnostic(); absent.serverSpeed.exitCode = 0;
  assert.throws(() => validateChinaStartupDiagnosis(absent), /china_startup_diagnosis_report_speed_absent/);
});

test('transport failure is sanitized, aborts the open session and removes its local secret directory', async () => fixture(async f => {
  let aborted = 0, directory;
  await assert.rejects(runChinaStartupDiagnosis({...f, now: fixedNow, capabilities: {
    verifyBaselines() {}, async openSession(input) {
      directory = input.directory;
      return {async call() { throw Error('raw private transport output synthetic-private-key-do-not-log'); },
        async close() { assert.fail('must abort failed transport'); }, abort() { aborted++; }, exited: Promise.resolve({code: 1})};
    },
  }}), /^Error: china_startup_diagnosis_failed$/);
  assert.equal(aborted, 1); await assert.rejects(fs.stat(directory), {code: 'ENOENT'});
  const raw = await fs.readFile(path.join(f.root, REPORT), 'utf8');
  assert.ok(!raw.includes('raw private transport')); assert.ok(!raw.includes('synthetic-private-key-do-not-log'));
  const report = JSON.parse(raw); assert.equal(report.completed, false); assert.equal(report.errorCode, 'china_startup_diagnosis_failed');
}));

test('a successful diagnosis cannot claim completion without read-only host close acknowledgement', async () => fixture(async f => {
  let aborted = false;
  await assert.rejects(runChinaStartupDiagnosis({...f, now: fixedNow, capabilities: {
    verifyBaselines() {}, async openSession() { return {call: async () => diagnostic(), close: async () => ({closed: true}),
      abort() { aborted = true; }, exited: Promise.resolve({code: 0})}; },
  }}), /china_startup_diagnosis_close/);
  assert.equal(aborted, true);
  const report = JSON.parse(await fs.readFile(path.join(f.root, REPORT), 'utf8'));
  assert.equal(report.completed, false); assert.equal(report.status, 'failed'); assert.ok(report.diagnosis);
}));

test('workflow has the one marker trigger, bounded read-only job and gates before its sole SSH secret', async () => {
  const workflow = await fs.readFile(path.join(ROOT, '.github/workflows/catalog-next-china-startup-diagnosis.yml'), 'utf8');
  assert.match(workflow, /on:\n  push:\n    branches: \[main\]\n    paths: \['\.github\/market-runs\/catalog-next-china-startup-diagnosis\.json'\]/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /github\.repository_id == '1289722938'.*github\.ref == 'refs\/heads\/main'.*github\.run_attempt == '1'/);
  assert.match(workflow, /timeout-minutes: 15/); assert.match(workflow, /environment: regcloud-staging/);
  assert.match(workflow, /npm ci --no-audit --no-fund/); assert.match(workflow, /fetch-depth: 2/);
  assert.match(workflow, /persist-credentials: false/);
  const verify = workflow.indexOf('diagnose-startup.mjs --verify'), tests = workflow.indexOf('node --test');
  const secret = workflow.indexOf('secrets.REGCLOUD_SSH_KEY'), run = workflow.indexOf('diagnose-startup.mjs --run');
  assert.ok(verify > 0 && tests > verify && secret > tests && run > secret);
  assert.deepEqual(workflow.match(/secrets\.[A-Z_]+/g), ['secrets.REGCLOUD_SSH_KEY']);
  assert.doesNotMatch(workflow, /workflow_dispatch|schedule:|repository_dispatch|docker\s|\bcurl\b|REGCLOUD_ACCESS|AUTO_API|prepare-generation|release\.mjs/);
  for (const filename of ['readonly-marker-invocation.test.mjs', 'catalog-next-startup-diagnosis.test.mjs',
    'catalog-next-startup-diagnose-host.test.mjs', 'catalog-next-release-ssh.test.mjs', 'release-speed-guard-contract.test.mjs'])
    assert.ok(workflow.includes('tests/' + filename));
  assert.match(workflow, /path: catalog-next-china-startup-diagnosis-report\.json/);
});

test('CLI rejects selectors and extra arguments without invoking SSH', async () => {
  await assert.rejects(execute(process.execPath, ['scripts/catalog-next/diagnose-startup.mjs', '--run', '--runtimeSha=override'],
    {cwd: ROOT, env: {PATH: process.env.PATH}}), error => error.code === 1
      && error.stderr.trim() === 'china_startup_diagnosis_cli_arguments' && error.stdout === '');
});
