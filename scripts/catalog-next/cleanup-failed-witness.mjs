import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {verifyFrozenSpeedBaselines} from '../verify-frozen-speed-baselines.mjs';
import {createChinaStateStorage, createChinaState, inspectChinaPublicationState} from './china-state.mjs';
import {openChinaSshSession} from './release-ssh.mjs';
import {FAILED_UPLOAD_CLEANUP_WITNESS} from './cleanup-failed-uploads.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MARKER = '.github/market-runs/catalog-next-china-failed-witness-cleanup.json';
const WORKFLOW = 'jeep-jim/AvtoCena/.github/workflows/catalog-next-china-failed-witness-cleanup.yml@refs/heads/main';
const REPORT = 'catalog-next-china-failed-witness-cleanup-report.json';
export const FAILED_WITNESS_CLEANUP_CURRENT = Object.freeze({
  runtimeSha: '99c45a3b5d8439bbc1ee34702ba41340ada08125', generationId: 'gen_china_45369451603_1',
});
export const FAILED_WITNESS_CLEANUP_TARGET = FAILED_UPLOAD_CLEANUP_WITNESS;
export const FAILED_WITNESS_CLEANUP_TARGETS = Object.freeze([FAILED_WITNESS_CLEANUP_TARGET, Object.freeze({
  ...FAILED_WITNESS_CLEANUP_TARGET,
  runtimeSha: '860e1ff601c6852eb3b1474982e52e3a5300c4af',
  nonce: 'df9db7228781df26f92a990a011eb1bd',
  planSha256: '27888989f2a0e90e235f7a497fcce912ece493e9f5add5c40005e02ad991d9b2',
  rollbackSha256: 'd550834e33b9cd9bf9b1be10c4c8f5358563d6aa56b2ba87794c9d5df9fdb5dd',
  imageId: 'sha256:3c0389d7fcd0986a850d2f87c3259a75bddff3b0090ed0aef56eb1e190ef2238',
}), Object.freeze({
  ...FAILED_WITNESS_CLEANUP_TARGET,
  runtimeSha: '1518035b9e6b717cd364ae8d13e63d0127899112',
  nonce: '92ec4a21446a23bed345fd789b2b3cc5',
  planSha256: '2b038c3566322b7be1f4e622716b8aed85e6e318fd323d31098db05dbb469964',
  rollbackSha256: '6f86011baf31bf183c5b156586b4c9b8a6aa22a0648c2d5f3de4c6f6e57538e9',
  imageId: 'sha256:0a1d136f6b292f9d027354fe8db3c14e12079e689e3f7b5773a7b014860213ea',
})]);
const TARGET_BYTES = Object.freeze([13041560320, 13041559296, 13041561344]);
const need = (value, code) => { if (!value) throw Error('china_failed_witness_cleanup_' + code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).length === expected.length
  && expected.every(key => Object.hasOwn(value, key));
const natural = value => Number.isSafeInteger(value) && value >= 0;
const sameObservation = (left, right) => left.found === right.found && left.etag === right.etag && left.sha256 === right.sha256;
const safeCode = error => /^(?:china_(?:failed_witness_cleanup|host|ssh|state)|readonly_invocation)_[a-z0-9_]{1,140}$/.test(error?.message ?? '')
  ? error.message : 'china_failed_witness_cleanup_failed';
const instant = value => {
  need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)), 'clock'); return Date.parse(value);
};

/** Verify the exact reviewed controller before reading a credential. Pushes
 * must be marker-only transitions from the already reviewed main tip. */
export function verifyFailedWitnessCleanupInvocation({root = ROOT, environment = process.env} = {}) {
  need(environment.GITHUB_WORKFLOW_REF === WORKFLOW, 'workflow');
  return verifyReadonlyInvocation({root, env: environment, markerPath: MARKER, operation: 'prune-failed-china-witness-after-first-acceptance'});
}

export function validateFailedWitnessCleanupReport(value, targetIndex = 0) {
  need(Number.isInteger(targetIndex) && [0, 1, 2].includes(targetIndex), 'report_target');
  const target = FAILED_WITNESS_CLEANUP_TARGETS[targetIndex];
  need(keys(value, ['version', 'kind', 'phase', 'completed', 'runtimeSha', 'generationId', 'targetIndex', 'targetFailedAttempt', 'earlierBulkFilesAbsent', 'filesDeleted',
    'freedBytes', 'alreadyAbsentFiles', 'diskFreeBytesBefore', 'diskFreeBytesAfter', 'retiredContainers', 'imagesDeleted', 'directoriesDeleted', 'privateGenerationDeletes',
    'acceptedStateWrites', 'intentStateWrites']) && value.version === 1 && value.kind === 'china-failed-witness-prune-v1' && value.phase === 'after-first-acceptance' && value.completed === true
    && value.runtimeSha === FAILED_WITNESS_CLEANUP_CURRENT.runtimeSha && value.generationId === FAILED_WITNESS_CLEANUP_CURRENT.generationId
    && value.targetIndex === targetIndex && keys(value.targetFailedAttempt, Object.keys(target))
    && Object.entries(target).every(([key, expected]) => value.targetFailedAttempt[key] === expected)
    && value.earlierBulkFilesAbsent === 8, 'report_identity');
  need(natural(value.filesDeleted) && natural(value.alreadyAbsentFiles) && value.filesDeleted + value.alreadyAbsentFiles === 4
    && natural(value.freedBytes) && value.freedBytes <= TARGET_BYTES[targetIndex]
    && (value.filesDeleted > 0 ? value.freedBytes > 0 : value.freedBytes === 0)
    && natural(value.diskFreeBytesBefore) && natural(value.diskFreeBytesAfter), 'report_counts');
  need(['retiredContainers', 'imagesDeleted', 'directoriesDeleted', 'privateGenerationDeletes', 'acceptedStateWrites', 'intentStateWrites']
    .every(key => value[key] === 0), 'report_scope');
  return structuredClone(value);
}

