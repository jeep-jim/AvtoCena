import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createChinaDailyRelease, checkedChinaCodePreflight} from '../scripts/catalog-next/daily-release.mjs';
import {createChinaState} from '../scripts/catalog-next/china-state.mjs';
import {runChinaCodeCycle} from '../scripts/catalog-next/code-controller.mjs';

const hash = raw => createHash('sha256').update(raw).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const digest = value => hash(JSON.stringify(ordered(value))), copy = value => JSON.parse(JSON.stringify(value));
const oldSha = '1'.repeat(40), nextSha = '2'.repeat(40), pricingSha = '3'.repeat(40);
const nonce = 'a'.repeat(32), acceptedAt = '2026-11-25T08:00:00Z';
function sample() {
  const manifestRaw = Buffer.from(JSON.stringify({kind: 'china-local-generation-v1', market: 'china',
    generationId: 'gen_china_100_1', runtimeSha: pricingSha, prepared: true, rows: 283188,
    source: {supplierLatestVerified: true, cursor: 100, sourceObservedAt: '2026-11-24T11:00:00Z'}}));
  const current = {market: 'china', generationId: 'gen_china_100_1', owner: {runId: '100', attempt: '1', revision: oldSha},
    receiptSha256: hash('receipt'), sourceDescriptorSha256: hash('source'), generationManifestSha256: hash(manifestRaw),
    sourceCursor: 100, sourceObservedAt: '2026-11-24T11:00:00Z', runtimeSha: oldSha, pricingRuntimeSha: pricingSha,
    imageId: 'sha256:' + '4'.repeat(64)};
  const receipt = Buffer.from(JSON.stringify({version: 1, kind: 'china-host-acceptance-v1', release: current.runtimeSha,
    pricingRuntimeSha: current.pricingRuntimeSha, generationId: current.generationId, imageId: current.imageId,
    generationManifestSha256: current.generationManifestSha256, privateGenerationReceiptSha256: current.receiptSha256,
    sourceDescriptorSha256: current.sourceDescriptorSha256, sourceCursor: current.sourceCursor,
    sourceObservedAt: current.sourceObservedAt, nonce, acceptedAt, retainedContainerId: '7'.repeat(64),
    browser: {release: oldSha, nonce, passed: true, functionalPassed: true, speedPassed: true,
      reportSha256: hash('browser'), speedReportSha256: hash('speed'), detailsReportSha256: hash('details')}}));
  current.proof = {kind: 'china-accepted-proof-v1', hostReceiptBase64: receipt.toString('base64'), hostReceiptSha256: hash(receipt)};
  const state = {version: 1, kind: 'china-accepted-state-v1', market: 'china', revision: 1, current, rollback: null, pending: null,
    commit: {nonce, intentSha256: hash('intent'), previousETag: null, previousStateSha256: null, acceptedAt}};
  const previous = {found: true, etag: '"accepted-1"', sha256: digest(state), value: state};
  const oracle = {version: 1, kind: 'local-native-reader-http-expectations-v1', runtimeSha: oldSha,
    pricingRuntimeSha: pricingSha, expectedGeneration: current.generationId, generationManifestSha256: current.generationManifestSha256,
    syntheticExpectations: true, httpVerified: false, cases: Array.from({length: 12}, (_, i) => ({name: 'case-' + i,
      path: '/api/catalog/search?market=china&page=' + (i + 1), total: 60, ids: ['8'.repeat(24)], totalRub: [1650154]}))};
  const oracleRaw = Buffer.from(JSON.stringify(oracle));
  const names = ['GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json', 'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson'];
  const preflight = {previousPlanSha256: hash('plan'), previousOracleSha256: hash(oracleRaw),
    generationBytes: manifestRaw.length + 600, availableDiskBytes: 100_000_000_000,
    generationManifestBase64: manifestRaw.toString('base64'), acceptanceBase64: oracleRaw.toString('base64'),
    generationFiles: names.map(name => ({name, bytes: name === 'GENERATION.json' ? manifestRaw.length : 100,
      sha256: name === 'GENERATION.json' ? hash(manifestRaw) : hash(name), compressedBytes: 50, compressedSha256: hash('compressed ' + name)}))};
  const {proof, ...unproved} = current;
  const candidate = {...unproved, runtimeSha: nextSha, imageId: 'sha256:' + '5'.repeat(64)};
  return {previous, current, candidate, preflight, oracle};
}

