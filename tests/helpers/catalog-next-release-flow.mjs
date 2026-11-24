// Execute the real first-release entrypoint against local capabilities only.
// The VM isolates its module globals/process; the actual state machine and reuse
// verifier remain in use. No network, external SSH or provider implementation is linked.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import {createChinaState, inspectChinaPublicationState} from '../../scripts/catalog-next/china-state.mjs';
import * as reuseModule from '../../scripts/catalog-next/release-reuse.mjs';
import {checkedStartupReport, checkedRetainedFenceReport, checkedServerSpeedReport, checkedHomePhaseTimingReport} from '../../scripts/catalog-next/release-ssh.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const [directory, mode] = process.argv.slice(2), config = JSON.parse(await fs.readFile(path.join(directory, 'fixture.json'), 'utf8'));
const root = path.join(directory, 'controller'), runtimeRoot = path.join(directory, 'runtime'), runner = path.join(directory, 'runner');
const hash = value => createHash('sha256').update(value).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const copy = value => JSON.parse(JSON.stringify(value));
const empty = () => ({found: false, etag: null, sha256: null, value: null});
const calls = [], logs = [], objects = new Map(); let serial = 0, plan, browserBytes, acceptedEvidence;
const servingPlan = {...config.servingPlan, runtimeDiffSha256: hash('reviewed fixture diff'), runtimeFiles: ['runtime.txt']};
config.result.plan.runtimeDiffSha256 = servingPlan.runtimeDiffSha256;
const release = copy(config.release); if (mode === 'initial') delete release.reuseHostAttempt;
for (const dir of [path.join(root, '.github/operations/catalog-next'), path.join(root, 'scripts/catalog-next'),
  path.join(root, 'docs/operations'), path.join(runner, 'china-release-build'), runtimeRoot]) await fs.mkdir(dir, {recursive: true});
for (const [name, value] of [['china-serving-plan.json', servingPlan], ['china-plan.json', {runtimeSha: servingPlan.pricingRuntimeSha}], ['china-release-plan.json', release]])
  await fs.writeFile(path.join(root, '.github/operations/catalog-next', name), JSON.stringify(value));
await fs.writeFile(path.join(root, 'scripts/regcloud-performance-gate.py'), '# fixture gate');
await fs.writeFile(path.join(root, 'docs/operations/2026-11-11-accepted-speed-baseline.json'), '{"fixture":true}');
const imageBytes = Buffer.from('fixture installed image');
await fs.writeFile(path.join(runner, 'china-release-build/image.tar'), imageBytes);
await fs.writeFile(path.join(runner, 'china-release-build/image-receipt.json'), JSON.stringify({runtimeSha: servingPlan.runtimeSha,
  pricingRuntimeSha: servingPlan.pricingRuntimeSha, runtimeTree: servingPlan.runtimeTree,
  bytes: imageBytes.length, sha256: hash(imageBytes), imageId: config.reuse.imageId}));
const storage = {async assertPrivateBucket() {}, async read(name) { return copy(objects.get(name) ?? empty()); },
  async compareAndSwap(name, previous, value) {
    const actual = objects.get(name) ?? empty(); assert.equal(actual.etag, previous.etag); assert.equal(actual.found, previous.found);
    objects.set(name, {found: true, etag: '"fixture-' + ++serial + '"', sha256: hash(JSON.stringify(ordered(value))), value: copy(value)});
  }};
const state = createChinaState({storage});
const stateProxy = Object.fromEntries(Object.entries(state).map(([key, value]) => [key,
  typeof value === 'function' ? (...args) => { if (key !== 'read') calls.push('state:' + key); return value.apply(state, args); } : value]));