function acceptedFirstPublication(view) {
  const status = inspectChinaPublicationState(view).status;
  const current = view.accepted.value?.current;
  need(view.accepted.found && view.accepted.value.pending === null && view.accepted.value.rollback === null
    && current?.runtimeSha === FAILED_WITNESS_CLEANUP_CURRENT.runtimeSha
    && current?.generationId === FAILED_WITNESS_CLEANUP_CURRENT.generationId
    && current?.pricingRuntimeSha === FAILED_WITNESS_CLEANUP_TARGET.pricingRuntimeSha
    && current?.generationManifestSha256 === FAILED_WITNESS_CLEANUP_TARGET.generationManifestSha256
    && current?.receiptSha256 === FAILED_WITNESS_CLEANUP_TARGET.privateGenerationReceiptSha256
    && view.intent.found && view.intent.value.status === 'committed' && status === 'resolved', 'accepted_state');
  const {proof, ...candidate} = current;
  need(isDeepStrictEqual(view.intent.value.candidate, candidate)
    && view.accepted.value.commit.nonce === view.intent.value.nonce, 'accepted_state');
}

/** After real first acceptance, retire only the exact failed 5e, 860e and 151 uploads.
 * It cannot reserve, commit or abort a
 * publication, delete a REG generation, switch ingress or alter containers.
 * Test substitutions are in-process only; the CLI has no target/path override. */
export async function runFailedWitnessCleanup({root = ROOT, environment = process.env,
  capabilities = {}, now = () => new Date().toISOString(), log = () => {}} = {}) {
  const defaults = {verifyInvocation: verifyFailedWitnessCleanupInvocation,
    verifyBaselines: verifyFrozenSpeedBaselines, createStorage: createChinaStateStorage, openSession: openChinaSshSession};
  need(object(capabilities) && Object.keys(capabilities).every(key => Object.hasOwn(defaults, key) && typeof capabilities[key] === 'function')
    && path.isAbsolute(root) && typeof now === 'function' && typeof log === 'function', 'arguments');
  const use = {...defaults, ...capabilities};
  const report = {version: 2, kind: 'china-failed-witness-cleanup-v2', market: 'china', phase: 'after-first-acceptance', completed: false, status: 'starting',
    current: FAILED_WITNESS_CLEANUP_CURRENT, targetFailedAttempts: FAILED_WITNESS_CLEANUP_TARGETS, partialResults: [],
    filesDeleted: null, freedBytes: null, alreadyAbsentFiles: null,
    diskFreeBytesBefore: null, diskFreeBytesAfter: null,
    acceptedStateWrites: 0, intentStateWrites: 0, privateGenerationDeletes: 0, leaseRelease: 'not_acquired'};
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
    directory = await fs.mkdtemp(path.join(temporary, 'china-failed-witness-cleanup-')); await fs.chmod(directory, 0o700);
    session = await use.openSession({root, directory, privateKey});
    for (const targetIndex of [0, 1, 2]) {
      const currentState = await assertAuthority();
      hostStarted = true; hostSettled = false;
      let raw;
      try { raw = await session.call('prune_failed_witness', {currentState, leaseExpiresAt: lease.value.expiresAt, targetIndex}); hostSettled = true; }
      catch (error) { hostSettled = /^china_host_[a-z0-9_]+$/.test(error?.message ?? ''); throw error; }
      report.partialResults.push(validateFailedWitnessCleanupReport(raw, targetIndex));
      await assertAuthority();
    }
    const closed = await session.close();
    need(closed?.closed === true && closed.readOnly === false, 'close'); session = null;
    // Only a fully verified three-target result has an aggregate. On any failure
    // the individual authenticated results remain explicitly partial instead.
    report.results = report.partialResults; delete report.partialResults;
    for (const key of ['filesDeleted', 'freedBytes', 'alreadyAbsentFiles']) report[key] = report.results.reduce((sum, value) => sum + value[key], 0);
    report.diskFreeBytesBefore = report.results[0].diskFreeBytesBefore;
    report.diskFreeBytesAfter = report.results[2].diskFreeBytesAfter;
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
      const invocation = verifyFailedWitnessCleanupInvocation(); verifyFrozenSpeedBaselines(ROOT);
      process.stdout.write(JSON.stringify({phase: 'china_failed_witness_cleanup_verified', controllerSha: invocation.sourceSha}) + '\n');
    } else await runFailedWitnessCleanup({log: value => process.stdout.write(JSON.stringify(value) + '\n')});
  } catch (error) { process.stderr.write(safeCode(error) + '\n'); process.exitCode = 1; }
}
