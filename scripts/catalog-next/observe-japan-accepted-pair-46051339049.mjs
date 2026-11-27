import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {CHINA_STATE_KEYS, createChinaStateStorage, createChinaState,
  inspectChinaPublicationState} from './china-state.mjs';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {verifyFrozenSpeedBaselines} from '../verify-frozen-speed-baselines.mjs';
import {JAPAN_OBSERVED_TIMING_POLICY, JAPAN_STABILITY_CODE_SCOPE} from './japan-stability-code-scope.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PROFILE = Object.freeze({
  workflowRef: 'jeep-jim/AvtoCena/.github/workflows/japan-accepted-pair-46051339049-readonly.yml@refs/heads/main',
  markerPath: '.github/market-runs/japan-accepted-pair-46051339049-readonly.json',
  operation: 'observe-japan-accepted-pair-46051339049',
  reportName: 'japan-accepted-pair-46051339049-readonly-report.json',
});
export const TARGET = Object.freeze({runId: '46051339049', attempt: '1',
  revision: 'a697a7b1c78a4d362134c2c3ab84dc0be5809a4d',
  runtimeSha: 'b9e9122b75f4e588088d0241476b18df7f047d96', acceptancePolicy: JAPAN_OBSERVED_TIMING_POLICY});
const MAX_REQUESTS = 18, DEADLINE_MS = 120_000, REQUEST_MS = 8_000;
const need = (value, code) => { if (!value) throw Error('japan_accepted_pair_' + code); };
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
const same = (a, b) => a.found === b.found && a.etag === b.etag && a.sha256 === b.sha256;

export function verifyAcceptedPairInvocation({root = ROOT, environment = process.env} = {}) {
  need(environment.GITHUB_ACTIONS === 'true' && environment.GITHUB_WORKFLOW_REF === PROFILE.workflowRef
    && environment.GITHUB_JOB === 'inspect' && /^[1-9][0-9]{0,19}$/.test(environment.GITHUB_RUN_ID ?? ''), 'workflow');
  return verifyReadonlyInvocation({root, env: environment, markerPath: PROFILE.markerPath, operation: PROFILE.operation});
}

/** Only bucket privacy and the three fixed state objects can cross this
 * boundary. The storage capability has no write method; no host or AJ access. */
export function createAcceptedPairReader({environment = process.env, fetcher = globalThis.fetch, now = Date.now} = {}) {
  const bucket = '/avtocena-staging-8120751';
  const allowed = new Set(Object.values(CHINA_STATE_KEYS).map(key => bucket + '/migration-staging/full-20261011/' + key));
  const deadline = now() + DEADLINE_MS; let requests = 0;
  const storage = createChinaStateStorage({environment, fetcher: async (url, init) => {
    const target = new URL(url), query = [...target.searchParams];
    need(init?.method === 'GET' && init.body === undefined && init.redirect === 'error'
      && target.origin === 'https://s3.regru.cloud' && !target.username && !target.password && !target.hash
      && (target.pathname === bucket
        ? query.length === 1 && ['acl', 'policy'].includes(query[0][0]) && query[0][1] === ''
        : allowed.has(target.pathname) && (query.length === 0
          || query.length === 1 && query[0][0] === 'acl' && query[0][1] === '')), 'readonly_request');
    need(++requests <= MAX_REQUESTS && now() < deadline, 'request_budget');
    return fetcher(url, {...init, signal: AbortSignal.any([init.signal,
      AbortSignal.timeout(Math.min(REQUEST_MS, deadline - now()))])});
  }});
  return Object.freeze({assertPrivateBucket: () => storage.assertPrivateBucket(), read: name => storage.read(name)});
}

const referenceSummary = reference => ({...Object.fromEntries(['market', 'generationId', 'owner', 'runtimeSha',
  'pricingRuntimeSha', 'imageId', 'receiptSha256', 'sourceDescriptorSha256', 'generationManifestSha256',
  'sourceCursor', 'sourceObservedAt'].map(key => [key, reference[key]])),
  hostReceiptSha256: reference.proof.hostReceiptSha256});

/** A released lease sandwiches each complete observation, and all three
 * canonical objects must remain identical across two observations. This is
 * evidence about these reads, never permission for a later deletion. */
