import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {verifyFrozenSpeedBaselines} from '../verify-frozen-speed-baselines.mjs';
import {createChinaStateStorage, createChinaState, inspectChinaPublicationState} from './china-state.mjs';
import {openChinaSshSession} from './release-ssh.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MARKER = '.github/market-runs/catalog-next-china-failed-upload-cleanup.json';
const WORKFLOW = 'jeep-jim/AvtoCena/.github/workflows/catalog-next-china-failed-upload-cleanup.yml@refs/heads/main';
const REPORT = 'catalog-next-china-failed-upload-cleanup-report.json';
export const FAILED_UPLOAD_CLEANUP_CURRENT = Object.freeze({
  runtimeSha: '5e62f9ff3a0079b07cd13b8ab912c5720dd22250', generationId: 'gen_china_45369451603_1',
});
const NONCES = Object.freeze(['2ab6a761ac784094d102edd7be8708af', 'ae835461a771911c083739ddbf03bead']);
const need = (value, code) => { if (!value) throw Error('china_failed_cleanup_' + code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).length === expected.length
  && expected.every(key => Object.hasOwn(value, key));
const natural = value => Number.isSafeInteger(value) && value >= 0;
const sameObservation = (left, right) => left.found === right.found && left.etag === right.etag && left.sha256 === right.sha256;
const safeCode = error => /^(?:china_(?:failed_cleanup|host|ssh|state)|readonly_invocation)_[a-z0-9_]{1,140}$/.test(error?.message ?? '')
  ? error.message : 'china_failed_cleanup_failed';
const instant = value => {
  need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)), 'clock'); return Date.parse(value);
};

/** Verify the exact reviewed controller before reading a credential. Pushes
 * must be marker-only transitions from the already reviewed main tip. */
export function verifyFailedUploadCleanupInvocation({root = ROOT, environment = process.env} = {}) {
  need(environment.GITHUB_WORKFLOW_REF === WORKFLOW, 'workflow');
  return verifyReadonlyInvocation({root, env: environment, markerPath: MARKER, operation: 'prune-failed-china-uploads'});
}

export function validateFailedUploadCleanupReport(value) {
  need(keys(value, ['version', 'kind', 'completed', 'runtimeSha', 'generationId', 'targetNonces', 'filesDeleted',
    'freedBytes', 'alreadyAbsentFiles', 'retiredContainers', 'imagesDeleted', 'directoriesDeleted', 'privateGenerationDeletes',
    'acceptedStateWrites']) && value.version === 1 && value.kind === 'china-failed-upload-prune-v1' && value.completed === true
    && value.runtimeSha === FAILED_UPLOAD_CLEANUP_CURRENT.runtimeSha && value.generationId === FAILED_UPLOAD_CLEANUP_CURRENT.generationId
    && Array.isArray(value.targetNonces) && JSON.stringify(value.targetNonces) === JSON.stringify(NONCES), 'report_identity');
  need(natural(value.filesDeleted) && natural(value.alreadyAbsentFiles) && value.filesDeleted + value.alreadyAbsentFiles === 8
    && natural(value.freedBytes) && value.freedBytes <= 26083118592
    && (value.filesDeleted > 0 ? value.freedBytes > 0 : value.freedBytes === 0), 'report_counts');
  need(['retiredContainers', 'imagesDeleted', 'directoriesDeleted', 'privateGenerationDeletes', 'acceptedStateWrites']
    .every(key => value[key] === 0), 'report_scope');
  return structuredClone(value);
}

function acceptedFirstPublication(view) {
  need(view.accepted.found && view.accepted.value.pending === null && view.accepted.value.rollback === null
    && view.accepted.value.current?.runtimeSha === FAILED_UPLOAD_CLEANUP_CURRENT.runtimeSha
    && view.accepted.value.current?.generationId === FAILED_UPLOAD_CLEANUP_CURRENT.generationId
    && view.intent.found && view.intent.value.status === 'committed'
    && inspectChinaPublicationState(view).status === 'resolved', 'accepted_state');
}

/** This is local-file retirement only. It cannot reserve, commit or abort a
 * publication, delete a REG generation, switch ingress or alter containers.
 * Test substitutions are in-process only; the CLI has no target/path override. */
