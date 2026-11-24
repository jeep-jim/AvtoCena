import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyChinaDailyInvocation, checkoutChinaDailyRuntimes, runChinaDailyEntry,
  readChinaDailyDeadline, CHINA_DAILY_JOB_TIMEOUT_MINUTES} from '../scripts/catalog-next/daily-entry.mjs';

const root = process.cwd(), sha = 'a'.repeat(40), hash = value => createHash('sha256').update(value).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const env = event => ({GITHUB_REPOSITORY: 'jeep-jim/AvtoCena', GITHUB_REPOSITORY_ID: '1289722938',
  GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, GITHUB_RUN_ID: '45399999999', GITHUB_RUN_ATTEMPT: '1',
  GITHUB_WORKFLOW_REF: 'jeep-jim/AvtoCena/.github/workflows/catalog-refresh-china.yml@refs/heads/main',
  GITHUB_EVENT_NAME: event, EXPECTED_CONTROLLER_SHA: sha});
const git = args => { if (args[0] === 'rev-parse') return sha + '\n'; assert.equal(args[0], 'diff'); return ''; };

test('actual daily invocation accepts only the bound main workflow, real dispatch SHA or the approved schedule', async () => {
  const manual = await verifyChinaDailyInvocation({environment: env('workflow_dispatch'), git, event: {inputs: {controller_sha: sha}}});
  assert.equal(manual.sourceSha, sha); assert.equal(manual.event, 'workflow_dispatch'); assert.equal(manual.markerPath, null);
  const scheduled = await verifyChinaDailyInvocation({environment: env('schedule'), git, event: {schedule: '0 14 * * *'}});
  assert.equal(scheduled.event, 'schedule'); assert.equal(scheduled.sourceSha, sha);
  for (const changed of [{GITHUB_REPOSITORY_ID: '1'}, {GITHUB_REF: 'refs/heads/other'}, {GITHUB_SHA: 'b'.repeat(40)},
    {GITHUB_WORKFLOW_REF: 'jeep-jim/AvtoCena/.github/workflows/unreviewed.yml@refs/heads/main'}, {GITHUB_EVENT_NAME: 'workflow_run'}])
    await assert.rejects(verifyChinaDailyInvocation({environment: {...env('workflow_dispatch'), ...changed}, git,
      event: {inputs: {controller_sha: sha}}}), /china_daily_entry_/);
  await assert.rejects(verifyChinaDailyInvocation({environment: env('workflow_dispatch'), git, event: {inputs: {controller_sha: 'b'.repeat(40)}}}), /manual_revision/);
  await assert.rejects(verifyChinaDailyInvocation({environment: env('schedule'), git, event: {schedule: '* * * * *'}}), /schedule/);
  await assert.rejects(verifyChinaDailyInvocation({environment: env('schedule'), git: () => { throw Error('dirty checkout'); },
    event: {schedule: '0 14 * * *'}}), /dirty checkout/);
});

test('real push event must be the exact daily marker-only commit on its approved parent', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-daily-marker-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const repository = path.join(directory, 'repo'), eventPath = path.join(directory, 'event.json');
  await fs.mkdir(repository);
  const run = args => execFileSync('/usr/bin/git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgSign=false', ...args], {cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  run(['init', '--initial-branch=main']); await fs.writeFile(path.join(repository, 'controller.mjs'), 'export const fixture = true;\n');
  run(['add', '.']); run(['commit', '-m', 'reviewed fixture controller']);
  const approved = run(['rev-parse', 'HEAD']), markerPath = '.github/market-runs/catalog-next-china-daily.json';
  await fs.mkdir(path.dirname(path.join(repository, markerPath)), {recursive: true});
  await fs.writeFile(path.join(repository, markerPath), JSON.stringify({version: 1, operation: 'refresh-china-generation', approvedSourceSha: approved}));
  run(['add', markerPath]); run(['commit', '-m', 'approved fixture daily marker']);
  const head = run(['rev-parse', 'HEAD']), event = {before: approved, after: head, ref: 'refs/heads/main', created: false, deleted: false, forced: false};
  await fs.writeFile(eventPath, JSON.stringify(event));
  const environment = {...env('push'), GITHUB_SHA: head, GITHUB_EVENT_PATH: eventPath};
  const result = await verifyChinaDailyInvocation({root: repository, environment});
  assert.deepEqual(result, {version: 1, event: 'push', sourceSha: head, approvedSourceSha: approved, markerPath});
  for (const change of [{forced: true}, {before: sha}, {after: approved}]) {
    await fs.writeFile(eventPath, JSON.stringify({...event, ...change}));
    await assert.rejects(verifyChinaDailyInvocation({root: repository, environment}), /readonly_invocation_push_transition/);
  }
  await fs.writeFile(eventPath, JSON.stringify(event));
  await assert.rejects(verifyChinaDailyInvocation({root: repository, environment: {...environment, GITHUB_RUN_ATTEMPT: '2'}}), /ref_or_attempt/);
  await fs.writeFile(path.join(repository, 'controller.mjs'), 'export const fixture = false;\n');
  run(['add', '.']); run(['commit', '--amend', '--no-edit']);
  const changedHead = run(['rev-parse', 'HEAD']); await fs.writeFile(eventPath, JSON.stringify({...event, after: changedHead}));
  await assert.rejects(verifyChinaDailyInvocation({root: repository, environment: {...environment, GITHUB_SHA: changedHead}}), /marker_only_diff/);
});

