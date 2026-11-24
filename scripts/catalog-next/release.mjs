import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createReadStream, createWriteStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash, randomBytes} from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {verifyFrozenSpeedBaselines} from '../verify-frozen-speed-baselines.mjs';
import {restorePrivateChinaGeneration} from './private-generation.mjs';
import {createPrivateChinaGenerationStorage} from './generation-storage.mjs';
import {openChinaSshSession, checkedStartupReport, checkedRetainedFenceReport, checkedServerSpeedReport} from './release-ssh.mjs';
import {verifyServingCompatibility} from './serving-compatibility.mjs';
import {createChinaStateStorage, createChinaState, inspectChinaPublicationState} from './china-state.mjs';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {assertChinaFeedControl} from './refresh-china-source.mjs';
import {resolveChinaReleaseReuse, resumeChinaHostAttempt} from './release-reuse.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const need = (value, code) => assert(value, 'china_release_' + code);
const hash = raw => createHash('sha256').update(raw).digest('hex');
const log = value => console.log(JSON.stringify(value));
const report = {version: 1, market: 'china', accepted: false, encyclopediaWrites: 0, otherMarketWrites: 0};
const reportPath = path.join(root, 'catalog-next-china-release-report.json');
const names = ['GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json', 'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson'];
let phase = 'invocation', session, state, lease, intent, reservation, scratch, hostPlan;
const privateKey = process.env.SSH_PRIVATE_KEY;
const step = async (name, fn) => { phase = name; log({phase, started: true}); const result = await fn(); log({phase, completed: true}); return result; };
const safeCode = error => /^china_[a-z0-9_:-]{2,180}$/i.test(error?.message ?? '') ? error.message : 'china_release_failed';

async function fileSeal(filename) {
  const before = await fs.stat(filename), digest = createHash('sha256');
  for await (const raw of createReadStream(filename)) digest.update(raw);
  const after = await fs.stat(filename);
  need(before.size === after.size && before.mtimeMs === after.mtimeMs && before.ino === after.ino, 'file_changed');
  return {bytes: after.size, sha256: digest.digest('hex')};
}
async function packFile(filename, directory, name) {
  const seal = await fileSeal(filename), packed = path.join(directory, name + '.gz');
  await pipeline(createReadStream(filename), createGzip({level: 6}), createWriteStream(packed, {mode: 0o600, flags: 'wx'}));
  const compressed = await fileSeal(packed);
  need((await fileSeal(filename)).sha256 === seal.sha256, 'pack_source_changed');
  return {descriptor: {name, ...seal, compressedBytes: compressed.bytes, compressedSha256: compressed.sha256}, packed};
}
async function child(script, args, env, cwd = root, timeout = 600000) {
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, [path.join(root, 'scripts/run-node-with-resources.mjs'),
      '--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href, script, ...args],
    {cwd, env, stdio: ['ignore', 'pipe', 'pipe']});
    // Child sources can expose raw commercial records on exceptions. Reports
    // are explicitly read below and only safe aggregates are retained.
    processChild.stdout.on('data', () => {}); processChild.stderr.on('data', () => {});
    const timer = setTimeout(() => { processChild.kill('SIGTERM'); reject(Error('china_release_child_timeout')); }, timeout);
    processChild.once('error', () => { clearTimeout(timer); reject(Error('china_release_child_start')); });
    processChild.once('close', code => { clearTimeout(timer); resolve(code); });
  });
}
async function publicHealth(runtime) {
  const result = await fetch('https://avtocena.com/api/health', {cache: 'no-store', signal: AbortSignal.timeout(15000)});
  need(result.ok, 'public_health_status'); const value = await result.json();
  need(value.ok === true && value.releaseSha === runtime && value.calculationVersion ===
    '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90', 'public_health_identity');
}

