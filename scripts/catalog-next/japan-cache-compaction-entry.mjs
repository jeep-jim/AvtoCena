import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyFrozenSpeedBaselines} from '../verify-frozen-speed-baselines.mjs';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {CHINA_STATE_KEYS, createChinaStateStorage, inspectChinaPublicationState,
  validateChinaLease} from './china-state.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/, RUN = /^[1-9][0-9]{0,19}$/;
export const JAPAN_CACHE_COMPACTION_PROFILE = Object.freeze({
  repository: 'jeep-jim/AvtoCena', repositoryId: '1289722938', ref: 'refs/heads/main',
  workflowRef: 'jeep-jim/AvtoCena/.github/workflows/japan-cache-compaction.yml@refs/heads/main',
  job: 'compact', schedule: '43 * * * *', markerPath: '.github/market-runs/japan-cache-compaction.json',
  operation: 'japan-cache-compaction-v1', reportName: 'japan-cache-compaction-report.json', reportBytes: 32 * 1024,
});
const need = (value, code) => { if (!value) throw Error('japan_cache_compaction_entry_' + code); };
const safeCode = error => /^japan_cache_compaction(?:_entry)?_[a-z0-9_]{1,100}$/.test(error?.message ?? '')
  ? error.message : 'japan_cache_compaction_entry_failed';
const gitAt = root => args => {
  try { return execFileSync('/usr/bin/git', ['--no-optional-locks', '--no-replace-objects', '-c', 'core.fsmonitor=false', ...args],
    {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024,
      env: {PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}}); }
  catch { throw Error('japan_cache_compaction_entry_git_unverified'); }
};

/** GitHub supplies the event; neither a local marker nor a requested SHA can
 * replace it. The first operation is a separate marker-only main push. */
export async function verifyJapanCacheCompactionInvocation({root = ROOT, environment = process.env,
  git = gitAt(root), event} = {}) {
  const p = JAPAN_CACHE_COMPACTION_PROFILE;
  need(environment.GITHUB_ACTIONS === 'true' && environment.GITHUB_REPOSITORY === p.repository
    && environment.GITHUB_REPOSITORY_ID === p.repositoryId && environment.GITHUB_REF === p.ref
    && environment.GITHUB_WORKFLOW_REF === p.workflowRef && environment.GITHUB_JOB === p.job, 'workflow');
  need(environment.GITHUB_RUN_ATTEMPT === '1', 'attempt');
  need(RUN.test(environment.GITHUB_RUN_ID ?? '') && SHA.test(environment.GITHUB_SHA ?? '')
    && ['push', 'schedule', 'workflow_dispatch'].includes(environment.GITHUB_EVENT_NAME), 'event');
  const sourceSha = git(['rev-parse', '--verify', 'HEAD']).trim();
  need(sourceSha === environment.GITHUB_SHA, 'controller_identity');
  git(['diff', '--quiet', '--no-ext-diff', '--no-textconv', 'HEAD', '--']);
  need(git(['ls-files', '--others', '--exclude-standard', '-z']) === '', 'untracked_checkout');
  let invocation;
  if (environment.GITHUB_EVENT_NAME === 'push') {
    invocation = verifyReadonlyInvocation({root, env: environment, markerPath: p.markerPath, operation: p.operation});
  } else {
    if (event === undefined) {
      try {
        const bytes = await fs.readFile(environment.GITHUB_EVENT_PATH);
        need(bytes.length > 0 && bytes.length <= 256 * 1024, 'event_size');
        event = JSON.parse(bytes.toString('utf8'));
      } catch { throw Error('japan_cache_compaction_entry_event_file'); }
    }
    if (environment.GITHUB_EVENT_NAME === 'schedule') need(event?.schedule === p.schedule, 'schedule');
    else need(environment.EXPECTED_CONTROLLER_SHA === sourceSha
      && event?.inputs?.expected_controller_sha === sourceSha, 'manual_revision');
    invocation = {version: 1, event: environment.GITHUB_EVENT_NAME, sourceSha, approvedSourceSha: sourceSha, markerPath: null};
  }
  return Object.freeze({...invocation, runId: environment.GITHUB_RUN_ID, attempt: '1'});
}

