import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {CHINA_STATE_KEYS, createChinaStateStorage, inspectChinaPublicationState,
  validateChinaAcceptedState, validateChinaGenerationReference, validateChinaLease,
  validateChinaPublicationIntent} from './china-state.mjs';
import {openChinaSshSession} from './release-ssh.mjs';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {verifyFrozenSpeedBaselines} from '../verify-frozen-speed-baselines.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const MARKER = '.github/market-runs/catalog-next-code-outcome-45841493341-readonly.json';
export const REPORT = 'catalog-next-code-outcome-45841493341-readonly-report.json';
export const OPERATION = 'inspect-code-outcome-45841493341';
const WORKFLOW = 'jeep-jim/AvtoCena/.github/workflows/catalog-next-code-outcome-45841493341-readonly.yml@refs/heads/main';
// The failed attempt's immutable image receipt, not the current serving plan.
export const EXACT = Object.freeze({runId: '45841493341', attempt: '1',
  runtimeSha: 'cf932b18644b5317c142ffdeb8f1586526644012',
  imageId: 'sha256:8f385c14a1c0015575f5c33fa2865efa4495d7bd70d64974cde852c262297505',
  nonce: 'ea36fb55d3528a0181a5d7690f441d8a',
  retainedRuntimeSha: '077cbb17626ab0c64e7f06db055fef9252ad21c0'});
const NAMES = Object.freeze(['accepted', 'intent', 'lease']);
const HASH = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).length === expected.length
  && expected.every(key => Object.hasOwn(value, key));
const hash = value => createHash('sha256').update(value).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const encoded = value => Buffer.from(JSON.stringify(ordered(value)));
const instant = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value)
  && Number.isFinite(Date.parse(value));
const etag = value => typeof value === 'string' && /^"[^"\x00-\x20\x7f]{1,250}"$/.test(value);
const sameObservation = (a, b) => a.found === b.found && a.etag === b.etag && a.sha256 === b.sha256;
const need = (value, code) => { if (!value) throw Error('code_outcome_capture_' + code); };
// Error text is never a report field. Even a plausible-looking private string
// is omitted unless it is one of these fixed local/transport failure codes.
const SAFE_ERRORS = new Set([
  ...['workflow', 'capabilities', 'arguments', 'clock', 'ssh_key', 'privacy', 'readonly_request',
    'state_observation', 'state_binding', 'state_read_incomplete', 'target_mismatch', 'state_changed',
    'outcome_shape', 'proof_encoding', 'proof_hash', 'proof_json', 'proof_binding', 'browser_binding',
    'host_close', 'report_size', 'cli_arguments', 'failed'].map(code => 'code_outcome_capture_' + code),
  ...['repository', 'ref_or_attempt', 'event', 'head_format', 'fixed_profile', 'git_unverified',
    'head_mismatch', 'manual_source', 'marker_regular_file', 'marker_json', 'marker_contract',
    'approved_parent', 'marker_only_diff', 'push_event_unverified', 'push_transition'].map(code => 'readonly_invocation_' + code),
  ...['storage_configuration', 'storage_credentials', 'storage_transport', 'storage_response_incomplete',
    'storage_response_size', 'bucket_acl', 'privacy_changed', 'privacy_not_checked', 'object_acl',
    'missing_changed', 'read', 'document', 'canonical_document', 'key'].map(code => 'china_state_' + code),
  ...['owner_only_acl_required', 'bucket_policy_unverified', 'duplicate_policy_keys',
    'bucket_policy_grant_not_supported'].map(code => 'china_private_' + code),
  ...['closed', 'transport', 'input', 'output_bound', 'protocol', 'remote_error', 'recover_timeout',
    'close_timeout', 'start_timeout', 'exit', 'host_pin', 'key_missing'].map(code => 'china_ssh_' + code),
  ...['recovery_identity', 'recovery_directory', 'recovery_plan', 'recovery_conflict', 'recovery_receipt',
    'recovery_browser', 'recovery_code_receipt', 'recovery_rollback', 'recovery_serving_changed',
    'serving_container', 'operation_failed', 'terminated', 'disconnected', 'regular_file', 'file_owner',
    'file_size', 'health_identity', 'mounts_shape', 'mounts_duplicate', 'mounted_reference',
    'mounted_generation', 'mounted_generation_hash', 'mounted_generation_identity', 'predecessor_reference',
    'predecessor_proof', 'predecessor_proof_hash', 'predecessor_state', 'predecessor_state_hash',
    'predecessor_commit', 'predecessor_identity', 'code_only_identity', 'plan_mode', 'plan_scope',
    'plan_revision', 'plan_digest', 'plan_identity', 'plan_files', 'plan_file', 'plan_generation',
    'speed_baseline', 'previous_state', 'code_usability_predecessor', 'code_source_binding',
    'code_storage_proof', 'code_storage_binding', 'code_storage_builder', 'code_storage_bytes',
    'browser_evidence_size', 'browser_evidence_encoding'].map(code => 'china_host_' + code),
]);
const safeError = error => SAFE_ERRORS.has(error?.message) ? error.message : 'code_outcome_capture_failed';

