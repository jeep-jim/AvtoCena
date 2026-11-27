import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {PROFILE, TARGET, verifyAcceptedPairInvocation, createAcceptedPairReader,
  observeAcceptedPair} from '../scripts/catalog-next/observe-japan-accepted-pair-46051339049.mjs';
import {CHINA_STATE_KEYS, createChinaState} from '../scripts/catalog-next/china-state.mjs';
import {createJapanCachePublicationFence} from '../scripts/catalog-next/japan-cache-compaction-entry.mjs';
import {JAPAN_OBSERVED_TIMING_POLICY, JAPAN_STABILITY_CODE_SCOPE} from '../scripts/catalog-next/japan-stability-code-scope.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const bytes = value => Buffer.from(JSON.stringify(ordered(value)));
const absent = () => ({found: false, etag: null, sha256: null, value: null});
const at = '2026-11-27T12:00:00.000Z';
const oldRuntime = 'c6cfb54cc7c9e2b9d30dcdbb7af9cb604b3aa323';
const storageEnvironment = {YC_OBJECT_STORAGE_ENDPOINT: 'https://s3.regru.cloud', YC_OBJECT_STORAGE_REGION: 'us-east-1',
  YC_OBJECT_STORAGE_BUCKET: 'avtocena-staging-8120751', YC_OBJECT_STORAGE_PREFIX: 'migration-staging/full-20261011/',
  YC_OBJECT_STORAGE_ACCESS_KEY_ID: 'fixture-access', YC_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'fixture-secret'};
const acl = '<AccessControlPolicy><Owner><ID>fixture-owner</ID></Owner><AccessControlList><Grant>'
  + '<Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>fixture-owner</ID></Grantee>'
  + '<Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>';

