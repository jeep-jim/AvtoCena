import {HOME_UI, HOME_RUNTIME, GATE_FILES, assertHomeSourceEvidence, verifyHomeGateFiles, sha256} from './contract.mjs';

const need = (value, code) => { if (!value) throw Error('home_ui_acceptance_' + code); };
const sameSet = (a, b) => Array.isArray(a) && a.length === b.length
  && new Set(a).size === a.length && a.every(item => b.includes(item));

export function assertFullServerReceipt(receipt, routes, nonce, phase) {
  need(receipt?.release === HOME_UI.source && receipt.nonce === nonce && receipt.phase === phase, 'server_identity');
  need(receipt.exitCode === 0 && /^[a-f0-9]{64}$/.test(receipt.logSha256 || ''), 'server_execution');
  need(receipt.baselineSha256 === GATE_FILES['docs/operations/2026-11-11-accepted-speed-baseline.json'], 'server_baseline');
  const summary = receipt.summary;
  need(summary?.performanceGate === 'summary' && summary.marketScope === ''
    && summary.functionalPassed === true && summary.acceptedBaselineEnforced === true
    && summary.samples === routes.length * 3 && sameSet(summary.routes, routes)
    && sameSet(summary.acceptedBaselineRoutes, routes), 'server_coverage');
  // Advisory absolute targets may still be slow. The existing program exits
  // unsuccessfully on an enforced frozen-baseline failure; do not redefine it.
  const samples = receipt.phases;
  need(Array.isArray(samples) && samples.length === routes.length * 3, 'server_phases');
  for (const route of routes) for (const p of ['warm','after_ttl','after_directory_ttl']) {
    need(samples.filter(row => row.path === route && row.performanceGate === p && row.functionalPassed === true).length === 1, 'server_phase_missing');
  }
  return receipt;
}

export function assertHomeBrowserVerdict(verdict, nonce) {
  need(/^[a-f0-9]{32}$/.test(nonce), 'browser_nonce');
  need(verdict?.schemaVersion === 1 && verdict.release === HOME_UI.source && verdict.nonce === nonce, 'browser_identity');
  need(verdict.passed === true && verdict.functionalPassed === true && verdict.speedPassed === true
    && /^[a-f0-9]{64}$/.test(verdict.reportSha256 || ''), 'browser_failed');
  return verdict;
}

export function assertHomeInventoryReceipt(inventory) {
  need(inventory?.version === 1 && inventory.status === 'verified_inventory_requires_review'
    && inventory.readOnly === true && inventory.activationAuthorized === false
    && inventory.requiresReviewedRollbackPins === true && inventory.lockMode === 'shared_nonblocking'
    && inventory.supplierRequests === 0 && inventory.mutations === 0
    && Number.isFinite(Date.parse(inventory.observedAt)), 'inventory_kind');
  need(inventory.nginxSha256 === HOME_RUNTIME.nginxSha256 && inventory.candidatePort?.port === 3003
    && inventory.candidatePort.socketListening === false && inventory.candidatePort.dockerReservationVerified === false, 'inventory_ingress');
  const kinds = ['serving','chinaRollback','legacyRollback'];
  need(inventory.containers && sameSet(Object.keys(inventory.containers), kinds)
    && inventory.rollbackPins && sameSet(Object.keys(inventory.rollbackPins), kinds.slice(1)), 'inventory_roles');
  const ids = new Set();
  for (const kind of kinds) {
    const row = inventory.containers[kind], expected = HOME_RUNTIME[kind];
    need(row && Object.entries(expected).every(([key, value]) => row[key] === value), 'inventory_role_identity');
    need(/^[a-f0-9]{64}$/.test(row.id || '') && !ids.has(row.id)
      && Number.isSafeInteger(row.pid) && row.pid > 0 && Number.isFinite(Date.parse(row.startedAt))
      && Number.isSafeInteger(row.restartCount) && row.restartCount >= 0
      && Number.isSafeInteger(row.environmentCount) && row.environmentCount > 0, 'inventory_process');
    ids.add(row.id);
    for (const key of ['environmentSha256','hostConfigSha256','mountsSha256','containerConfigSha256']) {
      need(/^[a-f0-9]{64}$/.test(row[key] || ''), 'inventory_fingerprint');
    }
    if (kind === 'serving') need(row.restartCount === HOME_RUNTIME.serving.restartCount
      && row.startedAt === HOME_RUNTIME.serving.startedAt, 'inventory_serving_restart');
    else need(inventory.rollbackPins[kind] === row.id, 'inventory_rollback_pin');
  }
  return inventory;
}

