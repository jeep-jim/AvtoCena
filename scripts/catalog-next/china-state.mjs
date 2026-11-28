import {createHash} from 'node:crypto';
import {signRawGcS3Request} from '../lib/catalog-raw-gc-s3.mjs';
import {privateOwnerAcl, nonGrantingPolicy} from './private-storage.mjs';
import {JAPAN_OBSERVED_TIMING_POLICY, JAPAN_STABILITY_CODE_SCOPE} from './japan-stability-code-scope.mjs';

export const CHINA_STATE_KEYS = Object.freeze(Object.fromEntries(['accepted', 'intent', 'lease']
  .map(name => [name, `catalog/market-rebuild/v1/china/${name}.json`])));
const HASH = /^[a-f0-9]{64}$/, REVISION = /^[a-f0-9]{40}$/, NONCE = /^[a-f0-9]{32}$/;
const LIMIT = 256 * 1024;
const fail = code => { throw Error('china_state_' + code); };
const need = (condition, code) => { if (!condition) fail(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const instant = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value)
  && Number.isFinite(Date.parse(value));
const etag = value => typeof value === 'string' && /^"[^"\x00-\x20\x7f]{1,250}"$/.test(value);
const keys = (value, required, optional = []) => object(value) && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const ordered = value => Array.isArray(value) ? value.map(ordered) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const encoded = value => Buffer.from(JSON.stringify(ordered(value)));
const digest = value => hash(encoded(value));
const equal = (a, b) => digest(a) === digest(b);
const clone = value => JSON.parse(JSON.stringify(value));
const observedTiming = value => value?.timingPolicy === JAPAN_OBSERVED_TIMING_POLICY
  && value.speedGateRequired === false && value.speedPassed === null && value.timingObserved === true;
function immutable(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
function parse(bytes, code) {
  need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= LIMIT, code);
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail(code); }
}
function owner(value) {
  need(keys(value, ['runId', 'attempt', 'revision']) && typeof value.runId === 'string' && /^[1-9]\d{0,19}$/.test(value.runId)
    && typeof value.attempt === 'string' && /^[1-9]\d{0,5}$/.test(value.attempt) && REVISION.test(value.revision ?? ''), 'owner');
}
function hostProof(value, reference) {
  need(keys(value, ['kind', 'hostReceiptBase64', 'hostReceiptSha256']) && value.kind === 'china-accepted-proof-v1'
    && HASH.test(value.hostReceiptSha256 ?? '') && typeof value.hostReceiptBase64 === 'string'
    && value.hostReceiptBase64.length <= 64 * 1024, 'proof');
  const bytes = Buffer.from(value.hostReceiptBase64, 'base64');
  need(bytes.toString('base64') === value.hostReceiptBase64 && hash(bytes) === value.hostReceiptSha256, 'proof_bytes');
  const receipt = parse(bytes, 'host_receipt');
  need(receipt?.version === 1 && receipt.kind === 'china-host-acceptance-v1'
    && receipt.release === reference.runtimeSha && receipt.pricingRuntimeSha === reference.pricingRuntimeSha
    && receipt.generationId === reference.generationId
    && receipt.generationManifestSha256 === reference.generationManifestSha256
    && receipt.privateGenerationReceiptSha256 === reference.receiptSha256
    && receipt.sourceDescriptorSha256 === reference.sourceDescriptorSha256 && receipt.imageId === reference.imageId
    && receipt.sourceCursor === reference.sourceCursor && receipt.sourceObservedAt === reference.sourceObservedAt
    && NONCE.test(receipt.nonce ?? '') && instant(receipt.acceptedAt)
    && Date.parse(receipt.acceptedAt) >= Date.parse(reference.sourceObservedAt)
    && HASH.test(receipt.retainedContainerId ?? ''), 'host_binding');
  const browser = receipt.browser;
  const japanPolicy = receipt.acceptancePolicy === JAPAN_OBSERVED_TIMING_POLICY;
  if (Object.hasOwn(receipt, 'acceptancePolicy')) need(japanPolicy && receipt.transition === 'code-update'
    && receipt.codeScope === JAPAN_STABILITY_CODE_SCOPE, 'timing_policy_scope');
  need(browser?.release === receipt.release && browser.nonce === receipt.nonce && browser.passed === true
    && browser.functionalPassed === true && (japanPolicy ? observedTiming(browser) : browser.speedPassed === true)
    && ['reportSha256', 'speedReportSha256', 'detailsReportSha256'].every(key => HASH.test(browser[key] ?? '')), 'browser_binding');
  if (Object.hasOwn(receipt, 'transition')) {
    need(receipt.transition === 'code-update' && etag(receipt.previousAcceptedETag)
      && HASH.test(receipt.previousAcceptedStateSha256 ?? '') && REVISION.test(receipt.retainedRuntimeSha ?? '')
      && /^sha256:[a-f0-9]{64}$/.test(receipt.retainedImageId ?? '')
      && receipt.retainedRuntimeSha !== receipt.release && receipt.retainedImageId !== receipt.imageId, 'code_update_host_binding');
  }
  return receipt;
}