function evidence(reference, nonce, previous, observedTiming = false) {
  const timing = observedTiming ? {timingPolicy: JAPAN_OBSERVED_TIMING_POLICY,
    speedGateRequired: false, speedPassed: null, timingObserved: true} : {};
  const oracleSha256 = hash('fixture-retained-oracle');
  const japan = {version: 1, kind: 'catalog-japan-browser-v1', codeScope: JAPAN_STABILITY_CODE_SCOPE,
    release: reference.runtimeSha, nonce, generationManifestSha256: reference.generationManifestSha256,
    oracleSha256, passed: true, ...timing,
    ...Object.fromEntries(['japanFreshnessPassed', 'japanPowerApiPassed', 'japanUiPassed', 'japanVisibilityPassed',
      'readOnlyBrowserFence', 'japanPetrolPowerUiPassed', 'japanDetailPowerInputPassed', 'japanDeliveredCalculationPassed',
      'japanFullPagesPassed', 'japanPagination24Passed', 'japanCatalogWarningRemovedPassed', 'japanModelSelectionPassed',
      'japanCombinedFiltersPassed', 'japanRelatedCardsPassed', 'japanVehiclePolicyPassed', 'japanPowerOrderPassed',
      'japanBrandDirectoryPassed'].map(key => [key, true])),
    productionMutations: 0, directSupplierApiRequests: 0, japanPreviewCalculationRequests: 1,
    timings: {version: 1, unit: 'ms', scope: 'japan-functional-journeys', latencyThresholdApplied: false,
      samples: [{phase: 'japan-ui', durationMs: 120000, measurement: 'observed'}]}};
  const browserSpeedBytes = Buffer.from(JSON.stringify(observedTiming ? japan
    : {release: reference.runtimeSha, passed: true, browserPassed: true, speedGuard: {passed: true}}));
  const browserDetailsBytes = Buffer.from(JSON.stringify({version: 1,
    kind: observedTiming ? 'japan-code-browser-details-v1' : 'china-browser-details-v1', release: reference.runtimeSha,
    nonce, passed: true, generationManifestSha256: reference.generationManifestSha256, precedingSpeedReportSha256: hash(browserSpeedBytes),
    ...(observedTiming ? {...timing, retainedChinaOraclePassed: true, unrelatedBrowserBenchmarksExecuted: false,
      oracleSha256, japanReportBase64: browserSpeedBytes.toString('base64'), japanReportSha256: hash(browserSpeedBytes)} : {})}));
  const receipt = {version: 1, kind: 'china-host-acceptance-v1', release: reference.runtimeSha,
    pricingRuntimeSha: reference.pricingRuntimeSha, generationId: reference.generationId,
    generationManifestSha256: reference.generationManifestSha256, privateGenerationReceiptSha256: reference.receiptSha256,
    sourceDescriptorSha256: reference.sourceDescriptorSha256, imageId: reference.imageId, sourceCursor: reference.sourceCursor,
    sourceObservedAt: reference.sourceObservedAt, nonce, acceptedAt: '2026-11-27T12:00:01.000Z', retainedContainerId: '5'.repeat(64),
    ...(observedTiming ? {acceptancePolicy: JAPAN_OBSERVED_TIMING_POLICY, codeScope: JAPAN_STABILITY_CODE_SCOPE} : {}),
    browser: {release: reference.runtimeSha, nonce, passed: true, functionalPassed: true, speedPassed: true, ...timing,
      reportSha256: hash(Buffer.concat([browserSpeedBytes, browserDetailsBytes])), speedReportSha256: hash(browserSpeedBytes), detailsReportSha256: hash(browserDetailsBytes)}};
  if (previous) Object.assign(receipt, {transition: 'code-update', previousAcceptedETag: previous.etag,
    previousAcceptedStateSha256: previous.sha256, retainedRuntimeSha: previous.value.current.runtimeSha,
    retainedImageId: previous.value.current.imageId});
  const raw = Buffer.from(JSON.stringify(receipt));
  return {hostReceiptBase64: raw.toString('base64'), hostReceiptSha256: hash(raw), browserSpeedBytes, browserDetailsBytes};
}
async function fixture({owner = {runId: TARGET.runId, attempt: TARGET.attempt, revision: TARGET.revision}, runtimeSha = TARGET.runtimeSha,
  committed = true, observedTiming = true} = {}) {
  const saved = new Map(), reads = []; let sequence = 0, hook;
  const save = (name, value) => saved.set(name, {found: true, etag: '"private-etag-' + ++sequence + '"', sha256: hash(bytes(value)), value: structuredClone(value)});
  const storage = {
    async assertPrivateBucket() { reads.push('privacy'); return {verified: true}; },
    async read(name) { assert(Object.hasOwn(CHINA_STATE_KEYS, name)); reads.push(name); if (hook) hook(name); return structuredClone(saved.get(name) ?? absent()); },
    async compareAndSwap(name, previous, value) { assert.equal(previous.etag, (saved.get(name) ?? absent()).etag); save(name, value); },
  };
  const state = createChinaState({storage, now: () => at});
  const reference = {market: 'china', generationId: 'gen_china_45875678028_1',
    owner: {runId: '45875678028', attempt: '1', revision: '1'.repeat(40)}, receiptSha256: hash('receipt'),
    sourceDescriptorSha256: hash('source'), generationManifestSha256: hash('generation'), sourceCursor: 13340204,
    sourceObservedAt: '2026-11-26T19:04:39.089Z', runtimeSha: oldRuntime,
    pricingRuntimeSha: '64c6338e0db23c8999096bceefbf113c0136fe15', imageId: 'sha256:' + '4'.repeat(64)};
  const initialNonce = 'a'.repeat(32), nonce = 'b'.repeat(32), expiresAt = '2026-11-27T13:00:00.000Z';
  let lease = await state.acquireLease({previous: absent(), owner: reference.owner, nonce: initialNonce, expiresAt});
  const first = await state.commit({lease, ...await state.reserve({lease, previous: absent(), previousIntent: absent(), candidate: reference}),
    evidence: evidence(reference, initialNonce)});
  await state.releaseLease({lease});
  lease = await state.acquireLease({previous: await state.read('lease'), owner, nonce, expiresAt});
  const candidate = {...reference, runtimeSha, imageId: 'sha256:' + '9'.repeat(64)};
  const staged = await state.reserve({lease, previous: first.accepted, previousIntent: first.intent, candidate, transition: 'code-update'});
  if (committed) await state.commit({lease, ...staged, evidence: evidence(candidate, nonce, first.accepted, observedTiming)});
  await state.releaseLease({lease});
  storage.compareAndSwap = () => assert.fail('observation must never mutate state');
  reads.length = 0;
  return {reader: storage, saved, reads, save, hook: value => { hook = value; }};
}

