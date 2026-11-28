import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createChinaDailyRelease} from '../scripts/catalog-next/daily-release.mjs';
import {runChinaDailyCycle} from '../scripts/catalog-next/daily-controller.mjs';
import {createChinaState, CHINA_STATE_KEYS} from '../scripts/catalog-next/china-state.mjs';
import {savePrivateChinaGeneration} from '../scripts/catalog-next/private-generation.mjs';
import {CHINA_GENERATION_FILES} from '../scripts/catalog-next/generation-storage.mjs';
import {JAPAN_STABILITY_CODE_SCOPE, JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS,
  JAPAN_STABILITY_EXACT_COUNT_RETAINED_RUNTIME, JAPAN_OBSERVED_TIMING_POLICY,
  JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY, japanSourceBoundedIncrementalRequired}
  from '../scripts/catalog-next/japan-stability-code-scope.mjs';

const root = process.cwd(), hash = value => createHash('sha256').update(value).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const copy = value => JSON.parse(JSON.stringify(value)), digest = value => hash(JSON.stringify(ordered(value)));
const empty = () => ({found: false, etag: null, sha256: null, value: null});
const oldAt = '2026-11-23T12:00:00Z', now = '2026-11-24T12:00:00Z', nonce = 'b'.repeat(32), revision = '1'.repeat(40);
const owner = id => ({runId: String(id), attempt: '1', revision});
function fixtureEvidence(ref, token, at, browserBytes) {
  const speed = browserBytes?.speed ?? Buffer.from(JSON.stringify({release: ref.runtimeSha, passed: true, browserPassed: true, speedGuard: {passed: true}}));
  const details = browserBytes?.details ?? Buffer.from(JSON.stringify({kind: 'china-browser-details-v1', release: ref.runtimeSha,
    nonce: token, generationManifestSha256: ref.generationManifestSha256, precedingSpeedReportSha256: hash(speed), passed: true}));
  const raw = Buffer.from(JSON.stringify({version: 1, kind: 'china-host-acceptance-v1', release: ref.runtimeSha,
    pricingRuntimeSha: ref.pricingRuntimeSha, generationId: ref.generationId, imageId: ref.imageId,
    generationManifestSha256: ref.generationManifestSha256, privateGenerationReceiptSha256: ref.receiptSha256,
    sourceDescriptorSha256: ref.sourceDescriptorSha256, sourceCursor: ref.sourceCursor, sourceObservedAt: ref.sourceObservedAt,
    nonce: token, acceptedAt: at, retainedContainerId: '8'.repeat(64), browser: {release: ref.runtimeSha, nonce: token,
      passed: true, functionalPassed: true, speedPassed: true, speedReportSha256: hash(speed), detailsReportSha256: hash(details),
      reportSha256: hash(Buffer.concat([speed, details]))}}));
  return {hostReceiptBase64: raw.toString('base64'), hostReceiptSha256: hash(raw), browserSpeedBytes: speed, browserDetailsBytes: details};
}
function stateStorage() {
  const objects = new Map(); let sequence = 0;
  return {objects,
    async assertPrivateBucket() { return {verified: true}; },
    async read(name) { assert.ok(Object.hasOwn(CHINA_STATE_KEYS, name)); return copy(objects.get(name) ?? empty()); },
    async compareAndSwap(name, previous, value) {
      const actual = objects.get(name) ?? empty(); assert.equal(actual.etag, previous.etag); assert.equal(actual.found, previous.found);
      objects.set(name, {found: true, etag: '"native-' + ++sequence + '"', sha256: digest(value), value: copy(value)});
    },
  };
}
async function fixture(t, {servingPlan: servingPlanOverride} = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-real-daily-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const [pricingPlan, defaultServingPlan] = await Promise.all(['china-plan.json', 'china-serving-plan.json'].map(async name =>
    JSON.parse(await fs.readFile(path.join(root, '.github/operations/catalog-next', name)))));
  const servingPlan = servingPlanOverride ?? defaultServingPlan;
  const old = {market: 'china', generationId: 'gen_china_100_1', owner: owner(100), receiptSha256: hash('old receipt'),
    sourceDescriptorSha256: hash('old source'), generationManifestSha256: hash('old generation'), sourceCursor: 100,
    sourceObservedAt: '2026-11-23T11:00:00Z', runtimeSha: servingPlan.runtimeSha, pricingRuntimeSha: pricingPlan.runtimeSha,
    imageId: 'sha256:' + '7'.repeat(64)};
  const storage = stateStorage(), initial = createChinaState({storage, now: () => oldAt});
  const lease = await initial.acquireLease({previous: empty(), owner: owner(100), nonce: 'a'.repeat(32), expiresAt: '2026-11-23T13:00:00Z'});
  const intent = await initial.reserve({lease, previous: empty(), previousIntent: empty(), candidate: old});
  const first = await initial.commit({lease, ...intent, evidence: fixtureEvidence(old, 'a'.repeat(32), oldAt)});
  await initial.releaseLease({lease});
  const artifacts = path.join(directory, 'artifacts'); await fs.mkdir(artifacts);
  const files = {};
  for (const name of CHINA_GENERATION_FILES) {
    files[name] = path.join(artifacts, name);
    await fs.writeFile(files[name], name === 'GENERATION.json' ? JSON.stringify({version: 1, kind: 'china-local-generation-v1', market: 'china',
      generationId: 'gen_china_101_1', runtimeSha: pricingPlan.runtimeSha, prepared: true, rows: 20, sourceRows: 21,
      source: {cursor: 200, sourceObservedAt: '2026-11-24T11:00:00Z', supplierLatestVerified: true}}) : JSON.stringify({privateFixture: name}));
  }
  const privateObjects = new Map(), reads = [], writes = [];
  const generationStorage = {async assertPrivateBucket() { return {verified: true}; },
    async getBinary(key) { reads.push(key); assert.ok(privateObjects.has(key)); return {data: Buffer.from(privateObjects.get(key))}; },
    async putBinary(key, bytes, _mime, condition) {
      assert.deepEqual(condition, {ifNoneMatch: '*'}); assert.ok(!privateObjects.has(key));
      writes.push(key); privateObjects.set(key, Buffer.from(bytes));
    }};
  const binding = {market: 'china', generationId: 'gen_china_101_1', runtimeSha: pricingPlan.runtimeSha,
    sourceDescriptorSha256: hash(await fs.readFile(files['SOURCE.json'])), generationManifestSha256: hash(await fs.readFile(files['GENERATION.json']))};
  const saved = await savePrivateChinaGeneration({storage: generationStorage, owner: owner(101), files, binding});
  const candidate = {...old, owner: owner(101), generationId: binding.generationId, receiptSha256: saved.receiptSha256,
    sourceDescriptorSha256: binding.sourceDescriptorSha256, generationManifestSha256: binding.generationManifestSha256,
    sourceCursor: 200, sourceObservedAt: '2026-11-24T11:00:00Z'};
  const prepared = {completed: true, published: false, liveCatalogWrites: 0, encyclopediaWrites: 0, calculatorFormulaChanges: 0, deletions: 0,
    sourceInput: {kind: 'accepted-generation', generationId: old.generationId, owner: old.owner, receiptSha256: old.receiptSha256,
      sourceDescriptorSha256: old.sourceDescriptorSha256, runtimeSha: old.runtimeSha, pricingRuntimeSha: old.pricingRuntimeSha,
      sourceCursor: old.sourceCursor, sourceObservedAt: old.sourceObservedAt},
    source: {sourceCursor: candidate.sourceCursor, sourceObservedAt: candidate.sourceObservedAt,
      supplierLatestVerified: true, sourceDescriptorSha256: candidate.sourceDescriptorSha256},
    runtime: {runtimeSha: pricingPlan.runtimeSha}, pricing: {runtimeSha: pricingPlan.runtimeSha, generationId: candidate.generationId,
      sourceDescriptorSha256: candidate.sourceDescriptorSha256, generationManifestSha256: candidate.generationManifestSha256},
    privateGeneration: {owner: owner(101), generationId: candidate.generationId, receiptSha256: candidate.receiptSha256,
      sourceDescriptorSha256: candidate.sourceDescriptorSha256, generationManifestSha256: candidate.generationManifestSha256}};
  const calls = [], childCalls = [], uploaded = new Map(); let hostPlan, evidence, outcome, browserBytes, hostVerdict;
  const flags = {wrongOracle: false, browserFails: false, loseAccept: false, badDiskAdmission: false};
  const session = () => ({exited: Promise.resolve({code: 0}), abort() { calls.push('abort'); },
    async call(method, params = {}) {
      calls.push(method);
      if (method === 'init') { hostPlan = params.plan;
        assert.equal(hostPlan.mode, 'generation-update'); assert.equal(hostPlan.retainedRuntime, old.runtimeSha);
        assert.equal(hostPlan.previousAcceptedETag, first.accepted.etag); assert.equal(hostPlan.previousAcceptedStateSha256, first.accepted.sha256);
        assert.deepEqual(hostPlan.previousAcceptedState, first.accepted.value);
        assert.equal(hostPlan.imageId, old.imageId); assert.ok(!hostPlan.files.some(file => file.name === 'image.tar'));
        const uploadedRawBytes = hostPlan.files.reduce((sum, file) => sum + file.bytes, 0);
        const largestCompressedBytes = Math.max(...hostPlan.files.map(file => file.compressedBytes));
        return flags.badDiskAdmission ? {initialized: true} : {initialized: true, generationDiskAdmission: {
          kind: 'china-generation-disk-admission-v1', uploadedRawBytes, largestCompressedBytes,
          operatingReserveBytes: 2 * 1024 ** 3, requiredBytes: uploadedRawBytes + largestCompressedBytes + 2 * 1024 ** 3,
          availableDiskBytes: 30 * 1024 ** 3}}; }
      if (method === 'start') { assert.equal(uploaded.size, 10); return {started: true, release: old.runtimeSha, generationId: candidate.generationId}; }
      if (method === 'functional') return {functionalPassed: true, cases: Array.from({length: 8}, (_, i) => ({name: String(i)}))};
      if (method === 'speed') return {speedPassed: true, samples: []};
      if (method === 'switch') {
        const accepted = await storage.read('accepted'); assert.equal(accepted.value.pending?.nonce, nonce);
        return {switched: true, release: old.runtimeSha, nonce};
      }
      if (method === 'browser_evidence') {
        browserBytes = {speed: Buffer.from(params.speedBase64, 'base64'), details: Buffer.from(params.detailsBase64, 'base64')};
        return {saved: true, speedReportSha256: hash(browserBytes.speed), detailsReportSha256: hash(browserBytes.details)};
      }
      if (method === 'accept') {
        // Match the real host's plan/verdict binding before producing a receipt.
        assert.equal(params.verdict.countAcceptance, hostPlan.countAcceptance);
        assert.equal(Object.hasOwn(params.verdict, 'countAcceptance'), Object.hasOwn(hostPlan, 'countAcceptance'));
        hostVerdict = params.verdict;
        evidence = fixtureEvidence(candidate, nonce, now, browserBytes);
        outcome = {status: 'accepted', hostReceiptBase64: evidence.hostReceiptBase64, hostReceiptSha256: evidence.hostReceiptSha256,
          browserSpeedBase64: evidence.browserSpeedBytes.toString('base64'), browserDetailsBase64: evidence.browserDetailsBytes.toString('base64')};
        if (flags.loseAccept) throw Error('china_ssh_closed');
        return {...outcome, accepted: true};
      }
      if (method === 'retire') {
        const accepted = await storage.read('accepted'); assert.equal(params.acceptedETag, accepted.etag);
        assert.equal(params.acceptedStateSha256, accepted.sha256); assert.deepEqual(params.acceptedState, accepted.value);
        assert.equal(accepted.value.pending, null); return {retiredContainers: 0, filesDeleted: 0, freedBytes: 0, directoriesDeleted: 0, imagesDeleted: 0};
      }
      if (method === 'retire_terminal_app_image') {
        assert.equal(params.action, 'prepare', 'same runtime data rotation must not send image removal');
        assert.deepEqual(params.currentState, params.publication);
        const target = params.publication.intent.value.previous.value.rollback;
        assert.equal(target.imageId, old.imageId); assert.equal(target.runtimeSha, old.runtimeSha);
        assert.equal(hash(params.policySource), params.policySourceSha256);
        return {version: 1, kind: 'china-terminal-app-image-cleanup-v1',
          completed: !flags.incompleteImageResult, status: 'protected', uncertain: false,
          imagesRemoved: 0, runtimeSha: target.runtimeSha, imageId: target.imageId,
          witnessSha256: digest(params.publication), diskFreeBytesBefore: 200, diskFreeBytesAfter: 200,
          measuredFreeBytesChange: 0, reason: 'current_or_rollback'};
      }
      if (method === 'retire_recovery') {
        const accepted = await storage.read('accepted'), intent = await storage.read('intent');
        assert.deepEqual(params.previousAccepted, first.accepted);
        assert.deepEqual(params.acceptedPublication, {accepted, intent});
        assert.deepEqual(params.currentState, {accepted, intent});
        if (flags.retirementFails) throw Error('china_host_retirement_unknown');
        return {retiredContainers: 0, filesDeleted: 2, freedBytes: 512, directoriesDeleted: 0, imagesDeleted: 0};
      }
      if (method === 'recover') return outcome ?? {status: 'pending'};
      assert.fail('unexpected method ' + method);
    },
    async upload(name, packed) {
      calls.push('upload:' + name); const raw = gunzipSync(await fs.readFile(packed));
      const descriptor = hostPlan.files.find(file => file.name === name);
      assert.equal(hash(raw), descriptor.sha256); assert.equal(raw.length, descriptor.bytes); uploaded.set(name, raw);
      return {verified: true, file: name, bytes: raw.length};
    },
    async close() {
      calls.push('close');
      if (hostPlan && !evidence) {
        const raw = Buffer.from(JSON.stringify({version: 1, kind: 'china-host-rollback-v1', nonce, release: candidate.runtimeSha,
          pricingRuntimeSha: candidate.pricingRuntimeSha, generationId: candidate.generationId,
          generationManifestSha256: candidate.generationManifestSha256, privateGenerationReceiptSha256: candidate.receiptSha256,
          sourceDescriptorSha256: candidate.sourceDescriptorSha256, imageId: candidate.imageId,
          previousAcceptedETag: first.accepted.etag, previousAcceptedStateSha256: first.accepted.sha256, rolledBackAt: now,
          retainedContainerId: '8'.repeat(64), retainedRuntimeSha: old.runtimeSha, retainedImageId: old.imageId,
          retainedRunning: true, ingressRestored: true, candidateRemoved: true}));
        outcome = {status: 'rolled_back', hostRollbackBase64: raw.toString('base64'), hostRollbackSha256: hash(raw)};
      }
      return {closed: true, readOnly: false};
    },
  });
  const servingRoot = path.join(directory, 'actual-serving-checkout'); await fs.mkdir(servingRoot);
  const release = createChinaDailyRelease({root, servingRoot, servingPlan, pricingPlan, runnerTemp: directory, controllerSha: revision,
    environment: {PATH: process.env.PATH, SSH_PRIVATE_KEY: 'private-ssh-fixture', AUTO_API_CHE168_KEY: 'private-supplier-fixture'},
    capabilities: {
      verifyCompatibility: async args => { assert.equal(args.runtimeRoot, servingRoot); assert.deepEqual(args.pricingPlan, pricingPlan);
        return {runtimeSha: servingPlan.runtimeSha, pricingRuntimeSha: pricingPlan.runtimeSha, protectedPricingPathsUnchanged: true}; },
      generationStorage: async actual => { assert.deepEqual(actual, owner(101)); return generationStorage; },
      openSession: async args => { assert.equal(args.privateKey, 'private-ssh-fixture'); return session(); },
      checkControl: async () => {}, health: async sha => assert.equal(sha, servingPlan.runtimeSha),
      async runChild(args) {
        childCalls.push(args);
        assert.ok(!('SSH_PRIVATE_KEY' in args.env)); assert.ok(!('AUTO_API_CHE168_KEY' in args.env));
        assert.equal(args.env.JSON_STORAGE_DRIVER, 'local');
        if (args.script.endsWith('/acceptance-oracle.mjs')) {
          assert.equal(args.args[0], servingRoot); assert.equal(args.args[2], candidate.generationManifestSha256);
          await fs.writeFile(args.args[3], JSON.stringify({version: 1, runtimeSha: flags.wrongOracle ? pricingPlan.runtimeSha : servingPlan.runtimeSha,
            pricingRuntimeSha: pricingPlan.runtimeSha, expectedGeneration: candidate.generationId,
            generationManifestSha256: candidate.generationManifestSha256, cases: Array.from({length: 8}, (_, i) => ({name: String(i)}))}));
        } else if (args.script.endsWith('/owner-filter-speed-live.mjs')) {
          const marker = JSON.parse(await fs.readFile(args.env.OWNER_FILTER_BROWSER_MARKER));
          assert.equal(marker.enforceSpeed, true); assert.equal(marker.verifyPartnerBudgets, false);
          assert.equal(marker.release, servingPlan.runtimeSha);
          if (flags.browserFails) return 1;
          await fs.writeFile(path.join(args.cwd, 'owner-filter-browser-report.json'), JSON.stringify({release: servingPlan.runtimeSha,
            passed: true, browserPassed: true, speedGuard: {passed: true}}));
        } else {
          assert.ok(args.script.endsWith('/browser-acceptance.mjs'));
          const raw = await fs.readFile(args.env.OWNER_FILTER_BROWSER_REPORT);
          await fs.writeFile(args.env.CHINA_BROWSER_DETAILS_OUTPUT, JSON.stringify({kind: 'china-browser-details-v1', passed: true,
            release: servingPlan.runtimeSha, nonce: args.env.VERIFICATION_NONCE, generationManifestSha256: candidate.generationManifestSha256,
            precedingSpeedReportSha256: hash(raw)}));
        }
        return 0;
      },
    }});
  const initialWrites = writes.length; reads.length = 0;
  const args = {runtimeRoot: path.join(directory, 'different-pricing-checkout'), plan: pricingPlan,
    invocation: {version: 1, sourceSha: revision}, owner: owner(101), nonce, storage, runnerTemp: directory,
    now: () => now, scheduleHeartbeat: () => () => {}, prepare: async input => {
      assert.equal(input.runtimeRoot, path.join(directory, 'different-pricing-checkout'));
      assert.deepEqual(input.sourceSelection.generation, first.accepted.value.current); return prepared;
    }, ...release};
  return {directory, old, candidate, first, storage, release, args, flags, calls, childCalls, reads, writes, initialWrites, uploaded,
    servingPlan, hostPlan: () => copy(hostPlan), hostVerdict: () => copy(hostVerdict)};
}