export function verifyInvocation({root = ROOT, environment = process.env} = {}) {
  need(environment.GITHUB_EVENT_NAME === 'push' && environment.GITHUB_WORKFLOW_REF === WORKFLOW
    && environment.GITHUB_JOB === 'inspect', 'workflow');
  return verifyReadonlyInvocation({root, env: environment, markerPath: MARKER, operation: OPERATION});
}

/** Narrow the existing private store to GETs for its three existing keys and
 * privacy metadata. No write/lease/CAS/list capability leaves this adapter. */
export function createReadonlyStateReader({environment = process.env, fetcher = fetch} = {}) {
  const prefix = '/avtocena-staging-8120751';
  const allowed = new Set(Object.values(CHINA_STATE_KEYS).map(key => prefix + '/migration-staging/full-20261011/' + key));
  const storage = createChinaStateStorage({environment, fetcher: async (url, init) => {
    const target = new URL(url), query = [...target.searchParams];
    need(init?.method === 'GET' && init.body === undefined && init.redirect === 'error'
      && target.origin === 'https://s3.regru.cloud' && !target.username && !target.password && !target.hash
      && (target.pathname === prefix
        ? query.length === 1 && ['acl', 'policy'].includes(query[0][0]) && query[0][1] === ''
        : allowed.has(target.pathname) && (query.length === 0
          || query.length === 1 && query[0][0] === 'acl' && query[0][1] === '')), 'readonly_request');
    return fetcher(url, init);
  }});
  return Object.freeze({assertPrivateBucket: () => storage.assertPrivateBucket(), read: name => storage.read(name)});
}

function checkedObservation(name, observation) {
  need(keys(observation, ['found', 'etag', 'sha256', 'value']) && typeof observation.found === 'boolean', 'state_observation');
  if (!observation.found) {
    need(observation.etag === null && observation.sha256 === null && observation.value === null, 'state_observation');
    return {found: false, etag: null, sha256: null, value: null};
  }
  need(etag(observation.etag) && HASH.test(observation.sha256 ?? '')
    && encoded(observation.value).length <= 256 * 1024 && hash(encoded(observation.value)) === observation.sha256, 'state_binding');
  let value;
  try {
    value = ({accepted: validateChinaAcceptedState, intent: validateChinaPublicationIntent, lease: validateChinaLease})[name](observation.value);
  } catch { need(false, 'state_binding'); }
  return {found: true, etag: observation.etag, sha256: observation.sha256, value};
}

