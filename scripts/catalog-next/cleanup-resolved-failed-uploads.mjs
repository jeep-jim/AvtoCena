import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {verifyFrozenSpeedBaselines} from '../verify-frozen-speed-baselines.mjs';
import {createChinaStateStorage, createChinaState, inspectChinaPublicationState} from './china-state.mjs';
import {openChinaSshSession} from './release-ssh.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MARKER = '.github/market-runs/catalog-next-china-resolved-failed-upload-cleanup.json';
const WORKFLOW = 'jeep-jim/AvtoCena/.github/workflows/catalog-next-china-resolved-failed-upload-cleanup.yml@refs/heads/main';
const REPORT = 'catalog-next-china-resolved-failed-upload-cleanup-report.json';
export const RESOLVED_CLEANUP_LIVE_RUNTIME = '56d6b94fea70457e0ce2b0820596da9972846b90';
const GENERATION = Object.freeze({pricingRuntimeSha: '64c6338e0db23c8999096bceefbf113c0136fe15',
  generationId: 'gen_china_45369451603_1',
  generationManifestSha256: 'd5745797cc162b82e0c0f0b1f49fef65f18f0d6649666562337183b18084dd75',
  privateGenerationReceiptSha256: '25f5277665bcc1a72879d9a7e55cb39fc7d4bd57a061be2593d3a6a9d9f1cc22'});
export const RESOLVED_CLEANUP_WITNESS = Object.freeze({...GENERATION,
  runtimeSha: '38895e53f7f770ee68edb0b8ad53056468b928a5', nonce: 'bb85ea435dc8bbf6f28809be2ec0b447',
  planSha256: '9309d5e0b06e2d4e34aefe9e9c09add5f3a54900dfd4130d02ab1f1966efa994',
  rollbackSha256: '6e2e1f838df5d9dd7e8a4d61e3277096432c068c8e55b8519bdd5df502c7812e',
  imageId: 'sha256:7c093eedb12cd825ba204d8f3758438a834d5bcece80c7a25f0040e4147159d9'});
export const RESOLVED_CLEANUP_TARGETS = Object.freeze([
  Object.freeze({...GENERATION, runtimeSha: '1518035b9e6b717cd364ae8d13e63d0127899112', nonce: '92ec4a21446a23bed345fd789b2b3cc5',
    planSha256: '2b038c3566322b7be1f4e622716b8aed85e6e318fd323d31098db05dbb469964',
    rollbackSha256: '6f86011baf31bf183c5b156586b4c9b8a6aa22a0648c2d5f3de4c6f6e57538e9',
    imageId: 'sha256:0a1d136f6b292f9d027354fe8db3c14e12079e689e3f7b5773a7b014860213ea'}),
  Object.freeze({...GENERATION, runtimeSha: '99c45a3b5d8439bbc1ee34702ba41340ada08125', nonce: 'eef77195126340e1a7c47262a86bb554',
    planSha256: '027f6e750ff886098174c4da80e44a3a06c1b6cc94a46dc0f619452aa24139fa',
    rollbackSha256: 'f47f596c64647fb7dd47e47c3d9b5b2d2d66808d51e74c3a690954076c619e04',
    imageId: 'sha256:c12a500a0e50fc692701e2f5a28733a6c8a995c241df9d193c294a2cd85cb87d'}),
]);
const TARGET_BYTES = [13041561344, 13041562880], TOTAL_BYTES = 26083124224;
const need = (value, code) => { if (!value) throw Error('china_resolved_cleanup_' + code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const natural = value => Number.isSafeInteger(value) && value >= 0;
const sameObservation = (a, b) => a.found === b.found && a.etag === b.etag && a.sha256 === b.sha256;
const safeCode = error => /^(?:china_(?:resolved_cleanup|host|ssh|state)|readonly_invocation)_[a-z0-9_]{1,140}$/.test(error?.message ?? '')
  ? error.message : 'china_resolved_cleanup_failed';
const instant = value => {
  need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)), 'clock'); return Date.parse(value);
};