test('a daily generation update on the accepted incremental runtime retains the ordinary China plan and verdict policy', async t => {
  const servingPlan = {version: 1, market: 'china', codeScope: JAPAN_STABILITY_CODE_SCOPE,
    runtimeSha: '7f7a316905cd8109352431ed4722108b3449c3ec', runtimeTree: '5854b591c0ee78e3aaa960f96b9a66b9c5b4175c',
    runtimeDiffSha256: hash('incremental-runtime-fixture'), retainedRuntime: JAPAN_STABILITY_EXACT_COUNT_RETAINED_RUNTIME,
    runtimeFiles: [...JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS], acceptancePolicy: JAPAN_OBSERVED_TIMING_POLICY,
    countAcceptance: JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY};
  assert.equal(japanSourceBoundedIncrementalRequired(servingPlan), true);
  const f = await fixture(t, {servingPlan}), result = await runChinaDailyCycle(f.args);
  assert.equal(result.status, 'accepted'); assert.equal(result.published, true);
  const plan = f.hostPlan(), verdict = f.hostVerdict();
  assert.equal(plan.mode, 'generation-update'); assert.equal(plan.runtimeSha, servingPlan.runtimeSha);
  assert.equal(plan.imageId, f.old.imageId); assert.notEqual(plan.generationId, f.old.generationId);
  for (const value of [plan, verdict]) {
    assert.equal(Object.hasOwn(value, 'countAcceptance'), false);
    assert.equal(Object.hasOwn(value, 'acceptancePolicy'), false);
    assert.equal(Object.hasOwn(value, 'timingPolicy'), false);
  }
  assert.equal(verdict.speedPassed, true);
  assert.equal(f.childCalls.length, 3);
  assert.ok(f.childCalls.every(call => !call.script.endsWith('/japan-browser-acceptance.mjs')
    && !Object.hasOwn(call.env, 'CATALOG_JAPAN_MODEL_COVERAGE_REQUIRED')));
  const current = (await f.storage.read('accepted')).value.current;
  assert.equal(current.runtimeSha, f.old.runtimeSha); assert.equal(current.generationId, f.candidate.generationId);
  const receipt = JSON.parse(Buffer.from(current.proof.hostReceiptBase64, 'base64'));
  assert.equal(Object.hasOwn(receipt, 'countAcceptance'), false);
  assert.equal(Object.hasOwn(receipt.browser, 'countAcceptance'), false);
});

