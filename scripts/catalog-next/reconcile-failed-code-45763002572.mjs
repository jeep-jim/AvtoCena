import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createChinaStateStorage, createChinaState, inspectChinaPublicationState} from './china-state.mjs';
import {openChinaSshSession} from './release-ssh.mjs';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {verifyFrozenSpeedBaselines} from '../verify-frozen-speed-baselines.mjs';

export const EXACT = Object.freeze({
  runId: '45763002572', attempt: '1', controllerSha: '82bd91f32e8c261361b64caab799414202fe0501',
  runtimeSha: '9c2a2bb55aec0a1d68d12b9744dff164b9dda053',
  imageId: 'sha256:fb1678ee498af616d06869da66c94dad41331c49c859294343d3b28e576d6d6b',
  nonce: '4ff3d35468b21b4f8a19bae2578f6182',
  previousRuntime: 'd536c1547c4d82a339ed68ced7d8503f09b6810b',
  previousImage: 'sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009',
  generationId: 'gen_china_45655051136_1',
  manifestSha256: '6711203fb59a70c99cda3c725eb4ee70654142b1871b0784516209d2903c0b8d',
  rollbackGenerationId: 'gen_china_45369451603_1',
  rollbackManifestSha256: 'd5745797cc162b82e0c0f0b1f49fef65f18f0d6649666562337183b18084dd75',
  retainedContainerId: 'bf233b651cc4c84afae4b59c2f17279ea2db7475bfeef6158ca012315a7f1c23',
  calculationVersion: '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90',
});
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MARKER = '.github/market-runs/china-reconcile-failed-code-45763002572.json';
const WORKFLOW = 'jeep-jim/AvtoCena/.github/workflows/china-reconcile-failed-code-45763002572.yml@refs/heads/main';
const need = (value, code) => { if (!value) throw Error('china_exact_reconcile_' + code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const equal = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const same = (a, b) => a.found === b.found && a.etag === b.etag && a.sha256 === b.sha256;
const safeError = error => /^(?:china_(?:exact_reconcile|state|host|ssh)|readonly_invocation)_[a-z0-9_]{1,140}$/.test(error?.message ?? '')
  ? error.message : 'china_exact_reconcile_unverified';

export function verifyInvocation(env = process.env) {
  need(env.GITHUB_WORKFLOW_REF === WORKFLOW && env.GITHUB_JOB === 'reconcile', 'workflow');
  const invocation = verifyReadonlyInvocation({root: ROOT, env, markerPath: MARKER,
    operation: 'reconcile-exact-failed-code-45763002572'});
  verifyFrozenSpeedBaselines(ROOT);
  return invocation;
}

export function checkedTargetView(view) {
  const status = inspectChinaPublicationState(view).status;
  const intent = view.intent.value, previous = intent?.previous?.value;
  need(view.intent.found && intent.market === 'china' && intent.transition === 'code-update'
    && intent.nonce === EXACT.nonce && intent.owner.runId === EXACT.runId && intent.owner.attempt === EXACT.attempt
    && intent.owner.revision === EXACT.controllerSha
    && intent.candidate.runtimeSha === EXACT.runtimeSha && intent.candidate.imageId === EXACT.imageId
    && intent.candidate.generationId === EXACT.generationId && intent.candidate.generationManifestSha256 === EXACT.manifestSha256, 'failed_intent');
  need(intent.previous.found && previous?.pending === null
    && previous.current?.runtimeSha === EXACT.previousRuntime && previous.current.imageId === EXACT.previousImage
    && previous.current.generationId === EXACT.generationId && previous.current.generationManifestSha256 === EXACT.manifestSha256
    && previous.rollback?.runtimeSha === EXACT.previousRuntime && previous.rollback.imageId === EXACT.previousImage
    && previous.rollback.generationId === EXACT.rollbackGenerationId
    && previous.rollback.generationManifestSha256 === EXACT.rollbackManifestSha256, 'previous_pair');
  need(['reserved', 'rollback_needs_evidence', 'resolved'].includes(status), 'unrecoverable_state');
  need(view.accepted.found && equal(view.accepted.value.current, previous.current)
    && equal(view.accepted.value.rollback, previous.rollback) && equal(view.accepted.value.commit, previous.commit), 'accepted_pair');
  if (status === 'resolved') need(intent.status === 'aborted' && intent.resolution.kind === 'rolled_back'
    && view.accepted.value.pending === null, 'resolved_outcome');
  else need(intent.status === 'pending', 'intent_not_pending');
  return status;
}

export function checkedRollbackOutcome(outcome, intent) {
  need(outcome?.status === 'rolled_back' && typeof outcome.hostRollbackBase64 === 'string'
    && outcome.hostRollbackBase64.length <= 65536 && /^[a-f0-9]{64}$/.test(outcome.hostRollbackSha256 ?? ''), 'host_outcome');
  const raw = Buffer.from(outcome.hostRollbackBase64, 'base64');
  need(raw.toString('base64') === outcome.hostRollbackBase64 && hash(raw) === outcome.hostRollbackSha256, 'host_proof_hash');
  let receipt; try { receipt = JSON.parse(raw.toString('utf8')); } catch { throw Error('china_exact_reconcile_host_proof_json'); }
  const candidate = intent.value.candidate;
  need(receipt.version === 1 && receipt.kind === 'china-host-rollback-v1'
    && receipt.nonce === EXACT.nonce && receipt.release === EXACT.runtimeSha && receipt.imageId === EXACT.imageId
    && receipt.generationId === EXACT.generationId && receipt.generationManifestSha256 === EXACT.manifestSha256
    && receipt.pricingRuntimeSha === candidate.pricingRuntimeSha
    && receipt.privateGenerationReceiptSha256 === candidate.receiptSha256
    && receipt.sourceDescriptorSha256 === candidate.sourceDescriptorSha256
    && receipt.previousAcceptedETag === intent.value.previous.etag
    && receipt.previousAcceptedStateSha256 === intent.value.previous.sha256
    && receipt.retainedContainerId === EXACT.retainedContainerId && receipt.retainedRuntimeSha === EXACT.previousRuntime
    && receipt.retainedImageId === EXACT.previousImage && receipt.retainedRunning === true
    && receipt.ingressRestored === true && receipt.candidateRemoved === true
    && Number.isFinite(Date.parse(receipt.rolledBackAt)) && Date.parse(receipt.rolledBackAt) >= Date.parse(intent.value.createdAt), 'host_proof_binding');
  return {hostRollbackBase64: outcome.hostRollbackBase64, hostRollbackSha256: outcome.hostRollbackSha256};
}

export async function publicHealth(fetcher = fetch) {
  const response = await fetcher('https://avtocena.com/api/health', {cache: 'no-store', signal: AbortSignal.timeout(15000)});
  need(response.status === 200, 'public_health');
  const reader = response.body?.getReader(); need(reader, 'public_health_body');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength; need(size <= 65536, 'public_health_bound'); chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Error('china_exact_reconcile_public_health_json'); }
  need(value.ok === true && value.releaseSha === EXACT.previousRuntime && value.calculationVersion === EXACT.calculationVersion, 'public_identity');
  return {status: 200, runtimeSha: value.releaseSha, calculationVersion: value.calculationVersion};
}

function summary(view) {
  return {state: inspectChinaPublicationState(view).status, acceptedSha256: view.accepted.sha256,
    intentSha256: view.intent.sha256, revision: view.accepted.value.revision,
    currentRuntimeSha: view.accepted.value.current.runtimeSha, currentGenerationId: view.accepted.value.current.generationId,
    rollbackRuntimeSha: view.accepted.value.rollback.runtimeSha, rollbackGenerationId: view.accepted.value.rollback.generationId};
}

/** The only permitted state changes are an owned lease and the established
 * proof-bound abort/finalize transition. No new intent or acceptance is created. */
export async function reconcileExact({state, readHostOutcome, health = publicHealth, owner,
  now = () => new Date().toISOString(), onProgress = () => {}}) {
  const pair = async () => { const [accepted, intent] = await Promise.all([state.read('accepted'), state.read('intent')]); return {accepted, intent}; };
  const initial = await pair(), initialStatus = checkedTargetView(initial), previousLease = await state.read('lease');
  onProgress('initial_state', summary(initial));
  need(previousLease.found && (previousLease.value.status === 'released' || Date.parse(previousLease.value.expiresAt) <= Date.parse(now())), 'lease_busy');
  // A prior read-only reconciliation can have acquired and released the lease
  // without changing this intent. Pin the failed owner/nonce in the intent and
  // proof; acquire only the freshly observed free lease through its exact CAS.
  const beforeHealth = await health(); onProgress('public_health_before', beforeHealth);
  let lease, result, failure;
  const unchanged = async expected => {
    const view = await pair(); need(same(view.accepted, expected.accepted) && same(view.intent, expected.intent), 'state_changed');
    return view;
  };
  const assertLease = async () => {
    const actual = await state.read('lease');
    need(same(actual, lease) && actual.value.status === 'held' && Date.parse(actual.value.expiresAt) > Date.parse(now()), 'lease_lost');
  };
  try {
    await unchanged(initial); need(same(await state.read('lease'), previousLease), 'lease_changed');
    if (initialStatus !== 'resolved') {
      lease = await state.acquireLease({previous: previousLease, owner, nonce: randomBytes(16).toString('hex'),
        expiresAt: new Date(Date.parse(now()) + 10 * 60 * 1000).toISOString()});
      onProgress('lease', {status: 'held'}); await assertLease(); await unchanged(initial);
    }
    const outcome = await readHostOutcome();
    const evidence = checkedRollbackOutcome(outcome, initial.intent);
    onProgress('durable_host_rollback', {runtimeSha: EXACT.runtimeSha, hostRollbackSha256: evidence.hostRollbackSha256});
    await health(); await unchanged(initial);
    if (lease) await assertLease();
    let final;
    if (initialStatus === 'resolved') {
      need(initial.intent.value.resolution.rollbackProof.hostRollbackSha256 === evidence.hostRollbackSha256, 'resolved_proof_changed');
      final = initial;
    } else if (initialStatus === 'reserved') {
      final = await state.abortReserved({lease, intent: initial.intent, reservation: initial.accepted, evidence});
    } else {
      final = await state.finalizeRollback({lease, ...initial, evidence});
    }
    need(checkedTargetView(final) === 'resolved' && final.accepted.value.pending === null
      && final.intent.value.resolution.rollbackProof.hostRollbackSha256 === evidence.hostRollbackSha256, 'not_resolved');
    onProgress('resolved_state', summary(final));
    const afterHealth = await health(); await unchanged(final); if (lease) await assertLease();
    result = {completed: true, status: initialStatus === 'resolved' ? 'already_resolved' : 'resolved',
      initialState: initialStatus, finalState: 'resolved', previousPairRestored: true,
      hostRollbackSha256: evidence.hostRollbackSha256, beforeHealth, afterHealth,
      acceptedStateWrites: initialStatus === 'reserved' ? 1 : 0, intentStateWrites: initialStatus === 'resolved' ? 0 : 1,
      hostMutations: 0, newPublicationCreated: false, filesDeleted: 0, containersDeleted: 0,
      currentRuntimeSha: EXACT.previousRuntime, currentGenerationId: EXACT.generationId, rollbackGenerationId: EXACT.rollbackGenerationId};
  } catch (error) { failure = error; }
  finally {
    if (lease) {
      try { await state.releaseLease({lease}); onProgress('lease', {status: 'released'}); }
      catch { onProgress('lease', {status: 'unconfirmed'}); failure ??= Error('china_exact_reconcile_lease_release_unconfirmed'); }
    }
  }
  if (failure) throw failure;
  return {...result, leaseReleased: Boolean(lease)};
}

async function main() {
  const invocation = verifyInvocation();
  if (process.argv[2] === '--verify') { process.stdout.write(JSON.stringify(invocation) + '\n'); return; }
  const report = {version: 1, kind: 'china-exact-code-reconciliation-v1', failedRun: EXACT.runId,
    controllerSha: invocation.sourceSha, completed: false, observations: []};
  let directory, session, failure;
  try {
    const storage = createChinaStateStorage(); need((await storage.assertPrivateBucket())?.verified === true, 'privacy');
    const state = createChinaState({storage}), privateKey = process.env.SSH_PRIVATE_KEY;
    need(typeof privateKey === 'string' && privateKey.length > 0, 'ssh_key');
    directory = await fs.mkdtemp(path.join(await fs.realpath(process.env.RUNNER_TEMP), 'exact-code-reconciliation-'));
    await fs.chmod(directory, 0o700);
    const result = await reconcileExact({state, owner: {runId: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT, revision: invocation.sourceSha},
      onProgress: (phase, value) => { report.observations.push({phase, ...value}); process.stdout.write(JSON.stringify({phase, ...value}) + '\n'); },
      readHostOutcome: async () => {
        session = await openChinaSshSession({root: ROOT, directory, privateKey});
        const value = await session.call('recover', {runtimeSha: EXACT.runtimeSha, nonce: EXACT.nonce});
        await session.close(); session = null;
        return value;
      }});
    Object.assign(report, result);
  } catch (error) { failure = Error(safeError(error)); report.errorCode = failure.message; }
  finally {
    if (session) { session.abort(); await session.exited; }
    if (directory) await fs.rm(directory, {recursive: true, force: true});
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(ROOT, 'china-exact-code-reconciliation-45763002572-report.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  }
  process.stdout.write(JSON.stringify(report) + '\n');
  if (failure) throw failure;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 3 && ['--verify', '--run'].includes(process.argv[2]), 'arguments');
    await main();
  } catch (error) { process.stderr.write(safeError(error) + '\n'); process.exitCode = 1; }
}