export function verifyResolvedCleanupInvocation({root = ROOT, environment = process.env} = {}) {
  need(environment.GITHUB_WORKFLOW_REF === WORKFLOW, 'workflow');
  return verifyReadonlyInvocation({root, env: environment, markerPath: MARKER,
    operation: 'prune-exact-china-uploads-after-resolved-99-rollback'});
}

/** inspectChinaPublicationState verifies canonical observations and the complete
 * authenticated rollback receipt. A timeout or an expired lease is no proof. */
export function verifyResolvedCleanupState(view) {
  const status = inspectChinaPublicationState(view).status;
  const state = view.accepted.value, intent = view.intent.value, target = RESOLVED_CLEANUP_TARGETS[1];
  need(status === 'resolved' && view.accepted.found && view.intent.found
    && ['current', 'pending', 'rollback', 'commit'].every(key => state[key] === null)
    && intent.status === 'aborted' && intent.resolution.kind === 'rolled_back'
    && intent.nonce === target.nonce && intent.resolution.rollbackProof.hostRollbackSha256 === target.rollbackSha256,
  'resolved_state');
  const previous = intent.previous.value;
  need((previous === null || ['current', 'pending', 'rollback', 'commit'].every(key => previous[key] === null))
    && state.revision === (previous?.revision ?? 0) + 2, 'resolved_state');
  const bindings = {runtimeSha: 'runtimeSha', pricingRuntimeSha: 'pricingRuntimeSha', generationId: 'generationId',
    generationManifestSha256: 'generationManifestSha256', receiptSha256: 'privateGenerationReceiptSha256', imageId: 'imageId'};
  need(Object.entries(bindings).every(([key, pin]) => intent.candidate[key] === target[pin]), 'resolved_candidate');
}

const identityKeys = ['liveRuntimeSha', 'protectedFailedAttempt', 'protectedFilesVerified', 'targetFailedAttempts'];
function checkedIdentity(value) {
  need(value.liveRuntimeSha === RESOLVED_CLEANUP_LIVE_RUNTIME && value.protectedFilesVerified === 11
    && isDeepStrictEqual(value.protectedFailedAttempt, RESOLVED_CLEANUP_WITNESS)
    && isDeepStrictEqual(value.targetFailedAttempts, RESOLVED_CLEANUP_TARGETS), 'report_identity');
}
export function validateResolvedCleanupPreparation(value) {
  need(keys(value, ['version', 'kind', 'prepared', ...identityKeys, 'targetFileBytes', 'alreadyAbsentFiles', 'alreadyAbsentBytes'])
    && value.version === 1 && value.kind === 'china-resolved-cleanup-prepared-v1' && value.prepared === true, 'report_preparation');
  checkedIdentity(value);
  need(Array.isArray(value.targetFileBytes) && value.targetFileBytes.length === 8
    && value.targetFileBytes.every(bytes => natural(bytes) && bytes > 0)
    && TARGET_BYTES.every((total, index) => value.targetFileBytes.slice(index * 4, index * 4 + 4).reduce((a, b) => a + b, 0) === total)
    && natural(value.alreadyAbsentFiles) && value.alreadyAbsentFiles <= 8
    && natural(value.alreadyAbsentBytes) && value.alreadyAbsentBytes <= TOTAL_BYTES
    && (value.alreadyAbsentFiles === 0) === (value.alreadyAbsentBytes === 0), 'report_preparation');
  return structuredClone(value);
}
export function validateResolvedCleanupStep(value, index, preparation) {
  need(natural(index) && index < 8 && keys(value, ['version', 'kind', 'index', 'deleted', 'alreadyAbsent', 'logicalBytesUnlinked'])
    && value.version === 1 && value.kind === 'china-resolved-cleanup-step-v1' && value.index === index
    && typeof value.deleted === 'boolean' && value.alreadyAbsent === !value.deleted
    && value.logicalBytesUnlinked === (value.deleted ? preparation.targetFileBytes[index] : 0), 'report_step');
  return structuredClone(value);
}
export function validateResolvedCleanupReport(value, preparation, steps) {
  const zeroKeys = ['retiredContainers', 'imagesDeleted', 'directoriesDeleted', 'privateGenerationDeletes', 'acceptedStateWrites', 'intentStateWrites'];
  need(keys(value, ['version', 'kind', 'phase', 'completed', ...identityKeys, 'filesDeleted', 'logicalBytesUnlinked',
    'alreadyAbsentFiles', 'alreadyAbsentBytes', 'diskFreeBytesBefore', 'diskFreeBytesAfter', ...zeroKeys])
    && value.version === 1 && value.kind === 'china-resolved-failed-upload-prune-v1'
    && value.phase === 'after-resolved-rollback' && value.completed === true, 'report_result');
  checkedIdentity(value);
  need(Array.isArray(steps) && steps.length === 8, 'report_steps');
  steps.forEach((step, index) => validateResolvedCleanupStep(step, index, preparation));
  need(value.filesDeleted === steps.filter(step => step.deleted).length
    && value.logicalBytesUnlinked === steps.reduce((sum, step) => sum + step.logicalBytesUnlinked, 0)
    && value.alreadyAbsentFiles === preparation.alreadyAbsentFiles && value.filesDeleted + value.alreadyAbsentFiles === 8
    && value.alreadyAbsentBytes === preparation.alreadyAbsentBytes && value.logicalBytesUnlinked + value.alreadyAbsentBytes === TOTAL_BYTES
    && natural(value.diskFreeBytesBefore) && natural(value.diskFreeBytesAfter) && zeroKeys.every(key => value[key] === 0), 'report_counts');
  return structuredClone(value);
}