function rollbackProof(value, intent) {
  need(keys(value, ['kind', 'hostRollbackBase64', 'hostRollbackSha256']) && value.kind === 'china-rollback-proof-v1'
    && HASH.test(value.hostRollbackSha256 ?? '') && typeof value.hostRollbackBase64 === 'string'
    && value.hostRollbackBase64.length <= 64 * 1024, 'rollback_proof');
  const bytes = Buffer.from(value.hostRollbackBase64, 'base64');
  need(bytes.toString('base64') === value.hostRollbackBase64 && hash(bytes) === value.hostRollbackSha256, 'rollback_proof_bytes');
  const receipt = parse(bytes, 'rollback_receipt'), reference = intent.candidate, previous = intent.previous.value?.current;
  need(receipt?.version === 1 && receipt.kind === 'china-host-rollback-v1' && receipt.nonce === intent.nonce
    && receipt.release === reference.runtimeSha && receipt.pricingRuntimeSha === reference.pricingRuntimeSha
    && receipt.generationId === reference.generationId && receipt.generationManifestSha256 === reference.generationManifestSha256
    && receipt.privateGenerationReceiptSha256 === reference.receiptSha256 && receipt.sourceDescriptorSha256 === reference.sourceDescriptorSha256
    && receipt.imageId === reference.imageId && receipt.previousAcceptedETag === intent.previous.etag
    && receipt.previousAcceptedStateSha256 === intent.previous.sha256 && instant(receipt.rolledBackAt)
    && Date.parse(receipt.rolledBackAt) >= Date.parse(intent.createdAt) && HASH.test(receipt.retainedContainerId ?? '')
    && REVISION.test(receipt.retainedRuntimeSha ?? '') && /^sha256:[a-f0-9]{64}$/.test(receipt.retainedImageId ?? '')
    && receipt.retainedRunning === true && receipt.ingressRestored === true && receipt.candidateRemoved === true, 'rollback_binding');
  if (previous) need(receipt.retainedRuntimeSha === previous.runtimeSha && receipt.retainedImageId === previous.imageId, 'rollback_previous');
  return receipt;
}

/** A reference is usable as a source only with requireAccepted:true. A candidate
 * has no proof. Proof bytes come from the authenticated release host, never a
 * locally invented "passed" flag; their SHA and every generation binding persist. */
export function validateChinaGenerationReference(value, {requireAccepted = false} = {}) {
  need(keys(value, ['market', 'generationId', 'owner', 'receiptSha256', 'sourceDescriptorSha256',
    'generationManifestSha256', 'sourceCursor', 'sourceObservedAt', 'runtimeSha', 'pricingRuntimeSha', 'imageId'], ['proof']), 'reference');
  owner(value.owner);
  need(value.market === 'china' && value.generationId === `gen_china_${value.owner.runId}_${value.owner.attempt}`
    && ['receiptSha256', 'sourceDescriptorSha256', 'generationManifestSha256'].every(key => HASH.test(value[key] ?? ''))
    && integer(value.sourceCursor) && instant(value.sourceObservedAt) && REVISION.test(value.runtimeSha ?? '')
    && REVISION.test(value.pricingRuntimeSha ?? '')
    && /^sha256:[a-f0-9]{64}$/.test(value.imageId ?? ''), 'reference_binding');
  if (Object.hasOwn(value, 'proof')) hostProof(value.proof, value);
  else need(!requireAccepted, 'accepted_proof_required');
  return immutable(clone(value));
}

const dataIdentity = reference => Object.fromEntries(['market', 'generationId', 'owner', 'receiptSha256',
  'sourceDescriptorSha256', 'generationManifestSha256', 'sourceCursor', 'sourceObservedAt', 'pricingRuntimeSha']
  .map(key => [key, reference[key]]));

/** A code publication changes only the serving application identity. Its data
 * remains the exact accepted generation; it never relabels or reprices it. */
export function validateChinaCodeTransition(candidate, previous) {
  candidate = validateChinaGenerationReference(candidate);
  previous = validateChinaGenerationReference(previous, {requireAccepted: true});
  need(!Object.hasOwn(candidate, 'proof'), 'candidate_is_not_accepted');
  need(equal(dataIdentity(candidate), dataIdentity(previous)), 'code_update_data_identity');
  need(candidate.runtimeSha !== previous.runtimeSha && candidate.imageId !== previous.imageId, 'code_update_runtime');
  return candidate;
}

function codeTransitionProof(receipt, candidate, previous, previousETag, previousStateSha256) {
  const {proof: _candidateProof, ...unproved} = candidate;
  validateChinaCodeTransition(unproved, previous);
  need(receipt.transition === 'code-update' && receipt.previousAcceptedETag === previousETag
    && receipt.previousAcceptedStateSha256 === previousStateSha256
    && receipt.retainedRuntimeSha === previous.runtimeSha && receipt.retainedImageId === previous.imageId,
  'code_update_predecessor');
  need(receipt.nonce !== hostProof(previous.proof, previous).nonce, 'code_update_nonce');
}