test('real daily adapter restores exact private bytes, checks serving oracle and frozen gates, then retires after committed pointer', async t => {
  const f = await fixture(t), result = await runChinaDailyCycle(f.args);
  assert.equal(result.status, 'accepted'); assert.equal(result.published, true); assert.equal(result.applicationBuilds, 0);
  assert.deepEqual(result.hostCleanup, {completed: true, retiredContainers: 0, filesDeleted: 0, freedBytes: 0});
  assert.ok(f.calls.indexOf('functional') < f.calls.indexOf('speed'));
  assert.ok(f.calls.indexOf('speed') < f.calls.indexOf('switch'));
  assert.ok(f.calls.indexOf('browser_evidence') < f.calls.indexOf('accept'));
  assert.ok(f.calls.indexOf('accept') < f.calls.indexOf('retire'));
  assert.ok(f.calls.indexOf('retire') < f.calls.indexOf('close'));
  assert.equal(f.childCalls.length, 3); assert.equal(f.writes.length, f.initialWrites, 'release cannot rewrite the private generation');
  assert.ok(f.reads.every(key => !key.includes('/files/SOURCE.json/') && !key.includes('/files/source.sqlite/')));
  assert.ok(!f.uploaded.has('image.tar'));
  assert.equal(hash(f.uploaded.get('accepted-speed-baseline.json')), '32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59');
});

