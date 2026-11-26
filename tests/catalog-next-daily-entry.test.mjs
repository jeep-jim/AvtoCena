import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyChinaDailyInvocation, checkoutChinaDailyRuntimes, runChinaDailyEntry,
  readChinaDailyDeadline, readChinaDailyPlans, selectChinaDailyServingPlan,
  CHINA_DAILY_JOB_TIMEOUT_MINUTES} from '../scripts/catalog-next/daily-entry.mjs';
import {runChinaDailyCycle} from '../scripts/catalog-next/daily-controller.mjs';
import {inspectChinaPublicationState} from '../scripts/catalog-next/china-state.mjs';
import {validateChinaGenerationRetirementWitness} from '../scripts/catalog-next/china-generation-gc.mjs';

const root = process.cwd(), sha = 'a'.repeat(40), hash = value => createHash('sha256').update(value).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const env = event => ({GITHUB_REPOSITORY: 'jeep-jim/AvtoCena', GITHUB_REPOSITORY_ID: '1289722938',
  GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, GITHUB_RUN_ID: '45399999999', GITHUB_RUN_ATTEMPT: '1',
  GITHUB_WORKFLOW_REF: 'jeep-jim/AvtoCena/.github/workflows/catalog-next-china-daily.yml@refs/heads/main',
  GITHUB_EVENT_NAME: event, EXPECTED_CONTROLLER_SHA: sha});
const git = args => { if (args[0] === 'rev-parse') return sha + '\n'; assert.equal(args[0], 'diff'); return ''; };

