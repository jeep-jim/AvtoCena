import {randomBytes} from 'node:crypto';
import {prepareChinaGeneration} from './prepare-generation.mjs';
import {chinaGenerationRoot} from './generation-storage.mjs';
import {createChinaStateStorage, createChinaState, validateChinaGenerationReference,
  inspectChinaPublicationState, protectedChinaGenerations} from './china-state.mjs';
import {checkedTerminalAppImageCleanupReport, terminalAppImageCleanupPending} from './release-ssh.mjs';

const HASH = /^[a-f0-9]{64}$/, REVISION = /^[a-f0-9]{40}$/;
const need = (value, code) => { if (!value) throw Error('china_daily_' + code); };
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const same = (left, right) => JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
const sameObservation = (left, right) => left.found === right.found && left.etag === right.etag && left.sha256 === right.sha256;
const time = value => {
  need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)), 'clock'); return Date.parse(value);
};
// The fixed cron is 0 14 * * *: each daily window starts at 21:00 Krasnoyarsk.
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000, DAILY_START_UTC_MS = 14 * 60 * 60 * 1000;
const dailyWindow = value => Math.floor((time(value) - DAILY_START_UTC_MS) / DAILY_INTERVAL_MS);
const safeCode = error => /^china_(?:daily|state|prepare|source|generation|private|gc|host)_[a-z0-9_]{1,120}$/.test(error?.message ?? '')
  ? error.message : 'china_daily_failed';
const defaultHeartbeat = (fn, interval) => { const timer = setInterval(fn, interval); timer.unref?.(); return () => clearInterval(timer); };

export function chinaDailyIsDue(reference, at) {
  const accepted = validateChinaGenerationReference(reference, {requireAccepted: true});
  const proof = JSON.parse(Buffer.from(accepted.proof.hostReceiptBase64, 'base64'));
  need(time(at) >= time(proof.acceptedAt), 'clock_before_acceptance');
  // A source observed after midnight still satisfies the preceding 21:00 window,
  // but must not suppress the next evening's update. Acceptance of an older
  // snapshot does not make its source fresh; both clock guards remain mandatory.
  need(time(at) >= time(accepted.sourceObservedAt), 'clock_before_source');
  return dailyWindow(at) !== dailyWindow(accepted.sourceObservedAt);
}

function preparedReference(prepared, owner, previous, plan) {
  const stored = prepared?.privateGeneration, source = prepared?.source, input = prepared?.sourceInput;
  need(prepared?.completed === true && prepared.published === false && prepared.liveCatalogWrites === 0
    && prepared.encyclopediaWrites === 0 && prepared.calculatorFormulaChanges === 0 && prepared.deletions === 0, 'prepared_result');
  need(input?.kind === 'accepted-generation' && same(input.owner, previous.owner) && input.generationId === previous.generationId
    && input.receiptSha256 === previous.receiptSha256 && input.sourceDescriptorSha256 === previous.sourceDescriptorSha256
    && input.runtimeSha === previous.runtimeSha && input.pricingRuntimeSha === previous.pricingRuntimeSha
    && input.sourceCursor === previous.sourceCursor && input.sourceObservedAt === previous.sourceObservedAt, 'source_predecessor');
  need(stored && same(stored.owner, owner) && stored.generationId === `gen_china_${owner.runId}_${owner.attempt}`
    && HASH.test(stored.receiptSha256 ?? '') && HASH.test(stored.sourceDescriptorSha256 ?? '')
    && HASH.test(stored.generationManifestSha256 ?? '') && prepared.runtime?.runtimeSha === plan.runtimeSha
    && prepared.pricing?.runtimeSha === plan.runtimeSha && prepared.pricing.generationId === stored.generationId
    && prepared.pricing.generationManifestSha256 === stored.generationManifestSha256
    && prepared.pricing.sourceDescriptorSha256 === stored.sourceDescriptorSha256, 'prepared_binding');
  need(source?.supplierLatestVerified === true && Number.isSafeInteger(source.sourceCursor)
    && source.sourceCursor >= previous.sourceCursor && time(source.sourceObservedAt) >= time(previous.sourceObservedAt)
    && source.sourceDescriptorSha256 === stored.sourceDescriptorSha256, 'source_not_complete');
  return validateChinaGenerationReference({market: 'china', generationId: stored.generationId, owner,
    receiptSha256: stored.receiptSha256, sourceDescriptorSha256: stored.sourceDescriptorSha256,
    generationManifestSha256: stored.generationManifestSha256, sourceCursor: source.sourceCursor,
    sourceObservedAt: source.sourceObservedAt, runtimeSha: previous.runtimeSha,
    pricingRuntimeSha: plan.runtimeSha, imageId: previous.imageId});
}

