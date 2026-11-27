import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {JAPAN_CACHE_COMPACTION_PROFILE as PROFILE, verifyJapanCacheCompactionInvocation,
  createJapanCachePublicationFence, runJapanCacheCompactionEntry} from '../scripts/catalog-next/japan-cache-compaction-entry.mjs';
import {CHINA_STATE_KEYS, createChinaState, inspectChinaPublicationState} from '../scripts/catalog-next/china-state.mjs';
import {COMPACTION_LIMITS, CHECKPOINT_KEY, parseJapanCacheCheckpoint,
  runJapanCacheCompaction} from '../scripts/catalog-next/japan-cache-compaction.mjs';
import {TARGET, CACHE_PREFIXES} from '../scripts/catalog-next/japan-cache-retention-audit.mjs';
import {FROZEN_SPEED_BASELINES} from '../scripts/verify-frozen-speed-baselines.mjs';

const sha = 'a'.repeat(40), hash = value => createHash('sha256').update(value).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const bytes = value => Buffer.from(JSON.stringify(ordered(value)));
const absent = () => ({found: false, etag: null, sha256: null, value: null});
const environment = event => ({GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: PROFILE.repository,
  GITHUB_REPOSITORY_ID: PROFILE.repositoryId, GITHUB_REF: PROFILE.ref, GITHUB_WORKFLOW_REF: PROFILE.workflowRef,
  GITHUB_JOB: PROFILE.job, GITHUB_RUN_ID: '45950000000', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: sha,
  GITHUB_EVENT_NAME: event, EXPECTED_CONTROLLER_SHA: sha});
const git = args => {
  if (args[0] === 'rev-parse') return sha + '\n';
  assert(['diff', 'ls-files'].includes(args[0])); return '';
};
async function temporary(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, {recursive: true, force: true})); return root;
}

test('scheduled continuation requires the real workflow, exact main checkout, repository id, job and hourly cron', async () => {
  const args = {environment: environment('schedule'), git, event: {schedule: '43 * * * *'}};
  const verified = await verifyJapanCacheCompactionInvocation(args);
  assert.deepEqual(verified, {version: 1, event: 'schedule', sourceSha: sha, approvedSourceSha: sha,
    markerPath: null, runId: '45950000000', attempt: '1'});
  for (const changed of [{GITHUB_ACTIONS: 'false'}, {GITHUB_REPOSITORY: 'another/AvtoCena'}, {GITHUB_REPOSITORY_ID: '1'},
    {GITHUB_REF: 'refs/heads/feature'}, {GITHUB_WORKFLOW_REF: PROFILE.workflowRef.replace('compaction', 'audit')},
    {GITHUB_JOB: 'inspect'}, {GITHUB_RUN_ATTEMPT: '2'}, {GITHUB_RUN_ATTEMPT: '0'}, {GITHUB_RUN_ID: '0'},
    {GITHUB_SHA: 'not-a-sha'}, {GITHUB_EVENT_NAME: 'workflow_run'}]) {
    await assert.rejects(verifyJapanCacheCompactionInvocation({...args, environment: {...args.environment, ...changed}}),
      /japan_cache_compaction_entry_(workflow|attempt|event)/);
  }
  for (const schedule of ['* * * * *', '43 * * * * ', '17 * * * *', undefined, ['43 * * * *']])
    await assert.rejects(verifyJapanCacheCompactionInvocation({...args, event: {schedule}}), /entry_schedule/);
  await assert.rejects(verifyJapanCacheCompactionInvocation({...args, git: args => args[0] === 'rev-parse' ? 'b'.repeat(40) : ''}), /controller_identity/);
  await assert.rejects(verifyJapanCacheCompactionInvocation({...args, git: args => args[0] === 'rev-parse' ? sha
    : args[0] === 'ls-files' ? 'unreviewed-source.mjs\0' : ''}), /untracked_checkout/);
  await assert.rejects(verifyJapanCacheCompactionInvocation({...args, git: args => {
    if (args[0] === 'diff') throw Error('dirty tracked fixture'); return git(args);
  }}), /dirty tracked fixture/);
});

