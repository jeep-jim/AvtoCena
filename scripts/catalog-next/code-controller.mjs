import {randomBytes} from 'node:crypto';
import {createChinaState, createChinaStateStorage, validateChinaCodeTransition,
  validateChinaGenerationReference, inspectChinaPublicationState, checkedChinaStateStorageFailure} from './china-state.mjs';
import {checkedServerSpeedReport, checkedHomePhaseTimingReport, checkedJapanServerTimingObservation,
  checkedTerminalAppImageCleanupReport, terminalAppImageCleanupPending} from './release-ssh.mjs';
import {JAPAN_OBSERVED_TIMING_POLICY, japanObservedTimingRequired} from './japan-stability-code-scope.mjs';

const need = (value, code) => { if (!value) throw Error('china_code_' + code); };
const safeCode = error => /^china_[a-z0-9_]{1,150}$/.test(error?.message ?? '') ? error.message : 'china_code_failed';
const sameObservation = (a, b) => a.found === b.found && a.etag === b.etag && a.sha256 === b.sha256;
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const equal = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const defaultHeartbeat = (fn, interval) => { const timer = setInterval(fn, interval); timer.unref?.(); return () => clearInterval(timer); };

/** Explicit app-only transition. There is no supplier client, prepare callback,
 * generation restore, price calculation, source write or private-generation
 * deletion capability. A proved obsolete host deployment must be retired before
 * its committed intent can be replaced by another publication.
 * The existing private lease/intent/CAS state and authentic host receipts remain
 * the sole publication authority, including after a lost acceptance response. */