/** One daily cycle; no CLI, workflow activation, application build or collection
 * of a neighbour. The entrypoint must authenticate its own actual GitHub event.
 *
 * stageRelease prepares the SAME accepted image against the new private data;
 * it must not switch ingress. It returns {candidate, activate, close}. activate
 * may switch only after receiving the exact reserved intent/ETag and returns
 * {kind:'accepted', evidence:{hostReceiptBase64,hostReceiptSha256,
 * browserSpeedBytes,browserDetailsBytes}}. close ends that host session.
 *
 * recoverRelease is an authenticated read of actual durable host receipts AND
 * the serving/rollback identity, not an inference from failure or timeout. It
 * returns {kind:'accepted'|'rolled_back',evidence} or null while unresolved.
 * No receipt implementation is supplied or fabricated here. */
export async function runChinaDailyCycle({runtimeRoot, plan, invocation, owner, runnerTemp, prepareReportPath,
  trigger = 'schedule', nonce = randomBytes(16).toString('hex'), storage,
  prepare = prepareChinaGeneration, stageRelease, recoverRelease, afterAccepted, resumeCleanup, retirePreviousHost, retireTerminalAppImage,
  now = () => new Date().toISOString(), scheduleHeartbeat = defaultHeartbeat,
  leaseMs = 15 * 60 * 1000, heartbeatMs = 30 * 1000, onProgress = () => {}}) {
  need(invocation?.version === 1 && REVISION.test(invocation.sourceSha ?? '') && owner?.revision === invocation.sourceSha, 'invocation');
  chinaGenerationRoot(owner);
  need(plan?.version === 1 && plan.market === 'china' && plan.minimumYear === 2014 && REVISION.test(plan.runtimeSha ?? ''), 'plan');
  need(['schedule', 'manual'].includes(trigger) && /^[a-f0-9]{32}$/.test(nonce)
    && [prepare, stageRelease, recoverRelease, now, scheduleHeartbeat, onProgress].every(value => typeof value === 'function'), 'capabilities');
  need((afterAccepted === undefined || typeof afterAccepted === 'function')
    && (resumeCleanup === undefined || typeof resumeCleanup === 'function')
    && (retirePreviousHost === undefined || typeof retirePreviousHost === 'function')
    && (retireTerminalAppImage === undefined || typeof retireTerminalAppImage === 'function'), 'retention_capability');
  need(Number.isSafeInteger(leaseMs) && Number.isSafeInteger(heartbeatMs) && heartbeatMs > 0 && leaseMs > heartbeatMs * 2, 'lease_timing');
  storage ??= createChinaStateStorage();
  need(typeof storage.assertPrivateBucket === 'function' && (await storage.assertPrivateBucket())?.verified === true, 'privacy');
  const state = createChinaState({storage, now});
  const report = {version: 1, kind: 'china-daily-cycle-v1', market: 'china', completed: false, published: false,
    status: 'starting', recovered: false, sourcePrepared: false, applicationBuilds: 0, encyclopediaWrites: 0, otherMarketWrites: 0, deletions: 0};
  let lease, expected, staged, closed = false, closeConfirmed = false, stopHeartbeat, authorityFailure, queue = Promise.resolve();
  const retentionAttempted = new Set();
  const serial = work => { const operation = queue.then(work); queue = operation.catch(() => {}); return operation; };
  const at = () => { const value = now(); time(value); return value; };
  const readPair = async () => { const [accepted, intent] = await Promise.all([state.read('accepted'), state.read('intent')]); return {accepted, intent}; };
  async function verifyLease() {
    if (authorityFailure) throw Error(authorityFailure);
    const current = await state.read('lease'), clock = time(at());
    need(lease && sameObservation(current, lease) && current.value?.status === 'held' && time(current.value.expiresAt) > clock, 'lease_lost');
    if (time(lease.value.expiresAt) - clock <= leaseMs / 2)
      lease = await state.renewLease({lease, expiresAt: new Date(clock + leaseMs).toISOString()});
  }
  const assertAuthority = () => serial(async () => {
    await verifyLease();
    if (expected) {
      const current = await readPair();
      need(sameObservation(current.accepted, expected.accepted) && sameObservation(current.intent, expected.intent), 'state_changed');
    }
  });
  const assertLeaseOnly = () => serial(verifyLease);
  const readOwnedState = () => serial(async () => {
    await verifyLease(); const current = await readPair();
    need(sameObservation(current.accepted, expected.accepted) && sameObservation(current.intent, expected.intent), 'state_changed');
    return current;
  });
  async function closeStage() {
    if (!staged || closed) return;
    closed = true; await staged.close(); closeConfirmed = true;
  }
  async function transition(work) {
    return serial(async () => { await verifyLease(); const result = await work(); expected = result; return result; });
  }
  async function reconcile() {
    const view = await serial(async () => { await verifyLease(); return readPair(); });
    const status = inspectChinaPublicationState(view).status;
    expected = view;
    if (status === 'idle' || status === 'resolved') return {kind: 'stable', ...view};
    need(status !== 'conflict', 'state_conflict');
    if (status === 'accepted_needs_finalization') {
      const done = await transition(async () => ({accepted: view.accepted,
        intent: await state.finalize({lease, ...view})}));
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
  async function retainAccepted(view) {
    if (!afterAccepted || !view.accepted.value?.current || view.intent.value?.status !== 'committed') return;
    const generation = view.accepted.value.current.generationId;
    if (retentionAttempted.has(generation)) return;
    retentionAttempted.add(generation);
    try {
      await assertAuthority();
      const value = await afterAccepted({previousAccepted: view.intent.value.previous,
        accepted: view.accepted, intent: view.intent, readState: readOwnedState, assertAuthority});
      report.retention = retentionSummary(value);
      report.deletions += report.retention.deletedObjects ?? 0;
    } catch (error) {
      // Publication already succeeded. Never rerun an uncertain deletion in
      // this invocation, undo acceptance, or copy private object keys to logs.
      report.retention = {completed: false, status: error?.report?.status === 'needs_reconciliation'
        ? 'needs_reconciliation' : 'paused', errorCode: safeCode(error)};
    }
  }
  function retentionSummary(value) {
    need(value?.market === 'china' && typeof value.completed === 'boolean' && /^[a-z0-9_]{1,80}$/.test(value.status ?? ''), 'retention_result');
    const summary = {status: value.status, completed: value.completed};
    if (typeof value.errorCode === 'string') summary.errorCode = safeCode({message: value.errorCode});
    if (typeof value.witnessRemembered === 'boolean' || value.witnessRemembered === null)
      summary.witnessRemembered = value.witnessRemembered;
    for (const key of ['deletedObjects', 'deletedBytes', 'alreadyAbsentObjects', 'enqueued', 'collected', 'pruned', 'pending',
      'retiredContainers', 'filesDeleted', 'freedBytes'])
      if (Number.isSafeInteger(value[key]) && value[key] >= 0) summary[key] = value[key];
    return summary;
  }
  async function resumeRetention() {
    if (!resumeCleanup) return;
    try {
      await assertAuthority();
      report.retentionResume = retentionSummary(await resumeCleanup({readState: readOwnedState, assertAuthority}));
      report.deletions += report.retentionResume.deletedObjects ?? 0;
    } catch (error) {
      report.retentionResume = {completed: false, status: error?.report?.status === 'needs_reconciliation'
        ? 'needs_reconciliation' : 'paused', errorCode: safeCode(error)};
    }
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
      if (required) throw Error('china_daily_app_image_cleanup_pending');
    }
  }
  const complete = (status, published, current = expected?.accepted?.value?.current) => {
    Object.assign(report, {completed: true, status, published, finishedAt: at()});
    if (current) Object.assign(report, {acceptedGenerationId: current.generationId,
      sourceObservedAt: current.sourceObservedAt, sourceCursor: current.sourceCursor});
    return report;
  };
  let originalFailure;
  try {
    const previousLease = await state.read('lease'), clock = time(at());
    if (previousLease.value?.status === 'held' && time(previousLease.value.expiresAt) > clock)
      return complete('lease_busy', false, null);
    lease = await state.acquireLease({previous: previousLease, owner, nonce, expiresAt: new Date(clock + leaseMs).toISOString()});
    stopHeartbeat = scheduleHeartbeat(() => { void assertLeaseOnly().catch(error => { authorityFailure ??= safeCode(error); }); }, heartbeatMs);
    need(typeof stopHeartbeat === 'function', 'heartbeat');
    const recovered = await reconcile();
    need(recovered.kind !== 'unresolved', 'pending_host_outcome');
    const current = expected.accepted.value?.current;
    need(current, 'accepted_source_required');
    validateChinaGenerationReference(current, {requireAccepted: true});
    need(current.pricingRuntimeSha === plan.runtimeSha, 'pricing_runtime_changed');
    await resumeRetention();
    if (trigger === 'schedule' && !chinaDailyIsDue(current, at())) return complete('not_due', false);
    await preservePreviousHost();
    await cleanupTerminalAppImage(true);
    await assertAuthority();
    await onProgress({phase: 'daily_prepare', market: 'china', published: false});
    const prepared = await prepare({runtimeRoot, plan, invocation, owner, runnerTemp, reportPath: prepareReportPath,
      sourceSelection: {kind: 'accepted-generation', generation: current}, assertAuthority, onProgress});
    const candidate = preparedReference(prepared, owner, current, plan);
    report.sourcePrepared = true; report.preparedGenerationId = candidate.generationId;
    await assertAuthority();
    staged = await stageRelease({prepared, candidate, previous: expected.accepted, nonce, assertAuthority});
    need(staged && typeof staged.activate === 'function' && typeof staged.close === 'function', 'stage_result');
    const verifiedCandidate = validateChinaGenerationReference(staged.candidate);
    need(same(verifiedCandidate, candidate), 'staged_binding');
    await assertAuthority();
    const reservation = await transition(async () => {
      const result = await state.reserve({lease, previous: expected.accepted, previousIntent: expected.intent, candidate});
      return {accepted: result.reservation, intent: result.intent};
    });
    await assertAuthority();
    const outcome = await staged.activate({intent: reservation.intent, reservation: reservation.accepted, assertAuthority});
    need(outcome?.kind === 'accepted' && outcome.evidence, 'activation_result');
    const committed = await transition(() => state.commit({lease, intent: reservation.intent, reservation: reservation.accepted, evidence: outcome.evidence}));
    if (typeof staged.afterCommit === 'function') {
      try {
        await assertAuthority();
        const retired = await staged.afterCommit({...committed, assertAuthority});
        report.hostCleanup = {completed: retired?.completed === true,
          retiredContainers: Number.isSafeInteger(retired?.retiredContainers) ? retired.retiredContainers : 0};
        for (const key of ['filesDeleted', 'freedBytes'])
          if (Number.isSafeInteger(retired?.[key]) && retired[key] >= 0) report.hostCleanup[key] = retired[key];
        if (!report.hostCleanup.completed) report.hostCleanupPending = true;
      } catch { report.hostCleanupPending = true; }
    }
    await closeStage();
    await cleanupTerminalAppImage();
    await retainAccepted(committed);
    return complete('accepted', true);
  } catch (error) {
    originalFailure = safeCode(error);
    try { await closeStage(); } catch { /* A missing outcome is reconciled, never guessed. */ }
    if (lease && !authorityFailure) {
      try {
        const result = await reconcile();
        if (result.kind === 'accepted' || result.kind === 'stable' && report.preparedGenerationId
          && result.accepted.value?.current?.generationId === report.preparedGenerationId
          && result.accepted.value.commit?.nonce === nonce) {
          await cleanupTerminalAppImage();
          await retainAccepted(result);
          report.recovered = true; return complete('accepted', true);
        }
        if (result.kind === 'rolled_back') await cleanupTerminalAppImage();
        report.status = result.kind === 'unresolved' ? 'needs_reconciliation'
          : result.kind === 'rolled_back' ? 'rolled_back' : 'failed';
        report.protectedGenerations = protectedChinaGenerations(result).references.length;
      } catch { report.status = 'needs_reconciliation'; }
    } else report.status = lease ? 'needs_reconciliation' : 'failed';
    Object.assign(report, {errorCode: originalFailure, finishedAt: at()});
    const failure = Error(originalFailure); failure.report = report; throw failure;
  } finally {
    stopHeartbeat?.(); await queue;
    if (lease) {
      // Releasing the lease does not erase a pending intent or allow a new
      // publication to skip its actual host outcome. No expiry-based abort.
      try { await state.releaseLease({lease}); report.leaseReleased = true; }
      catch { report.leaseReleasePending = true; /* Never release a different holder. */ }
    }
  }
}