/** This operation only writes the private lease. The host keeps the flock from
 * preparation through close; fresh state and lease reads precede every unlink. */
export async function runResolvedCleanup({root = ROOT, environment = process.env, capabilities = {},
  now = () => new Date().toISOString(), log = () => {}} = {}) {
  const defaults = {verifyInvocation: verifyResolvedCleanupInvocation, verifyBaselines: verifyFrozenSpeedBaselines,
    createStorage: createChinaStateStorage, openSession: openChinaSshSession};
  need(object(capabilities) && Object.keys(capabilities).every(key => Object.hasOwn(defaults, key) && typeof capabilities[key] === 'function')
    && path.isAbsolute(root) && typeof now === 'function' && typeof log === 'function', 'arguments');
  const use = {...defaults, ...capabilities};
  const report = {version: 1, kind: 'china-resolved-failed-upload-cleanup-v1', market: 'china', phase: 'after-resolved-rollback',
    completed: false, status: 'starting', liveRuntimeSha: RESOLVED_CLEANUP_LIVE_RUNTIME,
    protectedFailedAttempt: RESOLVED_CLEANUP_WITNESS, targetFailedAttempts: RESOLVED_CLEANUP_TARGETS, partialSteps: [],
    filesDeleted: null, logicalBytesUnlinked: null, alreadyAbsentFiles: null, alreadyAbsentBytes: null,
    diskFreeBytesBefore: null, diskFreeBytesAfter: null, acceptedStateWrites: 0, intentStateWrites: 0,
    privateGenerationDeletes: 0, leaseRelease: 'not_acquired'};
  let state, expected, lease, session, directory, failure, hostStarted = false, hostSettled = false;
  const readPair = async () => {
    const [accepted, intent] = await Promise.all([state.read('accepted'), state.read('intent')]); return {accepted, intent};
  };
  const checkedLease = async () => {
    const current = await state.read('lease');
    need(sameObservation(current, lease) && current.value?.status === 'held' && instant(current.value.expiresAt) > instant(now()), 'lease_lost');
  };
  const assertAuthority = async () => {
    await checkedLease();
    const view = await readPair(); verifyResolvedCleanupState(view);
    need(sameObservation(view.accepted, expected.accepted) && sameObservation(view.intent, expected.intent), 'state_changed');
    await checkedLease();
    return {publicationState: view, lease};
  };
  const call = async params => {
    hostStarted = true; hostSettled = false;
    try { const value = await session.call('prune_resolved_failed_uploads', params); hostSettled = true; return value; }
    catch (error) { hostSettled = /^china_host_[a-z0-9_]+$/.test(error?.message ?? ''); throw error; }
  };
  try {
    const invocation = use.verifyInvocation({root, environment});
    report.controllerSha = invocation.sourceSha; report.approvedControllerSha = invocation.approvedSourceSha;
    use.verifyBaselines(root);
    const storage = use.createStorage({environment});
    need(typeof storage.assertPrivateBucket === 'function' && (await storage.assertPrivateBucket())?.verified === true, 'privacy');
    state = createChinaState({storage, now}); expected = await readPair(); verifyResolvedCleanupState(expected);
    lease = await state.acquireLease({previous: await state.read('lease'),
      owner: {runId: environment.GITHUB_RUN_ID, attempt: environment.GITHUB_RUN_ATTEMPT, revision: invocation.sourceSha},
      nonce: randomBytes(16).toString('hex'), expiresAt: new Date(instant(now()) + 60 * 60 * 1000).toISOString()});
    report.leaseRelease = 'held'; await assertAuthority();
    const privateKey = environment.SSH_PRIVATE_KEY;
    need(typeof privateKey === 'string' && privateKey.length > 0, 'ssh_key');
    const temporary = await fs.realpath(environment.RUNNER_TEMP);
    directory = await fs.mkdtemp(path.join(temporary, 'china-resolved-cleanup-')); await fs.chmod(directory, 0o700);
    session = await use.openSession({root, directory, privateKey});
    const preparation = validateResolvedCleanupPreparation(await call({action: 'prepare', authority: await assertAuthority()}));
    for (let index = 0; index < 8; index++) {
      const step = await call({action: 'unlink', index, authority: await assertAuthority()});
      report.partialSteps.push(validateResolvedCleanupStep(step, index, preparation));
    }
    const result = validateResolvedCleanupReport(await call({action: 'finish', authority: await assertAuthority()}), preparation, report.partialSteps);
    await assertAuthority();
    const closed = await session.close();
    need(closed?.closed === true && closed.readOnly === false, 'close'); session = null;
    report.result = result; report.steps = report.partialSteps; delete report.partialSteps;
    for (const key of ['filesDeleted', 'logicalBytesUnlinked', 'alreadyAbsentFiles', 'alreadyAbsentBytes', 'diskFreeBytesBefore', 'diskFreeBytesAfter']) report[key] = result[key];
    report.completed = true; report.status = 'complete';
  } catch (error) {
    failure = Error(safeCode(error)); report.status = 'needs_recheck'; report.errorCode = failure.message;
  } finally {
    // A lost reply cannot establish the remote unlink outcome. Wait for SSH
    // exit and leave this lease held through expiry in that case.
    if (session) { session.abort(); await session.exited; }
    if (lease) {
      if (!hostStarted || hostSettled) {
        try { await state.releaseLease({lease}); report.leaseRelease = 'released'; }
        catch (error) { report.leaseRelease = 'unconfirmed'; report.leaseErrorCode = safeCode(error); }
      } else report.leaseRelease = 'expires';
    }
    if (directory) await fs.rm(directory, {recursive: true, force: true});
  }
  report.finishedAt = now();
  await fs.writeFile(path.join(root, REPORT), JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  log(report);
  if (failure) { failure.report = report; throw failure; }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 3 && ['--verify', '--run'].includes(process.argv[2]), 'cli_arguments');
    if (process.argv[2] === '--verify') {
      const invocation = verifyResolvedCleanupInvocation(); verifyFrozenSpeedBaselines(ROOT);
      process.stdout.write(JSON.stringify({phase: 'china_resolved_cleanup_verified', controllerSha: invocation.sourceSha}) + '\n');
    } else await runResolvedCleanup({log: value => process.stdout.write(JSON.stringify(value) + '\n')});
  } catch (error) { process.stderr.write(safeCode(error) + '\n'); process.exitCode = 1; }
}