export function validateChinaAcceptedState(value) {
  need(keys(value, ['version', 'kind', 'market', 'revision', 'current', 'rollback', 'commit', 'pending'])
    && value.version === 1 && value.kind === 'china-accepted-state-v1' && value.market === 'china'
    && integer(value.revision) && value.revision > 0, 'accepted_state');
  if (value.current === null) need(value.rollback === null && value.commit === null, 'bootstrap_not_accepted');
  else {
    validateChinaGenerationReference(value.current, {requireAccepted: true});
    const proof = hostProof(value.current.proof, value.current), commit = value.commit;
    need(keys(commit, ['nonce', 'intentSha256', 'previousETag', 'previousStateSha256', 'acceptedAt'])
      && commit.nonce === proof.nonce && HASH.test(commit.intentSha256 ?? '') && commit.acceptedAt === proof.acceptedAt
      && (commit.previousETag === null || etag(commit.previousETag))
      && (commit.previousStateSha256 === null || HASH.test(commit.previousStateSha256 ?? ''))
      && (commit.previousETag === null) === (commit.previousStateSha256 === null), 'commit');
    if (value.rollback !== null) {
      validateChinaGenerationReference(value.rollback, {requireAccepted: true});
      if (proof.transition === 'code-update')
        codeTransitionProof(proof, value.current, value.rollback, commit.previousETag, commit.previousStateSha256);
      else need(value.rollback.generationId !== value.current.generationId, 'rollback_identity');
    }
    else need(proof.transition !== 'code-update', 'code_update_rollback_required');
  }
  if (value.pending !== null) {
    need(keys(value.pending, ['nonce', 'intentSha256', 'candidateSha256', 'createdAt'])
      && NONCE.test(value.pending.nonce ?? '') && HASH.test(value.pending.intentSha256 ?? '')
      && HASH.test(value.pending.candidateSha256 ?? '') && instant(value.pending.createdAt), 'pending');
  }
  return immutable(clone(value));
}

function observation(name, value) {
  need(Object.hasOwn(CHINA_STATE_KEYS, name), 'key');
  need(keys(value, ['found', 'etag', 'sha256', 'value']) && typeof value.found === 'boolean', 'observation');
  if (!value.found) need(value.etag === null && value.sha256 === null && value.value === null, 'absent_observation');
  else {
    need(etag(value.etag) && HASH.test(value.sha256 ?? '') && digest(value.value) === value.sha256, 'observation_binding');
    validate(name, value.value);
  }
  return immutable(clone(value));
}
const absent = () => ({found: false, etag: null, sha256: null, value: null});
const sameObservation = (a, b) => a.found === b.found && a.etag === b.etag && a.sha256 === b.sha256;
function pendingForm(value) { return {...value, status: 'pending', resolution: null}; }
const intentDigest = value => digest(pendingForm(value));

export function validateChinaPublicationIntent(value) {
  need(keys(value, ['version', 'kind', 'market', 'revision', 'nonce', 'owner', 'createdAt', 'candidate', 'previous', 'status', 'resolution'], ['transition'])
    && value.version === 1 && value.kind === 'china-publication-intent-v1' && value.market === 'china'
    && integer(value.revision) && value.revision > 0 && NONCE.test(value.nonce ?? '') && instant(value.createdAt)
    && ['pending', 'committed', 'aborted'].includes(value.status), 'intent');
  owner(value.owner); validateChinaGenerationReference(value.candidate);
  need(!Object.hasOwn(value.candidate, 'proof'), 'candidate_is_not_accepted');
  observation('accepted', value.previous);
  need(!value.previous.found || value.previous.value.pending === null, 'previous_pending');
  if (Object.hasOwn(value, 'transition')) {
    need(value.transition === 'code-update' && value.previous.value?.current, 'code_update_previous_required');
    validateChinaCodeTransition(value.candidate, value.previous.value.current);
  } else need(value.candidate.generationId !== value.previous.value?.current?.generationId, 'candidate_is_current');
  if (value.status === 'pending') need(value.resolution === null, 'pending_resolution');
  else {
    need(keys(value.resolution, ['kind', 'at', 'acceptedETag', 'acceptedSha256', 'hostReceiptSha256'], ['rollbackProof'])
      && instant(value.resolution.at) && etag(value.resolution.acceptedETag) && HASH.test(value.resolution.acceptedSha256 ?? '')
      && (value.status === 'committed'
        ? value.resolution.kind === 'accepted' && HASH.test(value.resolution.hostReceiptSha256 ?? '') && !value.resolution.rollbackProof
        : ['never_reserved', 'rolled_back'].includes(value.resolution.kind) && value.resolution.hostReceiptSha256 === null), 'intent_resolution');
    if (value.resolution.kind === 'rolled_back') rollbackProof(value.resolution.rollbackProof, value);
    else need(!Object.hasOwn(value.resolution, 'rollbackProof'), 'unexpected_rollback_proof');
  }
  return immutable(clone(value));
}