export function assertReviewedInventory(inventory, reviewedSha256) {
  assertHomeInventoryReceipt(inventory);
  need(/^[a-f0-9]{64}$/.test(reviewedSha256 || '') && sha256(JSON.stringify(inventory)) === reviewedSha256, 'inventory_not_reviewed');
}

/** Reviewable transition controller, deliberately without a production adapter
 * or CLI. Every effect belongs to the future exact host adapter, which must be
 * reviewed against fresh inventory and pinned by the eventual runner. */
export async function acceptReviewedHomeUi(io, context) {
  assertHomeSourceEvidence(context.sourceProof);
  assertReviewedInventory(context.inventory, context.reviewedInventorySha256);
  need(/^[a-f0-9]{32}$/.test(context.nonce || ''), 'nonce');
  const {routes} = verifyHomeGateFiles(context.controllerRoot);
  return io.withRuntimeChangeLock(async () => {
    await io.assertFreshInventory(context.inventory);
    await io.assertNonceUnused(context.nonce);
    await io.verifyPinnedBuildAndRequiredChecks(context.sourceProof);
    await io.verifyExactPrivateBinding();
    // Acquire the existing catalog publication lease conditionally. A busy
    // publisher fails here; this controller never steals or replaces its lease.
    const lease = await io.acquirePublicationLease(context.nonce);
    let candidate, switchAttempted = false, accepted = false, ingressState = 'retained', failure, result;
    try {
      await io.assertLeaseOwned(lease);
      candidate = await io.startExactInactiveCandidate();
      await io.verifyCandidateIdentity(candidate);
      await io.verifyPrivateCardPriceAndAuthParity(candidate);
      assertFullServerReceipt(await io.runFullServerGate(candidate, context.nonce, 'private'), routes, context.nonce, 'private');
      await io.assertLeaseOwned(lease);
      await io.assertFreshInventory(context.inventory, candidate);
      // A reload or transport error can occur after the atomic file update.
      // Attempt a compare-and-swap rollback even when this call throws.
      switchAttempted = true; ingressState = 'unknown';
      await io.switchExactIngressCompareAndSwap(context.inventory, candidate);
      ingressState = 'candidate';
      await io.verifyPublicCandidateIdentity(candidate);
      assertFullServerReceipt(await io.runFullServerGate(candidate, context.nonce, 'public'), routes, context.nonce, 'public');
      // The adapter runs the existing nonce-bound handshake; it must never
      // supply an old successful report or silently accept missing evidence.
      assertHomeBrowserVerdict(await io.waitForRequiredBrowserVerdict(context.nonce), context.nonce);
      await io.assertLeaseOwned(lease);
      await io.verifyCandidateIdentity(candidate);
      await io.recordAcceptedRelease(candidate, context.nonce);
      accepted = true;
      result = {release:HOME_UI.source, servingCalculationVersion:HOME_UI.servingCalculationVersion,
        accepted:true, nonce:context.nonce, ingressState};
    } catch (error) {
      failure = error;
      try {
        if (switchAttempted) {
          // Refuse to overwrite any foreign postimage. If this fails, do not
          // stop a process that may still be receiving traffic.
          await io.restoreExactIngressCompareAndSwap(context.inventory, candidate);
          await io.verifyRetainedPublicIdentity();
          ingressState = 'retained';
        }
        if (candidate) await io.cleanupOnlyOwnedUnroutedCandidate(candidate);
      } catch (rollbackError) {
        ingressState = 'unknown';
        failure = new AggregateError([error, rollbackError], 'home_ui_rollback_unverified');
      }
    } finally {
      try { await io.releaseOnlyOwnedPublicationLease(lease); }
      catch (leaseError) { failure = failure ? new AggregateError([failure, leaseError], 'home_ui_failure_and_lease_cleanup') : leaseError; }
    }
    if (failure) {
      // Keep factual state when cleanup fails after a successful browser gate;
      // an outer finally must not replace it with a stale "not installed" report.
      failure.homeUiOutcome = {release:HOME_UI.source, accepted, ingressState, nonce:context.nonce};
      throw failure;
    }
    return result;
  });
}