const identity = value => value === null ? null : ({runtimeSha: value.runtimeSha, pricingRuntimeSha: value.pricingRuntimeSha,
  imageId: value.imageId, generationId: value.generationId, generationManifestSha256: value.generationManifestSha256,
  privateGenerationReceiptSha256: value.receiptSha256, sourceDescriptorSha256: value.sourceDescriptorSha256,
  hostReceiptSha256: value.proof?.hostReceiptSha256 ?? null});
const tokenHash = value => value === null ? null : hash(value);
const ownerSummary = value => ({runId: value.runId, attempt: value.attempt, revision: value.revision});
const observationIdentity = value => ({found: value.found, etagSha256: tokenHash(value.etag), sha256: value.sha256});

function observationSummary(name, observation) {
  const result = {...observationIdentity(observation), valid: true};
  if (!observation.found) return result;
  const value = observation.value;
  if (name === 'accepted') {
    result.value = {revision: value.revision, current: identity(value.current), rollback: identity(value.rollback),
      pending: value.pending === null ? null : {nonce: value.pending.nonce, intentSha256: value.pending.intentSha256,
        candidateSha256: value.pending.candidateSha256, createdAt: value.pending.createdAt},
      commit: value.commit === null ? null : {nonce: value.commit.nonce, intentSha256: value.commit.intentSha256,
        acceptedAt: value.commit.acceptedAt, previousETagSha256: tokenHash(value.commit.previousETag),
        previousStateSha256: value.commit.previousStateSha256}};
  } else if (name === 'intent') {
    result.value = {revision: value.revision, nonce: value.nonce, owner: ownerSummary(value.owner),
      createdAt: value.createdAt, status: value.status, transition: value.transition ?? null, candidate: identity(value.candidate),
      previous: {...observationIdentity(value.previous), current: identity(value.previous.value?.current ?? null),
        rollback: identity(value.previous.value?.rollback ?? null)},
      resolution: value.resolution === null ? null : {kind: value.resolution.kind, at: value.resolution.at,
        acceptedETagSha256: tokenHash(value.resolution.acceptedETag), acceptedSha256: value.resolution.acceptedSha256,
        hostReceiptSha256: value.resolution.hostReceiptSha256,
        hostRollbackSha256: value.resolution.rollbackProof?.hostRollbackSha256 ?? null}};
  } else {
    result.value = {epoch: value.epoch, nonce: value.nonce, owner: ownerSummary(value.owner), status: value.status,
      acquiredAt: value.acquiredAt, expiresAt: value.expiresAt, releasedAt: value.releasedAt};
  }
  return result;
}

function targetMatches(view) {
  const value = view.intent.value;
  return view.intent.found && value.transition === 'code-update' && value.nonce === EXACT.nonce
    && value.owner.runId === EXACT.runId && value.owner.attempt === EXACT.attempt
    && value.candidate.runtimeSha === EXACT.runtimeSha && value.candidate.imageId === EXACT.imageId
    && value.previous.found && value.previous.value.current?.runtimeSha === EXACT.retainedRuntimeSha;
}

async function readSnapshot(reader, at) {
  const requestedAt = at(), raw = {}, observations = {};
  const values = await Promise.allSettled(NAMES.map(name => reader.read(name)));
  for (let index = 0; index < NAMES.length; index++) {
    const name = NAMES[index], result = values[index];
    try {
      if (result.status !== 'fulfilled') throw result.reason;
      raw[name] = checkedObservation(name, result.value);
      observations[name] = observationSummary(name, raw[name]);
    } catch (error) { observations[name] = {valid: false, errorCode: safeError(error)}; }
  }
  const complete = NAMES.every(name => observations[name].valid);
  const summary = {requestedAt, receivedAt: at(), complete, observations,
    state: complete ? inspectChinaPublicationState(raw).status : 'unverified',
    targetMatches: complete ? targetMatches(raw) : false};
  return {raw: complete ? raw : null, summary};
}