export function validateChinaLease(value) {
  need(keys(value, ['version', 'kind', 'market', 'epoch', 'owner', 'nonce', 'status', 'acquiredAt', 'expiresAt', 'releasedAt'])
    && value.version === 1 && value.kind === 'china-market-lease-v1' && value.market === 'china'
    && integer(value.epoch) && value.epoch > 0 && NONCE.test(value.nonce ?? '')
    && ['held', 'released'].includes(value.status) && instant(value.acquiredAt) && instant(value.expiresAt)
    && Date.parse(value.expiresAt) > Date.parse(value.acquiredAt)
    && (value.status === 'held' ? value.releasedAt === null : instant(value.releasedAt)), 'lease');
  owner(value.owner); return immutable(clone(value));
}
function validate(name, value) {
  if (name === 'accepted') return validateChinaAcceptedState(value);
  if (name === 'intent') return validateChinaPublicationIntent(value);
  if (name === 'lease') return validateChinaLease(value);
  fail('key');
}

const TRANSIENT_READ_CAUSES = new Set(['TIME_LIMIT', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN',
  'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']);
const READ_ATTEMPTS = 2, REQUEST_TIMEOUT_MS = 30_000, READ_BUDGET_MS = 45_000, READ_RETRY_DELAY_MS = 250;

/** Only typed, bounded transport facts may accompany a public release report.
 * URLs, credentials, response bodies and exception text never enter evidence. */
