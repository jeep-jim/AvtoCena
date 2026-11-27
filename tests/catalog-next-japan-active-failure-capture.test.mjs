import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createChinaDailyRelease} from '../scripts/catalog-next/daily-release.mjs';
import {runChinaCodeCycle} from '../scripts/catalog-next/code-controller.mjs';
import {inspectChinaPublicationState} from '../scripts/catalog-next/china-state.mjs';
import {verifySavedActiveStabilityReport} from '../scripts/catalog-next/japan-usability-saved-failure-20261126.mjs';
import {JAPAN_STABILITY_CODE_SCOPE, JAPAN_STABILITY_CODE_PATHS, JAPAN_STABILITY_RETAINED_RUNTIME}
  from '../scripts/catalog-next/japan-stability-code-scope.mjs';
import {JAPAN_PAGINATION_CODE_SCOPE, JAPAN_PAGINATION_CODE_PATHS}
  from '../scripts/catalog-next/japan-pagination-code-scope.mjs';
import {hash, ordered, empty, stateStore} from './helpers/catalog-next-gc-fixture.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const runtimeSha = '2'.repeat(40), pricingRuntimeSha = '3'.repeat(40), controllerSha = '9'.repeat(40);
const retainedRuntime = JAPAN_STABILITY_RETAINED_RUNTIME, token = 'b'.repeat(32);
const at = '2026-11-27T08:30:00.000Z', acceptedAt = '2026-11-25T08:00:00.000Z';
const digest = value => hash(JSON.stringify(ordered(value)));
const slots = ['stats-list-1', 'stats-list-2', 'stats-list-3', 'stats-count', 'stats-latest'];
const absentSaved = () => ({version: 1, kind: 'japan-stability-saved-failure-v1',
  records: slots.map(slot => ({slot, readStatus: 'missing'})), supplierRequests: 0, writes: 0,
  attribution: 'saved_outer_request_metadata_only', historyReads: 0});