test('authenticated photo preflight preserves every frozen expected value and changes only the UI revision', () => {
  const f = sample(), result = checkedChinaCodePreflight(f.preflight, f.current, nextSha);
  assert.deepEqual(result.oracle, {...f.oracle, runtimeSha: nextSha});
  assert.deepEqual(result.generationFiles, f.preflight.generationFiles);
  for (const mutate of [
    row => { row.previousOracleSha256 = hash('other'); },
    row => { row.generationFiles[0].sha256 = hash('other'); },
    row => { row.generationFiles[1].name = '../details.sqlite'; },
    row => { row.generationFiles[1].name = row.generationFiles[2].name; },
    row => { row.generationManifestBase64 = Buffer.from('{}').toString('base64'); },
  ]) {
    const bad = copy(f.preflight); mutate(bad);
    assert.throws(() => checkedChinaCodePreflight(bad, f.current, nextSha), /china_daily_release_code_/);
  }
  assert.throws(() => checkedChinaCodePreflight(f.preflight, {...f.current, sourceCursor: 101}, nextSha));
});

async function fixture(t, {combined = false, japan = false} = {}) {
  const f = sample(), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-photo-stage-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const root = path.join(directory, 'controller');
  for (const name of ['scripts/regcloud-performance-gate.py', 'docs/operations/2026-11-11-accepted-speed-baseline.json',
    'docs/operations/2026-11-11-accepted-browser-speed-baseline.json']) {
    await fs.mkdir(path.dirname(path.join(root, name)), {recursive: true});
    await fs.copyFile(path.join(process.cwd(), name), path.join(root, name));
  }
  const imageDirectory = path.join(directory, 'china-release-build'); await fs.mkdir(imageDirectory);
  const image = Buffer.from('synthetic roundtrip image'), imagePath = path.join(imageDirectory, 'image.tar');
  await fs.writeFile(imagePath, image);
  const servingPlan = {version: 1, market: 'china', runtimeSha: nextSha, retainedRuntime: oldSha,
    runtimeTree: '6'.repeat(40), runtimeDiffSha256: hash('photo diff'), pricingRuntimeSha: pricingSha,
    ...(japan ? {codeScope: 'catalog-japan-recovery-v1'} : combined ? {codeScope: 'catalog-photo-japan-power-v1'} : {})};
  const pricingPlan = {version: 1, market: 'china', runtimeSha: pricingSha};
  const imageReceipt = {version: 1,
    kind: 'china-runtime-image-v1', runtimeSha: nextSha, runtimeTree: servingPlan.runtimeTree,
    retainedRuntime: oldSha, runtimeDiffSha256: servingPlan.runtimeDiffSha256, pricingRuntimeSha: pricingSha,
    imageId: f.candidate.imageId, bytes: image.length, imageUnpackedBytes: 100, sha256: hash(image), archiveRoundTripVerified: true,
    privateDataIncluded: false, protectedPathsUnchanged: true, servingCompatibility: {protectedPricingPathsUnchanged: true},
    configSha256: hash('configuration'), rootFsSha256: hash('rootfs'), platform: 'linux/amd64',
    builder: {version: '29.1.3', driver: 'overlayfs', driverType: 'io.containerd.snapshotter.v1'},
    ...(combined || japan ? {codeScope: servingPlan.codeScope} : {})};
  const imageReceiptRaw = JSON.stringify(imageReceipt);
  await fs.writeFile(path.join(imageDirectory, 'image-receipt.json'), imageReceiptRaw);
  const storageProof = {version: 1, kind: 'china-image-storage-v1',
    ...Object.fromEntries(['imageId', 'runtimeSha', 'runtimeTree', 'runtimeDiffSha256', 'configSha256', 'rootFsSha256', 'platform', 'builder']
      .map(key => [key, imageReceipt[key]])),
    archiveBytes: image.length, archiveSha256: hash(image), imageReceiptSha256: hash(imageReceiptRaw),
    manifestId: 'sha256:' + '7'.repeat(64), contentBytes: 10, unpackedBytes: 100, totalBytes: 110};
  const storagePath = path.join(imageDirectory, 'image-storage-proof.json');
  await fs.writeFile(storagePath, JSON.stringify(storageProof));
  const calls = [], uploaded = new Map(), flags = {gateExit: 0, wrongNonce: false, changeReport: null}; let hostPlan, browserBytes;
  const session = {exited: Promise.resolve(), abort() { calls.push('abort'); },
    async call(method, args) {
      calls.push(method);
      if (method === 'code_preflight') { assert.deepEqual(args.previousAccepted, f.previous); return f.preflight; }
      if (method === 'init') {
        hostPlan = args.plan;
        assert.equal(hostPlan.mode, 'code-update'); assert.equal(hostPlan.files.length, 12);
        assert.equal(hostPlan.generationId, f.current.generationId); assert.equal(hostPlan.retainedRuntime, oldSha);
        assert.equal(hostPlan.codeSourcePlanSha256, f.preflight.previousPlanSha256);
        assert.equal(hostPlan.codeSourceOracleSha256, f.preflight.previousOracleSha256);
        assert.deepEqual(hostPlan.codeImageStorageProof, storageProof);
        return {};
      }
      if (method === 'start') {
        assert.equal(uploaded.size, 5);
        return {started: true, release: nextSha, generationId: f.current.generationId};
      }
      if (method === 'functional') return {functionalPassed: !flags.functionalFailure, cases: f.oracle.cases};
      if (method === 'speed') {
        if (flags.speedFailure) throw flags.speedFailure;
        return {speedPassed: true};
      }
      if (method === 'switch') return {switched: true, release: nextSha, nonce: hostPlan.nonce};
      if (method === 'browser_evidence') {
        browserBytes = {speed: Buffer.from(args.speedBase64, 'base64'), details: Buffer.from(args.detailsBase64, 'base64')};
        const details = JSON.parse(browserBytes.details), raw = Buffer.from(
          japan ? details.japanReportBase64 : combined ? details.photoJapanReportBase64 : details.photoReportBase64, 'base64');
        assert.equal(hash(raw), japan ? details.japanReportSha256 : combined ? details.photoJapanReportSha256 : details.photoReportSha256);
        assert.equal(JSON.parse(raw).nonce, hostPlan.nonce);
        return {saved: true, speedReportSha256: hash(browserBytes.speed), detailsReportSha256: hash(browserBytes.details)};
      }
      if (method === 'accept') {
        const old = JSON.parse(Buffer.from(f.current.proof.hostReceiptBase64, 'base64'));
        const raw = Buffer.from(JSON.stringify({...old, release: nextSha, imageId: f.candidate.imageId, nonce: hostPlan.nonce,
          transition: 'code-update', previousAcceptedETag: f.previous.etag, previousAcceptedStateSha256: f.previous.sha256,
          retainedRuntimeSha: oldSha, retainedImageId: f.current.imageId, browser: args.verdict}));
        return {accepted: true, hostReceiptBase64: raw.toString('base64'), hostReceiptSha256: hash(raw)};
      }
      assert.fail('unexpected method ' + method);
    },
    async upload(name, filename) {
      const raw = gunzipSync(await fs.readFile(filename)), descriptor = hostPlan.files.find(row => row.name === name);
      assert.equal(hash(raw), descriptor.sha256); assert.equal(raw.length, descriptor.bytes); uploaded.set(name, raw);
      return {verified: true, file: name, bytes: raw.length};
    },
    async close() { calls.push('close'); },
  };
  const release = createChinaDailyRelease({root, servingRoot: directory, pricingPlan, servingPlan,
    controllerSha: '9'.repeat(40), runnerTemp: directory, environment: {SSH_PRIVATE_KEY: 'synthetic fixture'}, capabilities: {
      verifyBaselines() {}, async verifyCompatibility() { return {runtimeSha: nextSha, pricingRuntimeSha: pricingSha, protectedPricingPathsUnchanged: true}; },
      async verifyCodeCompatibility() { return {retainedRuntime: oldSha, frozenHttpOracleReusable: true}; },
      generationStorage() { assert.fail('app-only update must never restore private generation'); },
      async runChild(args) {
        const name = path.basename(args.script); calls.push(name);
        assert.notEqual(name, 'acceptance-oracle.mjs', 'code-only preparation cannot recalculate the frozen oracle');
        if (name === 'owner-filter-speed-live.mjs') {
          if (flags.chinaBrowserFailure) return 1;
          await fs.writeFile(path.join(args.cwd, 'owner-filter-browser-report.json'), JSON.stringify({release: nextSha,
            passed: true, browserPassed: true, speedGuard: {passed: true}}));
        } else if (name === 'browser-acceptance.mjs') {
          await fs.writeFile(args.env.CHINA_BROWSER_DETAILS_OUTPUT, JSON.stringify({kind: 'china-browser-details-v1', passed: true,
            release: nextSha, nonce: hostPlan.nonce, generationManifestSha256: f.candidate.generationManifestSha256,
            precedingSpeedReportSha256: hash(await fs.readFile(args.env.OWNER_FILTER_BROWSER_REPORT))}));
        } else if (name === 'japan-browser-acceptance.mjs') {
          assert.equal(japan, true); assert.deepEqual(args.args, []);
          assert.equal(args.env.EXPECTED_RELEASE_SHA, nextSha); assert.equal(args.env.VERIFICATION_NONCE, hostPlan.nonce);
          assert.ok(!Object.hasOwn(args.env, 'SSH_PRIVATE_KEY'));
          assert.equal(path.dirname(args.env.OUTPUT), args.cwd, 'the report belongs to this unique browser session');
          if (flags.gateExit) return flags.gateExit;
          const report = {version: 1, kind: 'catalog-japan-browser-v1', codeScope: 'catalog-japan-recovery-v1', release: nextSha,
            nonce: flags.wrongNonce ? 'f'.repeat(32) : hostPlan.nonce, checkedAt: new Date().toISOString(),
            generationManifestSha256: f.candidate.generationManifestSha256, oracleSha256: hash(await fs.readFile(args.env.ORACLE_PATH)),
            passed: true, japanFreshnessPassed: true, japanPowerApiPassed: true, japanUiPassed: true, japanVisibilityPassed: true,
            readOnlyBrowserFence: true, productionMutations: 0, directSupplierApiRequests: 0, explicitJapanApiRequests: 3};
          if (flags.failedReport) Object.assign(report, {passed: false, japanVisibilityPassed: false,
            error: {stage: 'catalog_visibility', code: 'japan_browser_overview_http', timeout: false}});
          if (flags.changeReport) flags.changeReport(report);
          if (!flags.missingReport) await fs.writeFile(args.env.OUTPUT, JSON.stringify(report));
          if (flags.failedReport) return 1;
        } else {
          assert.equal(name, 'photo-japan-browser-acceptance.mjs');
          assert.deepEqual(args.args, combined ? [] : ['--photo-only']);
          assert.equal(args.env.EXPECTED_RELEASE_SHA, nextSha); assert.equal(args.env.VERIFICATION_NONCE, hostPlan.nonce);
          assert.ok(!Object.hasOwn(args.env, 'SSH_PRIVATE_KEY'));
          if (flags.gateExit) return flags.gateExit;
          const report = {version: 1, kind: combined ? 'china-photo-japan-browser-v1' : 'china-photo-browser-v1', release: nextSha,
            nonce: flags.wrongNonce ? 'f'.repeat(32) : hostPlan.nonce, generationManifestSha256: f.candidate.generationManifestSha256,
            oracleSha256: hash(await fs.readFile(args.env.ORACLE_PATH)), passed: true, chinaPhotoPassed: true,
            ...(combined ? {japanFreshnessPassed: true, japanPowerApiPassed: true, japanUiPassed: true}
              : {codeScope: 'catalog-photo-recovery-v1', readOnlyBrowserFence: true, productionMutations: 0,
                directSupplierRequests: 0, explicitJapanApiRequests: 0, japanUiNavigations: 0})};
          if (flags.changeReport) flags.changeReport(report);
          if (!flags.missingReport) await fs.writeFile(args.env.OUTPUT, JSON.stringify(report));
        }
        return 0;
      },
      async openSession() { return session; }, async checkControl() {}, async health(value) { assert.ok([oldSha, nextSha].includes(value)); },
    }});
  return {...f, directory, imagePath, imageReceipt, imageReceiptRaw, storagePath, storageProof, calls, uploaded, release, flags};
}