test('pricing SHA cannot impersonate the serving oracle, and unbound source metadata never reaches SSH', async t => {
  const f = await fixture(t); f.flags.wrongOracle = true;
  await assert.rejects(runChinaDailyCycle(f.args), /china_daily_release_oracle_binding/);
  assert.equal(f.calls.length, 0); assert.deepEqual(await f.storage.read('accepted'), f.first.accepted);
  await assert.rejects(f.release.stageRelease({candidate: {...f.candidate, sourceCursor: 201}, previous: f.first.accepted,
    nonce, assertAuthority: async () => {}}), /generation_manifest/);
  assert.equal(f.calls.length, 0);
});

test('daily adapter requires the host disk admission before sending any generation bytes', async t => {
  const f = await fixture(t); f.flags.badDiskAdmission = true;
  await assert.rejects(f.release.stageRelease({candidate: f.candidate, previous: f.first.accepted,
    nonce, assertAuthority: async () => {}}), /china_daily_release_generation_disk_admission/);
  assert.ok(f.calls.includes('init'));
  assert.equal(f.uploaded.size, 0);
  assert.equal(f.calls.includes('start'), false);
  assert.deepEqual(await f.storage.read('accepted'), f.first.accepted);
});

test('failed real browser gate closes the host and reconciles only its actual rollback receipt', async t => {
  const f = await fixture(t); f.flags.browserFails = true;
  await assert.rejects(runChinaDailyCycle(f.args), error => error.report.status === 'rolled_back' && error.report.published === false);
  assert.equal(f.calls.includes('accept'), false); assert.equal(f.calls.includes('retire'), false);
  assert.ok(f.calls.indexOf('recover') > f.calls.indexOf('close'));
  assert.deepEqual((await f.storage.read('accepted')).value.current, f.first.accepted.value.current);
  assert.equal((await f.storage.read('intent')).value.resolution.kind, 'rolled_back');
});