test('manual continuation binds both input and environment to HEAD and cannot invent a schedule', async t => {
  const args = {environment: environment('workflow_dispatch'), git, event: {inputs: {expected_controller_sha: sha}}};
  assert.equal((await verifyJapanCacheCompactionInvocation(args)).event, 'workflow_dispatch');
  for (const event of [{}, {inputs: {expected_controller_sha: 'b'.repeat(40)}}, {schedule: PROFILE.schedule}])
    await assert.rejects(verifyJapanCacheCompactionInvocation({...args, event}), /manual_revision/);
  await assert.rejects(verifyJapanCacheCompactionInvocation({...args,
    environment: {...args.environment, EXPECTED_CONTROLLER_SHA: 'b'.repeat(40)}}), /manual_revision/);
  const root = await temporary(t, 'japan-compaction-event-'), filename = path.join(root, 'event.json');
  await fs.writeFile(filename, JSON.stringify({schedule: PROFILE.schedule}));
  assert.equal((await verifyJapanCacheCompactionInvocation({git, environment: {...environment('schedule'), GITHUB_EVENT_PATH: filename}})).event, 'schedule');
  for (const content of ['private invalid event', ' '.repeat(256 * 1024 + 1)]) {
    await fs.writeFile(filename, content);
    await assert.rejects(verifyJapanCacheCompactionInvocation({git,
      environment: {...environment('schedule'), GITHUB_EVENT_PATH: filename}}), error => error.message === 'japan_cache_compaction_entry_event_file');
  }
});