try {
  const invocation = verifyReadonlyInvocation({root, markerPath: '.github/market-runs/catalog-next-china-release.json', operation: 'activate-china-generation'});
  verifyFrozenSpeedBaselines(root); report.controllerSha = invocation.sourceSha;
  need(process.argv.length === 3, 'arguments'); const runtimeRoot = await fs.realpath(process.argv[2]);
  const plan = JSON.parse(await fs.readFile(path.join(root, '.github/operations/catalog-next/china-serving-plan.json'), 'utf8'));
  const pricingPlan = JSON.parse(await fs.readFile(path.join(root, '.github/operations/catalog-next/china-plan.json'), 'utf8'));
  await verifyServingCompatibility({runtimeRoot, servingPlan: plan, pricingPlan});
  const release = JSON.parse(await fs.readFile(path.join(root, '.github/operations/catalog-next/china-release-plan.json'), 'utf8'));
  need(release.version === 1 && release.market === 'china' && release.runtimeSha === plan.runtimeSha && release.pricingRuntimeSha === plan.pricingRuntimeSha &&
    /^[a-f0-9]{64}$/.test(release.receiptSha256 ?? '') && /^[a-f0-9]{64}$/.test(release.generationManifestSha256 ?? ''), 'profile');
  const reuse = resolveChinaReleaseReuse(release, plan);
  const git = args => execFileSync('git', args, {cwd: runtimeRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 ** 2});
  need(git(['rev-parse', 'HEAD']).trim() === plan.runtimeSha && git(['rev-parse', 'HEAD^{tree}']).trim() === plan.runtimeTree &&
    hash(git(['diff', '--binary', '--no-ext-diff', '--no-renames', plan.retainedRuntime, plan.runtimeSha])) === plan.runtimeDiffSha256, 'exact_runtime');
  git(['diff', '--quiet', 'HEAD', '--']);
  need(JSON.stringify(git(['diff', '--name-only', '--no-renames', plan.retainedRuntime, plan.runtimeSha]).trim().split('\n').sort()) ===
    JSON.stringify([...plan.runtimeFiles].sort()), 'runtime_scope');
  git(['diff', '--quiet', plan.retainedRuntime, plan.runtimeSha, '--', 'packages/engine', 'apps/web/lib/encyclopedia',
    'apps/web/app/(crm)', 'apps/web/components/site', 'data', 'apps/web/lib/business-settings.ts']);
  report.runtimeSha = plan.runtimeSha; report.pricingRuntimeSha = plan.pricingRuntimeSha; report.generationId = release.generationId;
  await publicHealth(plan.retainedRuntime);
  scratch = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP, 'china-release-'));
  const object = getJsonStorage();
  const checkControl = async () => {
    assertChinaFeedControl(await object.readJson('catalog/operations/collection-controls-v1.json', null));
    if (lease) {
      const observed = await state.read('lease');
      need(observed.etag === lease.etag && observed.sha256 === lease.sha256 && observed.value.status === 'held' &&
        Date.parse(observed.value.expiresAt) > Date.now(), 'lease_lost');
      if (Date.parse(lease.value.expiresAt) - Date.now() < 30 * 60 * 1000)
        lease = await state.renewLease({lease, expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()});
    }
  };
  await checkControl();
  const localEnv = {PATH: process.env.PATH, NODE_ENV: 'production', JSON_STORAGE_DRIVER: 'local', TZ: 'Asia/Krasnoyarsk'};
  const oracle = path.join(scratch, 'acceptance.json');
  const nonce = randomBytes(16).toString('hex');
  let previous, previousIntent, generation;
  const acquireFirstReleaseFence = async () => {
    const stateStorage = createChinaStateStorage();
    await stateStorage.assertPrivateBucket(); state = createChinaState({storage: stateStorage});
    const [accepted, savedIntent, previousLease] = await Promise.all([state.read('accepted'), state.read('intent'), state.read('lease')]);
    need(!accepted.value?.current && !accepted.value?.pending && ['idle', 'resolved'].includes(
      inspectChinaPublicationState({accepted, intent: savedIntent}).status), 'first_release_state');
    lease = await state.acquireLease({previous: previousLease,
      owner: {runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, revision: invocation.sourceSha},
      nonce, expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()});
    return {previous: accepted, previousIntent: savedIntent};
  };
  const recordGeneration = generation => {
    need(generation.prepared === true && generation.source.supplierLatestVerified === true && generation.rows > 0, 'prepared_generation');
    report.sourceObservedAt = generation.source.sourceObservedAt; report.pricingAsOf = generation.pricingAsOf;
    report.rows = generation.rows; report.sourceRows = generation.sourceRows;
  };
  const recordOracle = value => {
    need(value.runtimeSha === plan.runtimeSha && value.pricingRuntimeSha === plan.pricingRuntimeSha &&
      value.generationManifestSha256 === release.generationManifestSha256 && value.cases.length >= 8, 'oracle_identity');
    report.oracle = value.cases.map(({name, total, ids}) => ({name, total, items: ids.length}));
  };
  if (reuse) {
    // Reuse is only preparation for the same first-publication protocol below.
    // The exclusive China fence precedes any creation on the authenticated host.
    ({previous, previousIntent} = await acquireFirstReleaseFence());
    await checkControl();
    session = await step('authenticated_server_session', () => openChinaSshSession({root, directory: scratch, privateKey}));
    const reused = await step('reuse_verified_server_files', () => resumeChinaHostAttempt({session, reuse, release,
      servingPlan: plan, nonce, controllerSha: invocation.sourceSha, previous, oraclePath: oracle, assertAuthority: checkControl}));
    hostPlan = reused.plan; generation = reused.generation;
    recordGeneration(generation); recordOracle(reused.oracle); report.imageId = hostPlan.imageId;
    report.reuseHostAttempt = {verified: true, sourcePlanSha256: reuse.source.planSha256,
      copiedFiles: reused.copiedFiles, copiedBytes: reused.copiedBytes};
  } else {
    const storage = createPrivateChinaGenerationStorage({owner: release.owner});
    const restored = await step('restore_verified_local_generation', () => restorePrivateChinaGeneration({storage, owner: release.owner,
      expectedReceiptSha256: release.receiptSha256, outputDirectory: path.join(scratch, 'generation'), names, onProgress: log}));
    need(restored.receipt.binding.runtimeSha === plan.pricingRuntimeSha && restored.receipt.binding.generationId === release.generationId &&
      restored.receipt.binding.generationManifestSha256 === release.generationManifestSha256, 'generation_binding');
    generation = JSON.parse(await fs.readFile(restored.paths['GENERATION.json'], 'utf8')); recordGeneration(generation);
    await step('independent_local_query_oracle', async () => {
      const status = await child(path.join(root, 'scripts/catalog-next/acceptance-oracle.mjs'),
        [runtimeRoot, path.join(scratch, 'generation'), release.generationManifestSha256, oracle], localEnv);
      need(status === 0, 'oracle_failed'); recordOracle(JSON.parse(await fs.readFile(oracle, 'utf8')));
    });
    const imageDirectory = path.join(process.env.RUNNER_TEMP, 'china-release-build');
    const image = JSON.parse(await fs.readFile(path.join(imageDirectory, 'image-receipt.json'), 'utf8'));
    const imagePath = path.join(imageDirectory, 'image.tar'), imageSeal = await fileSeal(imagePath);
    need(image.runtimeSha === plan.runtimeSha && image.pricingRuntimeSha === plan.pricingRuntimeSha &&
      image.runtimeTree === plan.runtimeTree && image.sha256 === imageSeal.sha256 &&
      image.bytes === imageSeal.bytes && /^sha256:[a-f0-9]{64}$/.test(image.imageId ?? ''), 'image_receipt');
    report.imageId = image.imageId;
    const files = {...restored.paths, 'image.tar': imagePath, 'acceptance.json': oracle,
      'regcloud-performance-gate.py': path.join(root, 'scripts/regcloud-performance-gate.py'),
      'accepted-speed-baseline.json': path.join(root, 'docs/operations/2026-11-11-accepted-speed-baseline.json')};
    const packed = [];
    await step('pack_verified_files', async () => {
      for (const [name, filename] of Object.entries(files)) { packed.push(await packFile(filename, scratch, name)); log({phase, file: name}); }
    });
    ({previous, previousIntent} = await acquireFirstReleaseFence());
    hostPlan = {version: 1, market: 'china', retainedRuntime: plan.retainedRuntime, runtimeSha: plan.runtimeSha, pricingRuntimeSha: plan.pricingRuntimeSha,
      runtimeTree: plan.runtimeTree, runtimeDiffSha256: plan.runtimeDiffSha256, controllerSha: invocation.sourceSha,
      servingCalculationVersion: '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90',
      generationId: release.generationId, generationManifestSha256: release.generationManifestSha256,
      privateGenerationReceiptSha256: release.receiptSha256, sourceDescriptorSha256: restored.receipt.binding.sourceDescriptorSha256, imageId: image.imageId, nonce,
      previousAcceptedETag: previous.etag, previousAcceptedStateSha256: previous.sha256,
      files: packed.map(file => file.descriptor)};
    await checkControl();
    session = await step('authenticated_server_session', () => openChinaSshSession({root, directory: scratch, privateKey}));
    await session.call('init', {plan: hostPlan});
    for (const file of packed) await step('upload_' + file.descriptor.name.replaceAll('.', '_'), () => session.upload(file.descriptor.name, file.packed));
  }
  const candidate = {market: 'china', generationId: release.generationId, owner: release.owner,
    receiptSha256: release.receiptSha256, sourceDescriptorSha256: hostPlan.sourceDescriptorSha256,
    generationManifestSha256: release.generationManifestSha256, sourceCursor: generation.source.cursor,
    sourceObservedAt: generation.source.sourceObservedAt, runtimeSha: plan.runtimeSha,
    pricingRuntimeSha: plan.pricingRuntimeSha, imageId: hostPlan.imageId};
  await checkControl();
  report.start = await step('start_candidate_preserving_live', () => session.call('start'));
  report.functional = await step('exact_rows_prices_and_filters', () => session.call('functional'));
  report.serverSpeed = await step('unchanged_server_speed_baseline', () => session.call('speed'));
  await checkControl();
  ({intent, reservation} = await step('reserve_china_publication', () => state.reserve({lease, previous, previousIntent, candidate})));
  await step('switch_china_with_rollback_armed', () => session.call('switch'));
  await publicHealth(plan.runtimeSha);
  const marker = path.join(scratch, 'browser-marker.json');
  await fs.writeFile(marker, JSON.stringify({release: plan.runtimeSha, phase: 'independent-china', verifyPartnerBudgets: false, enforceSpeed: true}), {mode: 0o600});
  const browserCode = await step('live_mobile_desktop_browser', () => child(path.join(root, 'tests/browser/owner-filter-speed-live.mjs'), [],
    {...localEnv, CHROME_BIN: process.env.CHROME_BIN, PLAYWRIGHT_MODULE: process.env.PLAYWRIGHT_MODULE, OWNER_FILTER_BROWSER_MARKER: marker}));
  const browserRaw = await fs.readFile(path.join(root, 'owner-filter-browser-report.json'));
  const browser = JSON.parse(browserRaw);
  need(browserCode === 0 && browser.passed === true && browser.browserPassed === true && browser.speedGuard?.passed === true &&
    browser.release === plan.runtimeSha, 'browser_failed');
  report.browser = {passed: true, release: browser.release, checks: browser.checks, speedGuard: browser.speedGuard};
  const detailsPath = path.join(root, 'china-browser-details-report.json');
  const detailsCode = await step('general_catalog_power_city_detail_back', () => child(path.join(root, 'scripts/catalog-next/browser-acceptance.mjs'), [],
    {...localEnv, CHROME_BIN: process.env.CHROME_BIN, PLAYWRIGHT_MODULE: process.env.PLAYWRIGHT_MODULE,
      ORACLE_PATH: oracle, CHINA_RELEASE_SHA: plan.runtimeSha, VERIFICATION_NONCE: nonce,
      OWNER_FILTER_BROWSER_REPORT: path.join(root, 'owner-filter-browser-report.json'), CHINA_BROWSER_DETAILS_OUTPUT: detailsPath}));
  const detailsRaw = await fs.readFile(detailsPath), details = JSON.parse(detailsRaw);
  need(detailsCode === 0 && details.passed === true && details.release === plan.runtimeSha && details.nonce === nonce &&
    details.generationManifestSha256 === release.generationManifestSha256 && details.precedingSpeedReportSha256 === hash(browserRaw), 'browser_details_failed');
  report.browserDetails = details;
  await publicHealth(plan.runtimeSha); await checkControl();
  await step('persist_exact_browser_evidence', () => session.call('browser_evidence', {
    speedBase64: browserRaw.toString('base64'), detailsBase64: detailsRaw.toString('base64')}));
  const accepted = await step('accept_checked_china', () => session.call('accept', {verdict: {release: plan.runtimeSha,
    nonce, passed: true, functionalPassed: true, speedPassed: true, reportSha256: hash(Buffer.concat([browserRaw, detailsRaw])),
    speedReportSha256: hash(browserRaw), detailsReportSha256: hash(detailsRaw)}}));
  const {hostReceiptBase64, ...publicAcceptance} = accepted;
  report.acceptance = publicAcceptance;
  need(accepted.accepted === true && typeof hostReceiptBase64 === 'string' &&
    hash(Buffer.from(hostReceiptBase64, 'base64')) === accepted.hostReceiptSha256, 'acceptance');
  const committed = await step('commit_accepted_china_pointer', () => state.commit({lease, intent, reservation, evidence: {
    hostReceiptBase64, hostReceiptSha256: accepted.hostReceiptSha256,
    browserSpeedBytes: browserRaw, browserDetailsBytes: detailsRaw}}));
  report.state = {committed: true, acceptedRevision: committed.accepted.value.revision,
    acceptedStateSha256: committed.accepted.sha256, intentSha256: committed.intent.sha256};
  await session.close(); session = null;
  await publicHealth(plan.runtimeSha);
  await state.releaseLease({lease}); lease = null;
  report.accepted = true; report.finishedAt = new Date().toISOString();
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2)); log(report);
} catch (error) {
  if (error?.startup) {
    try { report.startupFailure = checkedStartupReport(error.startup); } catch {}
  }
  if (error?.retainedFence) {
    try { report.retainedFenceFailure = checkedRetainedFenceReport(error.retainedFence); } catch {}
  }
  if (error?.serverSpeed) {
    try { report.serverSpeedFailure = checkedServerSpeedReport(error.serverSpeed); } catch {}
  }
  if (session) { session.abort(); await session.exited; session = null; }
  report.phase = phase; report.errorCode = safeCode(error); report.finishedAt = new Date().toISOString();
  if (state && lease && !intent && hostPlan) {
    // reserve can persist its intent before an interrupted conditional write.
    // Recover only this exact nonce; never adopt another writer's state.
    try {
      const savedIntent = await state.read('intent'), observed = await state.read('accepted');
      if (savedIntent.value?.nonce === hostPlan.nonce && savedIntent.value.status === 'pending') {
        const status = inspectChinaPublicationState({accepted: observed, intent: savedIntent}).status;
        if (status === 'unreserved') await state.abandonUnreserved({lease, intent: savedIntent});
        else if (status === 'reserved') { intent = savedIntent; reservation = observed; }
        else report.publicationPendingRecovery = true;
      }
    } catch { report.publicationPendingRecovery = true; }
  }
  if (state && lease && intent && reservation && hostPlan) {
    // An interrupted response is reconciled from the authenticated host's exact
    // durable receipts. Missing evidence stays pending; elapsed time proves nothing.
    try {
      session = await openChinaSshSession({root, directory: scratch, privateKey});
      const outcome = await session.call('recover', {runtimeSha: hostPlan.runtimeSha, nonce: hostPlan.nonce});
      await session.close(); session = null;
      const observed = await state.read('accepted'), savedIntent = await state.read('intent');
      const status = inspectChinaPublicationState({accepted: observed, intent: savedIntent}).status;
      if (outcome.status === 'accepted') {
        if (status === 'reserved') await state.commit({lease, intent: savedIntent, reservation: observed, evidence: {
          hostReceiptBase64: outcome.hostReceiptBase64, hostReceiptSha256: outcome.hostReceiptSha256,
          browserSpeedBytes: Buffer.from(outcome.browserSpeedBase64, 'base64'),
          browserDetailsBytes: Buffer.from(outcome.browserDetailsBase64, 'base64')}});
        else if (status === 'accepted_needs_finalization') await state.finalize({lease, intent: savedIntent, accepted: observed});
        else need(status === 'resolved' && observed.value.current?.generationId === hostPlan.generationId, 'recovery_state');
        await publicHealth(hostPlan.runtimeSha);
        report.accepted = true; report.recoveredAcceptance = true; report.errorCode = null;
      } else if (outcome.status === 'rolled_back') {
        const evidence = {hostRollbackBase64: outcome.hostRollbackBase64, hostRollbackSha256: outcome.hostRollbackSha256};
        if (status === 'reserved') await state.abortReserved({lease, intent: savedIntent, reservation: observed, evidence});
        else if (status === 'rollback_needs_evidence') await state.finalizeRollback({lease, intent: savedIntent, accepted: observed, evidence});
        else need(status === 'resolved', 'recovery_state');
        report.rollbackVerified = true;
      } else report.publicationPendingRecovery = true;
    } catch (recoveryError) {
      if (session) { session.abort(); await session.exited; session = null; }
      report.recoveryErrorCode = safeCode(recoveryError);
    }
  }
  if (state && lease) {
    try { await state.releaseLease({lease}); lease = null; }
    catch { report.leaseReleasePending = true; }
  }
  // A disconnected session automatically rolls back unless already accepted;
  // report only the independently observed public release, never infer success.
  try { const response = await fetch('https://avtocena.com/api/health', {signal: AbortSignal.timeout(10000)});
    const value = await response.json(); report.observedPublicRelease = /^[a-f0-9]{40}$/.test(value.releaseSha ?? '') ? value.releaseSha : null;
  } catch { report.observedPublicRelease = null; }
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2)); log(report); process.exitCode = report.accepted ? 0 : 1;
}