test('exact accepted publication reports the actual validated pair, without planned rollback inference or private proof bytes', async () => {
  const f = await fixture();
  const report = await observeAcceptedPair({reader: f.reader, now: () => at});
  assert.equal(report.verified, true); assert.equal(report.stableObservation, true);
  assert.equal(report.acceptancePolicy, JAPAN_OBSERVED_TIMING_POLICY);
  assert.equal(report.speedGateRequired, false); assert.equal(report.speedPassed, null);
  assert.equal(report.current.runtimeSha, TARGET.runtimeSha); assert.equal(report.rollback.runtimeSha, oldRuntime);
  assert.equal(report.current.generationId, report.rollback.generationId);
  assert.equal(report.current.hostReceiptSha256, f.saved.get('accepted').value.current.proof.hostReceiptSha256);
  assert.equal(report.rollback.hostReceiptSha256, f.saved.get('accepted').value.rollback.proof.hostReceiptSha256);
  assert.equal(report.leaseStatus, 'released'); assert.equal(report.stateMutations, 0); assert.equal(report.deletionPermitted, false);
  assert.deepEqual(f.reads, ['privacy', 'lease', 'accepted', 'intent', 'lease', 'lease', 'accepted', 'intent', 'lease']);
  const text = JSON.stringify(report);
  assert(!/hostReceiptBase64|private-etag|nonce|retainedContainerId/.test(text));
  assert.equal(report.stateSha256.accepted, f.saved.get('accepted').sha256);
});

test('exact release33 observer requires its observed-timing acceptance receipt, not an older speed verdict', async () => {
  const f = await fixture({observedTiming: false});
  await assert.rejects(observeAcceptedPair({reader: f.reader}), /acceptance_policy/);
});

test('release33 binding refuses prior release owners even when the candidate claims the target runtime', async () => {
  assert.equal(TARGET.runId, '46051339049'); assert.equal(TARGET.attempt, '1');
  assert.equal(TARGET.revision, 'a697a7b1c78a4d362134c2c3ab84dc0be5809a4d');
  assert.equal(TARGET.runtimeSha, 'b9e9122b75f4e588088d0241476b18df7f047d96');
  for (const owner of [
    {runId: '46018937645', attempt: '1', revision: 'a4901bc73add6f8a8c51205349753cb2ee6ea33d'},
    {runId: '46025367220', attempt: '1', revision: 'ee8ac769f295b1e9c32b925bfbaec8f692312603'},
    {runId: '46032025653', attempt: '1', revision: '1c7d35ef02071847badfb9001f630fc5da66dbdc'},
    {runId: '46040340638', attempt: '1', revision: '400da6f50fa12606c7625e0382a0441fa4eb5381'},
    {runId: '46046207658', attempt: '1', revision: 'aa0d0c0b15c3d0e7fc913c8fa3fb08ecab4af679'},
  ]) {
    const f = await fixture({owner});
    await assert.rejects(observeAcceptedPair({reader: f.reader}), /target_mismatch/);
  }
});

test('dynamic maintenance fence validates the new receipt through real state commit and blocks a changed publication', async () => {
  const f = await fixture();
  const receipt = JSON.parse(Buffer.from(f.saved.get('accepted').value.current.proof.hostReceiptBase64, 'base64'));
  assert.equal(receipt.acceptancePolicy, JAPAN_OBSERVED_TIMING_POLICY);
  assert.equal(receipt.browser.speedPassed, null); assert.equal(receipt.browser.speedGateRequired, false);
  const fence = await createJapanCachePublicationFence({storage: f.reader});
  assert.equal(fence.summary.currentAndRollbackVerified, true);
  assert.equal(fence.summary.stateMutations, 0); assert.equal(await fence.beforeMutation(), true);
  f.save('lease', f.saved.get('lease').value);
  await assert.rejects(fence.beforeMutation(), /publication_changed/);
  await assert.rejects(fence.beforeMutation(), /publication_stopped/);
});

test('new receipt cannot turn observed timing into fabricated speed success for observer or maintenance', async () => {
  const f = await fixture(), accepted = structuredClone(f.saved.get('accepted').value);
  const receipt = JSON.parse(Buffer.from(accepted.current.proof.hostReceiptBase64, 'base64'));
  receipt.browser.speedPassed = true;
  const raw = Buffer.from(JSON.stringify(receipt));
  accepted.current.proof = {...accepted.current.proof, hostReceiptBase64: raw.toString('base64'), hostReceiptSha256: hash(raw)};
  f.save('accepted', accepted);
  await assert.rejects(observeAcceptedPair({reader: f.reader}), /browser_binding/);
  await assert.rejects(createJapanCachePublicationFence({storage: f.reader}), /publication_unavailable/);
});

test('other release run, attempt, trigger revision or runtime cannot authorize this exact observation', async () => {
  for (const change of [{runId: '46051339050'}, {attempt: '2'}, {revision: '2'.repeat(40)}]) {
    const f = await fixture({owner: {runId: TARGET.runId, attempt: TARGET.attempt, revision: TARGET.revision, ...change}});
    await assert.rejects(observeAcceptedPair({reader: f.reader}), /target_mismatch/);
  }
  const f = await fixture({runtimeSha: 'd6357672787a73c8e62e6f895f3c4cac5dc77211'});
  await assert.rejects(observeAcceptedPair({reader: f.reader}), /target_mismatch/);
});