test('initial push is one dedicated marker on the already published reviewed parent, with no controller changes', async t => {
  const root = await temporary(t, 'japan-compaction-marker-'), repo = path.join(root, 'repo'), eventFile = path.join(root, 'event.json');
  await fs.mkdir(repo);
  const run = args => execFileSync('/usr/bin/git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgSign=false', ...args], {cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  run(['init', '--initial-branch=main']);
  await fs.writeFile(path.join(repo, 'controller.mjs'), 'export const reviewed = true;\n');
  run(['add', '.']); run(['commit', '-m', 'reviewed fixture']); const approved = run(['rev-parse', 'HEAD']);
  await fs.mkdir(path.dirname(path.join(repo, PROFILE.markerPath)), {recursive: true});
  await fs.writeFile(path.join(repo, PROFILE.markerPath), JSON.stringify({version: 1, operation: PROFILE.operation, approvedSourceSha: approved}));
  run(['add', PROFILE.markerPath]); run(['commit', '-m', 'fixture marker']); const head = run(['rev-parse', 'HEAD']);
  const event = {before: approved, after: head, ref: PROFILE.ref, created: false, deleted: false, forced: false};
  await fs.writeFile(eventFile, JSON.stringify(event));
  const env = {...environment('push'), GITHUB_SHA: head, GITHUB_EVENT_PATH: eventFile};
  const verified = await verifyJapanCacheCompactionInvocation({root: repo, environment: env});
  assert.equal(verified.approvedSourceSha, approved); assert.equal(verified.markerPath, PROFILE.markerPath);
  for (const change of [{forced: true}, {created: true}, {deleted: true}, {before: sha}, {after: approved}]) {
    await fs.writeFile(eventFile, JSON.stringify({...event, ...change}));
    await assert.rejects(verifyJapanCacheCompactionInvocation({root: repo, environment: env}), /push_transition/);
  }
  await fs.writeFile(eventFile, JSON.stringify(event));
  await fs.writeFile(path.join(repo, 'untracked.mjs'), 'export const unreviewed = true;\n');
  await assert.rejects(verifyJapanCacheCompactionInvocation({root: repo, environment: env}), /untracked_checkout/);
  await fs.rm(path.join(repo, 'untracked.mjs'));
  await fs.writeFile(path.join(repo, 'controller.mjs'), 'export const reviewed = false;\n');
  await assert.rejects(verifyJapanCacheCompactionInvocation({root: repo, environment: env}), /git_unverified/);
  run(['add', '.']); run(['commit', '--amend', '--no-edit']); const modified = run(['rev-parse', 'HEAD']);
  await fs.writeFile(eventFile, JSON.stringify({...event, after: modified}));
  await assert.rejects(verifyJapanCacheCompactionInvocation({root: repo, environment: {...env, GITHUB_SHA: modified}}), /marker_only_diff/);
});

function candidate(id) {
  return {market: 'china', generationId: `gen_china_${1000 + id}_1`, owner: {runId: String(1000 + id), attempt: '1', revision: sha},
    receiptSha256: hash('receipt' + id), sourceDescriptorSha256: hash('source' + id), generationManifestSha256: hash('generation' + id),
    sourceCursor: id * 1000, sourceObservedAt: '2026-11-26T11:00:00.000Z', runtimeSha: '3'.repeat(40),
    pricingRuntimeSha: '6'.repeat(40), imageId: 'sha256:' + '4'.repeat(64)};
}
function acceptance(reference, nonce) {
  const browserSpeedBytes = Buffer.from(JSON.stringify({release: reference.runtimeSha, passed: true, browserPassed: true, speedGuard: {passed: true}}));
  const browserDetailsBytes = Buffer.from(JSON.stringify({version: 1, kind: 'china-browser-details-v1', release: reference.runtimeSha,
    nonce, passed: true, generationManifestSha256: reference.generationManifestSha256, precedingSpeedReportSha256: hash(browserSpeedBytes)}));
  const receipt = Buffer.from(JSON.stringify({version: 1, kind: 'china-host-acceptance-v1', release: reference.runtimeSha,
    pricingRuntimeSha: reference.pricingRuntimeSha, generationId: reference.generationId, generationManifestSha256: reference.generationManifestSha256,
    privateGenerationReceiptSha256: reference.receiptSha256, sourceDescriptorSha256: reference.sourceDescriptorSha256,
    imageId: reference.imageId, sourceCursor: reference.sourceCursor, sourceObservedAt: reference.sourceObservedAt, nonce,
    browser: {release: reference.runtimeSha, nonce, passed: true, functionalPassed: true, speedPassed: true,
      reportSha256: hash(Buffer.concat([browserSpeedBytes, browserDetailsBytes])), speedReportSha256: hash(browserSpeedBytes), detailsReportSha256: hash(browserDetailsBytes)},
    acceptedAt: '2026-11-27T05:00:01.000Z', retainedContainerId: '5'.repeat(64)}));
  return {hostReceiptBase64: receipt.toString('base64'), hostReceiptSha256: hash(receipt), browserSpeedBytes, browserDetailsBytes};
}
async function publicationFixture(count = 2) {
  const saved = new Map(), calls = []; let sequence = 0, id = 0, hook;
  const storage = {
    async assertPrivateBucket() { calls.push('privacy'); return {verified: true}; },
    async read(name) {
      assert(Object.hasOwn(CHINA_STATE_KEYS, name)); calls.push(name);
      if (hook) await hook(name); return structuredClone(saved.get(name) ?? absent());
    },
    async compareAndSwap(name, previous, value) {
      const actual = saved.get(name) ?? absent();
      assert.equal(previous.etag, actual.etag); assert.equal(previous.sha256, actual.sha256); save(name, value);
    },
  };
  function save(name, value) {
    saved.set(name, {found: true, etag: '"fixture-' + ++sequence + '"', sha256: hash(bytes(value)), value: structuredClone(value)});
  }
  const state = createChinaState({storage, now: () => '2026-11-27T05:00:00.000Z'});
  async function advance() {
    const ref = candidate(++id), nonce = String(id).repeat(32);
    const lease = await state.acquireLease({previous: await state.read('lease'), owner: ref.owner, nonce, expiresAt: '2026-11-27T06:00:00.000Z'});
    const staged = await state.reserve({lease, previous: await state.read('accepted'), previousIntent: await state.read('intent'), candidate: ref});
    await state.commit({lease, ...staged, evidence: acceptance(ref, nonce)}); await state.releaseLease({lease});
  }
  for (let i = 0; i < count; i++) await advance();
  calls.length = 0;
  return {storage, saved, save, advance, calls, setHook: value => { hook = value; }};
}

test('publication fence admits only resolved committed current plus verified rollback and never writes state', async () => {
  const f = await publicationFixture();
  f.storage.compareAndSwap = () => assert.fail('the guard must never acquire, renew, release or write China state');
  const fence = await createJapanCachePublicationFence({storage: f.storage});
  assert.deepEqual(f.calls, ['privacy', 'lease', 'accepted', 'intent', 'lease']);
  assert.equal(fence.summary.currentAndRollbackVerified, true); assert.equal(fence.summary.stateMutations, 0);
  assert.equal(await fence.beforeMutation(), true);
  assert.deepEqual(f.calls.slice(5), ['lease', 'accepted', 'intent', 'lease']);
  assert.deepEqual(Object.keys(fence).sort(), ['beforeMutation', 'summary']);
  assert(!JSON.stringify(fence.summary).includes('hostReceipt'));
  const firstOnly = await publicationFixture(1);
  await assert.rejects(createJapanCachePublicationFence({storage: firstOnly.storage}), /publication_current_or_rollback_required/);
});

test('any held China lease defers, including a holder whose timestamp already expired', async () => {
  for (const now of [Date.parse('2026-11-27T05:30:00Z'), Date.parse('2026-11-28T05:30:00Z')]) {
    const f = await publicationFixture(), lease = structuredClone(f.saved.get('lease').value);
    f.save('lease', {...lease, status: 'held', releasedAt: null});
    await assert.rejects(createJapanCachePublicationFence({storage: f.storage, now: () => now}), /entry_lease_busy/);
    assert.deepEqual(f.calls, ['privacy', 'lease']);
  }
});

test('pending, aborted, mismatched and corrupt state cannot authorize payload compaction', async () => {
  for (const kind of ['pending', 'aborted', 'mismatch', 'missing']) {
    const f = await publicationFixture(), intent = structuredClone(f.saved.get('intent').value);
    if (kind === 'pending') f.save('intent', {...intent, status: 'pending', resolution: null});
    if (kind === 'aborted') {
      f.save('intent', {...intent, status: 'aborted', resolution: {...intent.resolution, kind: 'never_reserved', hostReceiptSha256: null}});
      assert.equal(inspectChinaPublicationState({accepted: f.saved.get('accepted'), intent: f.saved.get('intent')}).status, 'resolved');
    }
    if (kind === 'mismatch') f.saved.get('accepted').etag = '"changed"';
    if (kind === 'missing') f.saved.delete('accepted');
    await assert.rejects(createJapanCachePublicationFence({storage: f.storage}), /publication_unresolved/);
  }
  const corrupt = await publicationFixture(); corrupt.saved.get('accepted').value.current.proof.hostReceiptBase64 = 'private invalid receipt';
  await assert.rejects(createJapanCachePublicationFence({storage: corrupt.storage}), error => error.message === 'japan_cache_compaction_entry_publication_unavailable');
});

test('a new accepted generation or intent ETag fences every later mutation and failure remains latched', async () => {
  const f = await publicationFixture(), fence = await createJapanCachePublicationFence({storage: f.storage});
  await f.advance();
  await assert.rejects(fence.beforeMutation(), /publication_changed/);
  await assert.rejects(fence.beforeMutation(), /publication_stopped/);
  const g = await publicationFixture(), other = await createJapanCachePublicationFence({storage: g.storage});
  const previous = structuredClone(g.saved.get('intent'));
  g.saved.get('intent').etag = '"same-body-new-etag"';
  await assert.rejects(other.beforeMutation(), /publication_changed/);
  g.saved.set('intent', previous);
  await assert.rejects(other.beforeMutation(), /publication_stopped/);
});

test('a publisher acquiring the lease between snapshot reads is detected before the next cache write', async () => {
  const f = await publicationFixture(), fence = await createJapanCachePublicationFence({storage: f.storage});
  f.setHook(name => {
    if (name === 'accepted') {
      const old = f.saved.get('lease').value;
      f.save('lease', {...old, epoch: old.epoch + 1, nonce: 'f'.repeat(32)}); f.setHook(null);
    }
  });
  await assert.rejects(fence.beforeMutation(), /publication_changed/);
  const held = await publicationFixture(), heldFence = await createJapanCachePublicationFence({storage: held.storage});
  held.save('lease', {...held.saved.get('lease').value, status: 'held', releasedAt: null});
  await assert.rejects(heldFence.beforeMutation(), /lease_busy/);
});

test('all production publication reads pass through the supplied bounded fetch and a transport failure stops the fence', async () => {
  const f = await publicationFixture(), calls = [];
  const ACL = '<AccessControlPolicy><Owner><ID>owner</ID></Owner><AccessControlList><Grant>' +
    '<Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>owner</ID></Grantee>' +
    '<Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>';
  const fetcher = async (url, options) => {
    const target = new URL(url); calls.push({url, method: options.method});
    assert.equal(target.origin, 'https://s3.regru.cloud'); assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    if (target.searchParams.has('policy')) return new Response('<Error><Code>NoSuchBucketPolicy</Code></Error>', {status: 404});
    if (target.searchParams.has('acl')) return new Response(ACL);
    const name = Object.keys(CHINA_STATE_KEYS).find(name => target.pathname.endsWith('/' + CHINA_STATE_KEYS[name]));
    assert(name, 'only three exact state keys are readable');
    const value = f.saved.get(name); return new Response(bytes(value.value), {headers: {etag: value.etag}});
  };
  const env = {REGCLOUD_S3_ACCESS_KEY_ID: 'fixture-access', REGCLOUD_S3_SECRET_ACCESS_KEY: 'fixture-secret'};
  const fence = await createJapanCachePublicationFence({environment: env, fetcher});
  assert.equal(calls.length, 10); await fence.beforeMutation(); assert.equal(calls.length, 18);
  let available = true;
  const failed = await createJapanCachePublicationFence({environment: env, fetcher: (...args) => {
    if (!available) throw Error('private credentials and raw response'); return fetcher(...args);
  }});
  available = false;
  await assert.rejects(failed.beforeMutation(), error => error.message === 'japan_cache_compaction_entry_publication_unavailable');
  await assert.rejects(failed.beforeMutation(), /publication_stopped/);
});

const goodReport = invocation => ({version: 1, kind: 'japan-cache-compaction-v1', controllerSha: invocation.sourceSha,
  runId: invocation.runId, attempt: invocation.attempt, completed: true, status: 'bounded_complete', cacheMutations: 1,
  cacheDeletes: 0, directSupplierRequests: 0, rawPayloadsPersisted: false});
test('entry verifies source and baselines before core access, shares the bounded fence transport, and writes only its report', async t => {
  const root = await temporary(t, 'japan-compaction-entry-'), calls = [], env = environment('schedule');
  const invocation = {sourceSha: sha, approvedSourceSha: sha, event: 'schedule', runId: env.GITHUB_RUN_ID, attempt: '1'};
  const bounded = () => assert.fail('fixture does not perform network'), clock = () => 0;
  const report = await runJapanCacheCompactionEntry({root, environment: env, capabilities: {
    verifyInvocation: async args => { assert.equal(args.environment, env); calls.push('invocation'); return invocation; },
    verifyBaselines: async input => { assert.equal(input, root); calls.push('baselines'); },
    createPublicationFence: async args => {
      calls.push('fence'); assert.equal(args.environment, env); assert.equal(args.fetcher, bounded); assert.equal(args.now, clock);
      return {summary: {stateMutations: 0}, beforeMutation: async () => calls.push('before-mutation')};
    },
    runCompaction: async args => {
      calls.push('core'); assert.equal(args.invocation, invocation); assert.equal(args.environment, env);
      const fence = await args.createPublicationFence({fetcher: bounded, now: clock}); await fence.beforeMutation();
      return goodReport(invocation);
    },
  }});
  assert.deepEqual(calls, ['invocation', 'baselines', 'core', 'fence', 'before-mutation']);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, PROFILE.reportName), 'utf8')), report);
  assert.deepEqual(await fs.readdir(root), [PROFILE.reportName]);
  assert.equal((await fs.stat(path.join(root, PROFILE.reportName))).mode & 0o777, 0o600);
});