test('lost SSH accept reply recovers exact durable host and browser bytes without repeating activation', async t => {
  const f = await fixture(t); f.flags.loseAccept = true;
  const result = await runChinaDailyCycle(f.args);
  assert.equal(result.status, 'accepted'); assert.equal(result.recovered, true);
  assert.equal(f.calls.filter(name => name === 'switch').length, 1); assert.equal(f.calls.filter(name => name === 'accept').length, 1);
  assert.equal((await f.storage.read('accepted')).value.current.generationId, f.candidate.generationId);
});

test('queued retirement uses exact original witnesses and fresh protected state without reinitializing the accepted release', async t => {
  const f = await fixture(t); await runChinaDailyCycle(f.args);
  const readState = async () => ({accepted: await f.storage.read('accepted'), intent: await f.storage.read('intent')});
  const acceptedPublication = await readState(), firstCount = f.calls.length; let authorityChecks = 0;
  const input = {previousAccepted: f.first.accepted, acceptedPublication, readState, assertAuthority: async () => { authorityChecks++; }};
  const result = await f.release.retireHost(input);
  assert.deepEqual(result, {completed: true, retiredContainers: 0, filesDeleted: 2, freedBytes: 512});
  assert.deepEqual(f.calls.slice(firstCount), ['retire_recovery', 'close']); assert.equal(authorityChecks, 3);
  f.flags.retirementFails = true;
  await assert.rejects(f.release.retireHost(input), /china_host_retirement_unknown/);
  assert.equal((await f.storage.read('accepted')).value.current.generationId, f.candidate.generationId);
});