function memoryStorage(previous) {
  const absent = {found: false, etag: null, sha256: null, value: null};
  const values = new Map([['accepted', previous]]); let serial = 1;
  return {async assertPrivateBucket() { return {verified: true}; },
    async read(name) { return copy(values.get(name) ?? absent); },
    async compareAndSwap(name, previous, value) {
      assert.equal((values.get(name) ?? absent).etag, previous.etag);
      values.set(name, {found: true, etag: '"fixture-' + ++serial + '"', sha256: digest(value), value: copy(value)});
    }};
}

async function reservedStage(f) {
  const token = 'b'.repeat(32), absent = {found: false, etag: null, sha256: null, value: null};
  const storage = memoryStorage(f.previous);
  const state = createChinaState({storage, now: () => acceptedAt});
  const lease = await state.acquireLease({previous: absent, owner: f.current.owner, nonce: token, expiresAt: '2026-11-25T10:00:00Z'});
  const stage = await f.release.stageCodeRelease({candidate: f.candidate, previous: f.previous, nonce: token, assertAuthority: async () => {}});
  const reserved = await state.reserve({lease, previous: f.previous, previousIntent: absent, candidate: f.candidate, transition: 'code-update'});
  return {stage, input: {...reserved, assertAuthority: async () => {}}};
}