test('cleanup deadline comes from the exact real job start and metadata errors do not invent a clock', async () => {
  const environment = {...env('workflow_dispatch'), GITHUB_JOB: 'refresh', GITHUB_TOKEN: 'private-gh-fixture'};
  const started = '2026-11-24T08:00:00Z', job = {name: 'refresh', run_id: Number(environment.GITHUB_RUN_ID), head_sha: sha,
    status: 'in_progress', conclusion: null, started_at: started};
  const args = {environment, now: () => Date.parse('2026-11-24T10:00:00Z'), fetcher: async (url, options) => {
    assert.equal(url, `https://api.github.com/repos/jeep-jim/AvtoCena/actions/runs/${environment.GITHUB_RUN_ID}/attempts/1/jobs?per_page=100`);
    assert.equal(options.headers.Authorization, 'Bearer private-gh-fixture'); assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({total_count: 1, jobs: [job]}));
  }};
  assert.equal(CHINA_DAILY_JOB_TIMEOUT_MINUTES, 360);
  assert.equal(await readChinaDailyDeadline(args), '2026-11-24T14:00:00.000Z');
  for (const changed of [{head_sha: 'b'.repeat(40)}, {run_id: 99}, {name: 'another-job'}, {status: 'completed'},
    {started_at: '2026-11-25T08:00:00Z'}, {conclusion: 'success'}])
    await assert.rejects(readChinaDailyDeadline({...args, fetcher: async () => new Response(JSON.stringify({total_count: 1, jobs: [{...job, ...changed}]}))}), /deadline_job/);
  await assert.rejects(readChinaDailyDeadline({...args, fetcher: async () => { throw Error('private-token-must-not-escape'); }}),
    error => error.message === 'china_daily_entry_deadline_transport');
  await assert.rejects(readChinaDailyDeadline({...args, fetcher: async () => new Response('{}', {status: 403})}), /deadline_status/);
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-daily-entry-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const control = path.join(directory, 'controller'), temporary = path.join(directory, 'runner');
  await fs.mkdir(path.join(control, '.github/operations/catalog-next'), {recursive: true});
  await fs.mkdir(temporary); await fs.mkdir(path.join(control, 'node_modules'));
  const [pricingPlan, servingPlan] = await Promise.all(['china-plan.json', 'china-serving-plan.json'].map(async name => {
    const raw = await fs.readFile(path.join(root, '.github/operations/catalog-next', name));
    await fs.writeFile(path.join(control, '.github/operations/catalog-next', name), raw); return JSON.parse(raw);
  }));
  const calls = [];
  const runtimes = await checkoutChinaDailyRuntimes({root: control, runnerTemp: temporary, git(args) {
    calls.push(args);
    if (args[0] === 'worktree') mkdirSync(args[3]);
    else assert.deepEqual(args.slice(0, 3), ['fetch', '--no-tags', 'https://github.com/jeep-jim/AvtoCena.git']);
    return '';
  }});
  return {control, temporary, pricingPlan, servingPlan, runtimes, calls};
}

test('pricing and serving checkouts stay distinct and use the two exact reviewed revisions', async t => {
  const f = await fixture(t), worktrees = f.calls.filter(args => args[0] === 'worktree');
  assert.deepEqual(worktrees.map(args => args[4]), [f.pricingPlan.runtimeSha, f.servingPlan.runtimeSha]);
  assert.notEqual(worktrees[0][3], worktrees[1][3]);
  assert.equal(f.runtimes.pricingRuntimeSha, f.pricingPlan.runtimeSha); assert.equal(f.runtimes.runtimeSha, f.servingPlan.runtimeSha);
  assert.equal(await fs.readlink(path.join(f.runtimes.pricingRoot, 'node_modules')), path.join(f.control, 'node_modules'));
  assert.equal(await fs.readlink(path.join(f.runtimes.servingRoot, 'node_modules')), path.join(f.control, 'node_modules'));
  await assert.rejects(checkoutChinaDailyRuntimes({root: f.control, runnerTemp: f.temporary, git: () => assert.fail('no overwrite')}), /checkout_exists/);
});