test('held or expired held leases, pending publication and missing rollback fail closed', async () => {
  for (const expiresAt of ['2026-11-27T13:00:00.000Z', '2026-11-27T12:00:00.001Z']) {
    const f = await fixture(); f.save('lease', {...f.saved.get('lease').value, status: 'held', releasedAt: null, expiresAt});
    await assert.rejects(observeAcceptedPair({reader: f.reader, now: () => '2026-11-28T12:00:00.000Z'}), /lease_busy/);
    assert.deepEqual(f.reads, ['privacy', 'lease']);
  }
  const pending = await fixture({committed: false});
  await assert.rejects(observeAcceptedPair({reader: pending.reader}), /publication_unresolved/);
  const missing = await fixture(), accepted = structuredClone(missing.saved.get('accepted').value);
  accepted.rollback = null; missing.save('accepted', accepted);
  await assert.rejects(observeAcceptedPair({reader: missing.reader}), /code_update_rollback_required/);
});

test('both current and rollback need real matching proof bytes and canonical observation hashes', async () => {
  for (const name of ['current', 'rollback']) {
    const f = await fixture(), accepted = structuredClone(f.saved.get('accepted').value);
    accepted[name].proof.hostReceiptSha256 = '0'.repeat(64); f.save('accepted', accepted);
    await assert.rejects(observeAcceptedPair({reader: f.reader}), /proof_bytes/);
  }
  const f = await fixture(); f.saved.get('accepted').sha256 = '0'.repeat(64);
  await assert.rejects(observeAcceptedPair({reader: f.reader}), /observation_binding/);
});

test('a resolved pointer alone cannot substitute another accepted intent witness', async () => {
  const f = await fixture(), intent = structuredClone(f.saved.get('intent').value);
  intent.resolution.hostReceiptSha256 = '0'.repeat(64); f.save('intent', intent);
  await assert.rejects(observeAcceptedPair({reader: f.reader}), /acceptance_binding/);
});

test('a lease change during a snapshot or any object change across observations prevents verification', async () => {
  for (const changed of ['accepted', 'intent', 'lease']) {
    const f = await fixture(); let leaseReads = 0;
    f.hook(name => {
      if (name === 'lease' && ++leaseReads === 3) {
        // Identical validated bytes with a changed storage ETag still invalidate
        // the observation, including a released lease reacquired and released.
        f.save(changed, f.saved.get(changed).value);
      }
    });
    if (changed === 'accepted') await assert.rejects(observeAcceptedPair({reader: f.reader}), /publication_unresolved/);
    else await assert.rejects(observeAcceptedPair({reader: f.reader}), /state_changed/);
  }
  const f = await fixture(); let leaseReads = 0;
  f.hook(name => { if (name === 'lease' && ++leaseReads === 2) f.save('lease', f.saved.get('lease').value); });
  await assert.rejects(observeAcceptedPair({reader: f.reader}), /state_changed/);
});

test('production reader exposes GET-only fixed keys and executes exactly 18 bounded privacy/document requests', async () => {
  const f = await fixture(), calls = [];
  const fetcher = async (url, init) => {
    const target = new URL(url); calls.push({target, init});
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.redirect, 'error');
    assert(init.signal instanceof AbortSignal);
    if (target.searchParams.has('acl')) return new Response(acl);
    if (target.searchParams.has('policy')) return new Response('<Error><Code>NoSuchBucketPolicy</Code></Error>', {status: 404});
    const name = Object.keys(CHINA_STATE_KEYS).find(name => target.pathname.endsWith('/' + CHINA_STATE_KEYS[name]));
    assert(name); const saved = f.saved.get(name);
    return new Response(bytes(saved.value), {headers: {etag: saved.etag}});
  };
  const reader = createAcceptedPairReader({environment: storageEnvironment, fetcher});
  assert.deepEqual(Object.keys(reader).sort(), ['assertPrivateBucket', 'read']);
  assert.equal((await observeAcceptedPair({reader})).verified, true);
  assert.equal(calls.length, 18);
  await assert.rejects(reader.read('accepted'), /storage_transport/);
  assert.equal(calls.length, 18, 'budget refusal happens before transport');
  await assert.rejects(reader.read('other'), /china_state_key/);
  assert.equal(calls.length, 18);
});