test('entry redacts failures, never claims zero mutations after an unobserved core outcome, and bounds report size', async t => {
  for (const stage of ['invocation', 'baselines', 'core', 'oversize', 'wrong_binding']) {
    const root = await temporary(t, 'japan-compaction-failure-'), calls = [], env = environment('schedule');
    const invocation = {sourceSha: sha, runId: env.GITHUB_RUN_ID, attempt: '1'};
    const failure = () => { const error = Error('private raw payload'); error.report = {secret: 'must-not-persist'}; throw error; };
    const report = await runJapanCacheCompactionEntry({root, environment: env, capabilities: {
      verifyInvocation: async () => { if (stage === 'invocation') failure(); return invocation; },
      verifyBaselines: () => { if (stage === 'baselines') failure(); },
      runCompaction: async () => {
        calls.push('core'); if (stage === 'core') failure();
        return stage === 'oversize' ? {...goodReport(invocation), foreign: 'x'.repeat(PROFILE.reportBytes)}
          : {...goodReport(invocation), controllerSha: 'b'.repeat(40)};
      },
    }});
    assert.equal(report.status, 'failed');
    assert.equal(report.cacheMutations, calls.length ? null : 0);
    const output = await fs.readFile(path.join(root, PROFILE.reportName), 'utf8');
    assert(Buffer.byteLength(output) <= PROFILE.reportBytes);
    assert(!output.includes('private') && !output.includes('secret') && !output.includes('must-not-persist'));
  }
});