let publicRuntime = servingPlan.retainedRuntime, closed = false, aborted = false;
const session = {exited: Promise.resolve({code: 0}), abort() { aborted = true; publicRuntime = servingPlan.retainedRuntime; calls.push('abort'); },
  async upload(name) { calls.push('upload:' + name); }, async close() { calls.push('close'); closed = true; return {closed: true}; },
  async call(method, params = {}) {
    calls.push(method);
    if (method === 'resume_init') {
      assert.equal(mode === 'initial', false); assert.equal((await state.read('lease')).value.status, 'held');
      assert.equal((await state.read('accepted')).value, null);
      assert.deepEqual(params.source, config.reuse.source); assert.notEqual(params.nonce, params.source.nonce);
      if (mode === 'retained-failure') throw Object.assign(Error('china_host_reuse_retained_changed'), {retainedFence: {
        version: 1, kind: 'china-host-retained-fence-v1', ingressChanged: false, changedFields: ['Pid', 'StartedAt'],
        mountOrderOnly: false, beforePid: 123, afterPid: 124, beforeStartedAt: '2026-11-24T00:00:00Z',
        afterStartedAt: '2026-11-24T12:00:00Z'}, rawPrivate: 'synthetic-private-ssh'});
      plan = {...copy(config.result.plan), nonce: params.nonce, controllerSha: params.controllerSha,
        previousAcceptedETag: params.previousAcceptedETag, previousAcceptedStateSha256: params.previousAcceptedStateSha256};
      return {...copy(config.result), plan};
    }
    if (method === 'init') { assert.equal(mode, 'initial'); plan = params.plan; return {initialized: true}; }
    if (method === 'start') {
      if (mode === 'startup-failure') throw Object.assign(Error('china_host_candidate_startup'), {startup: {
        version: 1, kind: 'china-host-startup-v1', ready: false, elapsedSeconds: 2, attempts: 1,
        health: 'connection_refused', candidate: {running: false, status: 'exited', exitCode: 1, oomKilled: false, restartCount: 0},
        reason: 'exited'}});
      return {started: true, release: plan.runtimeSha, generationId: plan.generationId};
    }
    if (method === 'functional') {
      if (mode === 'functional-failure') throw Error('china_host_functional_fixture');
      return {functionalPassed: true, cases: config.oracle.cases.map(({name, total}) => ({name, total}))};
    }
    if (method === 'speed') {
      const homePhaseTiming = {version: 1, kind: 'china-home-phase-timing-v1', runtimeSha: plan.runtimeSha, nonce: plan.nonce,
        logBytes: 256, logLines: 1, rejectedRows: 0, limited: false, rows: [{trace: '12345678-1234-1234-1234-123456789012',
          phase: 'snapshot', ms: 72.5, ok: true, policyDate: '2026-11-25', completedPolicyDate: '2026-11-25'}]};
      if (['home-timing-invalid', 'speed-invalid-evidence'].includes(mode)) homePhaseTiming.raw = 'synthetic-private-ssh';
      if (['home-timing-wrong-binding', 'speed-timing-wrong-binding'].includes(mode)) homePhaseTiming.nonce = '0'.repeat(32);
      if (['speed-failure', 'speed-invalid-evidence', 'speed-timing-wrong-binding'].includes(mode)) {
        const serverSpeed = {present: true, sha256: 'a'.repeat(64), exitCode: 1, rejectedSamples: 0, samples: [
          {speedBaseline: 'warm', path: '/cars?market=china', referenceSeconds: 0.09, measurementNoiseSeconds: 0.05,
            ceilingSeconds: 0.14, seconds: 0.2, blocking: true, passed: false, recheckSeconds: [0.18, 0.19, 0.17], recheckMedianSeconds: 0.18}]};
        if (mode === 'speed-invalid-evidence') serverSpeed.stderr = 'synthetic-private-ssh';
        throw Object.assign(Error('china_host_server_speed_failed'), {serverSpeed, homePhaseTiming});
      }
      return {speedPassed: true, samples: [], homePhaseTiming};
    }
    if (method === 'switch') {
      assert.equal((await state.read('accepted')).value.pending.nonce, plan.nonce);
      publicRuntime = plan.runtimeSha; return {switched: true, release: plan.runtimeSha, nonce: plan.nonce};
    }
    if (method === 'browser_evidence') {
      browserBytes = {speed: Buffer.from(params.speedBase64, 'base64'), details: Buffer.from(params.detailsBase64, 'base64')};
      return {saved: true};
    }
    if (method === 'accept') {
      const raw = Buffer.from(JSON.stringify({version: 1, kind: 'china-host-acceptance-v1', release: plan.runtimeSha,
        pricingRuntimeSha: plan.pricingRuntimeSha, generationId: plan.generationId, imageId: plan.imageId,
        generationManifestSha256: plan.generationManifestSha256, privateGenerationReceiptSha256: release.receiptSha256,
        sourceDescriptorSha256: plan.sourceDescriptorSha256, sourceCursor: config.generation.source.cursor,
        sourceObservedAt: config.generation.source.sourceObservedAt, nonce: plan.nonce, acceptedAt: new Date().toISOString(),
        retainedContainerId: '8'.repeat(64), browser: params.verdict}));
      assert.equal(params.verdict.speedReportSha256, hash(browserBytes.speed));
      assert.equal(params.verdict.detailsReportSha256, hash(browserBytes.details));
      acceptedEvidence = {accepted: true, hostReceiptBase64: raw.toString('base64'), hostReceiptSha256: hash(raw)}; return acceptedEvidence;
    }
    assert.fail('unexpected host call ' + method);
  }};