function decodeProof(value, maximum = 64 * 1024) {
  need(typeof value === 'string' && value.length > 0 && value.length <= Math.ceil(maximum / 3) * 4, 'proof_encoding');
  const raw = Buffer.from(value, 'base64');
  need(raw.length > 0 && raw.length <= maximum && raw.toString('base64') === value, 'proof_encoding');
  let decoded; try { decoded = JSON.parse(raw.toString('utf8')); } catch { need(false, 'proof_json'); }
  need(object(decoded), 'proof_json');
  return {raw, decoded};
}

/** Only typed hashes, identities, dates and booleans leave the private proof.
 * Browser payloads, opaque ETags and the original state/receipt never do. */
export function summarizeHostOutcome(outcome, intentObservation) {
  const intent = checkedObservation('intent', intentObservation).value;
  need(intent && targetMatches({intent: intentObservation}), 'target_mismatch');
  if (keys(outcome, ['status']) && outcome.status === 'pending') return {status: 'pending', durableProofPresent: false};
  const rollback = outcome?.status === 'rolled_back';
  need(keys(outcome, rollback ? ['status', 'hostRollbackBase64', 'hostRollbackSha256']
    : ['status', 'hostReceiptBase64', 'hostReceiptSha256', 'browserSpeedBase64', 'browserDetailsBase64'])
    && ['rolled_back', 'accepted'].includes(outcome.status), 'outcome_shape');
  const proofSha256 = rollback ? outcome.hostRollbackSha256 : outcome.hostReceiptSha256;
  const {raw, decoded: receipt} = decodeProof(rollback ? outcome.hostRollbackBase64 : outcome.hostReceiptBase64);
  need(HASH.test(proofSha256 ?? '') && hash(raw) === proofSha256, 'proof_hash');
  const candidate = intent.candidate, previous = intent.previous.value.current;
  need(receipt.version === 1 && receipt.kind === (rollback ? 'china-host-rollback-v1' : 'china-host-acceptance-v1')
    && receipt.nonce === EXACT.nonce && receipt.release === EXACT.runtimeSha && receipt.imageId === EXACT.imageId
    && receipt.pricingRuntimeSha === candidate.pricingRuntimeSha && receipt.generationId === candidate.generationId
    && receipt.generationManifestSha256 === candidate.generationManifestSha256
    && receipt.privateGenerationReceiptSha256 === candidate.receiptSha256
    && receipt.sourceDescriptorSha256 === candidate.sourceDescriptorSha256
    && receipt.previousAcceptedETag === intent.previous.etag && receipt.previousAcceptedStateSha256 === intent.previous.sha256
    && receipt.retainedRuntimeSha === EXACT.retainedRuntimeSha && receipt.retainedImageId === previous.imageId
    && HASH.test(receipt.retainedContainerId ?? ''), 'proof_binding');
  const result = {status: outcome.status, durableProofPresent: true, proofSha256,
    runtimeSha: receipt.release, imageId: receipt.imageId, nonce: receipt.nonce,
    generationId: receipt.generationId, generationManifestSha256: receipt.generationManifestSha256,
    previousAcceptedETagSha256: hash(receipt.previousAcceptedETag), previousAcceptedStateSha256: receipt.previousAcceptedStateSha256,
    retainedRuntimeSha: receipt.retainedRuntimeSha, retainedImageId: receipt.retainedImageId,
    retainedContainerId: receipt.retainedContainerId, stateBindingsMatched: true};
  if (rollback) {
    need(instant(receipt.rolledBackAt) && Date.parse(receipt.rolledBackAt) >= Date.parse(intent.createdAt)
      && receipt.retainedRunning === true && receipt.ingressRestored === true && receipt.candidateRemoved === true, 'proof_binding');
    return {...result, rolledBackAt: receipt.rolledBackAt, retainedRunning: true, ingressRestored: true, candidateRemoved: true};
  }
  try {
    validateChinaGenerationReference({...candidate, proof: {kind: 'china-accepted-proof-v1',
      hostReceiptBase64: outcome.hostReceiptBase64, hostReceiptSha256: proofSha256}}, {requireAccepted: true});
  } catch { need(false, 'proof_binding'); }
  need(receipt.transition === 'code-update' && Date.parse(receipt.acceptedAt) >= Date.parse(intent.createdAt), 'proof_binding');
  const speed = decodeProof(outcome.browserSpeedBase64, 256 * 1024), details = decodeProof(outcome.browserDetailsBase64, 256 * 1024);
  need(hash(speed.raw) === receipt.browser.speedReportSha256 && hash(details.raw) === receipt.browser.detailsReportSha256
    && hash(Buffer.concat([speed.raw, details.raw])) === receipt.browser.reportSha256
    && speed.decoded.release === EXACT.runtimeSha && speed.decoded.passed === true && speed.decoded.browserPassed === true
    && speed.decoded.speedGuard?.passed === true && details.decoded.kind === 'china-browser-details-v1'
    && details.decoded.release === EXACT.runtimeSha && details.decoded.nonce === EXACT.nonce && details.decoded.passed === true
    && details.decoded.generationManifestSha256 === candidate.generationManifestSha256
    && details.decoded.precedingSpeedReportSha256 === receipt.browser.speedReportSha256, 'browser_binding');
  return {...result, acceptedAt: receipt.acceptedAt, browserSpeedSha256: receipt.browser.speedReportSha256,
    browserDetailsSha256: receipt.browser.detailsReportSha256};
}