const INTEGRATION_AT = Date.parse('2026-11-27T12:00:00.000Z');
const INTEGRATION_OLD = '2026-11-19T12:00:00.000Z', INTEGRATION_FRESH = '2026-11-27T11:59:00.000Z';
const integrationSnapshot = (observedAt = INTEGRATION_OLD) => ({schemaVersion: 2, stale: false, items: [{id: 'PRIVATE_FIXTURE'}],
  page: 1, pageSize: 1, received: 1, rejected: 0, observedAt});

/** A real clean marker-only checkout and the original frozen baseline files.
 * Only the external S3 transport and time are replaced in the full entry run. */
async function integrationCheckout(t) {
  const directory = await temporary(t, 'japan-compaction-production-entry-'), root = path.join(directory, 'repo');
  await fs.mkdir(path.join(root, 'docs/operations'), {recursive: true});
  for (const name of Object.keys(FROZEN_SPEED_BASELINES))
    await fs.copyFile(new URL('../docs/operations/' + name, import.meta.url), path.join(root, 'docs/operations', name));
  const git = args => execFileSync('/usr/bin/git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgSign=false', ...args], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git(['init', '--initial-branch=main']); git(['add', '.']); git(['commit', '-m', 'reviewed fixture']);
  const parent = git(['rev-parse', 'HEAD']);
  await fs.mkdir(path.dirname(path.join(root, PROFILE.markerPath)), {recursive: true});
  await fs.writeFile(path.join(root, PROFILE.markerPath), JSON.stringify({version: 1, operation: PROFILE.operation, approvedSourceSha: parent}));
  git(['add', '.']); git(['commit', '-m', 'fixture activation']); const head = git(['rev-parse', 'HEAD']);
  const eventFile = path.join(directory, 'event.json');
  await fs.writeFile(eventFile, JSON.stringify({before: parent, after: head, ref: PROFILE.ref, created: false, deleted: false, forced: false}));
  const env = {...environment('push'), GITHUB_SHA: head, GITHUB_EVENT_PATH: eventFile,
    REGCLOUD_S3_ACCESS_KEY_ID: 'OFFLINE_ACCESS_KEY', REGCLOUD_S3_SECRET_ACCESS_KEY: 'OFFLINE_PRIVATE_SECRET'};
  return {root, env, async continueSchedule() {
    // Each GitHub run has a fresh checkout; remove only this run's local artifact.
    await fs.rm(path.join(root, PROFILE.reportName));
    await fs.writeFile(eventFile, JSON.stringify({schedule: PROFILE.schedule}));
    env.GITHUB_EVENT_NAME = 'schedule'; env.GITHUB_RUN_ID = String(BigInt(env.GITHUB_RUN_ID) + 1n);
  }};
}