const childProcess = {execFileSync(command, args, options) {
  assert.equal(command, 'git'); assert.equal(options.cwd, runtimeRoot);
  if (args.join(' ') === 'rev-parse HEAD') return servingPlan.runtimeSha + '\n';
  if (args.join(' ') === 'rev-parse HEAD^{tree}') return servingPlan.runtimeTree + '\n';
  if (args[0] === 'diff' && args[1] === '--binary') return 'reviewed fixture diff';
  if (args[0] === 'diff' && args[1] === '--name-only') return 'runtime.txt\n';
  if (args[0] === 'diff' && args[1] === '--quiet') return '';
  assert.fail('unexpected git call');
}, spawn(command, args, options) {
  assert.equal(command, process.execPath); const script = args[3], scriptArgs = args.slice(4);
  const name = path.basename(script); calls.push('child:' + name);
  assert.equal(options.env.JSON_STORAGE_DRIVER, 'local'); assert.equal(options.env.SSH_PRIVATE_KEY, undefined);
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
  setImmediate(async () => {
    try {
      if (name === 'acceptance-oracle.mjs') {
        assert.equal(mode, 'initial'); await fs.writeFile(scriptArgs[3], Buffer.from(config.result.oracleBase64, 'base64'));
      } else if (name === 'owner-filter-speed-live.mjs') {
        await fs.writeFile(path.join(root, 'owner-filter-browser-report.json'), JSON.stringify({release: plan.runtimeSha,
          passed: true, browserPassed: true, checks: [], speedGuard: {passed: true}}));
      } else if (name === 'browser-acceptance.mjs') {
        const speed = await fs.readFile(path.join(root, 'owner-filter-browser-report.json'));
        await fs.writeFile(options.env.CHINA_BROWSER_DETAILS_OUTPUT, JSON.stringify({kind: 'china-browser-details-v1',
          release: plan.runtimeSha, nonce: plan.nonce, generationManifestSha256: plan.generationManifestSha256,
          precedingSpeedReportSha256: hash(speed), passed: true}));
      } else assert.fail('unexpected child ' + name);
      child.emit('close', 0);
    } catch (error) { child.emit('error', error); }
  }); return child;
}};
const mocks = {
  '../lib/readonly-marker-invocation.mjs': {verifyReadonlyInvocation() { calls.push('invocation'); return {sourceSha: config.controllerSha}; }},
  '../verify-frozen-speed-baselines.mjs': {verifyFrozenSpeedBaselines() { calls.push('baselines'); }},
  './serving-compatibility.mjs': {verifyServingCompatibility() { calls.push('compatibility'); }},
  './generation-storage.mjs': {createPrivateChinaGenerationStorage() { assert.equal(mode, 'initial'); calls.push('generation-storage'); return {}; }},
  './private-generation.mjs': {async restorePrivateChinaGeneration({outputDirectory}) {
    assert.equal(mode, 'initial'); calls.push('restore-generation'); await fs.mkdir(outputDirectory);
    const paths = {};
    for (const name of ['GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json', 'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson']) {
      paths[name] = path.join(outputDirectory, name); await fs.writeFile(paths[name], name === 'GENERATION.json'
        ? Buffer.from(config.result.generationBase64, 'base64') : Buffer.from('private fixture ' + name));
    }
    return {paths, receipt: {binding: {runtimeSha: servingPlan.pricingRuntimeSha, generationId: release.generationId,
      generationManifestSha256: release.generationManifestSha256, sourceDescriptorSha256: config.result.plan.sourceDescriptorSha256}}};
  }},
  './release-ssh.mjs': {checkedStartupReport, checkedRetainedFenceReport, checkedServerSpeedReport, checkedHomePhaseTimingReport, async openChinaSshSession() { calls.push('open-session'); return session; }},
  './china-state.mjs': {createChinaStateStorage: () => storage, createChinaState: () => stateProxy, inspectChinaPublicationState},
  '../../apps/web/lib/data.ts': {getJsonStorage: () => ({async readJson(key) { assert.equal(key, 'catalog/operations/collection-controls-v1.json'); return {}; }})},
  './refresh-china-source.mjs': {assertChinaFeedControl() {}},
  './release-reuse.mjs': reuseModule,
  'node:child_process': childProcess,
};
const localProcess = {argv: [process.execPath, path.join(root, 'scripts/catalog-next/release.mjs'), runtimeRoot], execPath: process.execPath,
  env: {PATH: process.env.PATH, RUNNER_TEMP: runner, SSH_PRIVATE_KEY: 'synthetic-private-ssh',
    GITHUB_RUN_ID: '200', GITHUB_RUN_ATTEMPT: '1'}, exitCode: 0};
const context = vm.createContext({process: localProcess, console: {log: value => logs.push(String(value))}, Buffer, URL, Date,
  setTimeout, clearTimeout, AbortSignal, fetch: async url => { assert.equal(url, 'https://avtocena.com/api/health');
    return {ok: true, async json() { return {ok: true, releaseSha: publicRuntime,
      calculationVersion: '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'}; }}; }});
const source = await fs.readFile(path.join(ROOT, 'scripts/catalog-next/release.mjs'), 'utf8');
const module = new vm.SourceTextModule(source, {context, identifier: pathToFileURL(localProcess.argv[1]).href,
  initializeImportMeta(meta, mod) { meta.url = mod.identifier; }});
await module.link(async specifier => {
  const exports = mocks[specifier] ?? (specifier.startsWith('node:') ? await import(specifier) : assert.fail('unexpected import ' + specifier));
  return new vm.SyntheticModule(Object.keys(exports), function() {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }, {context});
});
await module.evaluate();
const report = JSON.parse(await fs.readFile(path.join(root, 'catalog-next-china-release-report.json'), 'utf8'));
await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify({calls, report, accepted: await state.read('accepted'),
  lease: await state.read('lease'), closed, aborted, exitCode: localProcess.exitCode,
  privateDataLeaked: logs.join('\n').includes('private-generation-do-not-log') || logs.join('\n').includes('synthetic-private-ssh')}));