test('actual daily invocation accepts only the bound main workflow, real dispatch SHA or exact primary and catch-up schedules', async () => {
  const manual = await verifyChinaDailyInvocation({environment: env('workflow_dispatch'), git, event: {inputs: {controller_sha: sha}}});
  assert.equal(manual.sourceSha, sha); assert.equal(manual.event, 'workflow_dispatch'); assert.equal(manual.markerPath, null);
  for (const schedule of ['0 14 * * *', '17 0,3,6,9,12,15,18,21 * * *']) {
    const scheduled = await verifyChinaDailyInvocation({environment: env('schedule'), git, event: {schedule}});
    assert.equal(scheduled.event, 'schedule'); assert.equal(scheduled.sourceSha, sha);
    for (const changed of [{GITHUB_REPOSITORY: 'other/AvtoCena'}, {GITHUB_REPOSITORY_ID: '1'},
      {GITHUB_REF: 'refs/heads/other'}, {GITHUB_WORKFLOW_REF: 'jeep-jim/AvtoCena/.github/workflows/other.yml@refs/heads/main'},
      {GITHUB_RUN_ATTEMPT: '2'}, {GITHUB_RUN_ATTEMPT: '0'}, {GITHUB_RUN_ATTEMPT: undefined}])
      await assert.rejects(verifyChinaDailyInvocation({environment: {...env('schedule'), ...changed}, git, event: {schedule}}),
        /china_daily_entry_(workflow|attempt)/);
  }
  for (const changed of [{GITHUB_REPOSITORY_ID: '1'}, {GITHUB_REF: 'refs/heads/other'}, {GITHUB_SHA: 'b'.repeat(40)},
    {GITHUB_WORKFLOW_REF: 'jeep-jim/AvtoCena/.github/workflows/unreviewed.yml@refs/heads/main'}, {GITHUB_EVENT_NAME: 'workflow_run'}])
    await assert.rejects(verifyChinaDailyInvocation({environment: {...env('workflow_dispatch'), ...changed}, git,
      event: {inputs: {controller_sha: sha}}}), /china_daily_entry_/);
  await assert.rejects(verifyChinaDailyInvocation({environment: env('workflow_dispatch'), git, event: {inputs: {controller_sha: 'b'.repeat(40)}}}), /manual_revision/);
  for (const schedule of ['* * * * *', '17 * * * *', '0 15 * * *', '17 0,3,6,9,12,15,18,21 * * * ', undefined, ['0 14 * * *']])
    await assert.rejects(verifyChinaDailyInvocation({environment: env('schedule'), git, event: {schedule}}), /schedule/);
  await assert.rejects(verifyChinaDailyInvocation({environment: {...env('workflow_dispatch'), GITHUB_RUN_ATTEMPT: '2'}, git,
    event: {inputs: {controller_sha: sha}}}), /china_daily_entry_attempt/);
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
  await assert.rejects(verifyChinaDailyInvocation({root: repository, environment: {...environment, GITHUB_RUN_ATTEMPT: '2'}}), /china_daily_entry_attempt/);
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

async function fixture(t, {withCodePlan = false} = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-daily-entry-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const control = path.join(directory, 'controller'), temporary = path.join(directory, 'runner');
  await fs.mkdir(path.join(control, '.github/operations/catalog-next'), {recursive: true});
  await fs.mkdir(temporary); await fs.mkdir(path.join(control, 'node_modules'));
  const [pricingPlan, servingPlan] = await Promise.all(['china-plan.json', 'china-serving-plan.json'].map(async name => {
    const raw = await fs.readFile(path.join(root, '.github/operations/catalog-next', name));
    await fs.writeFile(path.join(control, '.github/operations/catalog-next', name), raw); return JSON.parse(raw);
  }));
  const codePlan = withCodePlan ? {...servingPlan, retainedRuntime: servingPlan.runtimeSha,
    runtimeSha: 'c'.repeat(40), runtimeTree: 'd'.repeat(40)} : undefined;
  if (codePlan) await fs.writeFile(path.join(control, '.github/operations/catalog-next/china-code-serving-plan.json'), JSON.stringify(codePlan));
  const calls = [];
  const runtimes = await checkoutChinaDailyRuntimes({root: control, runnerTemp: temporary, git(args) {
    calls.push(args);
    if (args[0] === 'worktree') mkdirSync(args[3]);
    else assert.deepEqual(args.slice(0, 3), ['fetch', '--no-tags', 'https://github.com/jeep-jim/AvtoCena.git']);
    return '';
  }});
  return {control, temporary, pricingPlan, servingPlan, codePlan, runtimes, calls};
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

test('the reviewed code plan adds one exact checkout and cannot infer a revision or change the pricing runtime', async t => {
  const f = await fixture(t, {withCodePlan: true}), worktrees = f.calls.filter(args => args[0] === 'worktree');
  assert.deepEqual(worktrees.map(args => args[4]), [f.pricingPlan.runtimeSha, f.servingPlan.runtimeSha, f.codePlan.runtimeSha]);
  assert.equal(new Set(worktrees.map(args => args[3])).size, 3);
  const planSet = await readChinaDailyPlans(f.control);
  assert.equal(selectChinaDailyServingPlan(planSet, f.codePlan.runtimeSha).runtimeTree, f.codePlan.runtimeTree);
  assert.equal(selectChinaDailyServingPlan(planSet, f.servingPlan.runtimeSha).runtimeTree, f.servingPlan.runtimeTree);
  assert.throws(() => selectChinaDailyServingPlan(planSet, 'e'.repeat(40)), /accepted_runtime/);
  const filename = path.join(f.control, '.github/operations/catalog-next/china-code-serving-plan.json');
  await fs.writeFile(filename, JSON.stringify({...f.codePlan, pricingRuntimeSha: 'e'.repeat(40)}));
  await assert.rejects(readChinaDailyPlans(f.control), /plans/);
  await fs.writeFile(filename, JSON.stringify(f.servingPlan));
  await assert.rejects(readChinaDailyPlans(f.control), /plans/);
});

function accepted(f, {sourceObservedAt = '2026-11-24T09:00:00Z', acceptedAt = '2026-11-24T10:00:00Z',
  generation = 100, runtimeSha = f.servingPlan.runtimeSha} = {}) {
  const nonce = 'b'.repeat(32), at = acceptedAt;
  const ref = {market: 'china', generationId: `gen_china_${generation}_1`, owner: {runId: String(generation), attempt: '1', revision: sha},
    receiptSha256: '1'.repeat(64), sourceDescriptorSha256: '2'.repeat(64), generationManifestSha256: '3'.repeat(64),
    sourceCursor: 100, sourceObservedAt, runtimeSha,
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

function resolvedPublication(input, previous = {found: false, etag: null, sha256: null, value: null}) {
  const {proof, ...candidate} = input.value.current;
  const pending = {version: 1, kind: 'china-publication-intent-v1', market: 'china',
    revision: (previous.value?.revision ?? 0) + 1, nonce: input.value.commit.nonce, owner: candidate.owner,
    createdAt: input.value.commit.acceptedAt, candidate, previous, status: 'pending', resolution: null};
  const value = {...input.value, revision: (previous.value?.revision ?? 0) + 2, rollback: previous.value?.current ?? null,
    commit: {...input.value.commit, intentSha256: hash(JSON.stringify(ordered(pending))),
      previousETag: previous.etag, previousStateSha256: previous.sha256}};
  const observation = {found: true, etag: '"accepted-' + candidate.owner.runId + '"',
    sha256: hash(JSON.stringify(ordered(value))), value};
  const intentValue = {...pending, status: 'committed', resolution: {kind: 'accepted', at: value.commit.acceptedAt,
    acceptedETag: observation.etag, acceptedSha256: observation.sha256, hostReceiptSha256: proof.hostReceiptSha256}};
  const publication = {accepted: observation, intent: {found: true, etag: '"intent-' + candidate.owner.runId + '"',
    sha256: hash(JSON.stringify(ordered(intentValue))), value: intentValue}};
  assert.equal(inspectChinaPublicationState(publication).status, 'resolved');
  return publication;
}

test('primary and catch-up events skip preparation in a fresh source window and still prepare in the next window', async t => {
  const f = await fixture(t, {withCodePlan: true}), initial = accepted(f, {
    sourceObservedAt: '2026-11-25T14:05:00.000Z', acceptedAt: '2026-11-25T14:10:00.000Z'});
  const empty = () => ({found: false, etag: null, sha256: null, value: null});
  const objects = new Map([['accepted', initial]]), writes = [];
  let sequence = 0, clock, schedule, preparations = 0;
  const storage = {
    async assertPrivateBucket() { return {verified: true}; },
    async read(name) { assert.ok(['accepted', 'intent', 'lease'].includes(name)); return structuredClone(objects.get(name) ?? empty()); },
    async compareAndSwap(name, previous, value) {
      assert.equal(name, 'lease', 'fresh checks cannot replace accepted data or reserve a publication');
      const prior = objects.get(name) ?? empty();
      assert.equal(prior.etag, previous.etag); assert.equal(prior.found, previous.found);
      writes.push(name);
      objects.set(name, {found: true, etag: '"schedule-' + ++sequence + '"',
        sha256: hash(JSON.stringify(ordered(value))), value: structuredClone(value)});
    },
  };
  const capabilities = {
    verifyInvocation: ({environment}) => verifyChinaDailyInvocation({environment, git, event: {schedule}}),
    verifyBaselines: () => {}, createStorage: () => storage,
    runtimeGit: directory => args => { assert.equal(directory, f.runtimes.pricingRoot);
      return args[0] === 'diff' ? '' : args[1] === 'HEAD' ? f.pricingPlan.runtimeSha : f.pricingPlan.runtimeTree; },
    verifyCompatibility: async input => assert.equal(input.runtimeRoot, f.runtimes.servingRoot),
    createRelease: input => {
      assert.equal(input.servingPlan.runtimeSha, initial.value.current.runtimeSha, 'an unaccepted code plan cannot select the daily image');
      return {stageRelease: async () => assert.fail('no stage before preparation'),
        recoverRelease: async () => assert.fail('no host recovery for stable accepted state'),
        retireHost: async () => assert.fail('no retirement without publication')};
    },
    readDeadline: async () => null,
    collectRetired: async input => { assert.equal(input.mode, 'enqueue-only');
      return {completed: true, market: 'china', status: 'no_pending'}; },
    runCycle: input => {
      assert.equal(input.trigger, 'schedule');
      return runChinaDailyCycle({...input, now: () => clock, scheduleHeartbeat: () => () => {},
        prepare: async () => { preparations++; throw Error('china_prepare_fixture_stop_before_source'); }});
    },
  };
  const invoke = () => runChinaDailyEntry({root: f.control, environment: {...env('schedule'),
    RUNNER_TEMP: f.temporary, JSON_STORAGE_DRIVER: 'object'}, capabilities});
  for (const [cron, at] of [
    ['0 14 * * *', '2026-11-25T14:11:00.000Z'],
    ...['2026-11-25T15:17:00.000Z', '2026-11-25T18:17:00.000Z', '2026-11-25T21:17:00.000Z',
      '2026-11-26T00:17:00.000Z', '2026-11-26T03:17:00.000Z', '2026-11-26T06:17:00.000Z',
      '2026-11-26T09:17:00.000Z', '2026-11-26T12:17:00.000Z']
      .map(at => ['17 0,3,6,9,12,15,18,21 * * *', at]),
  ]) {
    schedule = cron; clock = at;
    const result = await invoke();
    assert.equal(result.status, 'not_due'); assert.equal(result.sourcePrepared, false);
    assert.equal(result.published, false); assert.equal(result.applicationBuilds, 0);
    assert.equal(result.leaseReleased, true); assert.equal(preparations, 0, 'source preparation is never entered while not due');
    assert.deepEqual(await storage.read('accepted'), initial);
  }
  assert.equal(writes.length, 18, 'each fresh check only acquires and releases its lease');
  clock = '2026-11-26T15:17:00.000Z';
  await assert.rejects(invoke(), error => error.message === 'china_prepare_fixture_stop_before_source'
    && error.report.published === false && error.report.leaseReleased === true);
  assert.equal(preparations, 1, 'the catch-up schedule reaches preparation once the next source window is due');
  assert.deepEqual(await storage.read('accepted'), initial);
});

test('recovery of a code publication selects the new reviewed adapter before the single subsequent daily stage', async t => {
  const f = await fixture(t, {withCodePlan: true}), initial = accepted(f), recovered = accepted({...f, servingPlan: f.codePlan});
  const {proof: _proof, ...codeCandidate} = recovered.value.current;
  const events = [], verifications = [], creations = [];
  let preparations = 0;
  const storage = {assertPrivateBucket: async () => ({verified: true}), read: async () => initial,
    compareAndSwap: async () => assert.fail('this test substitutes the cycle, not the host proof protocol')};
  const capabilities = {
    verifyInvocation: async () => ({version: 1, event: 'workflow_dispatch', sourceSha: sha}), verifyBaselines: () => {},
    runtimeGit: directory => args => { assert.equal(directory, f.runtimes.pricingRoot);
      return args[0] === 'diff' ? '' : args[1] === 'HEAD' ? f.pricingPlan.runtimeSha : f.pricingPlan.runtimeTree; },
    verifyCompatibility: async input => {
      verifications.push(input.servingPlan.runtimeSha);
      assert.equal(input.runtimeRoot, f.runtimes.servingRoots[input.servingPlan.runtimeSha]);
    },
    createStorage: () => storage, readDeadline: async () => '2026-11-25T18:00:00Z',
    createRelease: input => {
      const runtime = input.servingPlan.runtimeSha; creations.push(runtime);
      return {
        async recoverRelease(args) {
          assert.equal(runtime, f.codePlan.runtimeSha); assert.equal(args.intent.value.candidate.runtimeSha, runtime);
          events.push('recover-new'); return {kind: 'accepted', testOnlyRecoveredReference: recovered.value.current};
        },
        async stageRelease(args) {
          assert.equal(runtime, f.codePlan.runtimeSha); assert.equal(args.previous.value.current.runtimeSha, runtime);
          events.push('stage-new'); return {candidate: args.candidate};
        },
        retireHost: async () => assert.fail('no retirement requested'),
      };
    },
    runCycle: async input => {
      assert.equal(input.plan.runtimeSha, f.pricingPlan.runtimeSha);
      const result = await input.recoverRelease({intent: {value: {candidate: codeCandidate}}, assertAuthority: async () => {}});
      assert.equal(result.kind, 'accepted');
      preparations++;
      await input.stageRelease({previous: recovered, candidate: {...codeCandidate, generationId: 'gen_china_101_1'},
        assertAuthority: async () => {}});
      return {kind: 'china-daily-cycle-v1', completed: true, market: 'china', published: true, status: 'accepted'};
    },
  };
  const result = await runChinaDailyEntry({root: f.control, environment: {...env('workflow_dispatch'),
    RUNNER_TEMP: f.temporary, JSON_STORAGE_DRIVER: 'object'}, capabilities});
  assert.equal(result.status, 'accepted'); assert.equal(preparations, 1);
  assert.deepEqual(events, ['recover-new', 'stage-new']);
  assert.deepEqual(creations, [f.servingPlan.runtimeSha, f.codePlan.runtimeSha]);
  assert.deepEqual(verifications, creations);
  capabilities.runCycle = async input => input.recoverRelease({intent: {value: {candidate: {...codeCandidate, runtimeSha: 'e'.repeat(40)}}},
    assertAuthority: async () => {}});
  await assert.rejects(runChinaDailyEntry({root: f.control, environment: {...env('workflow_dispatch'),
    RUNNER_TEMP: f.temporary, JSON_STORAGE_DRIVER: 'object'}, capabilities}), /accepted_runtime/);
});

async function historicalRetirementFixture(t, historicalRuntime) {
  const f = await fixture(t, {withCodePlan: true}), creations = [], events = [];
  let historical;
  for (const generation of [100, 101, 102]) historical = resolvedPublication(
    accepted(f, {generation, runtimeSha: historicalRuntime}), historical?.accepted);
  const witness = {previousAccepted: historical.intent.value.previous, acceptedPublication: historical};
  assert.equal(validateChinaGenerationRetirementWitness(witness).reference.generationId, 'gen_china_100_1');
  const fresh = resolvedPublication(accepted(f, {generation: 103}), historical.accepted);
  const state = {current: fresh, assertions: 0, reads: 0, retired: 0, refuseAuthorityAt: 0};
  const args = {...witness,
    async readState() { state.reads++; events.push('fresh-state'); return state.current; },
    async assertAuthority() {
      state.assertions++; events.push('authority');
      if (state.refuseAuthorityAt === state.assertions) throw Error('china_daily_state_changed');
    }};
  const before = structuredClone(witness), checkoutCalls = structuredClone(f.calls);
  const capabilities = {
    verifyInvocation: async () => ({version: 1, event: 'workflow_dispatch', sourceSha: sha}), verifyBaselines: () => {},
    runtimeGit: directory => argv => { assert.equal(directory, f.runtimes.pricingRoot);
      return argv[0] === 'diff' ? '' : argv[1] === 'HEAD' ? f.pricingPlan.runtimeSha : f.pricingPlan.runtimeTree; },
    verifyCompatibility: async input => { assert.equal(input.servingPlan.runtimeSha, f.servingPlan.runtimeSha); },
    createStorage: () => ({assertPrivateBucket: async () => ({verified: true}), read: async name => {
      assert.equal(name, 'accepted'); return fresh.accepted;
    }, compareAndSwap: async () => assert.fail('adapter selection must not write publication state')}),
    readDeadline: async () => '2026-11-24T18:00:00.000Z',
    createRelease: input => {
      creations.push(input.servingPlan.runtimeSha);
      return {stageRelease: async () => assert.fail('retirement cannot stage or build'),
        recoverRelease: async () => assert.fail('retirement cannot recover a publication'),
        async retireHost(received) {
          state.retired++; events.push('retire'); assert.equal(received, args);
          assert.equal(received.previousAccepted, witness.previousAccepted);
          assert.equal(received.acceptedPublication, historical);
          assert.deepEqual({previousAccepted: received.previousAccepted, acceptedPublication: received.acceptedPublication}, before);
          assert.equal(input.servingPlan.runtimeSha, fresh.accepted.value.current.runtimeSha);
          return {completed: true, retiredContainers: 0, filesDeleted: 0, freedBytes: 0};
        }};
    },
    runCycle: async input => {
      const result = await input.retirePreviousHost(args);
      assert.equal(result.completed, true);
      return {kind: 'china-daily-cycle-v1', completed: true, market: 'china', published: false, status: 'fixture_retired'};
    },
  };
  const invoke = () => runChinaDailyEntry({root: f.control, environment: {...env('workflow_dispatch'),
    RUNNER_TEMP: f.temporary, JSON_STORAGE_DRIVER: 'object'}, capabilities});
  return {...f, fresh, state, creations, events, args, witness, before, checkoutCalls, invoke};
}

for (const historicalRuntime of ['36c7ea726e7f070d10dbc65afc6538f13c0c1a24', 'd536c1547c4d82a339ed68ced7d8503f09b6810b']) {
  test('host retirement selects fresh accepted runtime while preserving historical ' + historicalRuntime.slice(0, 7) + ' permission', async t => {
    const f = await historicalRetirementFixture(t, historicalRuntime);
    assert(![f.servingPlan.runtimeSha, f.codePlan.runtimeSha].includes(historicalRuntime));
    assert.equal((await f.invoke()).status, 'fixture_retired');
    assert.equal(f.state.retired, 1); assert.equal(f.state.reads, 1); assert.equal(f.state.assertions, 3);
    assert.deepEqual(f.events, ['authority', 'fresh-state', 'authority', 'authority', 'retire']);
    assert.deepEqual(f.creations, [f.servingPlan.runtimeSha]); assert.deepEqual(f.calls, f.checkoutCalls);
    assert.deepEqual(f.witness, f.before);
  });
}

test('retirement refuses changed authority, unsupported current runtime or unresolved fresh state without a host action', async t => {
  for (const kind of ['authority_before_read', 'authority_after_read', 'authority_before_host', 'unsupported', 'unresolved']) {
    const f = await historicalRetirementFixture(t, '36c7ea726e7f070d10dbc65afc6538f13c0c1a24');
    if (kind.startsWith('authority_')) f.state.refuseAuthorityAt = {
      authority_before_read: 1, authority_after_read: 2, authority_before_host: 3,
    }[kind];
    else if (kind === 'unsupported') f.state.current = resolvedPublication(accepted(f, {generation: 104, runtimeSha: 'e'.repeat(40)}), f.fresh.accepted);
    else {
      const pending = {...f.fresh.intent.value, status: 'pending', resolution: null};
      f.state.current = {...f.fresh, intent: {...f.fresh.intent, value: pending, sha256: hash(JSON.stringify(ordered(pending)))}};
      assert.equal(inspectChinaPublicationState(f.state.current).status, 'accepted_needs_finalization');
    }
    await assert.rejects(f.invoke(), kind.startsWith('authority_') ? /china_daily_state_changed/
      : kind === 'unsupported' ? /china_daily_entry_accepted_runtime/ : /china_daily_entry_retirement_state/);
    assert.equal(f.state.retired, 0); assert.deepEqual(f.creations, [f.servingPlan.runtimeSha]);
    assert.deepEqual(f.calls, f.checkoutCalls); assert.deepEqual(f.witness, f.before);
  }
});

test('production entry binds accepted state, passes pricing root to preparation and serving root only to release, and filters progress logs', async t => {
  const f = await fixture(t), observation = accepted(f), logs = [], called = [];
  const hostArgs = {previousAccepted: observation, acceptedPublication: {accepted: observation, intent: 'exact-test-intent'},
    readState: async () => resolvedPublication(observation), assertAuthority: async () => {}};
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
      return {stageRelease: async () => {}, recoverRelease: async () => {}, retireHost: async args => {
        called.push('host-retire'); assert.deepEqual(args, hostArgs);
        return {completed: true, retiredContainers: 0, filesDeleted: 0, freedBytes: 0};
      }}; },
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
      assert.deepEqual(await input.retirePreviousHost(hostArgs), {completed: true, retiredContainers: 0, filesDeleted: 0, freedBytes: 0});
      await input.afterAccepted({previousAccepted: observation, accepted: observation, intent: 'exact-test-intent', readState: async () => {}, assertAuthority: async () => {}});
      return {kind: 'china-daily-cycle-v1', completed: true, market: 'china', published: true, status: 'accepted'};
    },
  };
  const result = await runChinaDailyEntry({root: f.control, environment: {...env('workflow_dispatch'),
    RUNNER_TEMP: f.temporary, JSON_STORAGE_DRIVER: 'object'}, capabilities, log: value => logs.push(value)});
  assert.equal(result.status, 'accepted'); assert.deepEqual(called, ['release', 'cycle', 'enqueue-only', 'host-retire', 'drain']);
  assert.equal(result.cleanupDeadlineAt, '2026-11-24T18:00:00.000Z');
  assert.deepEqual(logs[0], {phase: 'test_progress', market: 'china', sourceRows: 123});
  assert.ok(!JSON.stringify(logs).includes('private_supplier_token'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.control, 'catalog-next-china-daily-report.json'))), result);
  capabilities.readDeadline = async () => { throw Error('private-gh-error'); };
  called.length = 0;
  const deferred = await runChinaDailyEntry({root: f.control, environment: {...env('workflow_dispatch'),
    RUNNER_TEMP: f.temporary, JSON_STORAGE_DRIVER: 'object'}, capabilities, log: value => logs.push(value)});
  assert.equal(deferred.status, 'accepted'); assert.equal(deferred.cleanupDeadlineAt, null);
  assert.deepEqual(called, ['release', 'cycle', 'enqueue-only', 'host-retire', 'enqueue-only']);
  assert.ok(!JSON.stringify(logs).includes('private-gh-error'));
  capabilities.createStorage = () => ({...storage, read: async () => ({found: false, etag: null, sha256: null, value: null})});
  called.length = 0;
  await assert.rejects(runChinaDailyEntry({root: f.control, environment: {...env('schedule'), RUNNER_TEMP: f.temporary,
    JSON_STORAGE_DRIVER: 'object'}, capabilities}), /accepted_source_required/);
  assert.deepEqual(called, [], 'no bootstrap, preparation, release or GC without accepted state');
});