function integrationS3(publication) {
  const objects = new Map(), synthetic = new Map(), calls = [], hooks = {};
  const acl = '<AccessControlPolicy><Owner><ID>owner</ID></Owner><AccessControlList><Grant>' +
    '<Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>owner</ID></Grantee>' +
    '<Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>';
  const error = code => '<Error><Code>' + code + '</Code></Error>';
  const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const seed = (key, value) => {
    const body = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(JSON.stringify(value));
    const row = {key, body, etag: '"' + hash(body) + '"'}; objects.set(key, row); return row;
  };
  const fetcher = async (input, options) => {
    const url = new URL(input), method = options.method, headers = new Headers(options.headers);
    assert.equal(url.origin, TARGET.endpoint); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert(headers.has('authorization')); assert.equal(headers.get('host'), 's3.regru.cloud');
    const bucket = '/' + TARGET.bucket, physical = decodeURIComponent(url.pathname);
    const key = physical.startsWith(bucket + '/' + TARGET.prefix) ? physical.slice((bucket + '/' + TARGET.prefix).length) : null;
    const call = {method, key, query: Object.fromEntries(url.searchParams), requestBytes: options.body ? Buffer.byteLength(options.body) : 0};
    calls.push(call);
    const reply = (content = '', status = 200, extra = {}) => {
      const body = status === 204 ? null : Buffer.from(content); call.responseBytes = body?.length ?? 0;
      return new Response(body, {status, headers: {...(body ? {'content-length': String(body.length)} : {}), ...extra}});
    };
    if (hooks.beforeRequest) await hooks.beforeRequest({key, method, query: call.query});
    if (key === null) {
      assert.equal(physical, bucket); assert.equal(method, 'GET');
      if (url.searchParams.has('acl')) return reply(acl);
      if (url.searchParams.has('policy')) return reply(error('NoSuchBucketPolicy'), 404);
      if (url.searchParams.has('versioning')) return reply('<VersioningConfiguration/>');
      if (url.searchParams.has('lifecycle')) return reply(error('NoSuchLifecycleConfiguration'), 404);
      assert.equal(url.searchParams.get('list-type'), '2'); assert.equal(url.searchParams.get('max-keys'), '100');
      assert.equal(url.searchParams.get('encoding-type'), 'url');
      const prefix = url.searchParams.get('prefix').slice(TARGET.prefix.length); assert(CACHE_PREFIXES.includes(prefix));
      const cursor = url.searchParams.get('continuation-token'), offset = cursor ? Number(cursor.split(':').at(-1)) : 0;
      const rows = [...objects.values()].filter(row => row.key.startsWith(prefix)).sort((a, b) => a.key.localeCompare(b.key));
      const page = rows.slice(offset, offset + 100), next = offset + page.length < rows.length ? 'PRIVATE_CURSOR:' + (offset + page.length) : null;
      return reply('<ListBucketResult><Name>' + TARGET.bucket + '</Name><Prefix>' + xml(encodeURIComponent(TARGET.prefix + prefix))
        + '</Prefix><MaxKeys>100</MaxKeys><KeyCount>' + page.length + '</KeyCount><EncodingType>url</EncodingType><IsTruncated>'
        + Boolean(next) + '</IsTruncated>' + (cursor ? '<ContinuationToken>' + xml(cursor) + '</ContinuationToken>' : '')
        + (next ? '<NextContinuationToken>' + xml(next) + '</NextContinuationToken>' : '')
        + page.map(row => '<Contents><Key>' + xml(encodeURIComponent(TARGET.prefix + row.key)) + '</Key><ETag>' + xml(row.etag)
          + '</ETag><Size>' + row.body.length + '</Size><LastModified>' + INTEGRATION_FRESH + '</LastModified><Type>Normal</Type></Contents>').join('')
        + '</ListBucketResult>');
    }
    const stateName = Object.keys(CHINA_STATE_KEYS).find(name => CHINA_STATE_KEYS[name] === key);
    if (stateName) {
      assert.equal(method, 'GET', 'production entry has no state or lease write authority'); assert.equal(options.body, undefined);
      const value = publication.saved.get(stateName); if (!value) return reply(error('NoSuchKey'), 404);
      if (url.searchParams.has('acl')) return reply(acl);
      assert.equal(url.searchParams.size, 0); return reply(bytes(value.value), 200, {etag: value.etag});
    }
    if (key.startsWith('catalog/operations/ajes-cache-retention-canary/v1/')) {
      assert.match(key, /^catalog\/operations\/ajes-cache-retention-canary\/v1\/[1-9][0-9]*\/1\/[a-f0-9]{48}\.json$/);
      assert.equal(url.searchParams.size, 0); const current = synthetic.get(key);
      if (method === 'GET') return current ? reply(current.body, 200, {etag: current.etag}) : reply(error('NoSuchKey'), 404);
      if (method === 'DELETE') {
        assert.match(headers.get('if-match'), /^[a-f0-9]{64}$/); synthetic.delete(key); return reply('', 204);
      }
      assert.equal(method, 'PUT'); assert.equal(headers.get('x-amz-acl'), 'private');
      if (headers.get('if-none-match') === '*') { if (current) return reply(error('PreconditionFailed'), 412); }
      else if (headers.get('if-match') !== current?.etag.slice(1, -1)) return reply(error('PreconditionFailed'), 412);
      const body = Buffer.from(options.body); assert(body.length <= 512);
      const row = {body, etag: '"' + hash(body) + '"'}; synthetic.set(key, row); return reply('', 200, {etag: row.etag});
    }
    assert(key === CHECKPOINT_KEY || CACHE_PREFIXES.some(prefix => key.startsWith(prefix)));
    assert.notEqual(method, 'DELETE', 'real cache and checkpoint DELETE must never reach storage');
    const current = objects.get(key);
    if (method === 'GET') {
      if (!current) return reply(error('NoSuchKey'), 404);
      return url.searchParams.has('acl') ? reply(acl) : reply(current.body, 200, {etag: current.etag});
    }
    assert.equal(method, 'PUT'); assert.equal(headers.get('x-amz-acl'), 'private');
    assert.equal(headers.get('content-type'), 'application/json'); assert.equal(url.searchParams.size, 0);
    if (headers.get('if-none-match') === '*') { assert.equal(key, CHECKPOINT_KEY); if (current) return reply(error('PreconditionFailed'), 412); }
    else { assert.match(headers.get('if-match'), /^[a-f0-9]{64}$/);
      if (headers.get('if-match') !== current?.etag.slice(1, -1)) return reply(error('PreconditionFailed'), 412); }
    const row = seed(key, Buffer.from(options.body)); return reply('', 200, {etag: row.etag});
  };
  return {objects, synthetic, calls, hooks, seed, fetcher};
}