// Only host/browser transports and the CAS storage backend are substituted.
// The production release adapter, publication controller and state machine run
// unchanged, including reservation, rollback receipt validation and cleanup.
async function fixture(t, {scope = JAPAN_STABILITY_CODE_SCOPE, mode = 'failed', exit = 1,
  inspect, defaultCapture = false, environment = {SSH_PRIVATE_KEY: 'SYNTHETIC_SSH'}} = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'japan-active-failure-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const root = path.join(directory, 'controller'), events = [], snapshots = [], captures = [];
  const output = path.join(root, 'catalog-next-japan-source-failure-report.json');
  const manifest = Buffer.from(JSON.stringify({kind: 'china-local-generation-v1', market: 'china',
    generationId: 'gen_china_100_1', runtimeSha: pricingRuntimeSha, prepared: true, rows: 283188,
    source: {supplierLatestVerified: true, cursor: 100, sourceObservedAt: '2026-11-24T11:00:00Z'}}));
  const current = {market: 'china', generationId: 'gen_china_100_1',
    owner: {runId: '100', attempt: '1', revision: retainedRuntime},
    receiptSha256: hash('receipt'), sourceDescriptorSha256: hash('source'), generationManifestSha256: hash(manifest),
    sourceCursor: 100, sourceObservedAt: '2026-11-24T11:00:00Z', runtimeSha: retainedRuntime,
    pricingRuntimeSha, imageId: 'sha256:' + '4'.repeat(64)};
  const acceptedReceipt = Buffer.from(JSON.stringify({version: 1, kind: 'china-host-acceptance-v1',
    release: retainedRuntime, pricingRuntimeSha, generationId: current.generationId, imageId: current.imageId,
    generationManifestSha256: current.generationManifestSha256, privateGenerationReceiptSha256: current.receiptSha256,
    sourceDescriptorSha256: current.sourceDescriptorSha256, sourceCursor: 100, sourceObservedAt: current.sourceObservedAt,
    nonce: 'a'.repeat(32), acceptedAt, retainedContainerId: '7'.repeat(64), browser: {
      release: retainedRuntime, nonce: 'a'.repeat(32), passed: true, functionalPassed: true, speedPassed: true,
      reportSha256: hash('browser'), speedReportSha256: hash('speed'), detailsReportSha256: hash('details')}}));
  current.proof = {kind: 'china-accepted-proof-v1', hostReceiptBase64: acceptedReceipt.toString('base64'),
    hostReceiptSha256: hash(acceptedReceipt)};
  const storage = {...stateStore(), async assertPrivateBucket() { return {verified: true}; }};
  await storage.compareAndSwap('accepted', empty(), {version: 1, kind: 'china-accepted-state-v1', market: 'china',
    revision: 1, current, rollback: null, pending: null, commit: {nonce: 'a'.repeat(32), intentSha256: hash('intent'),
      previousETag: null, previousStateSha256: null, acceptedAt}});
  const previous = await storage.read('accepted');
  const {proof, ...unproved} = current;
  const candidate = {...unproved, runtimeSha, imageId: 'sha256:' + '5'.repeat(64)};
  const oracle = {version: 1, kind: 'local-native-reader-http-expectations-v1', runtimeSha: retainedRuntime,
    pricingRuntimeSha, expectedGeneration: current.generationId, generationManifestSha256: current.generationManifestSha256,
    syntheticExpectations: true, httpVerified: false, cases: Array.from({length: 12}, (_, i) => ({name: 'case-' + i,
      path: '/api/catalog/search?market=china&page=' + (i + 1), total: 60, ids: ['8'.repeat(24)], totalRub: [1650154]}))};
  const oracleRaw = Buffer.from(JSON.stringify(oracle));
  const preflight = {previousPlanSha256: hash('plan'), previousOracleSha256: hash(oracleRaw),
    generationBytes: manifest.length + 600, availableDiskBytes: 100_000_000_000,
    generationManifestBase64: manifest.toString('base64'), acceptanceBase64: oracleRaw.toString('base64'),
    generationFiles: ['GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json',
      'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson'].map(name => ({name,
      bytes: name === 'GENERATION.json' ? manifest.length : 100,
      sha256: name === 'GENERATION.json' ? hash(manifest) : hash(name), compressedBytes: 50,
      compressedSha256: hash('compressed ' + name)}))};
  const servingPlan = {version: 1, market: 'china', minimumYear: 2014, runtimeSha, retainedRuntime,
    runtimeTree: '6'.repeat(40), runtimeDiffSha256: hash('fixture diff'), pricingRuntimeSha,
    codeScope: scope, runtimeFiles: [...(scope === JAPAN_STABILITY_CODE_SCOPE
      ? JAPAN_STABILITY_CODE_PATHS : JAPAN_PAGINATION_CODE_PATHS)]};
  for (const name of ['scripts/regcloud-release-retention.py', 'scripts/regcloud-performance-gate.py',
    'docs/operations/2026-11-11-accepted-speed-baseline.json', 'docs/operations/2026-11-11-accepted-browser-speed-baseline.json']) {
    await fs.mkdir(path.dirname(path.join(root, name)), {recursive: true});
    await fs.copyFile(path.join(repository, name), path.join(root, name));
  }
  const planPath = path.join(root, '.github/operations/catalog-next/china-code-serving-plan.json');
  await fs.mkdir(path.dirname(planPath), {recursive: true});
  await fs.writeFile(planPath, JSON.stringify(servingPlan));
  const offline = [
    ['japan-photo-retry-browser-report.json', {version: 1, kind: 'japan-photo-retry-browser-v1', passed: true,
      widths: [1440, 390], caseCount: 12, checks: Object.fromEntries(['transientRecovery', 'persistentFailureBound',
        'sourceChangeCancellation', 'unmountCancellation', 'exactUrl', 'noExternalRequests',
        'protectedPhotoPreserved', 'lazyLoadRecovery'].map(key => [key, true]))}],
    ['japan-pagination24-browser-report.json', {version: 1, kind: 'japan-pagination24-browser-v1', passed: true,
      caseCount: 8, widths: [390, 1440], checks: Object.fromEntries(['refill24', 'numberedContinuation',
        'appendNoDuplicatesOrGaps', 'finiteExhaustion', 'unknownPowerPreserved', 'failureHonesty', 'cursorBinding',
        'warningRemoved', 'sourcePageSize24', 'neighborPaginationPreserved', 'noExternalRequests'].map(key => [key, true]))}],
    ['japan-filter-directory-browser-report.json', {passed: true,
      scope: 'Actual Japan brand/model controls with bounded local source fixtures; no production or supplier calls',
      cases: [390, 1440].flatMap(width => ['source-options-only', 'make-change-clears-old-models',
        'model-directory-failure-and-retry', 'brand-directory-failure-and-retry'].map(name => ({width, name, passed: true})))}],
  ];
  for (const [name, value] of offline) await fs.writeFile(path.join(directory, name), JSON.stringify(value));
  const imageDirectory = path.join(directory, 'china-release-build'); await fs.mkdir(imageDirectory);
  const image = Buffer.from('synthetic roundtrip image');
  const imageReceipt = {version: 1, kind: 'china-runtime-image-v1', runtimeSha, runtimeTree: servingPlan.runtimeTree,
    retainedRuntime, runtimeDiffSha256: servingPlan.runtimeDiffSha256, pricingRuntimeSha, codeScope: scope,
    imageId: candidate.imageId, bytes: image.length, imageUnpackedBytes: 100, sha256: hash(image),
    archiveRoundTripVerified: true, privateDataIncluded: false, protectedPathsUnchanged: true,
    servingCompatibility: {protectedPricingPathsUnchanged: true}, configSha256: hash('configuration'),
    rootFsSha256: hash('rootfs'), platform: 'linux/amd64',
    builder: {version: '29.1.3', driver: 'overlayfs', driverType: 'io.containerd.snapshotter.v1'}};
  const imageReceiptRaw = JSON.stringify(imageReceipt);
  const storageProof = {version: 1, kind: 'china-image-storage-v1',
    ...Object.fromEntries(['imageId', 'runtimeSha', 'runtimeTree', 'runtimeDiffSha256', 'configSha256',
      'rootFsSha256', 'platform', 'builder'].map(key => [key, imageReceipt[key]])),
    archiveBytes: image.length, archiveSha256: hash(image), imageReceiptSha256: hash(imageReceiptRaw),
    manifestId: 'sha256:' + '7'.repeat(64), contentBytes: 10, unpackedBytes: 100, totalBytes: 110};
  for (const [name, value] of [['image.tar', image], ['image-receipt.json', imageReceiptRaw],
    ['image-storage-proof.json', JSON.stringify(storageProof)]]) await fs.writeFile(path.join(imageDirectory, name), value);
  const noteSnapshot = async phase => {
    let raw; try { raw = await fs.readFile(output); } catch {}
    snapshots.push({phase, raw});
  };
  let hostPlan, stagedDirectory;
  const release = createChinaDailyRelease({root, servingRoot: directory, servingPlan,
    pricingPlan: {version: 1, market: 'china', runtimeSha: pricingRuntimeSha}, controllerSha,
    runnerTemp: directory, environment, capabilities: {
      verifyBaselines() {}, async verifyCompatibility() { return {runtimeSha, pricingRuntimeSha, protectedPricingPathsUnchanged: true}; },
      async verifyCodeCompatibility() { return {retainedRuntime, frozenHttpOracleReusable: true}; },
      generationStorage() { assert.fail('app-only release cannot restore a source generation'); },
      async checkControl() {}, async health(sha) { assert.ok([runtimeSha, retainedRuntime].includes(sha)); },
      async verifyCrmAccess() { return {unauthorizedStatus: 401, unauthorizedContentTypeJson: true,
        unauthorizedBodyIsAuthRequired: true, unauthorizedSetCookieAbsent: true, unsignedAccessDenied: true}; },
      ...(!defaultCapture ? {async inspectSavedActiveStabilityFailure(input) {
        events.push('snapshot_read'); captures.push(input);
        return inspect ? inspect(input) : absentSaved();
      }} : {}),
      async openSession({directory: sessionDirectory}) {
        const stage = path.basename(sessionDirectory).startsWith('china-daily-release-');
        if (stage) stagedDirectory = sessionDirectory;
        return {exited: Promise.resolve(), abort() { events.push('abort'); },
          async call(method, args) {
            events.push(method);
            if (method === 'code_preflight') { assert.deepEqual(args.previousAccepted, previous); return preflight; }
            if (method === 'init') { hostPlan = args.plan; return {}; }
            if (method === 'start') return {started: true, release: runtimeSha, generationId: current.generationId};
            if (method === 'functional') return {functionalPassed: true, cases: oracle.cases};
            if (method === 'speed') return {speedPassed: true};
            if (method === 'switch') return {switched: true, release: runtimeSha, nonce: hostPlan.nonce};
            if (method === 'recover') {
              await noteSnapshot('recover');
              assert.equal(await fs.stat(stagedDirectory).then(() => true, () => false), false,
                'the actual stage close removed its temporary browser directory before recovery');
              const raw = Buffer.from(JSON.stringify({version: 1, kind: 'china-host-rollback-v1',
                release: runtimeSha, pricingRuntimeSha, generationId: current.generationId,
                generationManifestSha256: current.generationManifestSha256, privateGenerationReceiptSha256: current.receiptSha256,
                sourceDescriptorSha256: current.sourceDescriptorSha256, imageId: candidate.imageId,
                nonce: args.nonce, previousAcceptedETag: previous.etag, previousAcceptedStateSha256: previous.sha256,
                rolledBackAt: at, retainedContainerId: '7'.repeat(64), retainedRuntimeSha: retainedRuntime,
                retainedImageId: current.imageId, retainedRunning: true, ingressRestored: true, candidateRemoved: true}));
              return {status: 'rolled_back', hostRollbackBase64: raw.toString('base64'), hostRollbackSha256: hash(raw)};
            }
            if (method === 'retire_terminal_app_image') {
              await noteSnapshot('image_cleanup');
              const bound = {runtimeSha, imageId: candidate.imageId, witnessSha256: digest(args.publication)};
              return args.action === 'prepare'
                ? {version: 1, kind: 'china-terminal-app-image-prepared-v1', ...bound}
                : {version: 1, kind: 'china-terminal-app-image-cleanup-v1', ...bound, completed: true,
                  status: 'removed', uncertain: false, imagesRemoved: 1, diskFreeBytesBefore: 100,
                  diskFreeBytesAfter: 175, measuredFreeBytesChange: 75, reason: 'exact_terminal_image'};
            }
            assert.fail('unexpected host operation: ' + method);
          },
          async upload(name, filename) {
            const raw = gunzipSync(await fs.readFile(filename)), descriptor = hostPlan.files.find(row => row.name === name);
            assert.equal(hash(raw), descriptor.sha256); assert.equal(raw.length, descriptor.bytes);
            return {verified: true, file: name, bytes: raw.length};
          },
          async close() { events.push(stage ? 'close_stage' : 'close_recovery');
            if (stage) await noteSnapshot('close_stage');
            return {closed: true, readOnly: false}; },
        };
      },
      async runChild(args) {
        const name = path.basename(args.script); events.push(name);
        if (name === 'crm-china-status-proof.mjs') {
          const binding = JSON.parse(await fs.readFile(args.args[3]));
          await fs.writeFile(args.args[4], JSON.stringify({version: 1, kind: 'china-crm-manifest-proof-v1',
            ...binding, manifestHelperPassed: true, middlewareBoundaryPassed: true}));
        } else if (name === 'owner-filter-speed-live.mjs') {
          await fs.writeFile(path.join(args.cwd, 'owner-filter-browser-report.json'), JSON.stringify({release: runtimeSha,
            passed: true, browserPassed: true, speedGuard: {passed: true}}));
        } else if (name === 'browser-acceptance.mjs') {
          await fs.writeFile(args.env.CHINA_BROWSER_DETAILS_OUTPUT, JSON.stringify({kind: 'china-browser-details-v1',
            passed: true, release: runtimeSha, nonce: token, generationManifestSha256: current.generationManifestSha256,
            precedingSpeedReportSha256: hash(await fs.readFile(args.env.OWNER_FILTER_BROWSER_REPORT))}));
        } else {
          assert.equal(name, 'japan-browser-acceptance.mjs');
          assert.equal(args.env.CATALOG_CODE_SCOPE, scope);
          assert.equal(Object.hasOwn(args.env, 'YC_OBJECT_STORAGE_SECRET_ACCESS_KEY'), false);
          if (mode === 'crash') throw Error('china_fixture_browser_crash');
          if (mode === 'missing') return exit;
          const report = {version: 1, kind: 'catalog-japan-browser-v1', codeScope: scope, release: runtimeSha,
            nonce: token, checkedAt: new Date().toISOString(), generationManifestSha256: current.generationManifestSha256,
            oracleSha256: hash(await fs.readFile(args.env.ORACLE_PATH)), passed: false,
            error: {stage: 'plain_first', code: 'japan_stability_source_read_failed', timeout: false}};
          if (mode === 'wrong_nonce') report.nonce = 'f'.repeat(32);
          if (mode === 'wrong_release') report.release = retainedRuntime;
          if (mode === 'wrong_scope') report.codeScope = 'catalog-japan-completion-v2';
          if (mode === 'stale') report.checkedAt = acceptedAt;
          if (mode === 'wrong_stage') report.error.stage = 'PRIVATE/unsafe-stage';
          if (mode === 'no_stage') delete report.error;
          if (mode === 'not_false') report.passed = 0;
          await fs.writeFile(args.env.OUTPUT, mode === 'malformed' ? '{' : JSON.stringify(report));
          return exit;
        }
        return 0;
      },
    }});
  async function run(expected = 'china_daily_release_japan_browser_failed') {
    let failure;
    await assert.rejects(runChinaCodeCycle({plan: servingPlan, imageId: candidate.imageId,
      invocation: {version: 1, sourceSha: controllerSha}, owner: {runId: '200', attempt: '1', revision: controllerSha},
      nonce: token, storage, now: () => at, scheduleHeartbeat: () => () => events.push('heartbeat_stopped'),
      stageCodeRelease: release.stageCodeRelease, recoverRelease: release.recoverRelease,
      retireTerminalAppImage: release.retireTerminalAppImage,
    }), error => {
      failure = error;
      assert.equal(error.message, expected); assert.equal(error.report.errorCode, expected);
      assert.equal(error.report.status, 'rolled_back'); assert.equal(error.report.recovered, true);
      assert.equal(error.report.published, false); assert.equal(error.report.leaseReleased, true);
      assert.equal(error.report.appImageCleanup.completed, true);
      return true;
    });
    const accepted = await storage.read('accepted'), intent = await storage.read('intent');
    assert.deepEqual(accepted.value.current, current); assert.deepEqual(accepted.value.rollback, previous.value.rollback);
    assert.equal(inspectChinaPublicationState({accepted, intent}).status, 'resolved');
    assert.equal(intent.value.status, 'aborted'); assert.equal(intent.value.resolution.kind, 'rolled_back');
    assert.equal((await storage.read('lease')).value.status, 'released');
    assert.equal(events.includes('accept'), false); assert.equal(events.includes('browser_evidence'), false);
    assert.ok(events.indexOf('close_stage') < events.indexOf('recover'));
    return failure;
  }
  return {root, directory, output, events, snapshots, captures, run, servingPlan};
}