test('app-only adapter uploads only the new image and checks, retaining all seven source files on the host', async t => {
  const f = await fixture(t);
  const stage = await f.release.stageCodeRelease({candidate: f.candidate, previous: f.previous,
    nonce: 'b'.repeat(32), assertAuthority: async () => {}});
  assert.deepEqual(stage.candidate, f.candidate);
  assert.deepEqual([...f.uploaded.keys()].sort(), ['acceptance.json', 'accepted-speed-baseline.json',
    'image-receipt.json', 'image.tar', 'regcloud-performance-gate.py'].sort());
  assert.deepEqual(JSON.parse(f.uploaded.get('acceptance.json')), {...f.oracle, runtimeSha: nextSha});
  assert.ok(f.calls.indexOf('code_preflight') < f.calls.indexOf('init'));
  assert.ok(f.calls.indexOf('functional') < f.calls.indexOf('speed'));
  assert.equal(f.calls.includes('switch'), false, 'stage never changes ingress before a real reservation');
  await stage.close();
});

for (const mode of ['valid', 'missing', 'private-speed', 'private-timing', 'wrong-runtime', 'wrong-nonce',
  'speed-getter', 'timing-getter']) {
  test('failed server gate survives both code release wrappers: ' + mode, async t => {
    const f = await fixture(t), token = 'b'.repeat(32), storage = memoryStorage(f.previous);
    const speed = {present: true, sha256: hash('saved speed fixture'), exitCode: 1, rejectedSamples: 0,
      samples: [{performanceRequest: 'failed', path: '/cars?market=china', seconds: 90, errorType: 'TimeoutError'}]};
    const timing = {version: 1, kind: 'china-home-phase-timing-v1', runtimeSha: nextSha, nonce: token,
      logBytes: 256, logLines: 1, rejectedRows: 0, limited: false,
      rows: [{trace: '12345678-1234-1234-1234-123456789012', phase: 'snapshot', ms: 25.4,
        ok: true, policyDate: '2026-11-25', completedPolicyDate: '2026-11-25'}]};
    const sourceError = Object.assign(Error('china_host_server_speed_failed'), {
      serverSpeed: copy(speed), homePhaseTiming: copy(timing), rawOutput: 'PRIVATE_RAW_OUTPUT'});
    if (mode === 'missing') { delete sourceError.serverSpeed; delete sourceError.homePhaseTiming; }
    if (mode === 'private-speed') sourceError.serverSpeed.stderr = 'PRIVATE_STDERR';
    if (mode === 'private-timing') sourceError.homePhaseTiming.rows[0].raw = 'PRIVATE_LOG';
    if (mode === 'wrong-runtime') sourceError.homePhaseTiming.runtimeSha = oldSha;
    if (mode === 'wrong-nonce') sourceError.homePhaseTiming.nonce = nonce;
    if (mode.endsWith('-getter')) Object.defineProperty(sourceError,
      mode === 'speed-getter' ? 'serverSpeed' : 'homePhaseTiming', {get() { throw Error('PRIVATE_GETTER'); }});
    f.flags.speedFailure = sourceError;
    let stageError, heartbeatStopped = false;
    const expectedSpeed = ['missing', 'private-speed', 'speed-getter'].includes(mode) ? undefined : speed;
    const expectedTiming = ['valid', 'private-speed', 'speed-getter'].includes(mode) ? timing : undefined;
    await assert.rejects(runChinaCodeCycle({
      plan: {version: 1, market: 'china', minimumYear: 2014, runtimeSha: nextSha,
        retainedRuntime: oldSha, pricingRuntimeSha: pricingSha},
      imageId: f.candidate.imageId, invocation: {version: 1, sourceSha: '9'.repeat(40)},
      owner: {runId: '200', attempt: '1', revision: '9'.repeat(40)}, nonce: token, storage,
      now: () => acceptedAt, scheduleHeartbeat: () => () => { heartbeatStopped = true; },
      async stageCodeRelease(input) {
        try { return await f.release.stageCodeRelease(input); }
        catch (error) { stageError = error; throw error; }
      },
      recoverRelease: async () => assert.fail('a failed stage creates no publication reservation'),
    }), error => {
      assert.equal(error.message, sourceError.message); assert.equal(error.report.errorCode, sourceError.message);
      assert.equal(stageError.message, sourceError.message); assert.notEqual(stageError, sourceError);
      assert.deepEqual(stageError.serverSpeed, expectedSpeed); assert.deepEqual(stageError.homePhaseTiming, expectedTiming);
      assert.deepEqual(error.report.serverSpeedFailure, expectedSpeed); assert.deepEqual(error.report.homePhaseTiming, expectedTiming);
      if (expectedSpeed) assert.notEqual(error.report.serverSpeedFailure.samples, stageError.serverSpeed.samples);
      if (expectedTiming) assert.notEqual(error.report.homePhaseTiming.rows, stageError.homePhaseTiming.rows);
      assert.equal(error.report.status, 'failed'); assert.equal(error.report.completed, false);
      assert.equal(error.report.published, false); assert.equal(error.report.leaseReleased, true);
      assert.doesNotMatch(JSON.stringify(error.report), /PRIVATE/);
      return true;
    });
    assert.equal(heartbeatStopped, true);
    assert.deepEqual(await storage.read('accepted'), f.previous); assert.equal((await storage.read('intent')).found, false);
    assert.deepEqual(f.calls.slice(-2), ['speed', 'abort']);
    assert.equal(f.calls.includes('switch'), false); assert.equal(f.calls.includes('accept'), false);
    assert.equal((await fs.readdir(f.directory)).some(name => name.startsWith('china-daily-release-')), false);
  });
}