export async function observeAcceptedPair({reader, now = () => new Date().toISOString()} = {}) {
  need(typeof reader?.assertPrivateBucket === 'function' && typeof reader?.read === 'function', 'reader');
  need((await reader.assertPrivateBucket())?.verified === true, 'privacy');
  // Reuse every existing observation, lease, accepted-state, intent and host
  // proof validator. The required CAS capability is an unconditional refusal.
  const {read} = createChinaState({storage: {read: name => reader.read(name),
    compareAndSwap: async () => { throw Error('japan_accepted_pair_readonly_request'); }}});
  async function snapshot() {
    const firstLease = await read('lease');
    need(firstLease.value?.status !== 'held', 'lease_busy');
    const accepted = await read('accepted'), intent = await read('intent'), lease = await read('lease');
    need(same(firstLease, lease) && lease.value?.status !== 'held', 'state_changed');
    need(inspectChinaPublicationState({accepted, intent}).status === 'resolved'
      && intent.value?.status === 'committed' && accepted.value?.pending === null, 'publication_unresolved');
    need(accepted.value.current && accepted.value.rollback, 'pair_required');
    const saved = intent.value, {proof, ...current} = accepted.value.current;
    need(saved.transition === 'code-update' && saved.owner.runId === TARGET.runId
      && saved.owner.attempt === TARGET.attempt && saved.owner.revision === TARGET.revision
      && current.runtimeSha === TARGET.runtimeSha, 'target_mismatch');
    // Bind the resolved intent to this actual accepted pair, not the planned
    // retainedRuntime in the aggregate release report.
    need(digest(current) === digest(saved.candidate)
      && digest(accepted.value.rollback) === digest(saved.previous.value?.current)
      && accepted.value.commit.nonce === saved.nonce
      && accepted.value.commit.intentSha256 === digest({...saved, status: 'pending', resolution: null})
      && accepted.value.commit.previousETag === saved.previous.etag
      && accepted.value.commit.previousStateSha256 === saved.previous.sha256
      && proof.hostReceiptSha256 === saved.resolution.hostReceiptSha256, 'acceptance_binding');
    const receipt = JSON.parse(Buffer.from(proof.hostReceiptBase64, 'base64').toString('utf8'));
    need(receipt.acceptancePolicy === TARGET.acceptancePolicy && receipt.codeScope === JAPAN_STABILITY_CODE_SCOPE
      && receipt.browser.timingPolicy === TARGET.acceptancePolicy && receipt.browser.speedGateRequired === false
      && receipt.browser.speedPassed === null && receipt.browser.timingObserved === true, 'acceptance_policy');
    return {accepted, intent, lease};
  }
  const first = await snapshot(), final = await snapshot();
  need(['accepted', 'intent', 'lease'].every(name => same(first[name], final[name])), 'state_changed');
  const observedAt = now();
  need(typeof observedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(observedAt)
    && Number.isFinite(Date.parse(observedAt)), 'clock');
  return {version: 1, kind: 'japan-accepted-pair-readonly-v1', target: TARGET, observedAt,
    status: 'verified_current_and_rollback', verified: true, readOnly: true, stateMutations: 0, deletionPermitted: false,
    stableObservation: true, publicationStatus: 'resolved', intentStatus: 'committed',
    acceptancePolicy: TARGET.acceptancePolicy, speedGateRequired: false, speedPassed: null,
    leaseStatus: final.lease.value?.status ?? 'absent', acceptedAt: final.accepted.value.commit.acceptedAt,
    stateSha256: Object.fromEntries(['accepted', 'intent', 'lease'].map(name => [name, final[name].sha256])),
    current: referenceSummary(final.accepted.value.current), rollback: referenceSummary(final.accepted.value.rollback)};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let report;
  try {
    need(process.argv.length === 3 && ['--verify', '--observe'].includes(process.argv[2]), 'arguments');
    const invocation = verifyAcceptedPairInvocation();
    verifyFrozenSpeedBaselines(ROOT);
    if (process.argv[2] === '--verify') {
      process.stdout.write(JSON.stringify({kind: 'japan-accepted-pair-invocation', verified: true,
        controllerSha: invocation.sourceSha, target: TARGET, networkRequests: 0}) + '\n');
    } else {
      report = {...await observeAcceptedPair({reader: createAcceptedPairReader()}), controllerSha: invocation.sourceSha};
    }
  } catch (error) {
    const codes = new Set(['workflow', 'reader', 'privacy', 'readonly_request', 'request_budget', 'lease_busy',
      'state_changed', 'publication_unresolved', 'pair_required', 'target_mismatch', 'acceptance_binding', 'acceptance_policy', 'clock', 'arguments']
      .map(code => 'japan_accepted_pair_' + code));
    report = {version: 1, kind: 'japan-accepted-pair-readonly-v1', target: TARGET, verified: false, status: 'unverified',
      readOnly: true, stateMutations: 0, deletionPermitted: false,
      errorCode: codes.has(error?.message) ? error.message : 'japan_accepted_pair_unavailable'};
    process.exitCode = 1;
  }
  if (report) {
    const text = JSON.stringify(report, null, 2) + '\n';
    need(Buffer.byteLength(text) <= 16 * 1024, 'report_size');
    await fs.writeFile(path.join(ROOT, PROFILE.reportName), text, {mode: 0o600});
    process.stdout.write(text);
  }
}