function conclusion(view, host) {
  const state = inspectChinaPublicationState(view).status, intent = view.intent.value;
  if (host.status === 'pending') return 'host_outcome_pending';
  if (host.status === 'rolled_back') {
    if (state === 'reserved') return 'rollback_proof_available_state_reserved';
    if (state === 'rollback_needs_evidence') return 'rollback_proof_available_intent_pending';
    if (state === 'resolved' && intent.status === 'aborted' && intent.resolution.kind === 'rolled_back'
      && intent.resolution.rollbackProof.hostRollbackSha256 === host.proofSha256) return 'rollback_reconciled';
  } else if (host.status === 'accepted') {
    if (state === 'reserved') return 'acceptance_proof_available_state_reserved';
    if (state === 'accepted_needs_finalization') return 'acceptance_proof_available_intent_pending';
    if (state === 'resolved' && intent.status === 'committed' && intent.resolution.hostReceiptSha256 === host.proofSha256)
      return 'acceptance_reconciled';
  }
  return 'durable_state_conflict';
}

/** This capture does not reconcile, reserve, renew, publish, restore or clean.
 * The sole SSH call is recover in a fresh session without Host initialization;
 * close must acknowledge readOnly:true. Existing recover can use Docker GETs
 * and loopback /api/health to check the retained/current process; neither is a
 * supplier read or a public catalogue/page request. Failure preserves evidence. */