test('code adapter rejects changed image bytes and changed data before starting or switching a candidate', async t => {
  const f = await fixture(t);
  const args = {candidate: f.candidate, previous: f.previous, nonce: 'b'.repeat(32), assertAuthority: async () => {}};
  await assert.rejects(f.release.stageCodeRelease({...args, candidate: {...f.candidate, sourceCursor: 101}}), /code_update_data_identity/);
  assert.deepEqual(f.calls, []);
  await fs.writeFile(f.imagePath, 'altered image');
  await assert.rejects(f.release.stageCodeRelease(args), /china_daily_release_code_image/);
  assert.equal(f.calls.includes('init'), false); assert.equal(f.calls.includes('start'), false);
  assert.equal(f.calls.includes('switch'), false);
});

test('code staging keeps operating space and rejects the incident disk budget before uploads', async t => {
  const f = await fixture(t);
  // Actual free/generation bytes from failed run 45621910693. Even this
  // fixture's tiny image must not let a 12.78 GB copy exhaust serving space.
  f.preflight.availableDiskBytes = 13_817_753_600;
  f.preflight.generationFiles.find(row => row.name === 'details.sqlite').bytes += 12_783_566_731 - f.preflight.generationBytes;
  f.preflight.generationBytes = 12_783_566_731;
  await assert.rejects(f.release.stageCodeRelease({candidate: f.candidate, previous: f.previous,
    nonce: 'b'.repeat(32), assertAuthority: async () => {}}), /china_daily_release_code_disk_capacity/);
  assert.equal(f.calls.includes('init'), false);
  assert.equal(f.uploaded.size, 0);
  assert.equal(f.calls.includes('start'), false);
  assert.equal(f.calls.includes('switch'), false);
});

