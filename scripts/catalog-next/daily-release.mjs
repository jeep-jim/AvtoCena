import fs from 'node:fs/promises';
import {createReadStream, createWriteStream} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {verifyFrozenSpeedBaselines} from '../verify-frozen-speed-baselines.mjs';
import {verifyServingCompatibility} from './serving-compatibility.mjs';
import {createPrivateChinaGenerationStorage} from './generation-storage.mjs';
import {restorePrivateChinaGeneration} from './private-generation.mjs';
import {openChinaSshSession, checkedServerSpeedReport, checkedHomePhaseTimingReport, checkedJapanServerTimingObservation,
  checkedTerminalAppImageCleanupReport, terminalAppImageCleanupPending} from './release-ssh.mjs';
import {verifyChinaPhotoCodeRuntime} from './photo-code-scope.mjs';
import {verifyChinaImageStorageProof} from './build-release-image.mjs';
import {CRM_CHINA_CODE_SCOPE, CRM_CHINA_PROTECTED_EXCEPTIONS} from './crm-china-code-scope.mjs';
import {CRM_JAPAN_PHOTO_CODE_SCOPE} from './crm-japan-photo-code-scope.mjs';
import {JAPAN_PAGINATION_CODE_SCOPE} from './japan-pagination-code-scope.mjs';
import {JAPAN_STABILITY_CODE_SCOPE, japanPowerOrderRequired, japanSourceNamesRequired, japanBrandDirectoryRequired, japanPriceSortRequired, japanExactCountRequired,
  japanSourceBoundedIncrementalRequired, japanLiteralFamilyRequired, japanSourceBoundedAcceptancePassed, JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY,
  JAPAN_OBSERVED_TIMING_POLICY, japanObservedTimingRequired} from './japan-stability-code-scope.mjs';
import {checkedCrmChinaManifestProof, checkedCrmChinaEvidence, verifyCrmChinaUnauthorizedAccess} from './crm-china-status-proof.mjs';
import {readJapanPhotoRetryFixture, checkedJapanPhotoRetryEvidence} from './japan-photo-retry-proof.mjs';
import {readJapanPaginationFixture} from './japan-pagination-fixture.mjs';
import {readJapanFilterDirectoryFixture} from './japan-filter-directory-proof.mjs';
import {validateChinaGenerationReference, validateChinaAcceptedState, validateChinaPublicationIntent,
  validateChinaCodeTransition, inspectChinaPublicationState} from './china-state.mjs';

const CALCULATION = '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90';
const HASH = /^[a-f0-9]{64}$/;
// An operating-space policy floor, not an estimate of Docker overhead. Image
// content-store and unpacked-snapshot bytes are reserved separately below.
const CODE_DISK_OPERATING_RESERVE = 2 * 1024 ** 3;
const names = Object.freeze(['GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json',
  'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson']);
const need = (value, code) => { if (!value) throw Error('china_daily_release_' + code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const equal = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const digest = value => hash(JSON.stringify(ordered(value)));
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size
  && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
async function seal(filename) {
  const before = await fs.lstat(filename);
  need(before.isFile() && !before.isSymbolicLink() && before.nlink === 1, 'file_type');
  const sum = createHash('sha256'); let size = 0;
  for await (const bytes of createReadStream(filename)) { size += bytes.length; sum.update(bytes); }
  need(size === before.size && sameFile(before, await fs.lstat(filename)), 'file_changed');
  return {bytes: size, sha256: sum.digest('hex')};
}
async function pack(filename, directory, name) {
  const raw = await seal(filename), packed = path.join(directory, name + '.gz');
  await pipeline(createReadStream(filename), createGzip({level: 6}), createWriteStream(packed, {mode: 0o600, flags: 'wx'}));
  const compressed = await seal(packed);
  need(equal(raw, await seal(filename)), 'pack_changed');
  return {packed, descriptor: {name, ...raw, compressedBytes: compressed.bytes, compressedSha256: compressed.sha256}};
}
async function runChild({root, script, args = [], env, cwd, timeout = 600000}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/run-node-with-resources.mjs'),
      '--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href, script, ...args],
    {cwd, env, stdio: ['ignore', 'pipe', 'pipe']});
    // Only bound, parsed aggregate reports may leave this process. A child
    // exception can contain private paths or a commercial record.
    child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(Error('china_daily_release_child_timeout')); }, timeout);
    child.once('error', () => { clearTimeout(timer); reject(Error('china_daily_release_child_start')); });
    child.once('close', code => { clearTimeout(timer); resolve(code); });
  });
}
async function health(runtimeSha) {
  const response = await fetch('https://avtocena.com/api/health', {cache: 'no-store', signal: AbortSignal.timeout(15000)});
  need(response.ok, 'health_status'); const value = await response.json();
  need(value.ok === true && value.releaseSha === runtimeSha && value.calculationVersion === CALCULATION, 'health_identity');
}
function decode(value) {
  need(typeof value === 'string' && value.length <= 350000, 'receipt_size');
  const bytes = Buffer.from(value, 'base64');
  need(bytes.length > 0 && bytes.length <= 256 * 1024 && bytes.toString('base64') === value, 'receipt_encoding');
  return bytes;
}

/** Authenticated host bytes remain private to the controller. The existing
 * immutable manifest/oracle and all seven local files must match the accepted
 * reference. Only the candidate UI revision may change in the reused oracle. */
export function checkedChinaCodePreflight(value, previous, runtimeSha, {includeManifestBytes = false} = {}) {
  const current = validateChinaGenerationReference(previous, {requireAccepted: true});
  need(value && HASH.test(value.previousPlanSha256 ?? '') && HASH.test(value.previousOracleSha256 ?? '')
    && /^[a-f0-9]{40}$/.test(runtimeSha ?? '') && runtimeSha !== current.runtimeSha, 'code_preflight');
  need(Array.isArray(value.generationFiles) && value.generationFiles.length === names.length
    && new Set(value.generationFiles.map(row => row?.name)).size === names.length
    && value.generationFiles.every(row => row && names.includes(row.name)
      && Number.isSafeInteger(row.bytes) && row.bytes > 0 && HASH.test(row.sha256 ?? '')
      && Number.isSafeInteger(row.compressedBytes) && row.compressedBytes > 0
      && HASH.test(row.compressedSha256 ?? '')), 'code_files');
  need(Number.isSafeInteger(value.generationBytes) && value.generationBytes > 0
    && value.generationBytes === value.generationFiles.reduce((total, row) => total + row.bytes, 0)
    && Number.isSafeInteger(value.availableDiskBytes) && value.availableDiskBytes >= 0, 'code_capacity_observation');
  const manifestRaw = decode(value.generationManifestBase64), oldOracleRaw = decode(value.acceptanceBase64);
  need(hash(manifestRaw) === current.generationManifestSha256
    && hash(oldOracleRaw) === value.previousOracleSha256, 'code_content_hash');
  const generation = JSON.parse(manifestRaw), oracle = JSON.parse(oldOracleRaw);
  need(generation.kind === 'china-local-generation-v1' && generation.market === 'china'
    && generation.generationId === current.generationId && generation.runtimeSha === current.pricingRuntimeSha
    && generation.prepared === true && generation.source?.supplierLatestVerified === true
    && generation.source.cursor === current.sourceCursor && generation.source.sourceObservedAt === current.sourceObservedAt
    && Number.isSafeInteger(generation.rows) && generation.rows > 0, 'code_manifest');
  need(value.generationFiles.find(row => row.name === 'GENERATION.json').sha256 === current.generationManifestSha256
    && value.generationFiles.find(row => row.name === 'GENERATION.json').bytes === manifestRaw.length, 'code_manifest_file');
  need(oracle.version === 1 && oracle.kind === 'local-native-reader-http-expectations-v1'
    && oracle.runtimeSha === current.runtimeSha && oracle.pricingRuntimeSha === current.pricingRuntimeSha
    && oracle.expectedGeneration === current.generationId && oracle.generationManifestSha256 === current.generationManifestSha256
    && oracle.syntheticExpectations === true && oracle.httpVerified === false
    && Array.isArray(oracle.cases) && oracle.cases.length >= 8 && oracle.cases.length <= 32
    && oracle.cases.every(row => typeof row?.name === 'string'
      && typeof row.path === 'string' && row.path.startsWith('/api/catalog/search?') && row.path.length <= 4096
      && Number.isSafeInteger(row.total) && row.total >= 0 && Array.isArray(row.ids) && row.ids.length <= 24
      && row.ids.every(id => /^[a-f0-9]{24}$/.test(id)) && Array.isArray(row.totalRub)
      && row.totalRub.length === row.ids.length && row.totalRub.every(price => price === null || Number.isFinite(price) && price >= 0)), 'code_oracle');
  return {previousPlanSha256: value.previousPlanSha256, previousOracleSha256: value.previousOracleSha256,
    generationBytes: value.generationBytes, availableDiskBytes: value.availableDiskBytes,
    generationFiles: value.generationFiles.map(row => ({...row})), generation,
    ...(includeManifestBytes ? {generationManifestBytes: manifestRaw} : {}),
    oracle: {...oracle, runtimeSha}};
}