const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
const identity = value => ({found: value.found, etag: value.etag, sha256: value.sha256});
const same = (a, b) => a.found === b.found && a.etag === b.etag && a.sha256 === b.sha256;
const publicationCodes = new Set(['lease_busy', 'publication_unresolved', 'publication_current_or_rollback_required',
  'publication_changed', 'publication_unavailable', 'publication_stopped'].map(code => 'japan_cache_compaction_entry_' + code));
function safePublicationFailure(error) {
  return Error(publicationCodes.has(error?.message) ? error.message : 'japan_cache_compaction_entry_publication_unavailable');
}
function checkedLease(value) {
  need(value && typeof value.found === 'boolean', 'publication_unavailable');
  if (!value.found) need(value.etag === null && value.sha256 === null && value.value === null, 'publication_unavailable');
  else {
    need(typeof value.etag === 'string' && /^"[^"\x00-\x20\x7f]{1,250}"$/.test(value.etag)
      && HASH.test(value.sha256 ?? '') && digest(value.value) === value.sha256, 'publication_unavailable');
    validateChinaLease(value.value);
    // An expired holder is still a holder. This operation cannot infer recovery,
    // acquire the China lease, extend its TTL or overwrite its owner.
    need(value.value.status !== 'held', 'lease_busy');
  }
  return value;
}

/** Read-only publication capability. All requests use the core's bounded fetch,
 * including bucket/object ACL checks; there is no independent network budget. */
export async function createJapanCachePublicationFence({environment = process.env, fetcher = globalThis.fetch,
  now = Date.now, storage} = {}) {
  let stateStorage;
  try {
    need(typeof fetcher === 'function' && typeof now === 'function', 'publication_unavailable');
    const bucketPath = '/avtocena-staging-8120751';
    const statePaths = new Set(Object.values(CHINA_STATE_KEYS).map(key => bucketPath + '/migration-staging/full-20261011/' + key));
    const readOnlyFetch = async (url, options = {}) => {
      const target = new URL(url);
      need(target.origin === 'https://s3.regru.cloud' && !target.username && !target.password && !target.hash
        && options.method === 'GET' && options.body === undefined, 'publication_unavailable');
      const query = [...target.searchParams];
      const allowedBucket = target.pathname === bucketPath && query.length === 1
        && ['acl', 'policy'].includes(query[0][0]) && query[0][1] === '';
      const allowedState = statePaths.has(target.pathname) && (query.length === 0
        || query.length === 1 && query[0][0] === 'acl' && query[0][1] === '');
      need(allowedBucket || allowedState, 'publication_unavailable');
      return fetcher(url, options);
    };
    stateStorage = storage ?? createChinaStateStorage({environment: {
      YC_OBJECT_STORAGE_ENDPOINT: 'https://s3.regru.cloud', YC_OBJECT_STORAGE_REGION: 'us-east-1',
      YC_OBJECT_STORAGE_BUCKET: 'avtocena-staging-8120751', YC_OBJECT_STORAGE_PREFIX: 'migration-staging/full-20261011/',
      YC_OBJECT_STORAGE_ACCESS_KEY_ID: environment.REGCLOUD_S3_ACCESS_KEY_ID,
      YC_OBJECT_STORAGE_SECRET_ACCESS_KEY: environment.REGCLOUD_S3_SECRET_ACCESS_KEY,
    }, fetcher: readOnlyFetch});
    need(typeof stateStorage?.assertPrivateBucket === 'function' && typeof stateStorage?.read === 'function', 'publication_unavailable');
    need((await stateStorage.assertPrivateBucket())?.verified === true, 'publication_unavailable');
  } catch (error) { throw safePublicationFailure(error); }

  async function snapshot() {
    const firstLease = checkedLease(await stateStorage.read('lease'));
    const accepted = await stateStorage.read('accepted'), intent = await stateStorage.read('intent');
    const lastLease = checkedLease(await stateStorage.read('lease'));
    need(same(firstLease, lastLease), 'publication_changed');
    need(inspectChinaPublicationState({accepted, intent}).status === 'resolved'
      && intent.value?.status === 'committed' && accepted.value?.pending === null, 'publication_unresolved');
    // The existing state validators verify both authenticated host acceptance
    // proofs. No current or rollback reference is synthesized by this task.
    need(accepted.value?.current && accepted.value?.rollback, 'publication_current_or_rollback_required');
    return Object.freeze({accepted: Object.freeze(identity(accepted)), intent: Object.freeze(identity(intent)),
      lease: Object.freeze(identity(lastLease))});
  }
  let baseline;
  try { baseline = await snapshot(); } catch (error) { throw safePublicationFailure(error); }
  let blocked = false;
  return Object.freeze({
    summary: Object.freeze({status: 'resolved_committed', currentAndRollbackVerified: true,
      observationsBound: true, leaseHeld: false, stateMutations: 0}),
    async beforeMutation() {
      need(!blocked, 'publication_stopped');
      try {
        const current = await snapshot();
        need(['accepted', 'intent', 'lease'].every(name => same(current[name], baseline[name])), 'publication_changed');
        return true;
      } catch (error) { blocked = true; throw safePublicationFailure(error); }
    },
  });
}