test('code staging reserves a measured 1.17 GB snapshot even when the original receipt reports only packed bytes', async t => {
  const f = await fixture(t);
  f.storageProof.unpackedBytes = 1_171_000_000;
  f.storageProof.totalBytes = f.storageProof.contentBytes + f.storageProof.unpackedBytes;
  await fs.writeFile(f.storagePath, JSON.stringify(f.storageProof));
  f.preflight.availableDiskBytes = 2 * 1024 ** 3 + f.preflight.generationBytes + 512 * 1024 ** 2;
  assert.ok(f.imageReceipt.imageUnpackedBytes < 512 * 1024 ** 2);
  await assert.rejects(f.release.stageCodeRelease({candidate: f.candidate, previous: f.previous,
    nonce: 'b'.repeat(32), assertAuthority: async () => {}}), /china_daily_release_code_disk_capacity/);
  assert.equal(f.calls.includes('init'), false); assert.equal(f.uploaded.size, 0);
  assert.equal(await fs.readFile(path.join(path.dirname(f.imagePath), 'image-receipt.json'), 'utf8'), f.imageReceiptRaw);
});

for (const field of ['imageId', 'archiveSha256', 'imageReceiptSha256', 'runtimeTree']) {
  test('code staging refuses a storage proof with a different ' + field + ' before uploads', async t => {
    const f = await fixture(t);
    f.storageProof[field] = field === 'imageId' ? 'sha256:' + '0'.repeat(64)
      : field === 'runtimeTree' ? '0'.repeat(40) : '0'.repeat(64);
    await fs.writeFile(f.storagePath, JSON.stringify(f.storageProof));
    await assert.rejects(f.release.stageCodeRelease({candidate: f.candidate, previous: f.previous,
      nonce: 'b'.repeat(32), assertAuthority: async () => {}}), /china_image_storage_binding/);
    assert.equal(f.calls.includes('init'), false); assert.equal(f.uploaded.size, 0);
  });
}

test('combined code activation binds the photo and Japan browser report before host acceptance', async t => {
  const f = await fixture(t, {combined: true}), {stage, input} = await reservedStage(f);
  const result = await stage.activate(input);
  assert.equal(result.kind, 'accepted');
  assert.ok(f.calls.indexOf('photo-japan-browser-acceptance.mjs') < f.calls.indexOf('browser_evidence'));
  assert.ok(f.calls.indexOf('browser_evidence') < f.calls.indexOf('accept'));
  const details = JSON.parse(result.evidence.browserDetailsBytes);
  assert.equal(JSON.parse(Buffer.from(details.photoJapanReportBase64, 'base64')).passed, true);
  await stage.close();
});

for (const failure of ['gateExit', 'wrongNonce']) test('combined code rejects ' + failure + ' before recording acceptance', async t => {
  const f = await fixture(t, {combined: true}); f.flags[failure] = failure === 'gateExit' ? 1 : true;
  const {stage, input} = await reservedStage(f);
  await assert.rejects(stage.activate(input), /china_daily_release_photo_japan_browser_/);
  assert.equal(f.calls.includes('browser_evidence'), false); assert.equal(f.calls.includes('accept'), false);
  await stage.close();
});