function checkIntegratedAccounting(report, calls, {completeGuard = true} = {}) {
  assert.equal(report.requests.requests, calls.length, 'all publication ACL, body and lease reads share the core counter');
  assert.equal(report.requests.requestBytes, calls.reduce((sum, row) => sum + row.requestBytes, 0));
  assert.equal(report.requests.responseBytes, calls.reduce((sum, row) => sum + row.responseBytes, 0));
  assert(report.requests.requests <= COMPACTION_LIMITS.requests);
  assert(report.requests.requestBytes + report.requests.responseBytes <= COMPACTION_LIMITS.bytes);
  const stateCalls = calls.filter(row => Object.values(CHINA_STATE_KEYS).includes(row.key));
  assert(stateCalls.every(row => row.method === 'GET'));
  const mutations = calls.filter(row => row.method === 'PUT' && (row.key === CHECKPOINT_KEY || CACHE_PREFIXES.some(prefix => row.key?.startsWith(prefix))));
  if (completeGuard) assert.equal(stateCalls.length, 8 * (mutations.length + 1), 'initial snapshot plus a full snapshot before every real PUT');
  let precedingMutation = -1;
  for (const mutation of mutations) {
    const index = calls.indexOf(mutation), between = calls.slice(precedingMutation + 1, index);
    const snapshotReads = between.filter(row => Object.values(CHINA_STATE_KEYS).includes(row.key) && Object.keys(row.query).length === 0);
    assert.deepEqual(snapshotReads.slice(-4).map(row => row.key), ['lease', 'accepted', 'intent', 'lease'].map(name => CHINA_STATE_KEYS[name]));
    precedingMutation = index;
  }
  assert.deepEqual(report.publication, {status: 'resolved_committed', currentAndRollbackVerified: true,
    observationsBound: true, leaseHeld: false, stateMutations: 0});
}

