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
import {checkedCatalogCodeScope,JAPAN_USABILITY_RETAINED_RUNTIME,JAPAN_USABILITY_CODE_PATHS} from '../scripts/catalog-next/photo-code-scope.mjs';
import {CRM_CHINA_CODE_SCOPE, CRM_CHINA_CODE_PATHS, CRM_CHINA_RETAINED_RUNTIME, CRM_CHINA_PROTECTED_EXCEPTIONS}
  from '../scripts/catalog-next/crm-china-code-scope.mjs';
import {CRM_JAPAN_PHOTO_CODE_SCOPE, CRM_JAPAN_PHOTO_CODE_PATHS} from '../scripts/catalog-next/crm-japan-photo-code-scope.mjs';
import {JAPAN_PAGINATION_CODE_SCOPE, JAPAN_PAGINATION_CODE_PATHS, JAPAN_PAGINATION_RETAINED_RUNTIME} from '../scripts/catalog-next/japan-pagination-code-scope.mjs';
import {JAPAN_STABILITY_CODE_SCOPE, JAPAN_STABILITY_CODE_PATHS, JAPAN_STABILITY_UI_CODE_PATHS, JAPAN_STABILITY_POWER_CODE_PATHS, JAPAN_STABILITY_RAILS_CODE_PATHS, JAPAN_STABILITY_RETAINED_RUNTIME,
  JAPAN_STABILITY_HOME_CODE_PATHS, JAPAN_OBSERVED_TIMING_POLICY, JAPAN_STABILITY_PRICE_SORT_CODE_PATHS, JAPAN_STABILITY_PRICE_SORT_RETAINED_RUNTIME, JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS, JAPAN_STABILITY_EXACT_COUNT_RETAINED_RUNTIME,
  JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY} from '../scripts/catalog-next/japan-stability-code-scope.mjs';
import {JAPAN_STABILITY_GATES} from '../scripts/catalog-next/japan-stability-browser.mjs';