test('photo-only code activation requires its bound fault-recovery report before host acceptance', async t => {
  const f = await fixture(t), {stage, input} = await reservedStage(f);
  const result = await stage.activate(input);
  assert.equal(result.kind, 'accepted');
  assert.ok(f.calls.indexOf('browser-acceptance.mjs') < f.calls.indexOf('photo-japan-browser-acceptance.mjs'));
  assert.ok(f.calls.indexOf('photo-japan-browser-acceptance.mjs') < f.calls.indexOf('browser_evidence'));
  assert.ok(f.calls.indexOf('browser_evidence') < f.calls.indexOf('accept'));
  const details = JSON.parse(result.evidence.browserDetailsBytes), raw = Buffer.from(details.photoReportBase64, 'base64');
  assert.equal(hash(raw), details.photoReportSha256);
  assert.equal(JSON.parse(raw).kind, 'china-photo-browser-v1');
  assert.equal(JSON.parse(raw).chinaPhotoPassed, true);
  assert.equal(details.photoJapanReportBase64, undefined);
  await stage.close();
});

for (const [field, value] of [
  ['version', 2], ['kind', 'china-photo-japan-browser-v1'], ['codeScope', 'catalog-photo-japan-power-v1'],
  ['release', oldSha], ['nonce', nonce], ['generationManifestSha256', '0'.repeat(64)], ['oracleSha256', '0'.repeat(64)],
  ['passed', false], ['chinaPhotoPassed', false], ['readOnlyBrowserFence', false],
  ['productionMutations', 1], ['directSupplierRequests', 1], ['explicitJapanApiRequests', 1], ['japanUiNavigations', 1],
  ['explicitJapanApiRequests', undefined], ['directSupplierRequests', false],
]) test('photo-only code rejects wrong ' + field + '=' + value + ' before recording acceptance', async t => {
  const f = await fixture(t); f.flags.changeReport = report => { report[field] = value; };
  const {stage, input} = await reservedStage(f);
  await assert.rejects(stage.activate(input), /china_daily_release_photo_browser_binding/);
  assert.equal(f.calls.includes('browser_evidence'), false); assert.equal(f.calls.includes('accept'), false);
  await stage.close(); assert.equal(f.calls.at(-1), 'close');
});

for (const failure of ['gateExit', 'missingReport']) test('photo-only code rejects ' + failure + ' and closes its unaccepted session', async t => {
  const f = await fixture(t); f.flags[failure] = 1;
  const {stage, input} = await reservedStage(f);
  await assert.rejects(stage.activate(input));
  assert.equal(f.calls.includes('browser_evidence'), false); assert.equal(f.calls.includes('accept'), false);
  await stage.close(); assert.equal(f.calls.at(-1), 'close');
});

for (const field of ['japanFreshnessPassed', 'japanPowerApiPassed', 'japanUiPassed'])
  test('combined code still requires ' + field + ' despite a successful China photo check', async t => {
    const f = await fixture(t, {combined: true}); f.flags.changeReport = report => { report[field] = false; };
    const {stage, input} = await reservedStage(f);
    await assert.rejects(stage.activate(input), /china_daily_release_photo_japan_browser_binding/);
    assert.equal(f.calls.includes('browser_evidence'), false); assert.equal(f.calls.includes('accept'), false);
    await stage.close();
  });

test('Japan recovery requires the unchanged China gates before its own bound report and host acceptance', async t => {
  const f = await fixture(t, {japan: true}), {stage, input} = await reservedStage(f);
  const result = await stage.activate(input);
  assert.equal(result.kind, 'accepted');
  const sequence = ['functional', 'speed', 'switch', 'owner-filter-speed-live.mjs', 'browser-acceptance.mjs',
    'japan-browser-acceptance.mjs', 'browser_evidence', 'accept'];
  for (let index = 1; index < sequence.length; index++) {
    assert.ok(f.calls.includes(sequence[index - 1]) && f.calls.indexOf(sequence[index - 1]) < f.calls.indexOf(sequence[index]));
  }
  assert.equal(f.calls.includes('photo-japan-browser-acceptance.mjs'), false);
  const details = JSON.parse(result.evidence.browserDetailsBytes), raw = Buffer.from(details.japanReportBase64, 'base64');
  assert.equal(hash(raw), details.japanReportSha256);
  assert.equal(JSON.parse(raw).kind, 'catalog-japan-browser-v1');
  assert.equal(JSON.parse(raw).codeScope, 'catalog-japan-recovery-v1');
  assert.equal(details.photoReportBase64, undefined); assert.equal(details.photoJapanReportBase64, undefined);
  assert.deepEqual(JSON.parse(f.uploaded.get('acceptance.json')), {...f.oracle, runtimeSha: nextSha});
  await stage.close();
  const artifact = path.join(f.directory, 'controller/catalog-next-japan-browser-report.json');
  assert.deepEqual(await fs.readFile(artifact), raw, 'the exact evidence bytes survive staging cleanup for workflow upload');
  assert.equal((await fs.stat(artifact)).mode & 0o777, 0o600);
});