export async function runChinaCodeCycle({plan, imageId, invocation, owner, storage,
  stageCodeRelease, recoverRelease, preserveRetention, retirePreviousHost, retireTerminalAppImage,
  nonce = randomBytes(16).toString('hex'),
  now = () => new Date().toISOString(), scheduleHeartbeat = defaultHeartbeat,
  leaseMs = 20 * 60 * 1000, heartbeatMs = 30 * 1000, onProgress = () => {}}) {
  need(plan?.version === 1 && plan.market === 'china' && plan.minimumYear === 2014
    && [plan.runtimeSha, plan.retainedRuntime, plan.pricingRuntimeSha].every(value => /^[a-f0-9]{40}$/.test(value ?? ''))
    && plan.runtimeSha !== plan.retainedRuntime && /^sha256:[a-f0-9]{64}$/.test(imageId ?? ''), 'plan');
  need(invocation?.version === 1 && /^[a-f0-9]{40}$/.test(invocation.sourceSha ?? '')
    && owner?.revision === invocation.sourceSha && /^[a-f0-9]{32}$/.test(nonce), 'invocation');
  need([stageCodeRelease, recoverRelease, now, scheduleHeartbeat, onProgress].every(fn => typeof fn === 'function')
    && (preserveRetention === undefined || typeof preserveRetention === 'function')
    && (retirePreviousHost === undefined || typeof retirePreviousHost === 'function')
    && (retireTerminalAppImage === undefined || typeof retireTerminalAppImage === 'function')
    && Number.isSafeInteger(leaseMs) && Number.isSafeInteger(heartbeatMs)
    && heartbeatMs > 0 && leaseMs > heartbeatMs * 2, 'capabilities');
  storage ??= createChinaStateStorage();
  need((await storage.assertPrivateBucket())?.verified === true, 'privacy');
  const state = createChinaState({storage, now});
  const report = {version: 1, kind: 'china-code-cycle-v1', market: 'china', completed: false,
    published: false, status: 'starting', runtimeSha: plan.runtimeSha, retainedRuntime: plan.retainedRuntime,
    sourceRequests: 0, generationRestores: 0, priceCalculations: 0, generationWrites: 0,
    encyclopediaWrites: 0, otherMarketWrites: 0, deletions: 0};
  const observedJapanTiming = japanObservedTimingRequired(plan);
  if (observedJapanTiming) Object.assign(report, {acceptancePolicy: JAPAN_OBSERVED_TIMING_POLICY,
    speedGateRequired: false, speedPassed: null, timingObserved: false});
  let lease, expected, staged, stopHeartbeat, authorityFailure, candidate, closed = false, closeConfirmed = false, queue = Promise.resolve();
  const at = () => {
    const value = now();
    need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value)
      && Number.isFinite(Date.parse(value)), 'clock'); return value;
  };
  const serial = work => { const operation = queue.then(work); queue = operation.catch(() => {}); return operation; };
  const readPair = async () => {
    const [accepted, intent] = await Promise.all([state.read('accepted'), state.read('intent')]); return {accepted, intent};
  };
  async function verifyLease() {
    if (authorityFailure) throw authorityFailure;
    const current = await state.read('lease'), clock = Date.parse(at());
    need(lease && sameObservation(current, lease) && current.value.status === 'held'
      && Date.parse(current.value.expiresAt) > clock, 'lease_lost');
    if (Date.parse(lease.value.expiresAt) - clock <= leaseMs / 2)
      lease = await state.renewLease({lease, expiresAt: new Date(clock + leaseMs).toISOString()});
  }
  const assertLeaseOnly = () => serial(verifyLease);
  const assertAuthority = () => serial(async () => {
    await verifyLease();
    if (expected) {
      const current = await readPair();
      need(sameObservation(current.accepted, expected.accepted) && sameObservation(current.intent, expected.intent), 'state_changed');
    }
  });
  const readOwnedState = () => serial(async () => {
    await verifyLease();
    const current = await readPair();
    need(expected && sameObservation(current.accepted, expected.accepted)
      && sameObservation(current.intent, expected.intent), 'state_changed');
    return current;
  });
  const transition = work => serial(async () => { await verifyLease(); const result = await work(); expected = result; return result; });
  async function reconcile() {
    const view = await serial(async () => { await verifyLease(); return readPair(); });
    expected = view;
    const status = inspectChinaPublicationState(view).status;
    if (status === 'idle' || status === 'resolved') return {kind: 'stable', ...view};
    need(status !== 'conflict', 'state_conflict');
    if (status === 'accepted_needs_finalization') {
      const done = await transition(async () => ({accepted: view.accepted, intent: await state.finalize({lease, ...view})}));
      report.recovered = true; return {kind: 'accepted', ...done};
    }
    if (status === 'unreserved' || status === 'unreserved_abort_needs_finalization') {
      const done = await transition(() => status === 'unreserved'
        ? state.abandonUnreserved({lease, intent: view.intent})
        : state.finalize({lease, ...view}).then(intent => ({accepted: view.accepted, intent})));
      report.recovered = true; return {kind: 'never_reserved', ...done};
    }
    const outcome = await recoverRelease({intent: view.intent, accepted: view.accepted, assertAuthority: assertLeaseOnly});
    if (outcome === null) return {kind: 'unresolved', ...view};
    need(outcome && ['accepted', 'rolled_back'].includes(outcome.kind) && outcome.evidence, 'recovery_result');
    let done;
    if (status === 'reserved') done = await transition(() => outcome.kind === 'accepted'
      ? state.commit({lease, intent: view.intent, reservation: view.accepted, evidence: outcome.evidence})
      : state.abortReserved({lease, intent: view.intent, reservation: view.accepted, evidence: outcome.evidence}));
    else {
      need(status === 'rollback_needs_evidence' && outcome.kind === 'rolled_back', 'recovery_mismatch');
      done = await transition(() => state.finalizeRollback({lease, ...view, evidence: outcome.evidence}));
    }
    report.recovered = true; return {kind: outcome.kind, ...done};
  }
  async function closeStage() {
    if (!staged || closed) return;
    closed = true; await staged.close(); closeConfirmed = true;
  }
  async function preservePreviousHost() {
    if (expected.intent.value?.status !== 'committed' || !expected.intent.value.previous.value?.rollback) return;
    need(typeof retirePreviousHost === 'function', 'host_retirement_capability');
    await assertAuthority();
    const publication = await readOwnedState();
    const result = await retirePreviousHost({previousAccepted: publication.intent.value.previous,
      acceptedPublication: publication, readState: readOwnedState, assertAuthority});
    await assertAuthority();
    need(result?.completed === true && (result.uncertain === undefined || result.uncertain === false)
      && Number.isSafeInteger(result.retiredContainers) && result.retiredContainers >= 0 && result.retiredContainers <= 1
      && ['filesDeleted', 'freedBytes'].every(key => Number.isSafeInteger(result[key]) && result[key] >= 0),
    'host_retirement_incomplete');
    report.hostCleanupBeforeReserve = {completed: true, retiredContainers: result.retiredContainers,
      filesDeleted: result.filesDeleted, freedBytes: result.freedBytes};
  }
  async function cleanupTerminalAppImage(required = false) {
    const intent = expected?.intent?.value;
    const eligible = intent?.status === 'committed' && Boolean(intent.previous?.value?.rollback)
      || intent?.status === 'aborted' && intent.transition === 'code-update' && intent.resolution?.kind === 'rolled_back';
    if (!eligible) return;
    const field = required ? 'appImageCleanupBeforeReserve' : 'appImageCleanup';
    try {
      // A new host session must never contend with an uncertain primary session.
      need(!staged || closeConfirmed, 'app_image_cleanup_session_open');
      need(typeof retireTerminalAppImage === 'function', 'app_image_cleanup_capability');
      await assertAuthority();
      const publication = await readOwnedState();
      need(inspectChinaPublicationState(publication).status === 'resolved', 'app_image_cleanup_state');
      await onProgress({phase: 'app_image_cleanup', market: 'china'});
      const result = checkedTerminalAppImageCleanupReport(await retireTerminalAppImage({
        publication, readState: readOwnedState, assertAuthority}));
      await assertAuthority();
      report[field] = result;
    } catch (error) {
      report[field] = terminalAppImageCleanupPending(error);
      report.appImageCleanupPending = true;
      // The durable terminal witness cannot be replaced until its image cleanup
      // has a known outcome. A finished publication itself remains accepted.
      if (required) throw Error('china_code_app_image_cleanup_pending');
    }
  }
  function complete(status, published) {
    Object.assign(report, {completed: true, status, published, finishedAt: at()});
    const current = expected?.accepted?.value?.current;
    if (current) Object.assign(report, {acceptedGenerationId: current.generationId, acceptedRuntimeSha: current.runtimeSha,
      imageId: current.imageId, sourceObservedAt: current.sourceObservedAt, sourceCursor: current.sourceCursor,
      generationManifestSha256: current.generationManifestSha256});
    return report;
  }
  try {
    const previousLease = await state.read('lease'), clock = Date.parse(at());
    if (previousLease.value?.status === 'held' && Date.parse(previousLease.value.expiresAt) > clock)
      return complete('lease_busy', false);
    lease = await state.acquireLease({previous: previousLease, owner, nonce, expiresAt: new Date(clock + leaseMs).toISOString()});
    stopHeartbeat = scheduleHeartbeat(() => { void assertLeaseOnly().catch(error => {
      if (authorityFailure) return;
      authorityFailure = Error(safeCode(error));
      try { authorityFailure.stateStorageFailure = checkedChinaStateStorageFailure(error?.stateStorageFailure); } catch {}
    }); }, heartbeatMs);
    need(typeof stopHeartbeat === 'function', 'heartbeat');
    const recovered = await reconcile();
    need(recovered.kind !== 'unresolved', 'pending_host_outcome');
    const current = validateChinaGenerationReference(expected.accepted.value?.current, {requireAccepted: true});
    need(current.pricingRuntimeSha === plan.pricingRuntimeSha, 'pricing_changed');
    if (current.runtimeSha === plan.runtimeSha) {
      need(current.imageId === imageId, 'accepted_image_changed');
      return complete('already_accepted', false);
    }
    need(current.runtimeSha === plan.retainedRuntime, 'retained_runtime_changed');
    const {proof, ...data} = current;
    candidate = {...data, runtimeSha: plan.runtimeSha, imageId};
    validateChinaCodeTransition(candidate, current);
    await preservePreviousHost();
    await cleanupTerminalAppImage(true);
    if (preserveRetention) {
      await assertAuthority();
      const retention = await preserveRetention({readState: readOwnedState, assertAuthority});
      need(retention?.market === 'china' && retention.mode === 'enqueue-only' && retention.completed === true
        && (expected.intent.value?.status !== 'committed' || retention.witnessRemembered === true)
        && retention.deletedObjects === 0 && retention.collected === 0 && retention.pruned === 0,
      'retention_not_preserved');
      report.retentionPreserved = true;
      await assertAuthority();
    }
    await assertAuthority(); await onProgress({phase: 'code_stage', market: 'china'});
    staged = await stageCodeRelease({candidate, previous: expected.accepted, nonce, assertAuthority});
    need(staged && typeof staged.activate === 'function' && typeof staged.close === 'function'
      && equal(validateChinaGenerationReference(staged.candidate), candidate), 'staged_binding');
    if (observedJapanTiming) {
      report.serverTiming = checkedJapanServerTimingObservation(staged.serverTiming, {runtimeSha: candidate.runtimeSha, nonce});
      report.timingObserved = true;
    }
    await assertAuthority();
    const reservation = await transition(async () => {
      const result = await state.reserve({lease, previous: expected.accepted, previousIntent: expected.intent,
        candidate, transition: 'code-update'});
      return {accepted: result.reservation, intent: result.intent};
    });
    await assertAuthority(); await onProgress({phase: 'code_activate_and_verify', market: 'china'});
    const outcome = await staged.activate({intent: reservation.intent, reservation: reservation.accepted, assertAuthority});
    need(outcome?.kind === 'accepted' && outcome.evidence, 'activation_result');
    const committed = await transition(() => state.commit({lease, intent: reservation.intent,
      reservation: reservation.accepted, evidence: outcome.evidence}));
    if (typeof staged.afterCommit === 'function') {
      try {
        await assertAuthority();
        const retired = await staged.afterCommit({...committed, assertAuthority});
        report.hostCleanup = {completed: retired?.completed === true,
          retiredContainers: Number.isSafeInteger(retired?.retiredContainers) ? retired.retiredContainers : 0};
        if (!report.hostCleanup.completed) report.hostCleanupPending = true;
      } catch { report.hostCleanupPending = true; }
    }
    await closeStage();
    await cleanupTerminalAppImage();
    return complete('accepted', true);
  } catch (error) {
    const originalFailure = safeCode(error);
    try { await closeStage(); } catch {}
    if (lease && !authorityFailure) {
      try {
        const outcome = await reconcile();
        const {proof: _proof, ...observedCandidate} = outcome.accepted.value?.current ?? {};
        if (candidate && equal(observedCandidate, candidate) && outcome.accepted.value.commit?.nonce === nonce) {
          await cleanupTerminalAppImage();
          report.recovered = true; return complete('accepted', true);
        }
        if (outcome.kind === 'rolled_back') await cleanupTerminalAppImage();
        report.status = outcome.kind === 'unresolved' ? 'needs_reconciliation'
          : outcome.kind === 'rolled_back' ? 'rolled_back' : 'failed';
      } catch { report.status = 'needs_reconciliation'; }
    } else report.status = lease ? 'needs_reconciliation' : 'failed';
    Object.assign(report, {errorCode: originalFailure, finishedAt: at()});
    try { report.stateStorageFailure = checkedChinaStateStorageFailure(error?.stateStorageFailure); } catch {}
    try { if (error?.serverSpeed !== undefined) report.serverSpeedFailure = checkedServerSpeedReport(error.serverSpeed); } catch {}
    try { if (error?.homePhaseTiming !== undefined)
      report.homePhaseTiming = checkedHomePhaseTimingReport(error.homePhaseTiming, {runtimeSha: plan.runtimeSha, nonce}); } catch {}
    const failure = Error(originalFailure); failure.report = report; throw failure;
  } finally {
    stopHeartbeat?.(); await queue;
    if (lease) {
      try { await state.releaseLease({lease}); report.leaseReleased = true; }
      catch { report.leaseReleasePending = true; }
    }
  }
}