export function checkedChinaStateStorageFailure(value) {
  const fields = ['version', 'kind', 'method', 'target', 'part', 'phase', 'attempts', 'cause'];
  let prototype, descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch { fail('storage_failure_evidence'); }
  need((prototype === Object.prototype || prototype === null)
    && Reflect.ownKeys(descriptors).length === fields.length
    && fields.every(key => Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value')),
  'storage_failure_evidence');
  // Capture own data once; never invoke getters or toJSON while projecting a failure.
  const result = Object.fromEntries(fields.map(key => [key, descriptors[key].value]));
  need(result.version === 1 && result.kind === 'china-state-storage-failure-v1'
    && ['GET', 'PUT'].includes(result.method)
    && ['bucket', 'accepted', 'intent', 'lease'].includes(result.target)
    && ['acl', 'policy', 'document'].includes(result.part)
    && ['headers', 'body'].includes(result.phase)
    && Number.isSafeInteger(result.attempts) && result.attempts >= 1
    && result.attempts <= (result.method === 'GET' ? READ_ATTEMPTS : 1)
    && (result.cause === 'UNKNOWN' || TRANSIENT_READ_CAUSES.has(result.cause)), 'storage_failure_evidence');
  need(result.method !== 'PUT' || result.target !== 'bucket' && result.part === 'document', 'storage_failure_evidence');
  need(result.part !== 'policy' || result.target === 'bucket', 'storage_failure_evidence');
  return Object.freeze(result);
}

function transportCause(error, signal) {
  if (signal.aborted && signal.reason?.name === 'TimeoutError' || error?.name === 'TimeoutError') return 'TIME_LIMIT';
  const code = error?.cause?.code ?? error?.code;
  return TRANSIENT_READ_CAUSES.has(code) ? code : 'UNKNOWN';
}

/** REG capability with exactly three private keys. There are no lists, deletes,
 * unconditional or retried PUTs, generic prefixes or neighbour-state access.
 * Only a transient GET transport failure gets one bounded, freshly signed retry.
 * A lost PUT reply remains the state machine's exact-readback responsibility. */
export function createChinaStateStorage({environment = process.env, fetcher = fetch,
  retryTransientReads = false, clock = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  need(typeof fetcher === 'function' && typeof retryTransientReads === 'boolean'
    && typeof clock === 'function' && typeof pause === 'function', 'storage_capability');
  for (const [key, value] of Object.entries({YC_OBJECT_STORAGE_ENDPOINT: 'https://s3.regru.cloud',
    YC_OBJECT_STORAGE_REGION: 'us-east-1', YC_OBJECT_STORAGE_BUCKET: 'avtocena-staging-8120751',
    YC_OBJECT_STORAGE_PREFIX: 'migration-staging/full-20261011/'})) need(environment[key] === value, 'storage_configuration');
  const accessKeyId = environment.YC_OBJECT_STORAGE_ACCESS_KEY_ID, secretAccessKey = environment.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY;
  need(typeof accessKeyId === 'string' && /^[A-Za-z0-9_+=./-]{1,256}$/.test(accessKeyId)
    && typeof secretAccessKey === 'string' && secretAccessKey.length > 0 && secretAccessKey.length <= 1024
    && !/[\r\n\x00]/.test(secretAccessKey), 'storage_credentials');
  let privacy;
  const request = async (method, name, query = {}, body, headers = {}) => {
    need(name === null || Object.hasOwn(CHINA_STATE_KEYS, name), 'key');
    const target = '/avtocena-staging-8120751' + (name === null ? '' : '/migration-staging/full-20261011/' + CHINA_STATE_KEYS[name]);
    const maxAttempts = method === 'GET' && retryTransientReads ? READ_ATTEMPTS : 1;
    const deadline = clock() + (maxAttempts > 1 ? READ_BUDGET_MS : REQUEST_TIMEOUT_MS);
    for (let attempts = 1; ; attempts++) {
      const at = clock(), remaining = deadline - at;
      need(Number.isSafeInteger(at) && remaining > 0, 'storage_clock');
      const signed = signRawGcS3Request({method, host: 's3.regru.cloud', path: target, query, body: body ?? '', headers,
        region: 'us-east-1', accessKeyId, secretAccessKey, at});
      const signal = AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining));
      let phase = 'headers', responseStatus;
      try {
        const response = await fetcher('https://s3.regru.cloud' + signed.canonicalPath + (signed.canonicalQuery ? '?' + signed.canonicalQuery : ''),
          {method, headers: signed.headers, body, redirect: 'error', signal});
        responseStatus = response.status;
        phase = 'body';
        const parts = []; let size = 0;
        for await (const part of response.body ?? []) {
          size += part.byteLength; need(size <= LIMIT, 'storage_response_size'); parts.push(Buffer.from(part));
        }
        return {status: response.status, data: Buffer.concat(parts, size), etag: response.headers.get('etag')};
      } catch (error) {
        const cause = transportCause(error, signal);
        const failure = Error('china_state_' + (phase === 'headers' ? 'storage_transport' : 'storage_response_incomplete'));
        failure.stateStorageFailure = checkedChinaStateStorageFailure({version: 1, kind: 'china-state-storage-failure-v1',
          method, target: name ?? 'bucket', part: Object.hasOwn(query, 'acl') ? 'acl'
            : Object.hasOwn(query, 'policy') ? 'policy' : 'document', phase, attempts, cause});
        // HTTP/ACL/schema failures are checked outside this transport catch and
        // cannot be retried. An unknown exception (including blocked redirects)
        // also fails closed. Every successful read still undergoes exact CAS,
        // privacy, document and lease-expiry validation in its original caller.
        if (method !== 'GET' || attempts >= maxAttempts || !TRANSIENT_READ_CAUSES.has(cause)
          || responseStatus !== undefined && ![200, 404].includes(responseStatus)
          || deadline - clock() <= READ_RETRY_DELAY_MS) throw failure;
        await pause(READ_RETRY_DELAY_MS);
        if (clock() >= deadline) throw failure;
      }
    }
  };
  async function assertPrivateBucket() {
    const acl = await request('GET', null, {acl: ''}); need(acl.status === 200, 'bucket_acl');
    const ownerId = privateOwnerAcl(acl.data.toString());
    const policy = await request('GET', null, {policy: ''});
    const next = {owner: ownerId, policySha256: nonGrantingPolicy(policy.status, policy.data.toString())};
    if (privacy) need(equal(privacy, next), 'privacy_changed'); else privacy = next;
    return {verified: true};
  }
  async function read(name) {
    need(privacy, 'privacy_not_checked');
    need(Object.hasOwn(CHINA_STATE_KEYS, name), 'key');
    const acl = await request('GET', name, {acl: ''});
    if (acl.status === 404) {
      const missing = await request('GET', name);
      need(missing.status === 404, 'missing_changed'); return immutable(absent());
    }
    need(acl.status === 200 && privateOwnerAcl(acl.data.toString()) === privacy.owner, 'object_acl');
    const result = await request('GET', name); need(result.status === 200 && etag(result.etag), 'read');
    const value = validate(name, parse(result.data, 'document'));
    need(result.data.equals(encoded(value)), 'canonical_document');
    return immutable({found: true, etag: result.etag, sha256: hash(result.data), value});
  }
  async function compareAndSwap(name, previous, next) {
    need(privacy, 'privacy_not_checked'); observation(name, previous); validate(name, next);
    const body = encoded(next); need(body.length <= LIMIT, 'document_size');
    // Native REG conditional PUT expects the opaque ETag without its HTTP quotes.
    // Sign precisely the header being sent; never retry a 409/412 with a fresh ETag.
    const condition = previous.found ? {'if-match': previous.etag.slice(1, -1)} : {'if-none-match': '*'};
    const response = await request('PUT', name, {}, body, {'content-type': 'application/json', 'x-amz-acl': 'private', ...condition});
    if (response.status === 409 || response.status === 412) fail('conflict');
    need(response.status === 200 || response.status === 201, 'write_failed');
  }
  return Object.freeze({assertPrivateBucket, read, compareAndSwap});
}