export async function runFailedUploadCleanup({root = ROOT, environment = process.env,
  capabilities = {}, now = () => new Date().toISOString(), log = () => {}} = {}) {
  const defaults = {verifyInvocation: verifyFailedUploadCleanupInvocation,
    verifyBaselines: verifyFrozenSpeedBaselines, createStorage: createChinaStateStorage, openSession: openChinaSshSession};
  need(object(capabilities) && Object.keys(capabilities).every(key => Object.hasOwn(defaults, key) && typeof capabilities[key] === 'function')
    && path.isAbsolute(root) && typeof now === 'function' && typeof log === 'function', 'arguments');
  const use = {...defaults, ...capabilities};
  const report = {version: 1, kind: 'china-failed-upload-cleanup-v1', market: 'china', completed: false, status: 'starting',
    current: FAILED_UPLOAD_CLEANUP_CURRENT, filesDeleted: null, freedBytes: null, alreadyAbsentFiles: null,
    acceptedStateWrites: 0, privateGenerationDeletes: 0, leaseRelease: 'not_acquired'};
  let state, lease, expected, session, directory, failure, hostStarted = false, hostSettled = false;
  const readPair = async () => {
    const [accepted, intent] = await Promise.all([state.read('accepted'), state.read('intent')]); return {accepted, intent};
  };
  const assertAuthority = async () => {
    const current = await state.read('lease');
    need(sameObservation(current, lease) && current.value?.status === 'held' && instant(current.value.expiresAt) > instant(now()), 'lease_lost');
    const view = await readPair(); acceptedFirstPublication(view);
    need(sameObservation(view.accepted, expected.accepted) && sameObservation(view.intent, expected.intent), 'state_changed');
    return view;
  };
  try {
    const invocation = use.verifyInvocation({root, environment});
    report.controllerSha = invocation.sourceSha; report.approvedControllerSha = invocation.approvedSourceSha;
    use.verifyBaselines(root);
    const storage = use.createStorage({environment});
    need(typeof storage.assertPrivateBucket === 'function' && (await storage.assertPrivateBucket())?.verified === true, 'privacy');
    state = createChinaState({storage, now}); expected = await readPair(); acceptedFirstPublication(expected);
    const previous = await state.read('lease');
    lease = await state.acquireLease({previous,
      owner: {runId: environment.GITHUB_RUN_ID, attempt: environment.GITHUB_RUN_ATTEMPT, revision: invocation.sourceSha},
      nonce: randomBytes(16).toString('hex'), expiresAt: new Date(instant(now()) + 60 * 60 * 1000).toISOString()});
    report.leaseRelease = 'held';
    await assertAuthority();
    const privateKey = environment.SSH_PRIVATE_KEY;
    need(typeof privateKey === 'string' && privateKey.length > 0, 'ssh_key');
    const temporary = await fs.realpath(environment.RUNNER_TEMP);
    directory = await fs.mkdtemp(path.join(temporary, 'china-failed-upload-cleanup-')); await fs.chmod(directory, 0o700);
    session = await use.openSession({root, directory, privateKey});
    const currentState = await assertAuthority();
    hostStarted = true;
    let raw;
    try { raw = await session.call('prune_failed_uploads', {currentState, leaseExpiresAt: lease.value.expiresAt}); hostSettled = true; }
    catch (error) { hostSettled = /^china_host_[a-z0-9_]+$/.test(error?.message ?? ''); throw error; }
    report.result = validateFailedUploadCleanupReport(raw);
    for (const key of ['filesDeleted', 'freedBytes', 'alreadyAbsentFiles']) report[key] = report.result[key];
    await assertAuthority();
    const closed = await session.close();
    need(closed?.closed === true && closed.readOnly === false, 'close'); session = null;
    report.completed = true; report.status = 'complete';
  } catch (error) {
    failure = Error(safeCode(error)); report.status = 'needs_recheck'; report.errorCode = failure.message;
  } finally {
    // An SSH exit alone cannot prove that the remote unlink sequence settled.
    // Keep the lease through its expiry when the authenticated reply was lost.
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
      const invocation = verifyFailedUploadCleanupInvocation(); verifyFrozenSpeedBaselines(ROOT);
      process.stdout.write(JSON.stringify({phase: 'china_failed_upload_cleanup_verified', controllerSha: invocation.sourceSha}) + '\n');
    } else await runFailedUploadCleanup({log: value => process.stdout.write(JSON.stringify(value) + '\n')});
  } catch (error) { process.stderr.write(safeCode(error) + '\n'); process.exitCode = 1; }
}