/** Production entry exposes only the fixed operation. Test capabilities are
 * functions injected by local tests, never CLI paths or workflow input code. */
export async function runJapanCacheCompactionEntry({root = ROOT, environment = process.env, capabilities = {}} = {}) {
  const defaults = {verifyInvocation: verifyJapanCacheCompactionInvocation, verifyBaselines: verifyFrozenSpeedBaselines,
    createPublicationFence: createJapanCachePublicationFence,
    runCompaction: args => import('./japan-cache-compaction.mjs').then(module => module.runJapanCacheCompaction(args))};
  need(capabilities && Object.keys(capabilities).every(key => Object.hasOwn(defaults, key)
    && typeof capabilities[key] === 'function'), 'capabilities');
  const use = {...defaults, ...capabilities}, p = JAPAN_CACHE_COMPACTION_PROFILE;
  let report, coreStarted = false;
  try {
    const invocation = await use.verifyInvocation({root, environment});
    await use.verifyBaselines(root);
    coreStarted = true;
    report = await use.runCompaction({invocation, environment,
      createPublicationFence: ({fetcher, now}) => use.createPublicationFence({environment, fetcher, now})});
    need(report?.version === 1 && report.kind === 'japan-cache-compaction-v1'
      && report.controllerSha === invocation.sourceSha && report.runId === invocation.runId
      && report.attempt === invocation.attempt && Buffer.byteLength(JSON.stringify(report)) <= p.reportBytes, 'report');
  } catch (error) {
    report = {version: 1, kind: 'japan-cache-compaction-v1', completed: false, status: 'failed', errorCode: safeCode(error),
      controllerSha: SHA.test(environment.GITHUB_SHA ?? '') ? environment.GITHUB_SHA : null,
      runId: RUN.test(environment.GITHUB_RUN_ID ?? '') ? environment.GITHUB_RUN_ID : null, attempt: '1',
      cacheMutations: coreStarted ? null : 0, cacheDeletes: coreStarted ? null : 0,
      mutationOutcome: coreStarted ? 'not_observed' : 'not_started', directSupplierRequests: 0, rawPayloadsPersisted: false,
      physicalStorageReclamationVerified: false};
  }
  const bytes = Buffer.from(JSON.stringify(report) + '\n');
  need(bytes.length <= p.reportBytes, 'report');
  await fs.writeFile(path.join(root, p.reportName), bytes, {mode: 0o600, flag: 'wx'});
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 3 && ['--verify', '--compact'].includes(process.argv[2]), 'arguments');
    if (process.argv[2] === '--verify') {
      const invocation = await verifyJapanCacheCompactionInvocation();
      verifyFrozenSpeedBaselines(ROOT);
      console.log(JSON.stringify({version: 1, kind: 'japan-cache-compaction-invocation-v1', verified: true, ...invocation}));
    } else {
      const report = await runJapanCacheCompactionEntry();
      console.log(JSON.stringify(report));
      if (report.status === 'failed') process.exitCode = 1;
    }
  } catch (error) {
    console.error(JSON.stringify({version: 1, kind: 'japan-cache-compaction-entry-failure-v1', errorCode: safeCode(error)}));
    process.exitCode = 1;
  }
}