async function thirdDailyPublication(f) {
  await runChinaDailyCycle(f.args);
  const state = createChinaState({storage: f.storage, now: () => now});
  const previous = await f.storage.read('accepted'), previousIntent = await f.storage.read('intent');
  const token = 'c'.repeat(32);
  const lease = await state.acquireLease({previous: await f.storage.read('lease'), owner: owner(102),
    nonce: token, expiresAt: '2026-11-24T13:00:00Z'});
  const candidate = {...f.candidate, owner: owner(102), generationId: 'gen_china_102_1', sourceCursor: 300,
    receiptSha256: hash('third receipt'), generationManifestSha256: hash('third generation'),
    sourceDescriptorSha256: hash('third source')};
  const reservation = await state.reserve({lease, previous, previousIntent, candidate});
  const publication = await state.commit({lease, ...reservation, evidence: fixtureEvidence(candidate, token, now)});
  return publication;
}

test('daily image phase protects a reused current image and performs no source restore, build, generation write or DELETE', async t => {
  const f = await fixture(t), publication = await thirdDailyPublication(f);
  const before = {calls: f.calls.length, reads: f.reads.length, writes: f.writes.length, children: f.childCalls.length};
  const result = await f.release.retireTerminalAppImage({publication,
    readState: async () => ({accepted: await f.storage.read('accepted'), intent: await f.storage.read('intent')}),
    assertAuthority: async () => {}});
  assert.equal(result.status, 'protected'); assert.equal(result.reason, 'current_or_rollback');
  assert.equal(result.imagesRemoved, 0); assert.equal(result.measuredFreeBytesChange, 0);
  assert.deepEqual(f.calls.slice(before.calls), ['retire_terminal_app_image', 'close']);
  assert.equal(f.reads.length, before.reads); assert.equal(f.writes.length, before.writes); assert.equal(f.childCalls.length, before.children);
  assert.deepEqual({accepted: await f.storage.read('accepted'), intent: await f.storage.read('intent')}, publication);
});

test('daily image adapter refuses completed=false and preserves the resolved witness for a later required retry', async t => {
  const f = await fixture(t), publication = await thirdDailyPublication(f);
  f.flags.incompleteImageResult = true;
  const start = f.calls.length;
  await assert.rejects(f.release.retireTerminalAppImage({publication, readState: async () => copy(publication),
    assertAuthority: async () => {}}), error => {
      assert.equal(error.appImageCleanup.completed, false); assert.equal(error.appImageCleanup.errorCode, 'proof_invalid'); return true;
    });
  assert.deepEqual(f.calls.slice(start), ['retire_terminal_app_image', 'abort']);
  assert.deepEqual({accepted: await f.storage.read('accepted'), intent: await f.storage.read('intent')}, publication);
});