function accepted(f) {
  const nonce = 'b'.repeat(32), at = '2026-11-24T10:00:00Z';
  const ref = {market: 'china', generationId: 'gen_china_100_1', owner: {runId: '100', attempt: '1', revision: sha},
    receiptSha256: '1'.repeat(64), sourceDescriptorSha256: '2'.repeat(64), generationManifestSha256: '3'.repeat(64),
    sourceCursor: 100, sourceObservedAt: '2026-11-24T09:00:00Z', runtimeSha: f.servingPlan.runtimeSha,
    pricingRuntimeSha: f.pricingPlan.runtimeSha, imageId: 'sha256:' + '4'.repeat(64)};
  // Test-only representation of a receipt read from an authenticated host.
  const receipt = Buffer.from(JSON.stringify({version: 1, kind: 'china-host-acceptance-v1', release: ref.runtimeSha,
    pricingRuntimeSha: ref.pricingRuntimeSha, generationId: ref.generationId, generationManifestSha256: ref.generationManifestSha256,
    privateGenerationReceiptSha256: ref.receiptSha256, sourceDescriptorSha256: ref.sourceDescriptorSha256,
    sourceCursor: ref.sourceCursor, sourceObservedAt: ref.sourceObservedAt, imageId: ref.imageId, nonce,
    acceptedAt: at, retainedContainerId: '5'.repeat(64), browser: {release: ref.runtimeSha, nonce, passed: true,
      functionalPassed: true, speedPassed: true, reportSha256: '6'.repeat(64), speedReportSha256: '7'.repeat(64), detailsReportSha256: '8'.repeat(64)}}));
  const value = {version: 1, kind: 'china-accepted-state-v1', market: 'china', revision: 2, pending: null, rollback: null,
    current: {...ref, proof: {kind: 'china-accepted-proof-v1', hostReceiptBase64: receipt.toString('base64'), hostReceiptSha256: hash(receipt)}},
    commit: {nonce, intentSha256: '9'.repeat(64), previousETag: null, previousStateSha256: null, acceptedAt: at}};
  return {found: true, etag: '"native-accepted"', sha256: hash(JSON.stringify(ordered(value))), value};
}