const hash = raw => createHash('sha256').update(raw).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const digest = value => hash(JSON.stringify(ordered(value))), copy = value => JSON.parse(JSON.stringify(value));
const oldSha = '1'.repeat(40), nextSha = '2'.repeat(40), pricingSha = '3'.repeat(40);
const nonce = 'a'.repeat(32), acceptedAt = '2026-11-25T08:00:00Z';
const usabilityScope='catalog-japan-usability-v1';
const usabilityFlags=['japanBrandDirectoryPassed','japanFullPagesPassed','japanKnownPowerOrderPassed','japanVehiclePolicyPassed','japanQuietCatalogPassed'];
function sample(retainedRuntime=oldSha) {
  const manifestRaw = Buffer.from(JSON.stringify({kind: 'china-local-generation-v1', market: 'china',
    generationId: 'gen_china_100_1', runtimeSha: pricingSha, prepared: true, rows: 283188,
    source: {supplierLatestVerified: true, cursor: 100, sourceObservedAt: '2026-11-24T11:00:00Z'}}));
  const current = {market: 'china', generationId: 'gen_china_100_1', owner: {runId: '100', attempt: '1', revision: retainedRuntime},
    receiptSha256: hash('receipt'), sourceDescriptorSha256: hash('source'), generationManifestSha256: hash(manifestRaw),
    sourceCursor: 100, sourceObservedAt: '2026-11-24T11:00:00Z', runtimeSha: retainedRuntime, pricingRuntimeSha: pricingSha,
    imageId: 'sha256:' + '4'.repeat(64)};
  const receipt = Buffer.from(JSON.stringify({version: 1, kind: 'china-host-acceptance-v1', release: current.runtimeSha,
    pricingRuntimeSha: current.pricingRuntimeSha, generationId: current.generationId, imageId: current.imageId,
    generationManifestSha256: current.generationManifestSha256, privateGenerationReceiptSha256: current.receiptSha256,
    sourceDescriptorSha256: current.sourceDescriptorSha256, sourceCursor: current.sourceCursor,
    sourceObservedAt: current.sourceObservedAt, nonce, acceptedAt, retainedContainerId: '7'.repeat(64),
    browser: {release: retainedRuntime, nonce, passed: true, functionalPassed: true, speedPassed: true,
      reportSha256: hash('browser'), speedReportSha256: hash('speed'), detailsReportSha256: hash('details')}}));
  current.proof = {kind: 'china-accepted-proof-v1', hostReceiptBase64: receipt.toString('base64'), hostReceiptSha256: hash(receipt)};
  const state = {version: 1, kind: 'china-accepted-state-v1', market: 'china', revision: 1, current, rollback: null, pending: null,
    commit: {nonce, intentSha256: hash('intent'), previousETag: null, previousStateSha256: null, acceptedAt}};
  const previous = {found: true, etag: '"accepted-1"', sha256: digest(state), value: state};
  const oracle = {version: 1, kind: 'local-native-reader-http-expectations-v1', runtimeSha: retainedRuntime,
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

async function fixture(t, {combined = false, japan = false,completion=false, crm=false, crmPhoto=false, pagination=false, stability=false, ui=false, powerOrder=false, brandDirectory=false, observedTiming=false, priceSort=false, exactCount=false, incremental=false} = {}) {
  assert.equal(exactCount && incremental, false, 'strict and incremental acceptance are distinct profiles');
  const exactProfile = exactCount || incremental;
  priceSort=priceSort||exactProfile;
  observedTiming=observedTiming||priceSort;
  brandDirectory=brandDirectory||observedTiming;
  powerOrder=powerOrder||brandDirectory;
  stability=stability||ui||powerOrder;
  pagination=pagination||stability;
  crmPhoto=crmPhoto||pagination;completion=completion||pagination;
  crm=crm||crmPhoto;
  japan=Boolean(japan||completion);
  const usability=completion===usabilityScope,retainedRuntime=exactProfile?JAPAN_STABILITY_EXACT_COUNT_RETAINED_RUNTIME:priceSort?JAPAN_STABILITY_PRICE_SORT_RETAINED_RUNTIME:stability?JAPAN_STABILITY_RETAINED_RUNTIME:pagination?JAPAN_PAGINATION_RETAINED_RUNTIME:crm?CRM_CHINA_RETAINED_RUNTIME:usability?JAPAN_USABILITY_RETAINED_RUNTIME:oldSha;
  const f = sample(retainedRuntime), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-photo-stage-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const root = path.join(directory, 'controller');
  for (const name of ['scripts/regcloud-release-retention.py', 'scripts/regcloud-performance-gate.py', 'docs/operations/2026-11-11-accepted-speed-baseline.json',
    'docs/operations/2026-11-11-accepted-browser-speed-baseline.json']) {
    await fs.mkdir(path.dirname(path.join(root, name)), {recursive: true});
    await fs.copyFile(path.join(process.cwd(), name), path.join(root, name));
  }
  const imageDirectory = path.join(directory, 'china-release-build'); await fs.mkdir(imageDirectory);
  const photoFixturePath = path.join(directory, 'japan-photo-retry-browser-report.json');
  if (crmPhoto) await fs.writeFile(photoFixturePath, JSON.stringify({version: 1, kind: 'japan-photo-retry-browser-v1',
    passed: true, widths: [1440, 390], caseCount: 12, checks: Object.fromEntries([
      'transientRecovery', 'persistentFailureBound', 'sourceChangeCancellation', 'unmountCancellation',
      'exactUrl', 'noExternalRequests', 'protectedPhotoPreserved', 'lazyLoadRecovery'].map(key => [key, true]))}));
  const paginationFixturePath=path.join(directory,'japan-pagination24-browser-report.json');
  if(pagination)await fs.writeFile(paginationFixturePath,JSON.stringify({version:powerOrder?2:1,kind:powerOrder?'japan-pagination24-browser-v2':'japan-pagination24-browser-v1',passed:true,
    caseCount:powerOrder?12:8,widths:[390,1440],checks:Object.fromEntries(['refill24','numberedContinuation','appendNoDuplicatesOrGaps','finiteExhaustion',
      'unknownPowerPreserved','failureHonesty','cursorBinding','warningRemoved','sourcePageSize24','neighborPaginationPreserved','noExternalRequests',...(powerOrder?['knownBeforeUnknown','boundedKnownContinuation','evidenceEpochReset']:[])].map(key=>[key,true]))}));
  const directoryFixturePath=path.join(directory,'japan-filter-directory-browser-report.json');
  if(stability)await fs.writeFile(directoryFixturePath,JSON.stringify({passed:true,
    scope:'Actual Japan brand/model controls with bounded local source fixtures; no production or supplier calls',
    cases:[390,1440].flatMap(width=>['source-options-only','make-change-clears-old-models',
      'model-directory-failure-and-retry','brand-directory-failure-and-retry',...((ui||powerOrder)?['raw-source-selection','typed-source-make-aliases']:[]),
      ...(brandDirectory?['brand-directory-fresh-empty-visible-and-retry','brand-directory-stale-visible-and-retry','brand-directory-error-visible-and-retry']:[]),
      ...(exactProfile?['audi-family-stale-failed-retry-and-explicit-make']:[])].map(name=>({width,name,passed:true})))}));
  const image = Buffer.from('synthetic roundtrip image'), imagePath = path.join(imageDirectory, 'image.tar');
  await fs.writeFile(imagePath, image);
  const servingPlan = {version: 1, market: 'china', runtimeSha: nextSha, retainedRuntime,
    runtimeTree: '6'.repeat(40), runtimeDiffSha256: hash('photo diff'), pricingRuntimeSha: pricingSha,
    ...(usability?{runtimeFiles:[...JAPAN_USABILITY_CODE_PATHS]}:{}),
    ...(stability?{runtimeFiles:[...(brandDirectory?JAPAN_STABILITY_RAILS_CODE_PATHS:powerOrder?JAPAN_STABILITY_POWER_CODE_PATHS:ui?JAPAN_STABILITY_UI_CODE_PATHS:JAPAN_STABILITY_CODE_PATHS)],codeScope:JAPAN_STABILITY_CODE_SCOPE}:pagination?{runtimeFiles:[...JAPAN_PAGINATION_CODE_PATHS],codeScope:JAPAN_PAGINATION_CODE_SCOPE}:crm?{runtimeFiles:[...(crmPhoto?CRM_JAPAN_PHOTO_CODE_PATHS:CRM_CHINA_CODE_PATHS)], codeScope:crmPhoto?CRM_JAPAN_PHOTO_CODE_SCOPE:CRM_CHINA_CODE_SCOPE}:
      japan ? {codeScope: completion?(typeof completion==='string'?completion:'catalog-japan-completion-v1'):'catalog-japan-recovery-v1'} : combined ? {codeScope: 'catalog-photo-japan-power-v1'} : {})};
  const pricingPlan = {version: 1, market: 'china', runtimeSha: pricingSha};
  if (observedTiming) Object.assign(servingPlan, {runtimeFiles: [...(exactProfile?JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS:priceSort?JAPAN_STABILITY_PRICE_SORT_CODE_PATHS:JAPAN_STABILITY_HOME_CODE_PATHS)], acceptancePolicy: JAPAN_OBSERVED_TIMING_POLICY});
  if (incremental) servingPlan.countAcceptance = JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY;
  const imageReceipt = {version: 1,
    kind: 'china-runtime-image-v1', runtimeSha: nextSha, runtimeTree: servingPlan.runtimeTree,
    retainedRuntime, runtimeDiffSha256: servingPlan.runtimeDiffSha256, pricingRuntimeSha: pricingSha,
    imageId: f.candidate.imageId, bytes: image.length, imageUnpackedBytes: 100, sha256: hash(image), archiveRoundTripVerified: true,
    privateDataIncluded: false, protectedPathsUnchanged: true, servingCompatibility: {protectedPricingPathsUnchanged: true},
    configSha256: hash('configuration'), rootFsSha256: hash('rootfs'), platform: 'linux/amd64',
    builder: {version: '29.1.3', driver: 'overlayfs', driverType: 'io.containerd.snapshotter.v1'},
    ...(combined || japan || crm ? {codeScope: servingPlan.codeScope} : {}),
    ...(observedTiming ? {acceptancePolicy: JAPAN_OBSERVED_TIMING_POLICY} : {}),
    ...(incremental ? {countAcceptance: JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY} : {}),
    ...(crm && !pagination ? {protectedPathExceptions: [...CRM_CHINA_PROTECTED_EXCEPTIONS]} : {})};
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
      if (method === 'retire_terminal_app_image') {
        assert.deepEqual(args.currentState, args.publication);
        assert.equal(Object.hasOwn(args, 'imageId'), false);
        const target = args.publication.intent.value.candidate;
        const bound = {runtimeSha: target.runtimeSha, imageId: target.imageId, witnessSha256: digest(args.publication)};
        if (args.action === 'prepare') {
          assert.equal(hash(args.policySource), args.policySourceSha256);
          assert.match(args.policySource, /def pinned_image/);
          if (flags.imagePrepare) flags.imagePrepare();
          if (flags.imageAbsent) return {version: 1, kind: 'china-terminal-app-image-cleanup-v1', completed: true,
            status: 'already_absent', uncertain: false, imagesRemoved: 0, ...bound,
            diskFreeBytesBefore: 100, diskFreeBytesAfter: 100, measuredFreeBytesChange: 0, reason: 'already_absent'};
          return {version: 1, kind: 'china-terminal-app-image-prepared-v1', ...bound,
            ...(flags.imageWrongTarget ? {imageId: 'sha256:' + 'f'.repeat(64)} : {})};
        }
        assert.equal(args.action, 'remove'); flags.imageDeletes = (flags.imageDeletes ?? 0) + 1;
        if (flags.imageLostDelete) throw Error('china_ssh_closed');
        return {version: 1, kind: 'china-terminal-app-image-cleanup-v1', completed: true, status: 'removed',
          uncertain: false, imagesRemoved: 1, ...bound, diskFreeBytesBefore: 100, diskFreeBytesAfter: 175,
          measuredFreeBytesChange: 75, reason: 'exact_terminal_image'};
      }
      if (method === 'code_preflight') { assert.deepEqual(args.previousAccepted, f.previous); return f.preflight; }
      if (method === 'init') {
        hostPlan = args.plan;
        assert.equal(hostPlan.mode, 'code-update'); assert.equal(hostPlan.files.length, 12);
        assert.equal(hostPlan.generationId, f.current.generationId); assert.equal(hostPlan.retainedRuntime, retainedRuntime);
        assert.equal(hostPlan.codeSourcePlanSha256, f.preflight.previousPlanSha256);
        assert.equal(hostPlan.codeSourceOracleSha256, f.preflight.previousOracleSha256);
        assert.equal(hostPlan.countAcceptance, incremental ? JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY : undefined);
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
        if (observedTiming) return {version: 1, kind: 'japan-server-timing-observation-v1', release: nextSha, nonce: hostPlan.nonce,
          timingPolicy: JAPAN_OBSERVED_TIMING_POLICY, speedGateRequired: false, speedPassed: null, timingObserved: true,
          broadServerBenchmarkExecuted: false, healthSeconds: 123.45,
          baselineSha256: '32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59'};
        return {speedPassed: true};
      }
      if (method === 'switch') return {switched: true, release: nextSha, nonce: hostPlan.nonce};
      if (method === 'browser_evidence') {
        browserBytes = {speed: Buffer.from(args.speedBase64, 'base64'), details: Buffer.from(args.detailsBase64, 'base64')};
        const details = JSON.parse(browserBytes.details), raw = Buffer.from(
          crm && !observedTiming ? details.crmChinaReportBase64 : japan ? details.japanReportBase64 : combined ? details.photoJapanReportBase64 : details.photoReportBase64, 'base64');
        assert.equal(details.countAcceptance, incremental ? JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY : undefined);
        assert.equal(hash(raw), crm && !observedTiming ? details.crmChinaReportSha256 : japan ? details.japanReportSha256 : combined ? details.photoJapanReportSha256 : details.photoReportSha256);
        assert.equal(JSON.parse(raw).nonce, hostPlan.nonce);
        if (crmPhoto) {
          const photoRaw = Buffer.from(details.japanPhotoRetryReportBase64, 'base64');
          const photo = JSON.parse(photoRaw);
          assert.equal(hash(photoRaw), details.japanPhotoRetryReportSha256);
          assert.equal(photo.nonce, hostPlan.nonce); assert.equal(photo.release, hostPlan.runtimeSha);
          assert.equal(photo.codeScope, stability?JAPAN_STABILITY_CODE_SCOPE:pagination?JAPAN_PAGINATION_CODE_SCOPE:CRM_JAPAN_PHOTO_CODE_SCOPE);
          assert.deepEqual(Buffer.from(photo.fixtureBase64, 'base64'), await fs.readFile(photoFixturePath));
        }
        if(pagination){
          const japanRaw=Buffer.from(details.japanReportBase64,'base64'),japanReport=JSON.parse(japanRaw);
          assert.equal(hash(japanRaw),details.japanReportSha256);
          assert.equal(japanReport.codeScope,stability?JAPAN_STABILITY_CODE_SCOPE:JAPAN_PAGINATION_CODE_SCOPE);
          assert.equal(japanReport.japanPagination24Passed,true);assert.equal(japanReport.japanFullPagesPassed,true);
          if(stability)for(const key of JAPAN_STABILITY_GATES)assert.equal(japanReport[key],true);
          if(powerOrder)assert.equal(japanReport.japanPowerOrderPassed,true);
          if(brandDirectory)assert.equal(japanReport.japanBrandDirectoryPassed,true);
        }
        return {saved: true, speedReportSha256: hash(browserBytes.speed), detailsReportSha256: hash(browserBytes.details)};
      }
      if (method === 'accept') {
        const old = JSON.parse(Buffer.from(f.current.proof.hostReceiptBase64, 'base64'));
        const raw = Buffer.from(JSON.stringify({...old, release: nextSha, imageId: f.candidate.imageId, nonce: hostPlan.nonce,
          transition: 'code-update', previousAcceptedETag: f.previous.etag, previousAcceptedStateSha256: f.previous.sha256,
          ...(observedTiming ? {acceptancePolicy: JAPAN_OBSERVED_TIMING_POLICY, codeScope: JAPAN_STABILITY_CODE_SCOPE} : {}),
          ...(incremental ? {countAcceptance: JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY} : {}),
          retainedRuntimeSha: retainedRuntime, retainedImageId: f.current.imageId, browser: args.verdict}));
        return {accepted: true, hostReceiptBase64: raw.toString('base64'), hostReceiptSha256: hash(raw)};
      }
      assert.fail('unexpected method ' + method);
    },
    async upload(name, filename) {
      const raw = gunzipSync(await fs.readFile(filename)), descriptor = hostPlan.files.find(row => row.name === name);
      assert.equal(hash(raw), descriptor.sha256); assert.equal(raw.length, descriptor.bytes); uploaded.set(name, raw);
      return {verified: true, file: name, bytes: raw.length};
    },
    async close() { calls.push('close'); return {closed: true, readOnly: false}; },
  };
  const release = createChinaDailyRelease({root, servingRoot: directory, pricingPlan, servingPlan,
    controllerSha: '9'.repeat(40), runnerTemp: directory, environment: {SSH_PRIVATE_KEY: 'synthetic fixture'}, capabilities: {
      verifyBaselines() {}, async verifyCompatibility() { return {runtimeSha: nextSha, pricingRuntimeSha: pricingSha, protectedPricingPathsUnchanged: true}; },
      async verifyCodeCompatibility() { if(usability||crm)checkedCatalogCodeScope(servingPlan);return {retainedRuntime, frozenHttpOracleReusable: true}; },
      generationStorage() { assert.fail('app-only update must never restore private generation'); },
      async runChild(args) {
        const name = path.basename(args.script); calls.push(name);
        assert.notEqual(name, 'acceptance-oracle.mjs', 'code-only preparation cannot recalculate the frozen oracle');
        if (name === 'crm-china-status-proof.mjs') {
          assert.equal(crm, true); assert.equal(args.args[0], '--manifest'); assert.equal(args.args[1], directory);
          assert.equal(args.env.JSON_STORAGE_DRIVER, 'local'); assert.ok(!Object.hasOwn(args.env, 'SSH_PRIVATE_KEY'));
          assert.deepEqual(await fs.readFile(path.join(args.args[2], 'GENERATION.json')), Buffer.from(f.preflight.generationManifestBase64, 'base64'));
          assert.deepEqual(await fs.readdir(args.args[2]), ['GENERATION.json']);
          if (flags.manifestExit) return 1;
          const binding = JSON.parse(await fs.readFile(args.args[3]));
          const proof = {version: 1, kind: 'china-crm-manifest-proof-v1', ...binding, manifestHelperPassed: true, middlewareBoundaryPassed: true};
          if (flags.changeManifestProof) flags.changeManifestProof(proof);
          await fs.writeFile(args.args[4], JSON.stringify(proof));
        } else if (name === 'owner-filter-speed-live.mjs') {
          if (flags.chinaBrowserFailure) return 1;
          await fs.writeFile(path.join(args.cwd, 'owner-filter-browser-report.json'), JSON.stringify({release: nextSha,
            passed: true, browserPassed: true, speedGuard: {passed: true}}));
        } else if (name === 'browser-acceptance.mjs') {
          await fs.writeFile(args.env.CHINA_BROWSER_DETAILS_OUTPUT, JSON.stringify({kind: 'china-browser-details-v1', passed: true,
            release: nextSha, nonce: hostPlan.nonce, generationManifestSha256: f.candidate.generationManifestSha256,
            precedingSpeedReportSha256: hash(await fs.readFile(args.env.OWNER_FILTER_BROWSER_REPORT))}));
        } else if (name === 'japan-browser-acceptance.mjs') {
          assert.equal(japan, true); assert.deepEqual(args.args, []);
          assert.equal(args.env.CATALOG_CODE_SCOPE,servingPlan.codeScope);
          assert.equal(args.env.CATALOG_JAPAN_POWER_ORDER_REQUIRED,powerOrder?'1':'0');
          assert.equal(args.env.CATALOG_JAPAN_BRAND_DIRECTORY_REQUIRED,brandDirectory?'1':'0');
          assert.equal(args.env.CATALOG_JAPAN_PRICE_SORT_REQUIRED,priceSort?'1':'0');
          assert.equal(args.env.CATALOG_JAPAN_EXACT_COUNT_REQUIRED,exactCount?'1':'0');
          assert.equal(args.env.CATALOG_JAPAN_MODEL_COVERAGE_REQUIRED,incremental?'1':'0');
          assert.equal(args.env.CATALOG_JAPAN_TIMING_POLICY, observedTiming ? JAPAN_OBSERVED_TIMING_POLICY : undefined);
          assert.equal(Object.hasOwn(args.env, 'CATALOG_JAPAN_TIMING_POLICY'), observedTiming,
            'older profiles omit the optional timing policy rather than sending an invalid empty value');
          assert.equal(args.env.EXPECTED_RELEASE_SHA, nextSha); assert.equal(args.env.VERIFICATION_NONCE, hostPlan.nonce);
          assert.ok(!Object.hasOwn(args.env, 'SSH_PRIVATE_KEY'));
          assert.equal(path.dirname(args.env.OUTPUT), args.cwd, 'the report belongs to this unique browser session');
          if (flags.gateExit) return flags.gateExit;
          const report = {version: 1, kind: 'catalog-japan-browser-v1', codeScope: servingPlan.codeScope, release: nextSha,
            nonce: flags.wrongNonce ? 'f'.repeat(32) : hostPlan.nonce, checkedAt: new Date().toISOString(),
            generationManifestSha256: f.candidate.generationManifestSha256, oracleSha256: hash(await fs.readFile(args.env.ORACLE_PATH)),
            passed: true, japanFreshnessPassed: true, japanPowerApiPassed: true, japanUiPassed: true, japanVisibilityPassed: true,
            readOnlyBrowserFence: true, productionMutations: 0, directSupplierApiRequests: 0, explicitJapanApiRequests: completion?5:3,
            ...(observedTiming ? {timingPolicy: JAPAN_OBSERVED_TIMING_POLICY, speedGateRequired: false, speedPassed: null, timingObserved: true,
              timings: {version: 1, unit: 'ms', latencyThresholdApplied: false, samples: [{phase: 'own-ui', durationMs: 120000}]}} : {}),
            ...(completion?{japanPetrolPowerUiPassed:true,japanDetailPowerInputPassed:true,
              japanDeliveredCalculationPassed:true,japanPreviewCalculationRequests:1}:{}),
            ...(usability?Object.fromEntries(usabilityFlags.map(flag=>[flag,true])):{}),
            ...(pagination?{japanFullPagesPassed:true,japanPagination24Passed:true,japanCatalogWarningRemovedPassed:true}:{}),
            ...(powerOrder?{japanPowerOrderPassed:true}:{}),
            ...(brandDirectory?{japanBrandDirectoryPassed:true}:{}),
            ...(priceSort?{japanPriceSortRequired:true,japanPriceSortPassed:true,japanCountDisplayPassed:true}:{}),
            ...(exactCount?{japanExactCountRequired:true,japanExactCountPassed:true,japanModelCoveragePassed:true}:{}),
            ...(incremental?{countAcceptance:JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY,
              japanModelCoverageRequired:true,japanModelCoveragePassed:true,japanExactCountRequired:false,japanExactCountPassed:null,
              checks:{modelCoverage:{sourcePairs:94,accessiblePairs:94,allSourceModelsAccessible:true,noForeignModels:true,
                sourceMatchesUi:true,typedBase:'A4',typedFamilyNotNarrowed:true,modelExpansions:1,sourceFamilyModels:3,make:'AUDI',
                pairsSha256:hash('source pairs'),directory:{status:200,stale:false,sourcePairs:94,pairsSha256:hash('source pairs')},
                selection:{shown:24,observedSourceNamesOnly:true},countHonest:true,fullPage:true,explicitApiReads:3,
                liveExhaustiveScan:false,pageErrors:0}}}:{}),
            ...(stability?Object.fromEntries(JAPAN_STABILITY_GATES.map(key=>[key,true])):{})};
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
      async verifyCrmAccess() {
        assert.equal(crm, true); calls.push('crm_access_boundary');
        if (flags.accessFailure) throw Error('china_crm_status_unauthorized_boundary');
        return {unauthorizedStatus: 401, unauthorizedContentTypeJson: true, unauthorizedBodyIsAuthRequired: true,
          unauthorizedSetCookieAbsent: true, unsignedAccessDenied: true,
          ...(flags.accessChange ?? {})};
      },
      async openSession() { return session; }, async checkControl() {}, async health(value) { assert.ok([retainedRuntime, nextSha].includes(value)); },
    }});
  return {...f, directory, imagePath, imageReceipt, imageReceiptRaw, storagePath, storageProof, servingPlan, calls, uploaded, release, flags, photoFixturePath, paginationFixturePath, directoryFixturePath};
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
  return {stage, state, storage, lease, input: {...reserved, assertAuthority: async () => {}}};
}

test('exact Japan policy accepts own functional evidence with honest slow timing observations and skips unrelated browser benchmarks', async t => {
  const f = await fixture(t, {observedTiming: true}), storage = memoryStorage(f.previous);
  f.flags.chinaBrowserFailure = true;
  f.flags.accessFailure = true;
  const report = await runChinaCodeCycle({plan: {...f.servingPlan, minimumYear: 2014}, imageId: f.candidate.imageId,
    invocation: {version: 1, sourceSha: '9'.repeat(40)}, owner: {runId: '200', attempt: '1', revision: '9'.repeat(40)},
    nonce: 'b'.repeat(32), storage, now: () => acceptedAt, scheduleHeartbeat: () => () => {},
    stageCodeRelease: f.release.stageCodeRelease, recoverRelease: async () => assert.fail('no unresolved publication')});
  assert.equal(report.completed, true); assert.equal(report.status, 'accepted');
  assert.equal(report.speedGateRequired, false); assert.equal(report.speedPassed, null); assert.equal(report.timingObserved, true);
  assert.equal(report.serverTiming.healthSeconds, 123.45);
  assert(!f.calls.includes('owner-filter-speed-live.mjs')); assert(!f.calls.includes('browser-acceptance.mjs'));
  assert(!f.calls.includes('crm_access_boundary')); assert(f.calls.includes('japan-browser-acceptance.mjs'));
  assert(f.calls.indexOf('functional') < f.calls.indexOf('switch'));
  const accepted = await storage.read('accepted'), intent = await storage.read('intent');
  assert.equal(intent.value.status, 'committed'); assert.equal(accepted.value.current.runtimeSha, nextSha);
  assert.deepEqual(accepted.value.rollback, f.current);
  const receipt = JSON.parse(Buffer.from(accepted.value.current.proof.hostReceiptBase64, 'base64'));
  assert.equal(receipt.acceptancePolicy, JAPAN_OBSERVED_TIMING_POLICY);
  assert.equal(receipt.browser.speedPassed, null); assert.equal(receipt.browser.speedGateRequired, false);
});

test('observational Japan timing never excuses a failed own-market functional gate or invented timing evidence', async t => {
  for (const mutation of [report => { report.japanCombinedFiltersPassed = false; },
    report => { report.japanPowerOrderPassed = false; }, report => { report.japanBrandDirectoryPassed = false; },
    report => { report.speedPassed = true; }, report => { report.speedGateRequired = true; },
    report => { report.timingObserved = false; }]) {
    const f = await fixture(t, {observedTiming: true}), {stage, input} = await reservedStage(f);
    f.flags.changeReport = mutation;
    await assert.rejects(stage.activate(input), /japan_(?:browser|timing)_binding/);
    assert(!f.calls.includes('accept')); await stage.close();
  }
});

for (const priceFlag of ['japanPriceSortRequired', 'japanPriceSortPassed', 'japanCountDisplayPassed'])
for (const value of [undefined, false, 1, 'true'])
test('B9 successor stops before host acceptance without boolean ' + priceFlag + ': ' + value, async t => {
  const f = await fixture(t, {priceSort: true}), {stage, input} = await reservedStage(f);
  f.flags.changeReport = report => { if (value === undefined) delete report[priceFlag]; else report[priceFlag] = value; };
  await assert.rejects(stage.activate(input), /china_daily_release_japan_browser_binding/);
  assert(!f.calls.includes('accept') && !f.calls.includes('browser_evidence'));
  await stage.close();
});

test('B9 sort/count successor commits both new functional proofs while preserving accepted data and rollback', async t => {
  const f = await fixture(t, {priceSort: true}), storage = memoryStorage(f.previous);
  f.flags.chinaBrowserFailure = true;
  const report = await runChinaCodeCycle({plan: {...f.servingPlan, minimumYear: 2014}, imageId: f.candidate.imageId,
    invocation: {version: 1, sourceSha: '9'.repeat(40)}, owner: {runId: '200', attempt: '1', revision: '9'.repeat(40)},
    nonce: 'b'.repeat(32), storage, now: () => acceptedAt, scheduleHeartbeat: () => () => {},
    stageCodeRelease: f.release.stageCodeRelease, recoverRelease: async () => assert.fail('no unresolved publication')});
  assert.equal(report.completed, true); assert.equal(report.status, 'accepted');
  assert.equal(report.speedGateRequired, false); assert.equal(report.speedPassed, null);
  const accepted = await storage.read('accepted');
  assert.equal(accepted.value.current.runtimeSha, nextSha);
  assert.equal(accepted.value.current.generationId, f.current.generationId);
  assert.equal(accepted.value.current.pricingRuntimeSha, f.current.pricingRuntimeSha);
  assert.deepEqual(accepted.value.rollback, f.current);
  assert.equal(f.current.runtimeSha, JAPAN_STABILITY_PRICE_SORT_RETAINED_RUNTIME);
  assert(!f.calls.includes('owner-filter-speed-live.mjs'));
});

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

for (const crmPhoto of [false, true])
test('CRM code publication proves source metadata and unsigned access before acceptance; photo=' + crmPhoto, async t => {
  const f = await fixture(t, {crm: true, crmPhoto});
  const {stage, input} = await reservedStage(f);
  assert.ok(f.calls.indexOf('code_preflight') < f.calls.indexOf('crm-china-status-proof.mjs'));
  assert.ok(f.calls.indexOf('crm-china-status-proof.mjs') < f.calls.indexOf('init'));
  const outcome = await stage.activate(input);
  assert.equal(outcome.kind, 'accepted');
  const expected = ['functional', 'speed', 'switch', 'owner-filter-speed-live.mjs', 'browser-acceptance.mjs',
    'crm_access_boundary', 'browser_evidence', 'accept'];
  for (let i = 1; i < expected.length; i++) assert.ok(f.calls.indexOf(expected[i-1]) < f.calls.indexOf(expected[i]));
  assert.ok(!f.calls.some(name => name.includes('japan-browser') || name === 'acceptance-oracle.mjs'));
  const details = JSON.parse(outcome.evidence.browserDetailsBytes);
  const raw = Buffer.from(details.crmChinaReportBase64, 'base64'), proof = JSON.parse(raw);
  assert.equal(hash(raw), details.crmChinaReportSha256); assert.equal(proof.codeScope, crmPhoto?CRM_JAPAN_PHOTO_CODE_SCOPE:CRM_CHINA_CODE_SCOPE);
  assert.equal(proof.sourceObservedAt, f.current.sourceObservedAt); assert.notEqual(proof.sourceObservedAt, acceptedAt);
  assert.equal(proof.rows, 283188); assert.equal(proof.unauthorizedStatus, 401); assert.equal(proof.signedInRequests, 0);
  assert.equal(proof.middlewareBoundaryPassed, true);
  assert.equal(proof.generationId, f.current.generationId);
  assert.deepEqual([...f.uploaded.keys()].sort(), ['acceptance.json', 'accepted-speed-baseline.json', 'image-receipt.json', 'image.tar', 'regcloud-performance-gate.py'].sort());
  await stage.close();
});

for (const failure of ['missing', 'failed', 'partial', 'extra'])
test('combined photo recovery refuses missing or invalid offline proof before host contact: ' + failure, async t => {
  const f = await fixture(t, {crmPhoto: true});
  if (failure === 'missing') await fs.unlink(f.photoFixturePath);
  else {
    const proof = JSON.parse(await fs.readFile(f.photoFixturePath));
    if (failure === 'failed') proof.checks.transientRecovery = false;
    else if (failure === 'partial') proof.caseCount = 11;
    else proof.unreviewed = true;
    await fs.writeFile(f.photoFixturePath, JSON.stringify(proof));
  }
  await assert.rejects(f.release.stageCodeRelease({candidate: f.candidate, previous: f.previous,
    nonce: 'b'.repeat(32), assertAuthority: async () => {}}));
  assert.ok(!f.calls.includes('code_preflight') && !f.calls.includes('init') && !f.calls.includes('switch'));
});

for (const crmPhoto of [false, true])
for (const failure of ['child_exit', 'wrong_rows', 'accepted_date', 'wrong_manifest', 'middleware_missing'])
test('CRM manifest refusal stops before host stage and reservation: ' + crmPhoto + '/' + failure, async t => {
  const f = await fixture(t, {crm: true, crmPhoto});
  if (failure === 'child_exit') f.flags.manifestExit = true;
  else if (failure === 'middleware_missing') f.flags.changeManifestProof = proof => { delete proof.middlewareBoundaryPassed; };
  else f.flags.changeManifestProof = proof => { proof[failure === 'wrong_rows' ? 'rows' : failure === 'accepted_date'
    ? 'sourceObservedAt' : 'generationManifestSha256'] = failure === 'wrong_rows' ? 1 : failure === 'accepted_date' ? acceptedAt : '0'.repeat(64); };
  await assert.rejects(f.release.stageCodeRelease({candidate: f.candidate, previous: f.previous, nonce: 'b'.repeat(32), assertAuthority: async () => {}}), /china_(?:daily_release_crm_manifest_failed|crm_status_manifest_proof)/);
  assert.ok(!f.calls.includes('init') && !f.calls.includes('switch') && !f.calls.includes('accept'));
});

for (const crmPhoto of [false, true])
for (const failure of ['accessFailure', 'status200', 'route403', 'wrong_body', 'cookie_present', 'unexpected_private_field'])
test('CRM boundary failure cannot produce ACCEPTED: ' + crmPhoto + '/' + failure, async t => {
  const f = await fixture(t, {crm: true, crmPhoto});
  const {stage, input} = await reservedStage(f);
  if (failure === 'accessFailure') f.flags.accessFailure = true;
  else f.flags.accessChange = failure === 'status200' ? {unauthorizedStatus: 200} : failure === 'route403'
    ? {unauthorizedStatus: 403} : failure === 'wrong_body' ? {unauthorizedBodyIsAuthRequired: false}
    : failure === 'cookie_present' ? {unauthorizedSetCookieAbsent: false} : {body: 'PRIVATE_RESPONSE'};
  await assert.rejects(stage.activate(input), /china_crm_status_(?:unauthorized_boundary|evidence)/);
  assert.ok(!f.calls.includes('browser_evidence') && !f.calls.includes('accept'));
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

for(const scope of ['catalog-japan-completion-v1','catalog-japan-completion-v2',usabilityScope]){
test(scope+' requires its live UI/detail/calculation evidence after unchanged China gates',async t=>{
  const f=await fixture(t,{completion:scope}),{stage,input}=await reservedStage(f);
  const result=await stage.activate(input);assert.equal(result.kind,'accepted');
  const sequence=['functional','speed','switch','owner-filter-speed-live.mjs','browser-acceptance.mjs',
    'japan-browser-acceptance.mjs','browser_evidence','accept'];
  for(let index=1;index<sequence.length;index++)assert.ok(f.calls.indexOf(sequence[index-1])<f.calls.indexOf(sequence[index]));
  const details=JSON.parse(result.evidence.browserDetailsBytes),report=JSON.parse(Buffer.from(details.japanReportBase64,'base64'));
  assert.equal(report.codeScope,scope);assert.equal(report.japanPreviewCalculationRequests,1);
  assert.equal(report.productionMutations,0);assert.equal(report.japanDeliveredCalculationPassed,true);
  if(scope===usabilityScope){
    assert.equal(f.current.runtimeSha,JAPAN_USABILITY_RETAINED_RUNTIME);
    for(const flag of usabilityFlags)assert.equal(report[flag],true);
  }
  assert.deepEqual(JSON.parse(f.uploaded.get('acceptance.json')),{...f.oracle,runtimeSha:nextSha});
  await stage.close();
});

for(const [field,value] of [
  ['codeScope','catalog-japan-recovery-v1'],['japanPetrolPowerUiPassed',false],['japanDetailPowerInputPassed',false],
  ['codeScope',scope==='catalog-japan-completion-v1'?'catalog-japan-completion-v2':'catalog-japan-completion-v1'],
  ['japanDeliveredCalculationPassed',false],['japanPreviewCalculationRequests',0],['japanPreviewCalculationRequests',3],
  ['japanPreviewCalculationRequests',true],['japanPreviewCalculationRequests','1'],['japanPreviewCalculationRequests',undefined],
  ['productionMutations',1],['directSupplierApiRequests',1],['japanPowerApiPassed',false],['japanVisibilityPassed',false],
])test(scope+' rejects missing or invalid '+field+'='+value+' before host evidence',async t=>{
  const f=await fixture(t,{completion:scope});f.flags.changeReport=report=>{report[field]=value;};
  const {stage,input}=await reservedStage(f);
  await assert.rejects(stage.activate(input),/china_daily_release_japan_browser_binding/);
  assert.equal(f.calls.includes('browser_evidence'),false);assert.equal(f.calls.includes('accept'),false);await stage.close();
});

for(const flag of ['functionalFailure','chinaBrowserFailure'])
test(scope+' cannot bypass retained China '+flag,async t=>{
  const f=await fixture(t,{completion:scope});f.flags[flag]=true;
  if(flag==='functionalFailure')await assert.rejects(reservedStage(f),/china_daily_release_functional/);
  else{const {stage,input}=await reservedStage(f);await assert.rejects(stage.activate(input));await stage.close();}
  assert.equal(f.calls.includes('japan-browser-acceptance.mjs'),false);assert.equal(f.calls.includes('accept'),false);
});
}

const usabilityRequiredFlags=['passed','japanFreshnessPassed','japanPowerApiPassed','japanUiPassed','japanVisibilityPassed',
  'readOnlyBrowserFence','japanPetrolPowerUiPassed','japanDetailPowerInputPassed','japanDeliveredCalculationPassed',...usabilityFlags];
for(const field of usabilityRequiredFlags)for(const value of [undefined,false,1,'true'])
test(usabilityScope+' requires an exact true boolean for '+field+'='+JSON.stringify(value),async t=>{
  const f=await fixture(t,{completion:usabilityScope});f.flags.changeReport=report=>{
    if(value===undefined)delete report[field];else report[field]=value;
  };
  const {stage,input}=await reservedStage(f);
  await assert.rejects(stage.activate(input),/china_daily_release_japan_browser_binding/);
  assert.equal(f.calls.includes('browser_evidence'),false);assert.equal(f.calls.includes('accept'),false);await stage.close();
});

for(const [field,value] of [
  ['codeScope','catalog-japan-completion-v2'],['version',2],['kind','wrong-kind'],['release',oldSha],['nonce','f'.repeat(32)],
  ['generationManifestSha256',hash('other manifest')],['oracleSha256',hash('other oracle')],
  ['checkedAt','2000-01-01T00:00:00Z'],['checkedAt','2999-01-01T00:00:00Z'],
  ['productionMutations',undefined],['productionMutations',false],['directSupplierApiRequests',undefined],['directSupplierApiRequests',false],
])test(usabilityScope+' retains exact report binding for '+field+'='+value,async t=>{
  const f=await fixture(t,{completion:usabilityScope});f.flags.changeReport=report=>{report[field]=value;};
  const {stage,input}=await reservedStage(f);
  await assert.rejects(stage.activate(input),/china_daily_release_japan_browser_binding/);
  assert.equal(f.calls.includes('browser_evidence'),false);assert.equal(f.calls.includes('accept'),false);await stage.close();
});

test(usabilityScope+' cannot be staged against a different retained runtime',async t=>{
  const f=await fixture(t,{completion:usabilityScope});
  assert.throws(()=>checkedCatalogCodeScope({...f.servingPlan,retainedRuntime:oldSha}),/china_photo_scope_retained_runtime/);
  f.servingPlan.retainedRuntime=oldSha;
  await assert.rejects(reservedStage(f),/china_daily_release_code_/);
  assert.equal(f.calls.includes('init'),false);assert.equal(f.calls.includes('switch'),false);assert.equal(f.calls.includes('accept'),false);
});

for(const failure of ['gateExit','missingReport','oversizedReport'])
test(usabilityScope+' rejects '+failure+' before host evidence',async t=>{
  const f=await fixture(t,{completion:usabilityScope});
  if(failure==='oversizedReport')f.flags.changeReport=report=>{report.padding='x'.repeat(128*1024);};else f.flags[failure]=1;
  const {stage,input}=await reservedStage(f);await assert.rejects(stage.activate(input));
  assert.equal(f.calls.includes('browser_evidence'),false);assert.equal(f.calls.includes('accept'),false);await stage.close();
});

test('pagination24 preserves the accepted a5ca image lineage and composes CRM, photo and Japan evidence',async t=>{
  const f=await fixture(t,{pagination:true}),{stage,input}=await reservedStage(f);
  assert.equal(f.servingPlan.retainedRuntime,JAPAN_PAGINATION_RETAINED_RUNTIME);
  assert.equal(Object.hasOwn(f.imageReceipt,'protectedPathExceptions'),false);
  const outcome=await stage.activate(input);assert.equal(outcome.kind,'accepted');
  const details=JSON.parse(outcome.evidence.browserDetailsBytes);
  for(const key of ['crmChina','japanPhotoRetry','japan']){
    const raw=Buffer.from(details[key+'ReportBase64'],'base64'),report=JSON.parse(raw);
    assert.equal(hash(raw),details[key+'ReportSha256']);assert.equal(report.codeScope,JAPAN_PAGINATION_CODE_SCOPE);
    assert.equal(report.nonce,'b'.repeat(32));assert.equal(report.release,nextSha);
  }
  assert.ok(f.calls.indexOf('crm_access_boundary')<f.calls.indexOf('japan-browser-acceptance.mjs'));
  assert.ok(f.calls.indexOf('japan-browser-acceptance.mjs')<f.calls.indexOf('browser_evidence'));
  assert.ok(f.calls.indexOf('browser_evidence')<f.calls.indexOf('accept'));
  assert.ok(!f.calls.includes('acceptance-oracle.mjs'));await stage.close();
});

for(const flag of ['japanFullPagesPassed','japanPagination24Passed','japanCatalogWarningRemovedPassed','japanFreshnessPassed','japanPetrolPowerUiPassed',
  'japanDetailPowerInputPassed','japanDeliveredCalculationPassed'])
test('pagination24 refuses an incomplete live acceptance flag: '+flag,async t=>{
  const f=await fixture(t,{pagination:true}),{stage,input}=await reservedStage(f);
  f.flags.changeReport=report=>{report[flag]=false;};
  await assert.rejects(stage.activate(input),/china_daily_release_japan_browser_binding/);
  assert.ok(!f.calls.includes('accept')&&!f.calls.includes('browser_evidence'));await stage.close();
});

for(const failure of ['missing','failed'])
test('pagination24 requires its own offline actual-component fixture before host contact: '+failure,async t=>{
  const f=await fixture(t,{pagination:true});
  if(failure==='missing')await fs.unlink(f.paginationFixturePath);
  else {const report=JSON.parse(await fs.readFile(f.paginationFixturePath));report.checks.sourcePageSize24=false;
    await fs.writeFile(f.paginationFixturePath,JSON.stringify(report));}
  await assert.rejects(f.release.stageCodeRelease({candidate:f.candidate,previous:f.previous,nonce:'b'.repeat(32),assertAuthority:async()=>{}}),
    /^Error: china_daily_release_stage_failed$/);
  assert.ok(!f.calls.includes('code_preflight')&&!f.calls.includes('init')&&!f.calls.includes('switch'));
});

test('pagination24 cannot borrow the old CRM protected-path exemption',async t=>{
  const f=await fixture(t,{pagination:true});
  const file=path.join(f.directory,'china-release-build','image-receipt.json');
  await fs.writeFile(file,JSON.stringify({...f.imageReceipt,protectedPathExceptions:[...CRM_CHINA_PROTECTED_EXCEPTIONS]}));
  await assert.rejects(f.release.stageCodeRelease({candidate:f.candidate,previous:f.previous,nonce:'b'.repeat(32),assertAuthority:async()=>{}}),
    /china_daily_release_pagination_image_scope/);
  assert.ok(!f.calls.includes('init')&&!f.calls.includes('switch'));
});

test('pagination24 cannot accept an omitted live warning-removal proof',async t=>{
  const f=await fixture(t,{pagination:true}),{stage,input}=await reservedStage(f);
  f.flags.changeReport=report=>{delete report.japanCatalogWarningRemovedPassed;};
  await assert.rejects(stage.activate(input),/china_daily_release_japan_browser_binding/);
  assert.ok(!f.calls.includes('accept')&&!f.calls.includes('browser_evidence'));await stage.close();
});

test('stability publication composes unchanged China, CRM, photo, pagination and all new live proofs',async t=>{
  const f=await fixture(t,{stability:true}),{stage,input}=await reservedStage(f);
  assert.equal(f.servingPlan.retainedRuntime,JAPAN_STABILITY_RETAINED_RUNTIME);
  assert.equal(Object.hasOwn(f.imageReceipt,'protectedPathExceptions'),false);
  const outcome=await stage.activate(input);assert.equal(outcome.kind,'accepted');
  const details=JSON.parse(outcome.evidence.browserDetailsBytes);
  for(const key of ['crmChina','japanPhotoRetry','japan']){
    const raw=Buffer.from(details[key+'ReportBase64'],'base64'),report=JSON.parse(raw);
    assert.equal(hash(raw),details[key+'ReportSha256']);assert.equal(report.codeScope,JAPAN_STABILITY_CODE_SCOPE);
    assert.equal(report.nonce,'b'.repeat(32));assert.equal(report.release,nextSha);
    if(key==='japan')for(const flag of [...JAPAN_STABILITY_GATES,'japanFreshnessPassed','japanFullPagesPassed',
      'japanPagination24Passed','japanCatalogWarningRemovedPassed','japanDeliveredCalculationPassed'])assert.equal(report[flag],true);
  }
  assert.deepEqual(JSON.parse(f.uploaded.get('acceptance.json')),{...f.oracle,runtimeSha:nextSha});
  assert.ok(f.calls.indexOf('speed')<f.calls.indexOf('switch'));
  assert.ok(f.calls.indexOf('crm_access_boundary')<f.calls.indexOf('japan-browser-acceptance.mjs'));
  assert.ok(f.calls.indexOf('japan-browser-acceptance.mjs')<f.calls.indexOf('browser_evidence'));
  assert.ok(f.calls.indexOf('browser_evidence')<f.calls.indexOf('accept'));
  assert.ok(!f.calls.includes('acceptance-oracle.mjs'));await stage.close();
});

for(const flag of JAPAN_STABILITY_GATES)for(const missing of [false,true])
test('stability refuses '+(missing?'missing':'failed')+' '+flag+' before host acceptance',async t=>{
  const f=await fixture(t,{stability:true}),{stage,input}=await reservedStage(f);
  f.flags.changeReport=report=>{if(missing)delete report[flag];else report[flag]=false;};
  await assert.rejects(stage.activate(input),/china_daily_release_japan_browser_binding/);
  assert.ok(!f.calls.includes('accept')&&!f.calls.includes('browser_evidence'));await stage.close();
});

for(const failure of ['missing','failed','duplicate'])
test('stability requires its actual source-directory fixture before any host contact: '+failure,async t=>{
  const f=await fixture(t,{stability:true});
  if(failure==='missing')await fs.unlink(f.directoryFixturePath);
  else{
    const report=JSON.parse(await fs.readFile(f.directoryFixturePath));
    if(failure==='failed')report.cases[0].passed=false;else report.cases[1]=report.cases[0];
    await fs.writeFile(f.directoryFixturePath,JSON.stringify(report));
  }
  await assert.rejects(f.release.stageCodeRelease({candidate:f.candidate,previous:f.previous,nonce:'b'.repeat(32),assertAuthority:async()=>{}}),
    /^Error: china_daily_release_stage_failed$/);
  assert.ok(!f.calls.includes('code_preflight')&&!f.calls.includes('init')&&!f.calls.includes('switch'));
});

async function exactFailedCodePublication(f) {
  const absent = {found: false, etag: null, sha256: null, value: null}, token = 'c'.repeat(32);
  const storage = memoryStorage(f.previous), state = createChinaState({storage, now: () => acceptedAt});
  const lease = await state.acquireLease({previous: absent, owner: f.current.owner, nonce: token, expiresAt: '2026-11-25T10:00:00Z'});
  const reserved = await state.reserve({lease, previous: f.previous, previousIntent: absent, candidate: f.candidate, transition: 'code-update'});
  const ref = f.candidate, raw = Buffer.from(JSON.stringify({version: 1, kind: 'china-host-rollback-v1',
    nonce: token, release: ref.runtimeSha, pricingRuntimeSha: ref.pricingRuntimeSha, generationId: ref.generationId,
    generationManifestSha256: ref.generationManifestSha256, privateGenerationReceiptSha256: ref.receiptSha256,
    sourceDescriptorSha256: ref.sourceDescriptorSha256, imageId: ref.imageId,
    previousAcceptedETag: f.previous.etag, previousAcceptedStateSha256: f.previous.sha256, rolledBackAt: acceptedAt,
    retainedContainerId: '8'.repeat(64), retainedRuntimeSha: f.current.runtimeSha, retainedImageId: f.current.imageId,
    retainedRunning: true, ingressRestored: true, candidateRemoved: true}));
  const publication = await state.abortReserved({lease, ...reserved, evidence: {
    hostRollbackBase64: raw.toString('base64'), hostRollbackSha256: hash(raw)}});
  return {publication, storage, state, lease};
}

for(const profile of ['ui','powerOrder','brandDirectory'])
test('the exact '+profile+' successor requires its complete browser evidence before host contact',async t=>{
  const f=await fixture(t,{[profile]:true});
  const {stage,input}=await reservedStage(f);
  const outcome=await stage.activate(input);
  assert.equal(outcome.kind,'accepted');
  assert.ok(f.calls.includes('code_preflight')&&f.calls.includes('accept'));
  await stage.close();
});

for(const value of [undefined,false,1,'true'])
test('ordered power cannot borrow a live proof without its exact boolean order verdict: '+String(value),async t=>{
  const f=await fixture(t,{powerOrder:true}),{stage,input}=await reservedStage(f);
  f.flags.changeReport=report=>{if(value===undefined)delete report.japanPowerOrderPassed;else report.japanPowerOrderPassed=value;};
  await assert.rejects(stage.activate(input),/china_daily_release_japan_browser_binding/);
  assert.ok(!f.calls.includes('accept')&&!f.calls.includes('browser_evidence'));await stage.close();
});

for(const failure of ['legacy','failed-order','failed-budget','failed-reset','short'])
test('ordered power cannot publish with missing or incomplete v2 proof: '+failure,async t=>{
  const f=await fixture(t,{powerOrder:true});
  const proof=JSON.parse(await fs.readFile(f.paginationFixturePath));
  if(failure==='legacy'){
    proof.version=1;proof.kind='japan-pagination24-browser-v1';proof.caseCount=8;
    for(const name of ['knownBeforeUnknown','boundedKnownContinuation','evidenceEpochReset'])delete proof.checks[name];
  }else if(failure==='short')proof.caseCount=11;
  else proof.checks[{'failed-order':'knownBeforeUnknown','failed-budget':'boundedKnownContinuation','failed-reset':'evidenceEpochReset'}[failure]]=false;
  await fs.writeFile(f.paginationFixturePath,JSON.stringify(proof));
  await assert.rejects(f.release.stageCodeRelease({candidate:f.candidate,previous:f.previous,nonce:'b'.repeat(32),assertAuthority:async()=>{}}),
    /^Error: china_daily_release_stage_failed$/);
  assert.ok(!f.calls.includes('code_preflight')&&!f.calls.includes('init')&&!f.calls.includes('switch'));
});

for(const profile of ['ui','powerOrder','brandDirectory'])for(const failure of ['legacy','failed','duplicate'])
test(profile+' refuses a downgraded or incomplete raw source-name fixture: '+failure,async t=>{
  const f=await fixture(t,{[profile]:true}),proof=JSON.parse(await fs.readFile(f.directoryFixturePath));
  if(failure==='legacy')proof.cases=proof.cases.filter(row=>!['raw-source-selection','typed-source-make-aliases'].includes(row.name));
  else if(failure==='failed')proof.cases.find(row=>row.name==='raw-source-selection').passed=false;
  else proof.cases[proof.cases.length-1]=proof.cases[0];
  await fs.writeFile(f.directoryFixturePath,JSON.stringify(proof));
  await assert.rejects(f.release.stageCodeRelease({candidate:f.candidate,previous:f.previous,nonce:'b'.repeat(32),assertAuthority:async()=>{}}),
    /^Error: china_daily_release_stage_failed$/);
  assert.ok(!f.calls.includes('code_preflight')&&!f.calls.includes('init')&&!f.calls.includes('switch'));
});

for(const flag of ['japanBrandDirectoryPassed','japanPowerOrderPassed'])for(const value of [undefined,false,1,'true'])
test('complete Japan directory cannot publish without '+flag+' boolean proof: '+String(value),async t=>{
  const f=await fixture(t,{brandDirectory:true}),{stage,input}=await reservedStage(f);
  f.flags.changeReport=report=>{if(value===undefined)delete report[flag];else report[flag]=value;};
  await assert.rejects(stage.activate(input),/china_daily_release_japan_browser_binding/);
  assert.ok(!f.calls.includes('accept')&&!f.calls.includes('browser_evidence'));await stage.close();
});

for(const failure of ['old-profile','missing-case','failed-case','duplicate-case'])
test('complete Japan directory requires visible fallback and retry fixture before host contact: '+failure,async t=>{
  const f=await fixture(t,{brandDirectory:true}),proof=JSON.parse(await fs.readFile(f.directoryFixturePath));
  if(failure==='old-profile')proof.cases=proof.cases.filter(row=>!row.name.includes('visible-and-retry'));
  else if(failure==='missing-case')proof.cases.pop();
  else if(failure==='failed-case')proof.cases.find(row=>row.name==='brand-directory-fresh-empty-visible-and-retry').passed=false;
  else proof.cases[proof.cases.length-1]=proof.cases[0];
  await fs.writeFile(f.directoryFixturePath,JSON.stringify(proof));
  await assert.rejects(f.release.stageCodeRelease({candidate:f.candidate,previous:f.previous,nonce:'b'.repeat(32),assertAuthority:async()=>{}}),
    /^Error: china_daily_release_stage_failed$/);
  assert.ok(!f.calls.includes('code_preflight')&&!f.calls.includes('init')&&!f.calls.includes('switch'));
});

test('terminal app-image adapter refreshes exact resolved authority between prepare and one removal without source/build calls', async t => {
  const f = await fixture(t), {publication, storage, state, lease} = await exactFailedCodePublication(f);
  const saved = copy(publication); let reads = 0, assertions = 0, actualLease = lease;
  const result = await f.release.retireTerminalAppImage({publication,
    readState: async () => { reads++; return {accepted: await storage.read('accepted'), intent: await storage.read('intent')}; },
    assertAuthority: async () => {
      assertions++;
      if (assertions === 5) actualLease = await state.renewLease({lease: actualLease, expiresAt: '2026-11-25T11:00:00Z'});
    }});
  assert.equal(result.completed, true); assert.equal(result.imagesRemoved, 1); assert.equal(result.measuredFreeBytesChange, 75);
  assert.equal(result.runtimeSha, f.candidate.runtimeSha); assert.equal(result.witnessSha256, digest(publication));
  assert.equal(reads, 5); assert.equal(assertions, 10); assert.equal(f.flags.imageDeletes, 1);
  assert.deepEqual(f.calls, ['retire_terminal_app_image', 'retire_terminal_app_image', 'close']);
  assert.deepEqual(publication, saved); assert.notEqual(actualLease.etag, lease.etag);
  assert.deepEqual({accepted: await storage.read('accepted'), intent: await storage.read('intent')}, publication);
  assert.equal(f.uploaded.size, 0);
});

for (const failure of ['authority_changed', 'wrong_target'])
test('terminal image adapter refuses ' + failure + ' before removal and keeps the terminal witness', async t => {
  const f = await fixture(t), {publication, storage} = await exactFailedCodePublication(f);
  let changed = false;
  f.flags.imageWrongTarget = failure === 'wrong_target';
  f.flags.imagePrepare = () => { changed = failure === 'authority_changed'; };
  await assert.rejects(f.release.retireTerminalAppImage({publication,
    readState: async () => changed ? {...publication, accepted: {...publication.accepted, etag: '"changed"'}} : copy(publication),
    assertAuthority: async () => {}}), error => {
      assert.equal(error.appImageCleanup.completed, false); assert.equal(error.appImageCleanup.uncertain, false);
      assert.equal(error.appImageCleanup.errorCode, failure === 'wrong_target' ? 'proof_invalid' : 'authority_unavailable'); return true;
    });
  assert.equal(f.flags.imageDeletes ?? 0, 0); assert.equal(f.calls.includes('close'), false);
  assert.deepEqual(await storage.read('intent'), publication.intent);
});

test('lost terminal-image DELETE reply remains pending; exact retry can confirm absence without a second removal', async t => {
  const f = await fixture(t), {publication, storage} = await exactFailedCodePublication(f);
  const input = {publication, readState: async () => copy(publication), assertAuthority: async () => {}};
  f.flags.imageLostDelete = true;
  await assert.rejects(f.release.retireTerminalAppImage(input), error => {
    assert.deepEqual(error.appImageCleanup, {version: 1, kind: 'china-terminal-app-image-cleanup-v1',
      completed: false, status: 'pending', uncertain: true, errorCode: 'transport_unknown'}); return true;
  });
  assert.equal(f.flags.imageDeletes, 1); assert.deepEqual(await storage.read('intent'), publication.intent);
  f.flags.imageAbsent = true; f.flags.imageLostDelete = false;
  const result = await f.release.retireTerminalAppImage(input);
  assert.equal(result.status, 'already_absent'); assert.equal(result.imagesRemoved, 0);
  assert.equal(result.measuredFreeBytesChange, 0); assert.equal(f.flags.imageDeletes, 1);
  assert.deepEqual(await storage.read('intent'), publication.intent);
});

for (const exactFlag of ['japanExactCountRequired', 'japanExactCountPassed', 'japanModelCoveragePassed'])
for (const value of [undefined, false, 1, 'true'])
test('20fd successor cannot accept a missing or nonboolean ' + exactFlag + ': ' + value, async t => {
  const f = await fixture(t, {exactCount: true}), {stage, input} = await reservedStage(f);
  f.flags.changeReport = report => { if (value === undefined) delete report[exactFlag]; else report[exactFlag] = value; };
  await assert.rejects(stage.activate(input), /china_daily_release_japan_browser_binding/);
  assert(!f.calls.includes('accept') && !f.calls.includes('browser_evidence'));
  await stage.close();
});

test('20fd exact count successor preserves generation, pricing and retained image through accepted state', async t => {
  const f = await fixture(t, {exactCount: true}), storage = memoryStorage(f.previous);
  f.flags.chinaBrowserFailure = true;
  const report = await runChinaCodeCycle({plan: {...f.servingPlan, minimumYear: 2014}, imageId: f.candidate.imageId,
    invocation: {version: 1, sourceSha: '9'.repeat(40)}, owner: {runId: '200', attempt: '1', revision: '9'.repeat(40)},
    nonce: 'b'.repeat(32), storage, now: () => acceptedAt, scheduleHeartbeat: () => () => {},
    stageCodeRelease: f.release.stageCodeRelease, recoverRelease: async () => assert.fail('no unresolved publication')});
  assert.equal(report.completed, true); assert.equal(report.status, 'accepted');
  assert.equal(report.speedGateRequired, false); assert.equal(report.speedPassed, null);
  const accepted = await storage.read('accepted');
  assert.equal(accepted.value.current.runtimeSha, nextSha);
  assert.equal(accepted.value.current.generationId, f.current.generationId);
  assert.equal(accepted.value.current.pricingRuntimeSha, f.current.pricingRuntimeSha);
  assert.deepEqual(accepted.value.rollback, f.current);
});

test('source-bounded successor commits live model evidence while retaining an explicit incomplete exact count', async t => {
  const f = await fixture(t, {incremental: true}), storage = memoryStorage(f.previous);
  const report = await runChinaCodeCycle({plan: {...f.servingPlan, minimumYear: 2014}, imageId: f.candidate.imageId,
    invocation: {version: 1, sourceSha: '9'.repeat(40)}, owner: {runId: '200', attempt: '1', revision: '9'.repeat(40)},
    nonce: 'b'.repeat(32), storage, now: () => acceptedAt, scheduleHeartbeat: () => () => {},
    stageCodeRelease: f.release.stageCodeRelease, recoverRelease: async () => assert.fail('no unresolved publication')});
  assert.equal(report.completed, true); assert.equal(report.status, 'accepted');
  assert.equal(report.published, true); assert.equal(report.speedPassed, null);
  const accepted = await storage.read('accepted'), intent = await storage.read('intent');
  assert.equal(intent.value.status, 'committed');
  assert.deepEqual(accepted.value.current, {...f.candidate, proof: accepted.value.current.proof});
  assert.deepEqual(accepted.value.rollback, f.current);
  assert.equal(Object.hasOwn(accepted.value.current, 'countAcceptance'), false,
    'the policy is retained in the authenticated proof without widening data identity');
  const receipt = JSON.parse(Buffer.from(accepted.value.current.proof.hostReceiptBase64, 'base64'));
  assert.equal(receipt.countAcceptance, JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY);
  assert.equal(receipt.browser.countAcceptance, receipt.countAcceptance);
  const browser = JSON.parse(await fs.readFile(path.join(f.directory, 'controller/catalog-next-japan-browser-report.json')));
  assert.equal(browser.countAcceptance, receipt.countAcceptance);
  assert.equal(browser.japanModelCoveragePassed, true);
  assert.equal(browser.japanExactCountRequired, false); assert.equal(browser.japanExactCountPassed, null);
  assert.equal(browser.japanPriceSortPassed, true); assert.equal(browser.japanCountDisplayPassed, true);
  assert.equal(browser.checks.modelCoverage.typedFamilyNotNarrowed, true);
  assert.equal(browser.checks.modelCoverage.accessiblePairs, 94);
  assert.deepEqual(JSON.parse(await fs.readFile(f.directoryFixturePath)).cases.length, 20);
});

for (const [name, change] of [
  ['missing policy', report => { delete report.countAcceptance; }],
  ['invented exact acceptance', report => { report.japanExactCountPassed = true; }],
  ['missing model requirement', report => { delete report.japanModelCoverageRequired; }],
  ['incomplete model directory', report => { report.checks.modelCoverage.accessiblePairs--; }],
  ['narrowed typed family', report => { report.checks.modelCoverage.typedFamilyNotNarrowed = false; }],
  ['stale source directory', report => { report.checks.modelCoverage.directory.stale = true; }],
  ['missing source proof', report => { delete report.checks.modelCoverage; }],
  ['failed price sort', report => { report.japanPriceSortPassed = false; }],
  ['failed existing filter gate', report => { report.japanCombinedFiltersPassed = false; }],
]) test('source-bounded stage rejects ' + name + ' before host acceptance', async t => {
  const f = await fixture(t, {incremental: true}), {stage, input} = await reservedStage(f);
  t.after(() => stage.close());
  f.flags.changeReport = change;
  await assert.rejects(stage.activate(input), /china_daily_release_japan_browser_binding/);
  assert(!f.calls.includes('accept') && !f.calls.includes('browser_evidence'));
});

function resealedJapanEvidence(evidence, change) {
  const speed = JSON.parse(evidence.browserSpeedBytes), details = JSON.parse(evidence.browserDetailsBytes);
  const receipt = JSON.parse(Buffer.from(evidence.hostReceiptBase64, 'base64'));
  change({speed, details, receipt});
  const speedBytes = Buffer.from(JSON.stringify(speed));
  Object.assign(details, {precedingSpeedReportSha256: hash(speedBytes), japanReportSha256: hash(speedBytes),
    japanReportBase64: speedBytes.toString('base64')});
  const detailsBytes = Buffer.from(JSON.stringify(details));
  Object.assign(receipt.browser, {speedReportSha256: hash(speedBytes), detailsReportSha256: hash(detailsBytes),
    reportSha256: hash(Buffer.concat([speedBytes, detailsBytes]))});
  const raw = Buffer.from(JSON.stringify(receipt));
  return {...evidence, browserSpeedBytes: speedBytes, browserDetailsBytes: detailsBytes,
    hostReceiptBase64: raw.toString('base64'), hostReceiptSha256: hash(raw)};
}

test('accepted state independently binds the incremental policy and preserves strict exact-count receipts', async t => {
  const f = await fixture(t, {incremental: true});
  const {stage, input, state, storage, lease} = await reservedStage(f);
  t.after(() => stage.close());
  const outcome = await stage.activate(input);
  const before = {accepted: await storage.read('accepted'), intent: await storage.read('intent')};
  for (const [name, change, expected] of [
    ['unknown host policy', ({receipt}) => { receipt.countAcceptance = 'unreviewed'; }, /count_acceptance_scope/],
    ['missing verdict policy', ({receipt}) => { delete receipt.browser.countAcceptance; }, /browser_binding/],
    ['missing speed policy', ({speed}) => { delete speed.countAcceptance; }, /count_acceptance_binding/],
    ['missing details policy', ({details}) => { delete details.countAcceptance; }, /count_acceptance_binding/],
    ['false exact claim', ({speed}) => { speed.japanExactCountPassed = true; }, /japan_source_bounded_binding/],
    ['missing live coverage', ({speed}) => { delete speed.checks.modelCoverage; }, /japan_source_bounded_binding/],
    ['source mismatch', ({speed}) => { speed.checks.modelCoverage.directory.pairsSha256 = hash('other source'); }, /japan_source_bounded_binding/],
    ['missing all price proofs', ({speed}) => {
      for (const key of ['japanPriceSortRequired', 'japanPriceSortPassed', 'japanCountDisplayPassed']) delete speed[key];
    }, /japan_price_sort_binding/],
    ['strict receipt with incomplete count', ({receipt, speed, details}) => {
      for (const value of [receipt, receipt.browser, speed, details]) delete value.countAcceptance;
    }, /japan_exact_count_binding/],
  ]) {
    const evidence = resealedJapanEvidence(outcome.evidence, change);
    await assert.rejects(state.commit({lease, intent: input.intent, reservation: input.reservation, evidence}), expected, name);
    assert.deepEqual({accepted: await storage.read('accepted'), intent: await storage.read('intent')}, before, name);
  }
  const committed = await state.commit({lease, intent: input.intent, reservation: input.reservation, evidence: outcome.evidence});
  assert.equal(committed.accepted.value.current.runtimeSha, nextSha);
  assert.deepEqual(committed.accepted.value.rollback, f.current);
});