test('Japan recovery preserves a bound failed report for artifacts without accepting it', async t => {
  const f = await fixture(t, {japan: true}); f.flags.failedReport = true;
  const {stage, input} = await reservedStage(f);
  await assert.rejects(stage.activate(input), /china_daily_release_japan_browser_failed/);
  assert.equal(f.calls.includes('browser_evidence'), false); assert.equal(f.calls.includes('accept'), false);
  await stage.close();
  const artifact = path.join(f.directory, 'controller/catalog-next-japan-browser-report.json');
  const report = JSON.parse(await fs.readFile(artifact, 'utf8'));
  assert.equal(report.passed, false); assert.equal(report.japanVisibilityPassed, false);
  assert.equal(report.error.code, 'japan_browser_overview_http'); assert.equal(report.release, nextSha);
  assert.equal(report.nonce, input.intent.value.nonce);
  assert.equal((await fs.stat(artifact)).mode & 0o777, 0o600);
});

test('Japan recovery never overwrites an existing workflow artifact or accepts its stale bytes', async t => {
  const f = await fixture(t, {japan: true});
  const artifact = path.join(f.directory, 'controller/catalog-next-japan-browser-report.json'), existing = 'previous artifact';
  await fs.writeFile(artifact, existing, {flag: 'wx', mode: 0o600});
  const {stage, input} = await reservedStage(f);
  await assert.rejects(stage.activate(input), error => error.code === 'EEXIST');
  assert.equal(f.calls.includes('browser_evidence'), false); assert.equal(f.calls.includes('accept'), false);
  await stage.close();
  assert.equal(await fs.readFile(artifact, 'utf8'), existing);
});

for (const [field, value] of [
  ['version', 2], ['kind', 'china-photo-japan-browser-v1'], ['codeScope', 'catalog-photo-japan-power-v1'],
  ['release', oldSha], ['nonce', nonce], ['generationManifestSha256', '0'.repeat(64)], ['oracleSha256', '0'.repeat(64)],
  ['checkedAt', acceptedAt], ['checkedAt', '2999-01-01T00:00:00.000Z'], ['checkedAt', undefined],
  ...['passed', 'japanFreshnessPassed', 'japanPowerApiPassed', 'japanUiPassed', 'japanVisibilityPassed', 'readOnlyBrowserFence']
    .map(field => [field, false]),
  ['productionMutations', 1], ['directSupplierApiRequests', 1], ['productionMutations', false], ['directSupplierApiRequests', undefined],
]) test('Japan recovery rejects invalid ' + field + '=' + value + ' before accepting evidence', async t => {
  const f = await fixture(t, {japan: true}); f.flags.changeReport = report => { report[field] = value; };
  const {stage, input} = await reservedStage(f);
  await assert.rejects(stage.activate(input), /china_daily_release_japan_browser_binding/);
  assert.equal(f.calls.includes('browser_evidence'), false); assert.equal(f.calls.includes('accept'), false);
  await stage.close(); assert.equal(f.calls.at(-1), 'close');
});

for (const failure of ['gateExit', 'missingReport', 'oversizedReport', 'chinaBrowserFailure'])
  test('Japan recovery rejects ' + failure + ' and closes the unaccepted session', async t => {
    const f = await fixture(t, {japan: true});
    if (failure === 'oversizedReport') f.flags.changeReport = report => { report.padding = 'x'.repeat(128 * 1024); };
    else f.flags[failure] = 1;
    const {stage, input} = await reservedStage(f);
    await assert.rejects(stage.activate(input));
    assert.equal(f.calls.includes('browser_evidence'), false); assert.equal(f.calls.includes('accept'), false);
    if (failure === 'chinaBrowserFailure') assert.equal(f.calls.includes('japan-browser-acceptance.mjs'), false);
    await stage.close(); assert.equal(f.calls.at(-1), 'close');
  });

test('Japan recovery cannot switch when the existing China functional gate fails', async t => {
  const f = await fixture(t, {japan: true}); f.flags.functionalFailure = true;
  await assert.rejects(reservedStage(f), /china_daily_release_functional/);
  assert.equal(f.calls.includes('switch'), false); assert.equal(f.calls.includes('accept'), false);
  assert.equal(f.calls.at(-1), 'abort');
});