test('production entry binds accepted state, passes pricing root to preparation and serving root only to release, and filters progress logs', async t => {
  const f = await fixture(t), observation = accepted(f), logs = [], called = [];
  const storage = {assertPrivateBucket: async () => ({verified: true}), read: async name => { assert.equal(name, 'accepted'); return observation; },
    compareAndSwap: async () => assert.fail('the entry cannot write state outside its cycle')};
  const capabilities = {
    verifyInvocation: async () => ({version: 1, event: 'workflow_dispatch', sourceSha: sha}), verifyBaselines: () => {},
    runtimeGit: directory => args => { assert.equal(directory, f.runtimes.pricingRoot);
      return args[0] === 'diff' ? '' : args[1] === 'HEAD' ? f.pricingPlan.runtimeSha : f.pricingPlan.runtimeTree; },
    verifyCompatibility: async input => { assert.equal(input.runtimeRoot, f.runtimes.servingRoot); return {}; },
    createStorage: () => storage,
    createRelease: input => { called.push('release'); assert.equal(input.servingRoot, f.runtimes.servingRoot);
      assert.equal(input.pricingPlan.runtimeSha, f.pricingPlan.runtimeSha);
      return {stageRelease: async () => {}, recoverRelease: async () => {}, retireHost: async () => {}}; },
    readDeadline: async () => '2026-11-24T18:00:00.000Z',
    collectRetired: async input => { called.push(input.mode);
      if (input.mode === 'drain') { assert.equal(input.previousAccepted, observation);
        assert.deepEqual(input.acceptedPublication, {accepted: observation, intent: 'exact-test-intent'});
        assert.equal(input.deadlineAt, '2026-11-24T18:00:00.000Z'); assert.equal(typeof input.beforeCollect, 'function'); }
      else assert.equal(input.deadlineAt, undefined);
      return {completed: true, market: 'china', status: 'no_previous_rollback'}; },
    runCycle: async input => { called.push('cycle'); assert.equal(input.runtimeRoot, f.runtimes.pricingRoot);
      assert.equal(input.plan.runtimeSha, f.pricingPlan.runtimeSha); assert.equal(input.invocation.sourceSha, sha);
      assert.equal(input.trigger, 'manual'); assert.equal(input.storage, storage);
      input.onProgress({phase: 'test_progress', sourceRows: 123, secret: 'private_supplier_token', sourceRecord: {private: true}});
      await input.resumeCleanup({readState: async () => {}, assertAuthority: async () => {}});
      await input.afterAccepted({previousAccepted: observation, accepted: observation, intent: 'exact-test-intent', readState: async () => {}, assertAuthority: async () => {}});
      return {kind: 'china-daily-cycle-v1', completed: true, market: 'china', published: true, status: 'accepted'};
    },
  };
  const result = await runChinaDailyEntry({root: f.control, environment: {...env('workflow_dispatch'),
    RUNNER_TEMP: f.temporary, JSON_STORAGE_DRIVER: 'object'}, capabilities, log: value => logs.push(value)});
  assert.equal(result.status, 'accepted'); assert.deepEqual(called, ['release', 'cycle', 'enqueue-only', 'drain']);
  assert.equal(result.cleanupDeadlineAt, '2026-11-24T18:00:00.000Z');
  assert.deepEqual(logs[0], {phase: 'test_progress', market: 'china', sourceRows: 123});
  assert.ok(!JSON.stringify(logs).includes('private_supplier_token'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.control, 'catalog-next-china-daily-report.json'))), result);
  capabilities.readDeadline = async () => { throw Error('private-gh-error'); };
  called.length = 0;
  const deferred = await runChinaDailyEntry({root: f.control, environment: {...env('workflow_dispatch'),
    RUNNER_TEMP: f.temporary, JSON_STORAGE_DRIVER: 'object'}, capabilities, log: value => logs.push(value)});
  assert.equal(deferred.status, 'accepted'); assert.equal(deferred.cleanupDeadlineAt, null);
  assert.deepEqual(called, ['release', 'cycle', 'enqueue-only', 'enqueue-only']);
  assert.ok(!JSON.stringify(logs).includes('private-gh-error'));
  capabilities.createStorage = () => ({...storage, read: async () => ({found: false, etag: null, sha256: null, value: null})});
  called.length = 0;
  await assert.rejects(runChinaDailyEntry({root: f.control, environment: {...env('schedule'), RUNNER_TEMP: f.temporary,
    JSON_STORAGE_DRIVER: 'object'}, capabilities}), /accepted_source_required/);
  assert.deepEqual(called, [], 'no bootstrap, preparation, release or GC without accepted state');
});

test('the future workflow remains disabled outside active workflows, has no schedule or image build and uploads only aggregates', async () => {
  const text = await fs.readFile(path.join(root, '.github/operations/catalog-next/china-daily.workflow.yml'), 'utf8');
  assert.match(text, /^name: China independent daily/m);
  assert.match(text, /^\s+if: \$\{\{ false \}\}/m);
  assert.match(text, /^\s+workflow_dispatch:/m); assert.match(text, /^\s+push:/m);
  assert.match(text, /paths: \[\.github\/market-runs\/catalog-next-china-daily\.json\]/);
  assert.doesNotMatch(text, /^\s+(?:schedule|workflow_run):/m);
  assert.match(text, /contents: read/); assert.match(text, /cancel-in-progress: false/);
  assert.match(text, /daily-entry\.mjs --checkout/); assert.match(text, /daily-entry\.mjs --run/);
  assert.doesNotMatch(text, /docker|build-release-image|image\.tar|catalog-refresh-market|catalog-prepare-owned-china/i);
  assert.match(text, /AUTO_API_CHE168_KEY: \$\{\{ secrets\.AUTO_API_CHE168_KEY \}\}/);
  const artifact = text.slice(text.indexOf('name: Preserve aggregate'));
  assert.match(artifact, /catalog-next-china-daily-report\.json/);
  assert.match(artifact, /catalog-next-china-daily-generation-report\.json/);
  assert.doesNotMatch(artifact, /RUNNER_TEMP|sqlite|SOURCE|ACCEPTED|receiptBase64|\*\*/);
  await assert.rejects(fs.stat(path.join(root, '.github/workflows/catalog-next-china-daily.yml')), {code: 'ENOENT'});
});