/** Production SSH adapter for data-only updates of the already accepted image.
 * Test substitutions are in-process capabilities, never workflow inputs/env.
 * The first-release controller is neither imported nor modified. */
export function createChinaDailyRelease({root, servingRoot, pricingPlan, servingPlan, controllerSha, runnerTemp,
  environment = process.env, capabilities = {}, onProgress = () => {}}) {
  const defaults = {verifyCompatibility: verifyServingCompatibility, verifyBaselines: verifyFrozenSpeedBaselines,
    verifyCodeCompatibility: verifyChinaPhotoCodeRuntime,
    generationStorage: owner => createPrivateChinaGenerationStorage({owner, environment}),
    openSession: openChinaSshSession, runChild, health, verifyCrmAccess: verifyCrmChinaUnauthorizedAccess,
    async inspectSavedActiveStabilityFailure({env}) {
      const {inspectSavedActiveStabilityFailure} = await import('./japan-usability-saved-failure-20261126.mjs');
      return inspectSavedActiveStabilityFailure({env: {
        REGCLOUD_S3_ACCESS_KEY_ID: env.YC_OBJECT_STORAGE_ACCESS_KEY_ID,
        REGCLOUD_S3_SECRET_ACCESS_KEY: env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY,
      }});
    },
    async checkControl() {
      need(environment.JSON_STORAGE_DRIVER === 'object', 'storage_driver');
      const [{getJsonStorage}, {assertChinaFeedControl}] = await Promise.all([
        import('../../apps/web/lib/data.ts'), import('./refresh-china-source.mjs')]);
      assertChinaFeedControl(await getJsonStorage().readJson('catalog/operations/collection-controls-v1.json', null));
    }};
  need(capabilities && Object.keys(capabilities).every(key => Object.hasOwn(defaults, key) && typeof capabilities[key] === 'function'), 'capabilities');
  const use = {...defaults, ...capabilities}, privateKey = environment.SSH_PRIVATE_KEY;
  need([root, servingRoot, runnerTemp].every(value => typeof value === 'string' && path.isAbsolute(value))
    && /^[a-f0-9]{40}$/.test(controllerSha ?? '') && typeof onProgress === 'function', 'arguments');
  const verifyRuntime = async () => {
    use.verifyBaselines(root);
    const result = await use.verifyCompatibility({runtimeRoot: servingRoot, servingPlan, pricingPlan});
    need(result.runtimeSha === servingPlan.runtimeSha && result.pricingRuntimeSha === pricingPlan.runtimeSha
      && result.protectedPricingPathsUnchanged === true, 'runtime_binding');
  };
  const progress = phase => onProgress({phase, market: 'china', applicationBuilds: 0});
  const childEnv = () => ({PATH: environment.PATH, NODE_ENV: 'production', JSON_STORAGE_DRIVER: 'local', TZ: 'Asia/Krasnoyarsk'});
  async function stop(session) { if (!session) return; session.abort(); await session.exited; }

  async function stage(mode, {candidate, previous, nonce, assertAuthority}) {
    const codeUpdate = mode === 'code-update';
    const observedJapanTiming = codeUpdate && japanObservedTimingRequired(servingPlan);
    const stabilityCodeUpdate = codeUpdate && servingPlan.codeScope === JAPAN_STABILITY_CODE_SCOPE;
    const paginationCodeUpdate = codeUpdate && (servingPlan.codeScope === JAPAN_PAGINATION_CODE_SCOPE || stabilityCodeUpdate);
    const photoRetryCodeUpdate = codeUpdate && (servingPlan.codeScope === CRM_JAPAN_PHOTO_CODE_SCOPE || paginationCodeUpdate);
    const crmCodeUpdate = codeUpdate && (servingPlan.codeScope === CRM_CHINA_CODE_SCOPE || photoRetryCodeUpdate);
    const crmProtectedException = codeUpdate && [CRM_CHINA_CODE_SCOPE, CRM_JAPAN_PHOTO_CODE_SCOPE].includes(servingPlan.codeScope);
    candidate = validateChinaGenerationReference(candidate);
    need(!candidate.proof && previous?.found === true && typeof assertAuthority === 'function'
      && /^[a-f0-9]{32}$/.test(nonce ?? ''), 'stage_arguments');
    const prior = validateChinaAcceptedState(previous.value);
    need(prior.current && prior.pending === null && /^"[^"\x00-\x20\x7f]{1,250}"$/.test(previous.etag ?? '')
      && digest(prior) === previous.sha256, 'previous_state');
    if (codeUpdate) {
      validateChinaCodeTransition(candidate, prior.current);
      need(candidate.runtimeSha === servingPlan.runtimeSha && prior.current.runtimeSha === servingPlan.retainedRuntime
        && candidate.pricingRuntimeSha === pricingPlan.runtimeSha, 'code_plan');
      const checked = await use.verifyCodeCompatibility({runtimeRoot: servingRoot, servingPlan, pricingPlan});
      need(checked.frozenHttpOracleReusable === true && checked.retainedRuntime === prior.current.runtimeSha, 'code_scope');
    } else need(candidate.runtimeSha === prior.current.runtimeSha && candidate.imageId === prior.current.imageId
        && candidate.pricingRuntimeSha === prior.current.pricingRuntimeSha && candidate.runtimeSha === servingPlan.runtimeSha
        && candidate.pricingRuntimeSha === pricingPlan.runtimeSha && candidate.generationId !== prior.current.generationId, 'retained_image');
    const guard = async () => { await assertAuthority(); await use.checkControl(); };
    await verifyRuntime(); await guard(); await use.health(prior.current.runtimeSha);
    const temporary = await fs.realpath(runnerTemp), directory = await fs.mkdtemp(path.join(temporary, 'china-daily-release-'));
    let session, activated = false, closed = false, acceptedReceiptSha256;
    try {
      let codePreflight, codeImageStorageProof, codeImageArchiveBytes, files, oracle, crmManifestProof, crmBinding;
      // The frozen candidate's offline browser fixture ran before its image
      // build. Missing/failed evidence stops this exact scope before host contact.
      if (paginationCodeUpdate) await readJapanPaginationFixture(path.join(temporary, 'japan-pagination24-browser-report.json'),
        {requirePowerOrder: japanPowerOrderRequired(servingPlan)});
      if (stabilityCodeUpdate) await readJapanFilterDirectoryFixture(path.join(temporary, 'japan-filter-directory-browser-report.json'),
        {requireSourceNames: japanSourceNamesRequired(servingPlan), requireVisibleFallback: japanBrandDirectoryRequired(servingPlan),
          requireLiteralFamily: japanLiteralFamilyRequired(servingPlan)});
      const photoRetryFixture = photoRetryCodeUpdate
        ? await readJapanPhotoRetryFixture(path.join(temporary, 'japan-photo-retry-browser-report.json')) : null;
      const oraclePath = path.join(directory, 'acceptance.json');
      if (codeUpdate) {
        await guard(); await progress('code_verify_accepted_host_files');
        session = await use.openSession({root, directory, privateKey});
        codePreflight = checkedChinaCodePreflight(await session.call('code_preflight', {previousAccepted: previous}),
          prior.current, candidate.runtimeSha, {includeManifestBytes: crmCodeUpdate});
        oracle = codePreflight.oracle;
        await fs.writeFile(oraclePath, JSON.stringify(oracle) + '\n', {mode: 0o600, flag: 'wx'});
        if (crmCodeUpdate) {
          await guard(); await progress('code_crm_manifest');
          const manifestDirectory = path.join(directory, 'crm-status-generation');
          await fs.mkdir(manifestDirectory, {mode: 0o700});
          await fs.writeFile(path.join(manifestDirectory, 'GENERATION.json'), codePreflight.generationManifestBytes,
            {mode: 0o400, flag: 'wx'});
          crmBinding = {runtimeSha: candidate.runtimeSha, pricingRuntimeSha: candidate.pricingRuntimeSha,
            generationManifestSha256: candidate.generationManifestSha256, generationId: candidate.generationId,
            sourceObservedAt: candidate.sourceObservedAt, rows: codePreflight.generation.rows};
          const bindingPath = path.join(directory, 'crm-status-binding.json'), proofPath = path.join(directory, 'crm-manifest-proof.json');
          await fs.writeFile(bindingPath, JSON.stringify(crmBinding) + '\n', {mode: 0o600, flag: 'wx'});
          need(await use.runChild({root, script: path.join(root, 'scripts/catalog-next/crm-china-status-proof.mjs'),
            args: ['--manifest', servingRoot, manifestDirectory, bindingPath, proofPath], env: childEnv(), cwd: directory}) === 0,
          'crm_manifest_failed');
          const proofRaw = await fs.readFile(proofPath);
          need(proofRaw.length <= 16 * 1024, 'crm_manifest_size');
          crmManifestProof = checkedCrmChinaManifestProof(JSON.parse(proofRaw), crmBinding);
          await guard(); await verifyRuntime();
        }
        const imageDirectory = path.join(temporary, 'china-release-build');
        const receiptPath = path.join(imageDirectory, 'image-receipt.json'), imagePath = path.join(imageDirectory, 'image.tar');
        const imageReceiptRaw = await fs.readFile(receiptPath), imageReceipt = JSON.parse(imageReceiptRaw), image = await seal(imagePath);
        need(imageReceipt.version === 1 && imageReceipt.kind === 'china-runtime-image-v1'
          && (imageReceipt.codeScope ?? 'catalog-photo-recovery-v1') === (servingPlan.codeScope ?? 'catalog-photo-recovery-v1')
          && imageReceipt.runtimeSha === candidate.runtimeSha && imageReceipt.runtimeTree === servingPlan.runtimeTree
          && imageReceipt.retainedRuntime === prior.current.runtimeSha && imageReceipt.runtimeDiffSha256 === servingPlan.runtimeDiffSha256
          && imageReceipt.pricingRuntimeSha === candidate.pricingRuntimeSha && imageReceipt.imageId === candidate.imageId
          && imageReceipt.acceptancePolicy === servingPlan.acceptancePolicy
          && imageReceipt.countAcceptance === servingPlan.countAcceptance
          && imageReceipt.sha256 === image.sha256 && imageReceipt.bytes === image.bytes
          && Number.isSafeInteger(imageReceipt.imageUnpackedBytes) && imageReceipt.imageUnpackedBytes > 0
          && imageReceipt.archiveRoundTripVerified === true && imageReceipt.privateDataIncluded === false
          && imageReceipt.protectedPathsUnchanged === true && imageReceipt.servingCompatibility?.protectedPricingPathsUnchanged === true,
        'code_image');
        if (crmProtectedException) need(equal(imageReceipt.protectedPathExceptions, CRM_CHINA_PROTECTED_EXCEPTIONS), 'crm_image_scope');
        if (paginationCodeUpdate) need(!Object.hasOwn(imageReceipt, 'protectedPathExceptions'), 'pagination_image_scope');
        const storagePath = path.join(imageDirectory, 'image-storage-proof.json');
        const storageRaw = await fs.readFile(storagePath), storageSeal = await seal(storagePath);
        need(storageRaw.length <= 16 * 1024 && storageRaw.length === storageSeal.bytes
          && hash(storageRaw) === storageSeal.sha256, 'code_storage_file');
        codeImageStorageProof = verifyChinaImageStorageProof(JSON.parse(storageRaw),
          {imageReceipt, imageReceiptSha256: hash(imageReceiptRaw)});
        codeImageArchiveBytes = image.bytes;
        files = {'image.tar': imagePath, 'image-receipt.json': receiptPath};
      } else {
        await progress('daily_restore_runtime_generation');
        const owner = {runId: candidate.owner.runId, attempt: candidate.owner.attempt, revision: candidate.owner.revision};
        const restored = await restorePrivateChinaGeneration({storage: await use.generationStorage(owner), owner,
        expectedReceiptSha256: candidate.receiptSha256, outputDirectory: path.join(directory, 'generation'), names,
        onProgress: value => onProgress({...value, market: 'china'})});
      const binding = restored.receipt.binding;
      need(binding?.market === 'china' && binding.runtimeSha === candidate.pricingRuntimeSha && binding.generationId === candidate.generationId
        && binding.generationManifestSha256 === candidate.generationManifestSha256
        && binding.sourceDescriptorSha256 === candidate.sourceDescriptorSha256, 'generation_binding');
      const generationRaw = await fs.readFile(restored.paths['GENERATION.json']), generation = JSON.parse(generationRaw);
      need(hash(generationRaw) === candidate.generationManifestSha256 && generation.kind === 'china-local-generation-v1'
        && generation.market === 'china' && generation.generationId === candidate.generationId && generation.runtimeSha === candidate.pricingRuntimeSha
        && generation.prepared === true && generation.source?.supplierLatestVerified === true && generation.rows > 0
        && generation.source.cursor === candidate.sourceCursor && generation.source.sourceObservedAt === candidate.sourceObservedAt, 'generation_manifest');
      await guard(); await progress('daily_actual_serving_oracle');
      need(await use.runChild({root, script: path.join(root, 'scripts/catalog-next/acceptance-oracle.mjs'),
        args: [servingRoot, path.join(directory, 'generation'), candidate.generationManifestSha256, oraclePath],
        env: childEnv(), cwd: directory}) === 0, 'oracle_failed');
        oracle = JSON.parse(await fs.readFile(oraclePath));
        files = restored.paths;
      }
      need(oracle.runtimeSha === candidate.runtimeSha && oracle.pricingRuntimeSha === candidate.pricingRuntimeSha
        && oracle.generationManifestSha256 === candidate.generationManifestSha256 && oracle.expectedGeneration === candidate.generationId
        && Array.isArray(oracle.cases) && oracle.cases.length >= 8, 'oracle_binding');
      files = {...files, 'acceptance.json': oraclePath,
        'regcloud-performance-gate.py': path.join(root, 'scripts/regcloud-performance-gate.py'),
        'accepted-speed-baseline.json': path.join(root, 'docs/operations/2026-11-11-accepted-speed-baseline.json')};
      const packed = [];
      for (const [name, filename] of Object.entries(files)) { await guard(); packed.push(await pack(filename, directory, name)); }
      if (codeUpdate) {
        let uploadedRaw = 0, uploadPeak = 0;
        for (const {descriptor} of packed) {
          uploadedRaw += descriptor.bytes;
          uploadPeak = Math.max(uploadPeak, uploadedRaw + descriptor.compressedBytes);
        }
        // The uploaded archive is already in uploadedRaw. Reserve the complete
        // measured content store and unpacked snapshot too, even when some of
        // this exact image may already be cached on the host.
        const imageStorageBytes = codeImageStorageProof.contentBytes + codeImageStorageProof.unpackedBytes;
        const neededBytes = Math.max(uploadPeak, uploadedRaw + codePreflight.generationBytes + imageStorageBytes)
          + CODE_DISK_OPERATING_RESERVE;
        need(Number.isSafeInteger(neededBytes) && codePreflight.availableDiskBytes >= neededBytes, 'code_disk_capacity');
        await onProgress({phase: 'code_capacity_checked', market: 'china',
          generationBytes: codePreflight.generationBytes, imageArchiveBytes: codeImageArchiveBytes,
          imageContentBytes: codeImageStorageProof.contentBytes, imageUnpackedBytes: codeImageStorageProof.unpackedBytes,
          operatingReserveBytes: CODE_DISK_OPERATING_RESERVE,
          availableDiskBytes: codePreflight.availableDiskBytes, neededBytes});
      }
      const plan = {version: 1, market: 'china', mode, retainedRuntime: prior.current.runtimeSha,
        runtimeSha: candidate.runtimeSha, pricingRuntimeSha: candidate.pricingRuntimeSha,
        runtimeTree: servingPlan.runtimeTree, runtimeDiffSha256: servingPlan.runtimeDiffSha256, controllerSha,
        servingCalculationVersion: CALCULATION, generationId: candidate.generationId,
        generationManifestSha256: candidate.generationManifestSha256, privateGenerationReceiptSha256: candidate.receiptSha256,
        sourceDescriptorSha256: candidate.sourceDescriptorSha256, imageId: candidate.imageId, nonce,
        previousAcceptedETag: previous.etag, previousAcceptedStateSha256: previous.sha256, previousAcceptedState: prior,
        files: [...(codePreflight?.generationFiles ?? []), ...packed.map(file => file.descriptor)],
        ...(codeUpdate ? {codeSourcePlanSha256: codePreflight.previousPlanSha256,
          codeSourceOracleSha256: codePreflight.previousOracleSha256,
          codeScope: servingPlan.codeScope ?? 'catalog-photo-recovery-v1', codeImageStorageProof,
          ...(japanSourceBoundedIncrementalRequired(servingPlan) ? {countAcceptance: JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY} : {}),
          ...(observedJapanTiming ? {acceptancePolicy: JAPAN_OBSERVED_TIMING_POLICY} : {})} : {})};
      await guard(); session ??= await use.openSession({root, directory, privateKey});
      const initialized = await session.call('init', {plan});
      if (!codeUpdate) {
        const admission = initialized?.generationDiskAdmission;
        const uploadedRawBytes = packed.reduce((sum, file) => sum + file.descriptor.bytes, 0);
        const largestCompressedBytes = Math.max(...packed.map(file => file.descriptor.compressedBytes));
        const requiredBytes = uploadedRawBytes + largestCompressedBytes + CODE_DISK_OPERATING_RESERVE;
        need(initialized?.initialized === true && admission?.kind === 'china-generation-disk-admission-v1'
          && admission.uploadedRawBytes === uploadedRawBytes && admission.largestCompressedBytes === largestCompressedBytes
          && admission.operatingReserveBytes === CODE_DISK_OPERATING_RESERVE && admission.requiredBytes === requiredBytes
          && Number.isSafeInteger(admission.availableDiskBytes) && admission.availableDiskBytes >= requiredBytes,
        'generation_disk_admission');
        await onProgress({phase: 'daily_disk_capacity_checked', market: 'china', ...admission});
      }
      for (const file of packed) { await guard(); const saved = await session.upload(file.descriptor.name, file.packed);
        need(saved?.verified === true && saved.file === file.descriptor.name && saved.bytes === file.descriptor.bytes, 'upload_readback'); }
      await guard(); const started = await session.call('start');
      need(started?.started === true && started.release === candidate.runtimeSha && started.generationId === candidate.generationId, 'start');
      const functional = await session.call('functional'); need(functional?.functionalPassed === true && functional.cases?.length >= 8, 'functional');
      await guard(); const speed = await session.call('speed');
      const serverTiming = observedJapanTiming ? checkedJapanServerTimingObservation(speed, {runtimeSha: candidate.runtimeSha, nonce}) : null;
      if (!observedJapanTiming) need(speed?.speedPassed === true, 'server_speed');
      await guard(); await progress('daily_candidate_checked');
      return {candidate, ...(observedJapanTiming ? {serverTiming} : {}),
        async activate({intent, reservation, assertAuthority: activeAuthority}) {
          need(!activated && !closed && typeof activeAuthority === 'function', 'activation_state');
          validateChinaPublicationIntent(intent?.value);
          need(inspectChinaPublicationState({accepted: reservation, intent}).status === 'reserved'
            && equal(intent.value.candidate, candidate) && intent.value.nonce === nonce
            && (codeUpdate ? intent.value.transition === 'code-update' : intent.value.transition === undefined)
            && intent.value.previous.etag === previous.etag && intent.value.previous.sha256 === previous.sha256, 'reservation_binding');
          activated = true;
          const activeGuard = async () => { await activeAuthority(); await use.checkControl(); };
          await activeGuard(); await verifyRuntime();
          const switched = await session.call('switch');
          need(switched?.switched === true && switched.release === candidate.runtimeSha && switched.nonce === nonce, 'switch');
          await use.health(candidate.runtimeSha);
          const browserDirectory = path.join(directory, 'browser'); await fs.mkdir(path.join(browserDirectory, 'docs/operations'), {recursive: true, mode: 0o700});
          await fs.copyFile(path.join(root, 'docs/operations/2026-11-11-accepted-browser-speed-baseline.json'),
            path.join(browserDirectory, 'docs/operations/2026-11-11-accepted-browser-speed-baseline.json'));
          const marker = path.join(browserDirectory, 'marker.json');
          await fs.writeFile(marker, JSON.stringify({release: candidate.runtimeSha,
            phase: observedJapanTiming ? 'independent-japan-functional' : 'independent-china-daily',
            verifyPartnerBudgets: false, enforceSpeed: !observedJapanTiming,
            ...(observedJapanTiming ? {timingPolicy: JAPAN_OBSERVED_TIMING_POLICY} : {})}), {mode: 0o600, flag: 'wx'});
          const browserEnv = {...childEnv(), CHROME_BIN: environment.CHROME_BIN, PLAYWRIGHT_MODULE: environment.PLAYWRIGHT_MODULE,
            OWNER_FILTER_BROWSER_MARKER: marker};
          const speedPath = path.join(browserDirectory, 'owner-filter-browser-report.json');
          const detailsPath = path.join(browserDirectory, 'china-browser-details-report.json');
          let speedRaw, detailsRaw, details;
          if (!observedJapanTiming) {
          need(await use.runChild({root, script: path.join(root, 'tests/browser/owner-filter-speed-live.mjs'), args: [], env: browserEnv,
            cwd: browserDirectory}) === 0, 'browser_speed_failed');
          speedRaw = await fs.readFile(speedPath);
          const browser = JSON.parse(speedRaw);
          need(speedRaw.length <= 256 * 1024 && browser.release === candidate.runtimeSha && browser.passed === true
            && browser.browserPassed === true && browser.speedGuard?.passed === true, 'browser_speed_binding');
          await activeGuard();
          need(await use.runChild({root, script: path.join(root, 'scripts/catalog-next/browser-acceptance.mjs'), args: [], cwd: browserDirectory,
            env: {...browserEnv, ORACLE_PATH: oraclePath, CHINA_RELEASE_SHA: candidate.runtimeSha, VERIFICATION_NONCE: nonce,
              OWNER_FILTER_BROWSER_REPORT: speedPath, CHINA_BROWSER_DETAILS_OUTPUT: detailsPath}}) === 0, 'browser_details_failed');
          detailsRaw = await fs.readFile(detailsPath);
          details = JSON.parse(detailsRaw);
          need(detailsRaw.length <= 256 * 1024 && details.kind === 'china-browser-details-v1' && details.passed === true
            && details.release === candidate.runtimeSha && details.nonce === nonce
            && details.generationManifestSha256 === candidate.generationManifestSha256
            && details.precedingSpeedReportSha256 === hash(speedRaw), 'browser_details_binding');
          } else {
            // The own-market report will be the actual timing evidence. No
            // successful broad browser benchmark is invented for this policy.
            details = {version: 1, kind: 'japan-code-browser-details-v1', passed: false,
              release: candidate.runtimeSha, nonce, generationManifestSha256: candidate.generationManifestSha256,
              timingPolicy: JAPAN_OBSERVED_TIMING_POLICY, speedGateRequired: false, speedPassed: null,
              timingObserved: false, retainedChinaOraclePassed: true, unrelatedBrowserBenchmarksExecuted: false,
              oracleSha256: hash(await fs.readFile(oraclePath)), serverTiming};
            detailsRaw = Buffer.from(JSON.stringify(details) + '\n');
          }
          if (crmCodeUpdate && !observedJapanTiming) {
            const crmStartedAt = Date.now();
            await activeGuard(); await verifyRuntime(); await use.health(candidate.runtimeSha);
            await progress('code_crm_access_boundary');
            checkedCrmChinaManifestProof(crmManifestProof, crmBinding);
            const access = await use.verifyCrmAccess();
            await use.health(candidate.runtimeSha); await activeGuard();
            const crm = checkedCrmChinaEvidence({version: 1, kind: 'china-crm-operations-proof-v1',
              codeScope: servingPlan.codeScope, release: candidate.runtimeSha, nonce, checkedAt: new Date().toISOString(),
              pricingRuntimeSha: candidate.pricingRuntimeSha, generationManifestSha256: candidate.generationManifestSha256,
              generationId: candidate.generationId, sourceObservedAt: candidate.sourceObservedAt, rows: crmBinding.rows,
              oracleSha256: hash(await fs.readFile(oraclePath)), passed: true, manifestHelperPassed: true,
              middlewareBoundaryPassed: true, ...access,
              productionMutations: 0, directSupplierRequests: 0, signedInRequests: 0},
            {candidate, nonce, oracleSha256: hash(await fs.readFile(oraclePath)), rows: crmBinding.rows,
              codeScope: servingPlan.codeScope, startedAt: crmStartedAt});
            const crmRaw = Buffer.from(JSON.stringify(crm) + '\n');
            await fs.writeFile(path.join(root, 'catalog-next-crm-china-operations-report.json'), crmRaw, {mode: 0o600, flag: 'wx'});
            const extraDetails = {...details, crmChinaReportBase64: crmRaw.toString('base64'),
              crmChinaReportSha256: hash(crmRaw)};
            detailsRaw = Buffer.from(JSON.stringify(extraDetails) + '\n');
            need(detailsRaw.length <= 256 * 1024, 'browser_details_size');
            await fs.writeFile(detailsPath, detailsRaw, {mode: 0o600});
          }
          if (photoRetryCodeUpdate) {
            const photoStartedAt = Date.now(), oracleSha256 = hash(await fs.readFile(oraclePath));
            const photo = checkedJapanPhotoRetryEvidence({version: 1, kind: 'japan-photo-retry-proof-v1',
              codeScope: servingPlan.codeScope, release: candidate.runtimeSha, nonce, checkedAt: new Date().toISOString(),
              oracleSha256, fixtureBase64: photoRetryFixture.toString('base64'), fixtureSha256: hash(photoRetryFixture),
              passed: true, directSupplierRequests: 0, productionMutations: 0},
            {candidate, nonce, oracleSha256, codeScope: servingPlan.codeScope, startedAt: photoStartedAt});
            const photoRaw = Buffer.from(JSON.stringify(photo) + '\n');
            await fs.writeFile(path.join(root, 'catalog-next-japan-photo-retry-report.json'), photoRaw, {mode: 0o600, flag: 'wx'});
            detailsRaw = Buffer.from(JSON.stringify({...JSON.parse(detailsRaw),
              japanPhotoRetryReportBase64: photoRaw.toString('base64'), japanPhotoRetryReportSha256: hash(photoRaw)}) + '\n');
            need(detailsRaw.length <= 256 * 1024, 'browser_details_size');
            await fs.writeFile(detailsPath, detailsRaw, {mode: 0o600});
          }
          if (codeUpdate && plan.codeScope === 'catalog-photo-recovery-v1') {
            await activeGuard(); await progress('code_photo_browser');
            const photoOutput = path.join(root, 'catalog-next-photo-browser-report.json');
            need(await use.runChild({root, script: path.join(root, 'scripts/catalog-next/photo-japan-browser-acceptance.mjs'),
              args: ['--photo-only'], cwd: browserDirectory, env: {...browserEnv, ORACLE_PATH: oraclePath,
                EXPECTED_RELEASE_SHA: candidate.runtimeSha, VERIFICATION_NONCE: nonce, OUTPUT: photoOutput}}) === 0,
            'photo_browser_failed');
            const photoRaw = await fs.readFile(photoOutput), photo = JSON.parse(photoRaw);
            need(photoRaw.length <= 128 * 1024 && photo.version === 1 && photo.kind === 'china-photo-browser-v1'
              && photo.codeScope === plan.codeScope && photo.release === candidate.runtimeSha && photo.nonce === nonce
              && photo.generationManifestSha256 === candidate.generationManifestSha256
              && photo.oracleSha256 === hash(await fs.readFile(oraclePath))
              && photo.passed === true && photo.chinaPhotoPassed === true && photo.readOnlyBrowserFence === true
              && ['productionMutations', 'directSupplierRequests', 'explicitJapanApiRequests', 'japanUiNavigations']
                .every(key => photo[key] === 0), 'photo_browser_binding');
            detailsRaw = Buffer.from(JSON.stringify({...details, photoReportBase64: photoRaw.toString('base64'),
              photoReportSha256: hash(photoRaw)}) + '\n');
            need(detailsRaw.length <= 256 * 1024, 'browser_details_size');
            await fs.writeFile(detailsPath, detailsRaw, {mode: 0o600});
          }
          if (codeUpdate && servingPlan.codeScope === 'catalog-photo-japan-power-v1') {
            await activeGuard(); await progress('code_photo_japan_browser');
            const photoJapanOutput = path.join(root, 'catalog-next-photo-japan-browser-report.json');
            need(await use.runChild({root, script: path.join(root, 'scripts/catalog-next/photo-japan-browser-acceptance.mjs'),
              args: [], cwd: browserDirectory, env: {...browserEnv, ORACLE_PATH: oraclePath,
                EXPECTED_RELEASE_SHA: candidate.runtimeSha, VERIFICATION_NONCE: nonce, OUTPUT: photoJapanOutput}}) === 0,
            'photo_japan_browser_failed');
            const photoJapanRaw = await fs.readFile(photoJapanOutput), photoJapan = JSON.parse(photoJapanRaw);
            need(photoJapanRaw.length <= 128 * 1024 && photoJapan.version === 1
              && photoJapan.kind === 'china-photo-japan-browser-v1'
              && photoJapan.release === candidate.runtimeSha && photoJapan.nonce === nonce
              && photoJapan.generationManifestSha256 === candidate.generationManifestSha256
              && photoJapan.oracleSha256 === hash(await fs.readFile(oraclePath))
              && ['passed', 'chinaPhotoPassed', 'japanFreshnessPassed', 'japanPowerApiPassed', 'japanUiPassed']
                .every(key => photoJapan[key] === true), 'photo_japan_browser_binding');
            detailsRaw = Buffer.from(JSON.stringify({...details, photoJapanReportBase64: photoJapanRaw.toString('base64'),
              photoJapanReportSha256: hash(photoJapanRaw)}) + '\n');
            need(detailsRaw.length <= 256 * 1024, 'browser_details_size');
            await fs.writeFile(detailsPath, detailsRaw, {mode: 0o600});
          }
          if (codeUpdate && ['catalog-japan-recovery-v1', 'catalog-japan-completion-v1', 'catalog-japan-completion-v2', 'catalog-japan-usability-v1', JAPAN_PAGINATION_CODE_SCOPE, JAPAN_STABILITY_CODE_SCOPE].includes(plan.codeScope)) {
            await activeGuard(); await progress('code_japan_browser');
            const japanOutput = path.join(browserDirectory, 'japan-browser-report.json'), japanStartedAt = Date.now();
            let failedJapanStage;
            try {
              const japanExit = await use.runChild({root, script: path.join(root, 'scripts/catalog-next/japan-browser-acceptance.mjs'),
                args: [], cwd: browserDirectory, env: {...browserEnv, ORACLE_PATH: oraclePath,
                  EXPECTED_RELEASE_SHA: candidate.runtimeSha, VERIFICATION_NONCE: nonce, OUTPUT: japanOutput,
                  CATALOG_CODE_SCOPE: plan.codeScope,
                  ...(observedJapanTiming ? {CATALOG_JAPAN_TIMING_POLICY: JAPAN_OBSERVED_TIMING_POLICY} : {}),
                  CATALOG_JAPAN_POWER_ORDER_REQUIRED: japanPowerOrderRequired(servingPlan) ? '1' : '0',
                  CATALOG_JAPAN_PRICE_SORT_REQUIRED: japanPriceSortRequired(servingPlan) ? '1' : '0',
                  CATALOG_JAPAN_EXACT_COUNT_REQUIRED: japanExactCountRequired(servingPlan) ? '1' : '0',
                  CATALOG_JAPAN_MODEL_COVERAGE_REQUIRED: japanSourceBoundedIncrementalRequired(servingPlan) ? '1' : '0',
                  CATALOG_JAPAN_BRAND_DIRECTORY_REQUIRED: japanBrandDirectoryRequired(servingPlan) ? '1' : '0'}});
              let japanRaw;
              try { japanRaw = await fs.readFile(japanOutput); }
              catch (error) { need(japanExit === 0, 'japan_browser_failed'); throw error; }
              need(japanRaw.length <= 128 * 1024, 'japan_browser_binding');
              const japan = JSON.parse(japanRaw), checkedAt = Date.parse(japan.checkedAt);
              need(japan.version === 1 && japan.kind === 'catalog-japan-browser-v1' && japan.codeScope === plan.codeScope
                && japan.countAcceptance === servingPlan.countAcceptance
                && japan.release === candidate.runtimeSha && japan.nonce === nonce
                && japan.generationManifestSha256 === candidate.generationManifestSha256
                && japan.oracleSha256 === hash(await fs.readFile(oraclePath))
                && Number.isFinite(checkedAt) && checkedAt >= japanStartedAt && checkedAt <= Date.now(), 'japan_browser_binding');
              // Keep the exact bound report after staging cleanup, including a
              // failed gate's diagnostic report. Copying it never grants acceptance.
              await fs.writeFile(path.join(root, 'catalog-next-japan-browser-report.json'), japanRaw, {flag: 'wx', mode: 0o600});
              if (japan.passed === false && typeof japan.error?.stage === 'string'
                && /^[a-z][a-z0-9_]{0,79}$/.test(japan.error.stage))
                failedJapanStage = japan.error.stage;
              need(japanExit === 0, 'japan_browser_failed');
              need(['passed', 'japanFreshnessPassed', 'japanPowerApiPassed', 'japanUiPassed', 'japanVisibilityPassed', 'readOnlyBrowserFence']
                  .every(key => japan[key] === true)
                && ['productionMutations', 'directSupplierApiRequests'].every(key => japan[key] === 0), 'japan_browser_binding');
              if (['catalog-japan-completion-v1', 'catalog-japan-completion-v2', 'catalog-japan-usability-v1', JAPAN_PAGINATION_CODE_SCOPE, JAPAN_STABILITY_CODE_SCOPE].includes(plan.codeScope)) need(
                ['japanPetrolPowerUiPassed', 'japanDetailPowerInputPassed', 'japanDeliveredCalculationPassed']
                  .every(key => japan[key] === true)
                && Number.isSafeInteger(japan.japanPreviewCalculationRequests) && japan.japanPreviewCalculationRequests >= 1
                && japan.japanPreviewCalculationRequests <= 2, 'japan_browser_binding');
              if (plan.codeScope === 'catalog-japan-usability-v1') need(
                ['japanBrandDirectoryPassed','japanFullPagesPassed','japanKnownPowerOrderPassed','japanVehiclePolicyPassed','japanQuietCatalogPassed']
                  .every(key => japan[key] === true), 'japan_browser_binding');
              if (paginationCodeUpdate) need(['japanFullPagesPassed', 'japanPagination24Passed', 'japanCatalogWarningRemovedPassed']
                .every(key => japan[key] === true), 'japan_browser_binding');
              if (stabilityCodeUpdate) need(['japanModelSelectionPassed', 'japanCombinedFiltersPassed',
                'japanRelatedCardsPassed', 'japanVehiclePolicyPassed'].every(key => japan[key] === true), 'japan_browser_binding');
              if (japanPowerOrderRequired(servingPlan)) need(japan.japanPowerOrderPassed === true, 'japan_browser_binding');
              if (japanBrandDirectoryRequired(servingPlan)) need(japan.japanBrandDirectoryPassed === true, 'japan_browser_binding');
              if (japanPriceSortRequired(servingPlan)) need(japan.japanPriceSortRequired === true && japan.japanPriceSortPassed === true
                && japan.japanCountDisplayPassed === true, 'japan_browser_binding');
              if (japanExactCountRequired(servingPlan)) need(japan.japanExactCountRequired === true && japan.japanExactCountPassed === true
                && japan.japanModelCoveragePassed === true, 'japan_browser_binding');
              if (japanSourceBoundedIncrementalRequired(servingPlan)) need(japanSourceBoundedAcceptancePassed(japan), 'japan_browser_binding');
              if (observedJapanTiming) {
                need(japan.timingPolicy === JAPAN_OBSERVED_TIMING_POLICY && japan.speedGateRequired === false
                  && japan.speedPassed === null && japan.timingObserved === true, 'japan_timing_binding');
                speedRaw = japanRaw;
              }
              // Preserve the already bound CRM/photo evidence when this profile
              // additionally verifies Japan's ordinary 24-row continuation.
              detailsRaw = Buffer.from(JSON.stringify({...JSON.parse(detailsRaw), japanReportBase64: japanRaw.toString('base64'),
                japanReportSha256: hash(japanRaw),
                ...(japanSourceBoundedIncrementalRequired(servingPlan) ? {countAcceptance: JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY} : {}),
                ...(observedJapanTiming ? {passed: true, timingObserved: true, precedingSpeedReportSha256: hash(speedRaw)} : {})}) + '\n');
              need(detailsRaw.length <= 256 * 1024, 'browser_details_size');
              await fs.writeFile(detailsPath, detailsRaw, {mode: 0o600});
            } catch (error) {
              if (stabilityCodeUpdate && failedJapanStage !== undefined) {
                // Read only the five bounded saved slots while this candidate
                // still serves. Rollback may overwrite them with older code.
                // Diagnostics cannot replace the original gate failure.
                try {
                  const saved = await use.inspectSavedActiveStabilityFailure({env: environment});
                  const raw = Buffer.from(JSON.stringify({...saved, capture: {version: 1, stage: 'before_rollback',
                    runtimeSha: servingPlan.runtimeSha, controllerSha, nonce, failedStage: failedJapanStage,
                    capturedAt: new Date().toISOString()}}, null, 2) + '\n');
                  need(raw.length <= 32 * 1024, 'japan_failure_snapshot_size');
                  await fs.writeFile(path.join(root, 'catalog-next-japan-source-failure-report.json'), raw,
                    {mode: 0o600, flag: 'wx', signal: AbortSignal.timeout(1000)});
                } catch {}
              }
              throw error;
            }
          }
          await activeGuard(); await use.health(candidate.runtimeSha);
          const saved = await session.call('browser_evidence', {speedBase64: speedRaw.toString('base64'), detailsBase64: detailsRaw.toString('base64')});
          need(saved?.saved === true && saved.speedReportSha256 === hash(speedRaw) && saved.detailsReportSha256 === hash(detailsRaw), 'browser_persistence');
          const outcome = await session.call('accept', {verdict: {release: candidate.runtimeSha, nonce, passed: true,
            functionalPassed: true, speedPassed: observedJapanTiming ? null : true,
            ...(japanSourceBoundedIncrementalRequired(servingPlan) ? {countAcceptance: JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY} : {}),
            ...(observedJapanTiming ? {timingPolicy: JAPAN_OBSERVED_TIMING_POLICY, speedGateRequired: false, timingObserved: true} : {}),
            reportSha256: hash(Buffer.concat([speedRaw, detailsRaw])),
            speedReportSha256: hash(speedRaw), detailsReportSha256: hash(detailsRaw)}});
          need(outcome?.accepted === true && HASH.test(outcome.hostReceiptSha256 ?? '')
            && hash(decode(outcome.hostReceiptBase64)) === outcome.hostReceiptSha256, 'host_acceptance');
          const proof = {kind: 'china-accepted-proof-v1', hostReceiptBase64: outcome.hostReceiptBase64, hostReceiptSha256: outcome.hostReceiptSha256};
          validateChinaGenerationReference({...candidate, proof}, {requireAccepted: true});
          const receipt = JSON.parse(decode(outcome.hostReceiptBase64));
          need(receipt.nonce === nonce && receipt.browser.reportSha256 === hash(Buffer.concat([speedRaw, detailsRaw])), 'host_browser_binding');
          acceptedReceiptSha256 = outcome.hostReceiptSha256;
          return {kind: 'accepted', evidence: {...proof, browserSpeedBytes: speedRaw, browserDetailsBytes: detailsRaw}};
        },
        async afterCommit({accepted, intent, assertAuthority: committedAuthority}) {
          need(!closed && acceptedReceiptSha256 && typeof committedAuthority === 'function', 'retire_state');
          need(inspectChinaPublicationState({accepted, intent}).status === 'resolved'
            && accepted.value.current?.generationId === candidate.generationId
            && accepted.value.current.proof.hostReceiptSha256 === acceptedReceiptSha256
            && equal(intent.value.candidate, candidate), 'retire_commit');
          await committedAuthority();
          const result = await session.call('retire', {acceptedState: accepted.value,
            acceptedETag: accepted.etag, acceptedStateSha256: accepted.sha256});
          await committedAuthority();
          need(Number.isSafeInteger(result?.retiredContainers) && result.retiredContainers >= 0 && result.retiredContainers <= 1
            && result.directoriesDeleted === 0 && result.imagesDeleted === 0
            && Number.isSafeInteger(result.filesDeleted) && result.filesDeleted >= 0
            && Number.isSafeInteger(result.freedBytes) && result.freedBytes >= 0, 'retire_result');
          return {completed: true, retiredContainers: result.retiredContainers, filesDeleted: result.filesDeleted, freedBytes: result.freedBytes};
        },
        async close() {
          if (closed) return; closed = true;
          try { await session.close(); }
          catch (error) { await stop(session); throw error; }
          // The durable private generation remains in REG; remove only this
          // invocation's restored/compressed working copy after the host closes.
          await fs.rm(directory, {recursive: true, force: true});
        },
      };
    } catch (error) {
      await stop(session); await fs.rm(directory, {recursive: true, force: true});
      const failure = Error(/^china_[a-z0-9_]+$/.test(error?.message ?? '') ? error.message : 'china_daily_release_stage_failed');
      // Optional public observations must survive normalization without ever
      // replacing the gate failure or changing the rollback path.
      try { if (error?.serverSpeed !== undefined) failure.serverSpeed = checkedServerSpeedReport(error.serverSpeed); } catch {}
      try { if (error?.homePhaseTiming !== undefined)
        failure.homePhaseTiming = checkedHomePhaseTimingReport(error.homePhaseTiming, {runtimeSha: candidate.runtimeSha, nonce}); } catch {}
      throw failure;
    }
  }

  async function recoverRelease({intent, assertAuthority}) {
    validateChinaPublicationIntent(intent?.value);
    need(typeof assertAuthority === 'function', 'recovery_authority'); await assertAuthority();
    const directory = await fs.mkdtemp(path.join(await fs.realpath(runnerTemp), 'china-daily-recovery-')); let session;
    try {
      session = await use.openSession({root, directory, privateKey});
      const outcome = await session.call('recover', {runtimeSha: intent.value.candidate.runtimeSha, nonce: intent.value.nonce});
      await session.close(); session = null; await assertAuthority();
      if (outcome?.status === 'pending') return null;
      if (outcome?.status === 'accepted') return {kind: 'accepted', evidence: {
        hostReceiptBase64: outcome.hostReceiptBase64, hostReceiptSha256: outcome.hostReceiptSha256,
        browserSpeedBytes: decode(outcome.browserSpeedBase64), browserDetailsBytes: decode(outcome.browserDetailsBase64)}};
      need(outcome?.status === 'rolled_back', 'recovery_status');
      decode(outcome.hostRollbackBase64);
      return {kind: 'rolled_back', evidence: {hostRollbackBase64: outcome.hostRollbackBase64, hostRollbackSha256: outcome.hostRollbackSha256}};
    } finally { await stop(session); await fs.rm(directory, {recursive: true, force: true}); }
  }
  async function retireHost({previousAccepted, acceptedPublication, readState, assertAuthority}) {
    need(typeof readState === 'function' && typeof assertAuthority === 'function', 'retirement_authority');
    validateChinaAcceptedState(previousAccepted?.value);
    need(inspectChinaPublicationState(acceptedPublication).status === 'resolved', 'retirement_publication');
    await assertAuthority(); const currentState = await readState(); await assertAuthority();
    const directory = await fs.mkdtemp(path.join(await fs.realpath(runnerTemp), 'china-daily-retirement-')); let session;
    try {
      session = await use.openSession({root, directory, privateKey});
      const result = await session.call('retire_recovery', {previousAccepted, acceptedPublication, currentState});
      await session.close(); session = null; await assertAuthority();
      need(Number.isSafeInteger(result?.retiredContainers) && result.retiredContainers >= 0 && result.retiredContainers <= 1
        && result.directoriesDeleted === 0 && result.imagesDeleted === 0
        && Number.isSafeInteger(result.filesDeleted) && result.filesDeleted >= 0
        && Number.isSafeInteger(result.freedBytes) && result.freedBytes >= 0, 'retirement_result');
      return {completed: true, retiredContainers: result.retiredContainers, filesDeleted: result.filesDeleted, freedBytes: result.freedBytes};
    } finally { await stop(session); await fs.rm(directory, {recursive: true, force: true}); }
  }

  /** Separate from container/private-file retirement. Only the resolved private
   * publication authorizes a target; a caller cannot supply an image ID. */
  async function retireTerminalAppImage({publication, readState, assertAuthority}) {
    let directory, session, phase = 'proof', removalRequested = false;
    try {
      need(typeof readState === 'function' && typeof assertAuthority === 'function', 'app_image_authority');
      publication = structuredClone({accepted: publication?.accepted, intent: publication?.intent});
      need(inspectChinaPublicationState(publication).status === 'resolved', 'app_image_publication');
      const intent = publication.intent.value;
      const target = intent?.status === 'committed' ? intent.previous.value?.rollback
        : intent?.status === 'aborted' && intent.transition === 'code-update'
          && intent.resolution?.kind === 'rolled_back' ? intent.candidate : null;
      const witnessSha256 = digest(publication);
      const authority = async () => {
        phase = 'authority';
        await assertAuthority();
        const value = await readState();
        await assertAuthority();
        const currentState = {accepted: value?.accepted, intent: value?.intent};
        need(inspectChinaPublicationState(currentState).status === 'resolved'
          && equal(currentState, publication), 'app_image_authority_changed');
        return currentState;
      };
      const checkedResult = value => {
        phase = 'proof';
        const result = checkedTerminalAppImageCleanupReport(value);
        need(result.witnessSha256 === witnessSha256
          && (target ? result.status !== 'not_applicable' && result.runtimeSha === target.runtimeSha && result.imageId === target.imageId
            : result.status === 'not_applicable'), 'app_image_result_binding');
        return result;
      };
      await authority();
      phase = 'proof';
      // Reuse the reviewed absolute pins without invoking its legacy cleanup.
      // The host independently pins these exact source bytes before import.
      const filename = path.join(root, 'scripts/regcloud-release-retention.py');
      const before = await fs.lstat(filename);
      need(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size > 0
        && before.size <= 64 * 1024, 'app_image_policy');
      const raw = await fs.readFile(filename);
      need(raw.length === before.size && sameFile(before, await fs.lstat(filename)), 'app_image_policy_changed');
      directory = await fs.mkdtemp(path.join(await fs.realpath(runnerTemp), 'china-terminal-app-image-'));
      phase = 'transport';
      session = await use.openSession({root, directory, privateKey});
      const currentState = await authority();
      phase = 'transport';
      let value = await session.call('retire_terminal_app_image', {action: 'prepare', publication, currentState,
        policySource: raw.toString('utf8'), policySourceSha256: hash(raw)});
      if (value?.kind === 'china-terminal-app-image-prepared-v1') {
        phase = 'proof';
        need(value.version === 1 && Object.keys(value).sort().join(',') ===
          ['version', 'kind', 'runtimeSha', 'imageId', 'witnessSha256'].sort().join(',')
          && target && value.runtimeSha === target.runtimeSha && value.imageId === target.imageId
          && value.witnessSha256 === witnessSha256, 'app_image_prepare_binding');
        const refreshed = await authority();
        phase = 'transport';
        removalRequested = true;
        value = await session.call('retire_terminal_app_image', {action: 'remove', publication, currentState: refreshed});
      }
      const result = checkedResult(value);
      await authority();
      phase = 'close';
      const closed = await session.close();
      need(closed?.closed === true && closed?.readOnly === false, 'app_image_close');
      session = null;
      await authority();
      return result;
    } catch (cause) {
      const error = Error('china_daily_release_app_image_cleanup_failed');
      const descriptor = cause && Object.getOwnPropertyDescriptor(cause, 'appImageCleanup');
      error.appImageCleanup = descriptor && Object.hasOwn(descriptor, 'value')
        ? terminalAppImageCleanupPending(cause)
        : Object.freeze({version: 1, kind: 'china-terminal-app-image-cleanup-v1', completed: false,
          status: 'pending', uncertain: removalRequested || phase === 'close',
          errorCode: phase === 'authority' ? 'authority_unavailable'
            : ['transport', 'close'].includes(phase) ? 'transport_unknown' : 'proof_invalid'});
      throw error;
    } finally {
      await stop(session);
      if (directory) await fs.rm(directory, {recursive: true, force: true});
    }
  }
  return Object.freeze({stageRelease: args => stage('generation-update', args),
    stageCodeRelease: args => stage('code-update', args), recoverRelease, retireHost, retireTerminalAppImage});
}