test('default snapshot reads workflow-bound saved slots before real close, rollback and image cleanup', async t => {
  const workflow = await fs.readFile(path.join(repository, '.github/workflows/catalog-next-china-photo-release.yml'), 'utf8');
  const publish = workflow.split('      - name: Publish the code with existing China bytes and automatic rollback\n')[1]
    .split('\n      - name: ')[0];
  const secrets = {REGCLOUD_SSH_KEY: 'SYNTHETIC_SSH', REGCLOUD_S3_ACCESS_KEY_ID: 'SYNTHETIC_ACCESS',
    REGCLOUD_S3_SECRET_ACCESS_KEY: 'SYNTHETIC_SECRET'};
  const environment = Object.fromEntries([...publish.matchAll(/^\s+([A-Z0-9_]+): \$\{\{ secrets\.([A-Z0-9_]+) \}\}$/gm)]
    .map(([, name, secret]) => [name, secrets[secret]]));
  assert.deepEqual(environment, {SSH_PRIVATE_KEY: secrets.REGCLOUD_SSH_KEY,
    YC_OBJECT_STORAGE_ACCESS_KEY_ID: secrets.REGCLOUD_S3_ACCESS_KEY_ID,
    YC_OBJECT_STORAGE_SECRET_ACCESS_KEY: secrets.REGCLOUD_S3_SECRET_ACCESS_KEY});
  const f = await fixture(t, {defaultCapture: true, environment}), requests = [];
  const source = {startedAt: '2026-11-27T08:00:00.000Z', finishedAt: '2026-11-27T08:00:01.000Z',
    kind: 'list', page: 1, pageSize: 24, outcome: 'invalid_response', httpStatus: 200,
    sql: 'PRIVATE_SQL', body: 'PRIVATE_BODY', visitorIp: 'PRIVATE_IP', responseValidation: {
      version: 1, phase: 'page_shape', code: 'root_not_array', wireBytes: 42, decodedBytes: 42, rootKind: 'object'}};
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    f.events.push('saved_get');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(url.origin, 'https://s3.regru.cloud');
    assert.ok(options.headers.authorization.includes('Credential=SYNTHETIC_ACCESS/'));
    assert.equal(options.signal.aborted, false);
    requests.push({pathname: url.pathname, signal: options.signal});
    return new Response(JSON.stringify({...source, page: requests.length <= 3 ? requests.length : null}),
      {status: 200, headers: {'content-type': 'application/json'}});
  });
  await f.run();
  assert.deepEqual(requests.map(row => row.pathname.split('/').slice(-2).join('/')), [
    'catalog-failure-pages/stats-list-1.json', 'catalog-failure-pages/stats-list-2.json',
    'catalog-failure-pages/stats-list-3.json', 'catalog-failure-pages/stats-count.json',
    'ajes/catalog-failure-stats.json']);
  assert.equal(new Set(requests.map(row => row.signal)).size, 1, 'all five GETs share the bounded helper deadline');
  assert.ok(f.events.lastIndexOf('saved_get') < f.events.indexOf('close_stage'));
  const raw = await fs.readFile(f.output), report = JSON.parse(raw);
  assert.ok(raw.length <= 32 * 1024); assert.equal((await fs.stat(f.output)).mode & 0o777, 0o600);
  assert.equal(raw.toString(), JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.capture, {version: 1, stage: 'before_rollback', runtimeSha, controllerSha,
    nonce: token, failedStage: 'plain_first', capturedAt: report.capture.capturedAt});
  assert.ok(Number.isFinite(Date.parse(report.capture.capturedAt)));
  assert.deepEqual(report.records.map(row => row.slot), slots);
  assert.deepEqual(report.records[0].responseValidation, source.responseValidation);
  assert.equal(report.records[0].sqlSha256, hash(source.sql));
  assert.doesNotMatch(raw.toString(), /PRIVATE_|SYNTHETIC_|authorization|visitorIp/);
  assert.deepEqual(f.snapshots.map(row => row.phase), ['close_stage', 'recover', 'image_cleanup', 'image_cleanup']);
  for (const observed of f.snapshots) assert.deepEqual(observed.raw, raw, observed.phase);
  assert.equal((await verifySavedActiveStabilityReport({root: f.root, environment: {GITHUB_SHA: controllerSha}})).verified, true);
});