export async function runOutcomeCapture({root = ROOT, environment = process.env, capabilities = {},
  now = () => new Date().toISOString(), log = () => {}} = {}) {
  const defaults = {verifyInvocation, verifyBaselines: verifyFrozenSpeedBaselines,
    createReader: createReadonlyStateReader, openSession: openChinaSshSession};
  need(object(capabilities) && Object.keys(capabilities).every(key => Object.hasOwn(defaults, key) && typeof capabilities[key] === 'function'), 'capabilities');
  need(path.isAbsolute(root) && typeof now === 'function' && typeof log === 'function', 'arguments');
  const use = {...defaults, ...capabilities};
  const at = () => { const value = now(); need(instant(value), 'clock'); return value; };
  const report = {version: 1, kind: 'exact-code-outcome-readonly-v1', selector: EXACT,
    readOnly: true, completed: false, status: 'starting', startedAt: at(), reconciledByThisOperation: false,
    hostMutations: 0, storageWrites: 0, providerCalls: 0, publicPageRequests: 0,
    hostReadCapabilities: ['saved_plan_and_outcome', 'docker_get', 'local_health_get']};
  let reader, before, after, session, directory, failure, stage = 'invocation';
  try {
    const invocation = use.verifyInvocation({root, environment});
    report.controllerSha = invocation.sourceSha; report.approvedControllerSha = invocation.approvedSourceSha;
    use.verifyBaselines(root);
    need(typeof environment.SSH_PRIVATE_KEY === 'string' && environment.SSH_PRIVATE_KEY.length > 0, 'ssh_key');
    stage = 'private_state'; reader = use.createReader({environment});
    need((await reader.assertPrivateBucket())?.verified === true, 'privacy');
    before = await readSnapshot(reader, at); report.before = before.summary;
    need(before.raw, 'state_read_incomplete'); need(before.summary.targetMatches, 'target_mismatch');
    directory = await fs.mkdtemp(path.join(await fs.realpath(environment.RUNNER_TEMP), 'code-outcome-readonly-'));
    await fs.chmod(directory, 0o700);
    stage = 'host_recover';
    report.hostRequestedAt = at();
    session = await use.openSession({root, directory, privateKey: environment.SSH_PRIVATE_KEY});
    const outcome = await session.call('recover', {runtimeSha: EXACT.runtimeSha, nonce: EXACT.nonce});
    report.hostReceivedAt = at(); report.host = summarizeHostOutcome(outcome, before.raw.intent);
    stage = 'host_close';
    const closed = await session.close(); need(closed?.closed === true && closed.readOnly === true, 'host_close');
    report.hostClosedReadOnly = true; session = null;
  } catch (error) {
    failure = Error(safeError(error)); report.errorCode = failure.message; report.failureStage = stage;
  } finally {
    if (session) {
      try { session.abort(); await session.exited; }
      catch { report.transportAbortUnconfirmed = true; }
    }
    if (directory) {
      try { await fs.rm(directory, {recursive: true, force: true}); }
      catch {
        report.localTemporaryCleanupFailed = true;
        if (!failure) {
          failure = Error('code_outcome_capture_failed'); report.errorCode = failure.message; report.failureStage = 'runner_cleanup';
        }
      }
    }
    if (before) {
      after = await readSnapshot(reader, at); report.after = after.summary;
      report.stateStable = Boolean(before.raw && after.raw && NAMES.every(name => sameObservation(before.raw[name], after.raw[name])));
      if (!failure && (!after.raw || !report.stateStable)) {
        failure = Error('code_outcome_capture_' + (after.raw ? 'state_changed' : 'state_read_incomplete'));
        report.errorCode = failure.message; report.failureStage = 'state_recheck';
      }
    }
  }
  if (!failure) {
    report.completed = true; report.status = 'complete'; report.conclusion = conclusion(after.raw, report.host);
  } else { report.status = 'failed'; report.conclusion = 'unverified'; }
  report.finishedAt = at();
  const raw = JSON.stringify(report, null, 2) + '\n'; need(Buffer.byteLength(raw) <= 64 * 1024, 'report_size');
  await fs.writeFile(path.join(root, REPORT), raw, {flag: 'wx', mode: 0o600});
  log(report);
  if (failure) { failure.report = report; throw failure; }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 3 && ['--verify', '--run'].includes(process.argv[2]), 'cli_arguments');
    if (process.argv[2] === '--verify') {
      const invocation = verifyInvocation(); verifyFrozenSpeedBaselines(ROOT);
      process.stdout.write(JSON.stringify({phase: 'code_outcome_capture_verified', controllerSha: invocation.sourceSha,
        failedRunId: EXACT.runId, runtimeSha: EXACT.runtimeSha, readOnly: true}) + '\n');
    } else await runOutcomeCapture({log: value => process.stdout.write(JSON.stringify(value) + '\n')});
  } catch (error) { process.stderr.write(safeError(error) + '\n'); process.exitCode = 1; }
}