function emptyAccepted(revision) {
  return {version: 1, kind: 'china-accepted-state-v1', market: 'china', revision,
    current: null, rollback: null, commit: null, pending: null};
}
function reservedValue(intent) {
  const previous = intent.previous.value ?? emptyAccepted(0);
  return {...previous, revision: previous.revision + 1, pending: {nonce: intent.nonce, intentSha256: intentDigest(intent),
    candidateSha256: digest(intent.candidate), createdAt: intent.createdAt}};
}
function rolledBackValue(intent) {
  const previous = intent.previous.value ?? emptyAccepted(0);
  return {...previous, revision: previous.revision + 2, pending: null};
}
function committedMatches(state, intent) {
  if (!state?.current || state.pending !== null || state.commit.nonce !== intent.nonce || state.commit.intentSha256 !== intentDigest(intent)) return false;
  const {proof, ...candidate} = state.current;
  return equal(candidate, intent.candidate) && equal(state.rollback, intent.previous.value?.current ?? null)
    && state.commit.previousETag === intent.previous.etag && state.commit.previousStateSha256 === intent.previous.sha256;
}

/** Read-only reconciliation. A missing host proof never becomes acceptance or
 * rollback by inference from a timeout/expired lease. An unresolved reservation
 * remains protected until its real host outcome can be reconciled. */
export function inspectChinaPublicationState({accepted, intent}) {
  observation('accepted', accepted); observation('intent', intent);
  if (!intent.found) return {status: accepted.value?.pending ? 'conflict' : 'idle'};
  const saved = intent.value;
  if (saved.status !== 'pending') return {status: !accepted.value?.pending && accepted.etag === saved.resolution.acceptedETag
    && accepted.sha256 === saved.resolution.acceptedSha256 ? 'resolved' : 'conflict'};
  if (sameObservation(accepted, saved.previous)) return {status: 'unreserved'};
  if (accepted.found && equal(accepted.value, reservedValue(saved))) return {status: 'reserved'};
  if (accepted.found && committedMatches(accepted.value, saved)) return {status: 'accepted_needs_finalization'};
  const previous = saved.previous.value ?? emptyAccepted(0);
  if (accepted.found && equal(accepted.value, {...previous, revision: previous.revision + 1, pending: null}))
    return {status: 'unreserved_abort_needs_finalization'};
  if (accepted.found && equal(accepted.value, rolledBackValue(saved))) return {status: 'rollback_needs_evidence'};
  return {status: 'conflict'};
}

export function protectedChinaGenerations({accepted, intent}) {
  observation('accepted', accepted); observation('intent', intent);
  const reconciliation = inspectChinaPublicationState({accepted, intent}).status;
  const references = new Map();
  const add = ref => { if (ref) references.set(`${ref.generationId}:${ref.receiptSha256}`, ref); };
  add(accepted.value?.current); add(accepted.value?.rollback);
  // Keep the full intent closure even when the accepted/intent pair is uncertain.
  if (intent.found && (intent.value.status === 'pending' || reconciliation === 'conflict')) {
    add(intent.value.candidate); add(intent.value.previous.value?.current); add(intent.value.previous.value?.rollback);
  }
  return immutable({reconciliation, references: [...references.values()], deletionPermitted: false});
}

function acceptanceProof(candidate, intent, evidence) {
  need(object(evidence), 'acceptance_evidence');
  const proof = {kind: 'china-accepted-proof-v1', hostReceiptBase64: evidence.hostReceiptBase64,
    hostReceiptSha256: evidence.hostReceiptSha256};
  const receipt = hostProof(proof, candidate);
  need(receipt.nonce === intent.nonce && Date.parse(receipt.acceptedAt) >= Date.parse(intent.createdAt), 'acceptance_intent');
  if (intent.transition === 'code-update')
    codeTransitionProof(receipt, candidate, intent.previous.value.current, intent.previous.etag, intent.previous.sha256);
  else need(receipt.transition === undefined, 'unexpected_code_update_proof');
  const speed = parse(evidence.browserSpeedBytes, 'speed_report'), details = parse(evidence.browserDetailsBytes, 'details_report');
  need(hash(evidence.browserSpeedBytes) === receipt.browser.speedReportSha256
    && hash(evidence.browserDetailsBytes) === receipt.browser.detailsReportSha256
    && hash(Buffer.concat([evidence.browserSpeedBytes, evidence.browserDetailsBytes])) === receipt.browser.reportSha256, 'report_hashes');
  const japanPolicy = receipt.acceptancePolicy === JAPAN_OBSERVED_TIMING_POLICY;
  need(speed.release === candidate.runtimeSha && speed.passed === true && (japanPolicy
    ? speed.kind === 'catalog-japan-browser-v1' && speed.codeScope === JAPAN_STABILITY_CODE_SCOPE
      && speed.nonce === intent.nonce && speed.generationManifestSha256 === candidate.generationManifestSha256
      && observedTiming(speed)
    : speed.browserPassed === true && speed.speedGuard?.passed === true), 'speed_report_binding');
  need(details.kind === (japanPolicy ? 'japan-code-browser-details-v1' : 'china-browser-details-v1')
    && details.passed === true && details.release === candidate.runtimeSha
    && details.nonce === intent.nonce && details.generationManifestSha256 === candidate.generationManifestSha256
    && details.precedingSpeedReportSha256 === receipt.browser.speedReportSha256, 'details_report_binding');
  if (japanPolicy) {
    need(observedTiming(details) && details.retainedChinaOraclePassed === true
      && details.unrelatedBrowserBenchmarksExecuted === false && HASH.test(details.oracleSha256 ?? '')
      && speed.oracleSha256 === details.oracleSha256
      && details.japanReportBase64 === evidence.browserSpeedBytes.toString('base64')
      && details.japanReportSha256 === receipt.browser.speedReportSha256, 'japan_timing_report_binding');
    need(['japanFreshnessPassed', 'japanPowerApiPassed', 'japanUiPassed', 'japanVisibilityPassed', 'readOnlyBrowserFence',
      'japanPetrolPowerUiPassed', 'japanDetailPowerInputPassed', 'japanDeliveredCalculationPassed', 'japanFullPagesPassed',
      'japanPagination24Passed', 'japanCatalogWarningRemovedPassed', 'japanModelSelectionPassed', 'japanCombinedFiltersPassed',
      'japanRelatedCardsPassed', 'japanVehiclePolicyPassed', 'japanPowerOrderPassed', 'japanBrandDirectoryPassed']
      .every(key => speed[key] === true)
      && speed.productionMutations === 0 && speed.directSupplierApiRequests === 0
      && Number.isSafeInteger(speed.japanPreviewCalculationRequests)
      && speed.japanPreviewCalculationRequests >= 1 && speed.japanPreviewCalculationRequests <= 2, 'japan_functional_binding');
    if (['japanPriceSortRequired', 'japanPriceSortPassed', 'japanCountDisplayPassed'].some(key => Object.hasOwn(speed, key)))
      need(speed.japanPriceSortRequired === true && speed.japanPriceSortPassed === true
        && speed.japanCountDisplayPassed === true, 'japan_price_sort_binding');
  }
  return {proof, receipt};
}