test('production entry, real publication fence and core share one budget and resume a bounded batch from the durable cursor', async t => {
  const checkout = await integrationCheckout(t), publication = await publicationFixture(), fake = integrationS3(publication);
  for (let i = 0; i < 40; i++) fake.seed(CACHE_PREFIXES[0] + 'old-' + String(i).padStart(2, '0') + '.json', integrationSnapshot());
  const freshKey = CACHE_PREFIXES[0] + 'fresh.json', mixedKey = CACHE_PREFIXES[2] + '42.json';
  const fresh = fake.seed(freshKey, integrationSnapshot(INTEGRATION_FRESH)).body;
  const kept = {hash: 'c'.repeat(64), value: integrationSnapshot(INTEGRATION_FRESH)};
  fake.seed(mixedKey, {...kept, previous: [{hash: 'd'.repeat(64), value: integrationSnapshot()}]});
  const stateBefore = structuredClone([...publication.saved]), reports = [];
  for (let run = 0; run < 4; run++) {
    const from = fake.calls.length;
    const report = await runJapanCacheCompactionEntry({root: checkout.root, environment: checkout.env, capabilities: {
      runCompaction: args => runJapanCacheCompaction({...args, fetcher: fake.fetcher, now: () => INTEGRATION_AT,
        nonce: String(run + 1).repeat(48)}),
    }});
    assert.notEqual(report.status, 'failed', JSON.stringify(report));
    assert.equal(report.controllerSha, checkout.env.GITHUB_SHA); checkIntegratedAccounting(report, fake.calls.slice(from));
    reports.push(report); assert.equal(fake.synthetic.size, 0);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(checkout.root, PROFILE.reportName), 'utf8')), report);
    if (report.scanCycleCompleted) break;
    assert.equal(report.status, 'bounded_partial'); assert.equal(report.reason, 'bounded_run');
    assert(report.payloadsCompacted > 0 && report.payloadsCompacted < COMPACTION_LIMITS.writes);
    assert.equal(report.checkpointSaved, true); assert.equal(report.partial, true);
    const checkpoint = parseJapanCacheCheckpoint(fake.objects.get(CHECKPOINT_KEY).body);
    assert.equal(checkpoint.activation.controllerSha, checkout.env.GITHUB_SHA); assert(checkpoint.scan.page?.position > 0);
    await checkout.continueSchedule();
  }
  assert(reports.length >= 2, 'actual repeated state checks consume the shared request budget before the whole fixture fits');
  assert.equal(reports.at(-1).scanCycleCompleted, true); assert.equal(reports.at(-1).resumed, true);
  assert.equal(reports.reduce((sum, report) => sum + report.payloadsCompacted, 0), 41);
  for (let i = 0; i < 40; i++) assert.equal(fake.objects.get(CACHE_PREFIXES[0] + 'old-' + String(i).padStart(2, '0') + '.json').body.toString(), 'null');
  assert(fake.objects.get(freshKey).body.equals(fresh)); assert.deepEqual(JSON.parse(fake.objects.get(mixedKey).body), kept);
  assert.deepEqual([...publication.saved], stateBefore, 'accepted current, rollback, intent and lease are byte-for-byte unchanged');
  const output = JSON.stringify(reports);
  for (const privateText of ['PRIVATE_', 'OFFLINE_PRIVATE_SECRET', 'hostReceiptBase64', CHECKPOINT_KEY, freshKey]) assert(!output.includes(privateText));
});

test('production entry defers a held lease before canary and stops before cache PUT after publication changes', async t => {
  for (const race of ['held', 'changed']) {
    const checkout = await integrationCheckout(t), publication = await publicationFixture(), fake = integrationS3(publication);
    const key = CACHE_PREFIXES[0] + 'old.json', original = fake.seed(key, integrationSnapshot()).body;
    if (race === 'held') publication.save('lease', {...publication.saved.get('lease').value, status: 'held', releasedAt: null});
    else fake.hooks.beforeRequest = async request => {
      if (request.key === key && request.method === 'GET' && Object.keys(request.query).length === 0) {
        delete fake.hooks.beforeRequest; await publication.advance();
      }
    };
    const report = await runJapanCacheCompactionEntry({root: checkout.root, environment: checkout.env, capabilities: {
      runCompaction: args => runJapanCacheCompaction({...args, fetcher: fake.fetcher, now: () => INTEGRATION_AT, nonce: 'e'.repeat(48)}),
    }});
    assert.equal(report.errorCode, 'japan_cache_compaction_entry_' + (race === 'held' ? 'lease_busy' : 'publication_changed'));
    assert.equal(report.requests.requests, fake.calls.length); assert.equal(report.payloadsCompacted, 0);
    assert(fake.objects.get(key).body.equals(original)); assert.equal(fake.synthetic.size, 0);
    assert(!fake.calls.some(row => row.key === key && row.method === 'PUT'));
    if (race === 'held') { assert.equal(report.status, 'deferred'); assert(fake.calls.every(row => row.method === 'GET')); }
    else {
      assert.equal(report.status, 'bounded_partial'); assert.equal(report.checkpointSaved, true);
      checkIntegratedAccounting(report, fake.calls, {completeGuard: false});
    }
  }
});
