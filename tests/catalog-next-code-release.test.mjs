import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createChinaDailyRelease, checkedChinaCodePreflight} from '../scripts/catalog-next/daily-release.mjs';
import {createChinaState} from '../scripts/catalog-next/china-state.mjs';

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

async function fixture(t, {combined = false} = {}) {
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
    ...(combined ? {codeScope: 'catalog-photo-japan-power-v1'} : {})};
  const pricingPlan = {version: 1, market: 'china', runtimeSha: pricingSha};
  await fs.writeFile(path.join(imageDirectory, 'image-receipt.json'), JSON.stringify({version: 1,
    kind: 'china-runtime-image-v1', runtimeSha: nextSha, runtimeTree: servingPlan.runtimeTree,
    retainedRuntime: oldSha, runtimeDiffSha256: servingPlan.runtimeDiffSha256, pricingRuntimeSha: pricingSha,
    imageId: f.candidate.imageId, bytes: image.length, imageUnpackedBytes: 100, sha256: hash(image), archiveRoundTripVerified: true,
    privateDataIncluded: false, protectedPathsUnchanged: true, servingCompatibility: {protectedPricingPathsUnchanged: true},
    ...(combined ? {codeScope: servingPlan.codeScope} : {})}));
  const calls = [], uploaded = new Map(), flags = {gateExit: 0, wrongNonce: false}; let hostPlan, browserBytes;
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
        return {};
      }
      if (method === 'start') {
        assert.equal(uploaded.size, 5);
        return {started: true, release: nextSha, generationId: f.current.generationId};
      }
      if (method === 'functional') return {functionalPassed: true, cases: f.oracle.cases};
      if (method === 'speed') return {speedPassed: true};
      if (method === 'switch') return {switched: true, release: nextSha, nonce: hostPlan.nonce};
      if (method === 'browser_evidence') {
        browserBytes = {speed: Buffer.from(args.speedBase64, 'base64'), details: Buffer.from(args.detailsBase64, 'base64')};
        const details = JSON.parse(browserBytes.details), raw = Buffer.from(details.photoJapanReportBase64, 'base64');
        assert.equal(hash(raw), details.photoJapanReportSha256);
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
          await fs.writeFile(path.join(args.cwd, 'owner-filter-browser-report.json'), JSON.stringify({release: nextSha,
            passed: true, browserPassed: true, speedGuard: {passed: true}}));
        } else if (name === 'browser-acceptance.mjs') {
          await fs.writeFile(args.env.CHINA_BROWSER_DETAILS_OUTPUT, JSON.stringify({kind: 'china-browser-details-v1', passed: true,
            release: nextSha, nonce: hostPlan.nonce, generationManifestSha256: f.candidate.generationManifestSha256,
            precedingSpeedReportSha256: hash(await fs.readFile(args.env.OWNER_FILTER_BROWSER_REPORT))}));
        } else {
          assert.equal(name, 'photo-japan-browser-acceptance.mjs');
          assert.equal(args.env.EXPECTED_RELEASE_SHA, nextSha); assert.equal(args.env.VERIFICATION_NONCE, hostPlan.nonce);
          assert.ok(!Object.hasOwn(args.env, 'SSH_PRIVATE_KEY'));
          if (flags.gateExit) return flags.gateExit;
          await fs.writeFile(args.env.OUTPUT, JSON.stringify({version: 1, kind: 'china-photo-japan-browser-v1', release: nextSha,
            nonce: flags.wrongNonce ? 'f'.repeat(32) : hostPlan.nonce, generationManifestSha256: f.candidate.generationManifestSha256,
            oracleSha256: hash(await fs.readFile(args.env.ORACLE_PATH)), passed: true, chinaPhotoPassed: true,
            japanFreshnessPassed: true, japanPowerApiPassed: true, japanUiPassed: true}));
        }
        return 0;
      },
      async openSession() { return session; }, async checkControl() {}, async health(value) { assert.ok([oldSha, nextSha].includes(value)); },
    }});
  return {...f, directory, imagePath, calls, uploaded, release, flags};
}

async function reservedStage(f) {
  const token = 'b'.repeat(32), absent = {found: false, etag: null, sha256: null, value: null};
  const values = new Map([['accepted', f.previous]]); let serial = 1;
  const storage = {async assertPrivateBucket() { return {verified: true}; },
    async read(name) { return copy(values.get(name) ?? absent); },
    async compareAndSwap(name, previous, value) {
      assert.equal((values.get(name) ?? absent).etag, previous.etag);
      values.set(name, {found: true, etag: '"fixture-' + ++serial + '"', sha256: digest(value), value: copy(value)});
    }};
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