/** State transitions are private and conditional. Call reserve before any host
 * switch, then commit only after receiving the authenticated host ACCEPTED bytes
 * and the exact two browser reports. This module does not switch the website. */
export function createChinaState({storage, now = () => new Date().toISOString()} = {}) {
  need(typeof storage?.read === 'function' && typeof storage?.compareAndSwap === 'function', 'storage_capability');
  const clock = () => { const value = now(); need(instant(value), 'clock'); return value; };
  const read = async name => observation(name, await storage.read(name));
  async function current(name, expected) {
    observation(name, expected); const actual = await read(name);
    need(sameObservation(actual, expected), 'conflict'); return actual;
  }
  async function writeOnce(name, previous, next) {
    observation(name, previous); validate(name, next);
    let failure = false;
    try { await storage.compareAndSwap(name, previous, next); } catch { failure = true; }
    // A lost PUT response is resolved by exact readback, never by a new PUT.
    const actual = await read(name);
    if (actual.found && actual.sha256 === digest(next) && actual.etag !== previous.etag) return actual;
    if (failure && sameObservation(actual, previous)) fail('write_not_committed');
    fail('conflict');
  }
  async function activeLease(lease) {
    const actual = await current('lease', lease);
    need(actual.found && actual.value.status === 'held' && Date.parse(actual.value.expiresAt) > Date.parse(clock()), 'lease_not_active');
    return actual.value;
  }
  async function acquireLease({previous, owner: holder, nonce, expiresAt}) {
    observation('lease', previous); owner(holder); const at = clock();
    need(NONCE.test(nonce ?? '') && instant(expiresAt) && Date.parse(expiresAt) > Date.parse(at), 'lease_request');
    need(!previous.found || previous.value.status === 'released' || Date.parse(previous.value.expiresAt) <= Date.parse(at), 'lease_held');
    return writeOnce('lease', previous, {version: 1, kind: 'china-market-lease-v1', market: 'china',
      epoch: (previous.value?.epoch ?? 0) + 1, owner: holder, nonce, status: 'held', acquiredAt: at, expiresAt, releasedAt: null});
  }
  async function renewLease({lease, expiresAt}) {
    const previous = await activeLease(lease);
    need(instant(expiresAt) && Date.parse(expiresAt) > Date.parse(previous.expiresAt), 'lease_extension');
    return writeOnce('lease', lease, {...previous, expiresAt});
  }
  async function releaseLease({lease}) {
    const previous = await activeLease(lease);
    return writeOnce('lease', lease, {...previous, status: 'released', releasedAt: clock()});
  }
  async function reserveSavedIntent({lease, intent}) {
    await activeLease(lease); await current('intent', intent);
    need(intent.found && intent.value.status === 'pending', 'intent_not_pending');
    // Use only the recorded previous ETag, even after an interruption.
    const accepted = await read('accepted');
    if (accepted.found && equal(accepted.value, reservedValue(intent.value))) return accepted;
    need(sameObservation(accepted, intent.value.previous), 'conflict');
    return writeOnce('accepted', intent.value.previous, reservedValue(intent.value));
  }
  async function reserve({lease, previous, previousIntent, candidate, transition}) {
    const holder = await activeLease(lease); observation('accepted', previous); observation('intent', previousIntent);
    candidate = validateChinaGenerationReference(candidate);
    need(!Object.hasOwn(candidate, 'proof') && (!previous.found || previous.value.pending === null), 'reservation_pending');
    need(!previousIntent.found || (previousIntent.value.status !== 'pending'
      && previousIntent.value.resolution.acceptedETag === previous.etag && previousIntent.value.resolution.acceptedSha256 === previous.sha256), 'unresolved_intent');
    await current('accepted', previous);
    const value = {version: 1, kind: 'china-publication-intent-v1', market: 'china', revision: (previousIntent.value?.revision ?? 0) + 1,
      nonce: holder.nonce, owner: holder.owner, createdAt: clock(), candidate, previous, status: 'pending', resolution: null,
      ...(transition !== undefined ? {transition} : {})};
    const intent = await writeOnce('intent', previousIntent, value);
    const reservation = await reserveSavedIntent({lease, intent});
    return immutable({intent, reservation});
  }
  async function finalize({lease, intent, accepted}) {
    await activeLease(lease); await current('intent', intent); await current('accepted', accepted);
    need(intent.found && intent.value.status === 'pending', 'intent_not_pending');
    const status = inspectChinaPublicationState({accepted, intent}).status;
    const committed = status === 'accepted_needs_finalization';
    need(committed || status === 'unreserved_abort_needs_finalization', 'resolution_unproved');
    const next = {...intent.value, status: committed ? 'committed' : 'aborted', resolution: {
      kind: committed ? 'accepted' : 'never_reserved', at: clock(), acceptedETag: accepted.etag, acceptedSha256: accepted.sha256,
      hostReceiptSha256: committed ? accepted.value.current.proof.hostReceiptSha256 : null}};
    return writeOnce('intent', intent, next);
  }
  async function commit({lease, intent, reservation, evidence}) {
    await activeLease(lease); await current('intent', intent);
    need(intent.found && intent.value.status === 'pending' && reservation.found
      && equal(reservation.value, reservedValue(intent.value)), 'reservation');
    const {proof, receipt} = acceptanceProof(intent.value.candidate, intent.value, evidence);
    await current('accepted', reservation);
    const next = {...reservation.value, revision: reservation.value.revision + 1,
      current: {...intent.value.candidate, proof}, rollback: intent.value.previous.value?.current ?? null, pending: null,
      commit: {nonce: intent.value.nonce, intentSha256: intentDigest(intent.value), previousETag: intent.value.previous.etag,
        previousStateSha256: intent.value.previous.sha256, acceptedAt: receipt.acceptedAt}};
    const accepted = await writeOnce('accepted', reservation, next);
    const completed = await finalize({lease, intent, accepted});
    return immutable({accepted, intent: completed});
  }
  async function abandonUnreserved({lease, intent}) {
    await activeLease(lease); await current('intent', intent);
    need(intent.found && intent.value.status === 'pending', 'intent_not_pending');
    const previous = intent.value.previous;
    await current('accepted', previous);
    // A revision write fences a concurrent late reservation before cancelling.
    const value = previous.value ?? emptyAccepted(0);
    const accepted = await writeOnce('accepted', previous, {...value, revision: value.revision + 1, pending: null});
    const completed = await finalize({lease, intent, accepted});
    return immutable({accepted, intent: completed});
  }
  async function finalizeRollback({lease, intent, accepted, evidence}) {
    await activeLease(lease); await current('intent', intent); await current('accepted', accepted);
    need(intent.found && intent.value.status === 'pending' && accepted.found
      && equal(accepted.value, rolledBackValue(intent.value)), 'rollback_state');
    const proof = {kind: 'china-rollback-proof-v1', hostRollbackBase64: evidence?.hostRollbackBase64,
      hostRollbackSha256: evidence?.hostRollbackSha256};
    rollbackProof(proof, intent.value);
    const completed = await writeOnce('intent', intent, {...intent.value, status: 'aborted', resolution: {
      kind: 'rolled_back', at: clock(), acceptedETag: accepted.etag, acceptedSha256: accepted.sha256,
      hostReceiptSha256: null, rollbackProof: proof}});
    return immutable({accepted, intent: completed});
  }
  async function abortReserved({lease, intent, reservation, evidence}) {
    await activeLease(lease); await current('intent', intent);
    need(intent.found && intent.value.status === 'pending' && reservation.found
      && equal(reservation.value, reservedValue(intent.value)), 'reservation');
    rollbackProof({kind: 'china-rollback-proof-v1', hostRollbackBase64: evidence?.hostRollbackBase64,
      hostRollbackSha256: evidence?.hostRollbackSha256}, intent.value);
    await current('accepted', reservation);
    const accepted = await writeOnce('accepted', reservation, rolledBackValue(intent.value));
    return finalizeRollback({lease, intent, accepted, evidence});
  }
  return Object.freeze({read, acquireLease, renewLease, releaseLease, reserve, reserveSavedIntent,
    commit, finalize, abandonUnreserved, abortReserved, finalizeRollback});
}