test('the production daily workflow has exact primary and catch-up schedules, one writer, no image build and aggregate-only artifacts', async () => {
  const text = await fs.readFile(path.join(root, '.github/workflows/catalog-next-china-daily.yml'), 'utf8');
  assert.match(text, /^name: China independent daily/m);
  assert.match(text, /^\s+if: github\.repository_id == '1289722938'/m);
  assert.match(text, /^\s+workflow_dispatch:/m); assert.match(text, /^\s+push:/m);
  assert.match(text, /paths: \[\.github\/market-runs\/catalog-next-china-daily\.json\]/);
  assert.match(text, /^\s+schedule:/m);
  assert.deepEqual([...text.matchAll(/^\s+- cron: '([^']+)'$/gm)].map(match => match[1]),
    ['0 14 * * *', '17 0,3,6,9,12,15,18,21 * * *']);
  assert.doesNotMatch(text, /^\s+workflow_run:/m);
  assert.match(text, /contents: read/); assert.match(text, /cancel-in-progress: false/);
  assert.match(text, /group: catalog-next-china/); assert.match(text, /github\.run_attempt == '1'/);
  assert.match(text, /daily-entry\.mjs --checkout/); assert.match(text, /daily-entry\.mjs --run/);
  assert.doesNotMatch(text, /docker|build-release-image|image\.tar|catalog-refresh-market|catalog-prepare-owned-china/i);
  assert.match(text, /AUTO_API_CHE168_KEY: \$\{\{ secrets\.AUTO_API_CHE168_KEY \}\}/);
  const artifact = text.slice(text.indexOf('name: Preserve aggregate'));
  assert.match(artifact, /catalog-next-china-daily-report\.json/);
  assert.match(artifact, /catalog-next-china-daily-generation-report\.json/);
  assert.doesNotMatch(artifact, /RUNNER_TEMP|sqlite|SOURCE|ACCEPTED|receiptBase64|\*\*/);
  assert.ok((await fs.stat(path.join(root, '.github/workflows/catalog-next-china-daily.yml'))).isFile());
});