test('saved helper failure never replaces the original Japan error or prevents rollback', async t => {
  const f = await fixture(t, {inspect() { throw Error('PRIVATE_STORAGE_FAILURE'); }});
  const error = await f.run();
  assert.equal(f.captures.length, 1); assert.ok(f.events.indexOf('snapshot_read') < f.events.indexOf('close_stage'));
  assert.equal(await fs.stat(f.output).then(() => true, () => false), false);
  assert.doesNotMatch(JSON.stringify(error.report), /PRIVATE_STORAGE_FAILURE/);
});

test('snapshot write failure preserves an existing file and still rolls back with the original error', async t => {
  const f = await fixture(t), previous = 'existing unrelated local bytes';
  await fs.writeFile(f.output, previous);
  await f.run();
  assert.equal(f.captures.length, 1); assert.equal(await fs.readFile(f.output, 'utf8'), previous);
});

test('oversize snapshot is not written and cannot block rollback or replace the gate failure', async t => {
  const f = await fixture(t, {inspect() { return {...absentSaved(), unexpected: 'x'.repeat(32 * 1024)}; }});
  await f.run();
  assert.equal(f.captures.length, 1);
  assert.equal(await fs.stat(f.output).then(() => true, () => false), false);
});

test('valid bound failed report is captured even when the browser incorrectly exits zero', async t => {
  const f = await fixture(t, {exit: 0});
  await f.run('china_daily_release_japan_browser_binding');
  assert.equal(f.captures.length, 1);
  assert.equal((await verifySavedActiveStabilityReport({root: f.root, environment: {GITHUB_SHA: controllerSha}})).verified, true);
});