test('read failures and elapsed deadline cannot produce verified identities or consume another request', async () => {
  const f = await fixture(); f.reader.read = async () => { throw Error('private transport error'); };
  await assert.rejects(observeAcceptedPair({reader: f.reader}), /private transport error/);
  let now = 0, calls = 0;
  const reader = createAcceptedPairReader({environment: storageEnvironment, now: () => now,
    fetcher: async () => { calls++; throw Error('transport'); }});
  now = 120_000;
  await assert.rejects(reader.assertPrivateBucket(), /storage_transport/); assert.equal(calls, 0);
});

test('invocation admits only an exact clean main checkout and separate read-only marker, never maintenance activation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'accepted-pair-invocation-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const run = args => execFileSync('/usr/bin/git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgSign=false', ...args], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  run(['init', '--initial-branch=main']); await fs.writeFile(path.join(root, 'controller.mjs'), 'export const reviewed = true;\n');
  run(['add', '.']); run(['commit', '-m', 'reviewed fixture']); const source = run(['rev-parse', 'HEAD']);
  const environment = {GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'jeep-jim/AvtoCena', GITHUB_REPOSITORY_ID: '1289722938',
    GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: PROFILE.workflowRef, GITHUB_JOB: 'inspect', GITHUB_RUN_ID: '46020000000',
    GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: source, GITHUB_EVENT_NAME: 'workflow_dispatch', EXPECTED_CONTROLLER_SHA: source};
  assert.equal(verifyAcceptedPairInvocation({root, environment}).sourceSha, source);
  for (const changes of [{GITHUB_ACTIONS: 'false'}, {GITHUB_WORKFLOW_REF: 'other'}, {GITHUB_JOB: 'compact'},
    {GITHUB_RUN_ID: '0'}, {GITHUB_REF: 'refs/heads/other'}, {GITHUB_RUN_ATTEMPT: '2'}, {EXPECTED_CONTROLLER_SHA: '0'.repeat(40)}]) {
    assert.throws(() => verifyAcceptedPairInvocation({root, environment: {...environment, ...changes}}));
  }
  await fs.mkdir(path.dirname(path.join(root, PROFILE.markerPath)), {recursive: true});
  await fs.writeFile(path.join(root, PROFILE.markerPath), JSON.stringify({version: 1, operation: PROFILE.operation, approvedSourceSha: source}));
  run(['add', PROFILE.markerPath]); run(['commit', '-m', 'observe only']); const marker = run(['rev-parse', 'HEAD']);
  const eventPath = path.join(root, 'event.json');
  await fs.writeFile(eventPath, JSON.stringify({before: source, after: marker, ref: environment.GITHUB_REF, created: false, deleted: false, forced: false}));
  const pushed = {...environment, GITHUB_EVENT_NAME: 'push', GITHUB_SHA: marker, GITHUB_EVENT_PATH: eventPath};
  assert.equal(verifyAcceptedPairInvocation({root, environment: pushed}).approvedSourceSha, source);
  await fs.writeFile(path.join(root, 'controller.mjs'), 'export const reviewed = false;\n');
  assert.throws(() => verifyAcceptedPairInvocation({root, environment: pushed}), /git_unverified/);
});

test('workflow has only exact read-only triggers, shared concurrency and scoped storage credentials after offline verification', async () => {
  const workflow = await fs.readFile(new URL('../.github/workflows/japan-accepted-pair-46051339049-readonly.yml', import.meta.url), 'utf8');
  assert(workflow.includes('paths: [' + PROFILE.markerPath + ']'));
  assert(workflow.includes('group: catalog-next-china')); assert(workflow.includes('cancel-in-progress: false'));
  assert(!/schedule:|secrets\..*(?:SSH|AJ)|npm ci|docker|curl/.test(workflow));
  assert(workflow.indexOf('--verify') < workflow.indexOf('secrets.REGCLOUD_S3_ACCESS_KEY_ID'));
  assert(workflow.indexOf('tests/catalog-next-japan-accepted-pair-readonly.test.mjs') < workflow.indexOf('secrets.REGCLOUD_S3_ACCESS_KEY_ID'));
  assert(workflow.includes('persist-credentials: false')); assert(workflow.includes('fetch-depth: 2'));
  assert(workflow.includes('timeout-minutes: 5')); assert(workflow.includes('path: ' + PROFILE.reportName));
  const script = await fs.readFile(new URL('../scripts/catalog-next/observe-japan-accepted-pair-46051339049.mjs', import.meta.url), 'utf8');
  assert(script.includes('verifyFrozenSpeedBaselines(ROOT)')); assert(script.includes('deletionPermitted: false'));
  assert(!script.includes('openChinaSshSession')); assert(!script.includes('hostReceiptBase64:'));
});