test('nonstability Japan failure keeps the existing release path without reading saved slots', async t => {
  const f = await fixture(t, {scope: JAPAN_PAGINATION_CODE_SCOPE});
  await f.run();
  assert.equal(f.captures.length, 0);
  assert.equal(await fs.stat(f.output).then(() => true, () => false), false);
});

for (const [mode, expected] of [
  ['crash', 'china_fixture_browser_crash'], ['missing', 'china_daily_release_japan_browser_failed'],
  ['malformed', 'china_code_failed'], ['wrong_nonce', 'china_daily_release_japan_browser_binding'],
  ['wrong_release', 'china_daily_release_japan_browser_binding'], ['wrong_scope', 'china_daily_release_japan_browser_binding'],
  ['stale', 'china_daily_release_japan_browser_binding'], ['wrong_stage', 'china_daily_release_japan_browser_failed'],
  ['no_stage', 'china_daily_release_japan_browser_failed'], ['not_false', 'china_daily_release_japan_browser_failed'],
]) test('no saved snapshot for a crash, malformed or unbound failed report: ' + mode, async t => {
  const f = await fixture(t, {mode});
  await f.run(expected);
  assert.equal(f.captures.length, 0);
  assert.equal(await fs.stat(f.output).then(() => true, () => false), false);
});
