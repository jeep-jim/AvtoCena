import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PROFILE, TARGETS, verifyCancelInvocation, checkTargetRun, checkPreflightJob,
  createCancellationClient, cancelStalledPreflights} from '../scripts/catalog-next/cancel-japan-stalled-preflight-46040340638.mjs';

const POST_NAMES = ['Post Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  'Post Run actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'];
const at = '2026-11-27T17:30:34.949Z';
function run(target, completed = false) {
  return {id: Number(target.runId), head_sha: target.headSha, path: target.workflowPath,
    run_attempt: 1, event: 'push', head_branch: 'main', repository: {id: 1289722938, full_name: 'jeep-jim/AvtoCena'},
    head_repository: {id: 1289722938}, status: completed ? 'completed' : 'in_progress', conclusion: completed ? 'cancelled' : null};
}
function jobs(target) {
  return {total_count: 1, jobs: [{id: Number(target.jobId), run_id: Number(target.runId), name: target.jobName,
    run_attempt: 1, head_sha: target.headSha,
    status: 'in_progress', conclusion: null, steps: [
      ...Array.from({length: target.lastStepNumber}, (_, index) => ({number: index + 1,
        name: target.required[index + 1] ?? 'Known local or artifact step ' + (index + 1),
        status: index + 1 < target.gateNumber ? 'completed' : index + 1 === target.gateNumber ? 'in_progress' : 'pending',
        conclusion: index + 1 < target.gateNumber ? 'success' : null})),
      ...target.postNumbers.map((number, index) => ({number, name: POST_NAMES[index], status: 'pending', conclusion: null})),
    ]}]};
}
function fixture({transformRun, transformJobs, cancelStatus = 202, terminal = true} = {}) {
  const calls = [], cancelled = new Set(), reads = new Map();
  const client = {
    async readRun(target) {
      calls.push('run:' + target.runId);
      return transformRun ? transformRun(target, cancelled.has(target.runId)) : run(target, terminal && cancelled.has(target.runId));
    },
    async readJobs(target) {
      calls.push('jobs:' + target.runId); const count = (reads.get(target.runId) ?? 0) + 1; reads.set(target.runId, count);
      return transformJobs ? transformJobs(target, count) : jobs(target);
    },
    async cancel(target) { calls.push('cancel:' + target.runId); cancelled.add(target.runId); return {status: cancelStatus}; },
  };
  const waits = [];
  return {calls, client, waits, execute: () => cancelStalledPreflights({client, now: () => at, wait: async ms => { waits.push(ms); }})};
}

test('only the exact release31 and verify62 identities are admitted', () => {
  assert.deepEqual(TARGETS.map(value => [value.runId, value.headSha, value.jobId]), [
    ['46040340638', '400da6f50fa12606c7625e0382a0441fa4eb5381', '140646157850'],
    ['46040261112', 'cb293d98fca55acc4ec2a027c2fae71899d6d69c', '140645894844'],
  ]);
  for (const target of TARGETS) {
    assert.equal(checkTargetRun(target, run(target)).status, 'in_progress');
    assert.equal(checkPreflightJob(target, jobs(target)).laterStepsPending, true);
    for (const change of [{id: 1}, {head_sha: '0'.repeat(40)}, {path: '.github/workflows/foreign.yml'},
      {run_attempt: 2}, {event: 'pull_request'}, {head_branch: 'other'},
      {repository: {id: 1, full_name: 'jeep-jim/AvtoCena'}}, {head_repository: {id: 1}}]) {
      assert.throws(() => checkTargetRun(target, {...run(target), ...change}), /run_binding/);
    }
    assert.throws(() => checkTargetRun({...target}, run(target)), /target/);
    assert.throws(() => checkTargetRun(target, {...run(target), status: 'queued'}), /run_status/);
  }
});

test('every later step including build, publication, failure diagnostics and post actions must still be pending', () => {
  for (const target of TARGETS) {
    for (const later of jobs(target).jobs[0].steps.filter(step => step.number > target.gateNumber)) {
      for (const status of ['in_progress', 'completed']) {
        const changed = jobs(target); const step = changed.jobs[0].steps.find(value => value.number === later.number);
        step.status = status; step.conclusion = status === 'completed' ? 'success' : null;
        assert.throws(() => checkPreflightJob(target, changed), /not_preflight/);
      }
    }
    for (const status of ['pending', 'completed']) {
      const changed = jobs(target); changed.jobs[0].steps.find(step => step.number === target.gateNumber).status = status;
      assert.throws(() => checkPreflightJob(target, changed), /not_preflight/);
    }
  }
});

test('missing, duplicate, renamed or foreign job/step evidence cannot authorize cancellation', () => {
  for (const target of TARGETS) {
    for (const mutate of [
      value => { value.jobs = []; }, value => { value.total_count = 2; },
      value => { value.jobs.push(structuredClone(value.jobs[0])); },
      value => { value.jobs[0].id++; }, value => { value.jobs[0].run_id++; },
      value => { value.jobs[0].run_attempt = 2; }, value => { value.jobs[0].head_sha = '0'.repeat(40); },
      value => { value.jobs[0].name = 'other'; }, value => { value.jobs[0].status = 'completed'; },
      value => { value.jobs[0].steps.pop(); },
      value => { value.jobs[0].steps[1].number = 1; },
      value => { value.jobs[0].steps[0].number = 99; },
      value => { value.jobs[0].steps[0].conclusion = 'failure'; },
      value => { value.jobs[0].steps.find(step => step.number === target.gateNumber).name = 'Other test'; },
    ]) { const changed = jobs(target); mutate(changed); assert.throws(() => checkPreflightJob(target, changed), /japan_preflight_cancel_/); }
    for (const number of Object.keys(target.required).map(Number)) {
      const changed = jobs(target); changed.jobs[0].steps.find(step => step.number === number).name = 'Missing required boundary';
      assert.throws(() => checkPreflightJob(target, changed), /step_binding/);
    }
  }
});

test('two fresh observations immediately precede each single normal request, and terminal verification is separate', async () => {
  const f = fixture(), report = await f.execute();
  assert.equal(report.completed, true); assert.equal(report.atomicCancellationClaimed, false);
  assert.equal(report.forceCancellationUsed, false); assert.equal(report.githubRunCancellationOnly, true);
  assert.deepEqual(f.calls, [
    ...TARGETS.flatMap(target => ['run:', 'jobs:', 'run:', 'jobs:', 'cancel:'].map(prefix => prefix + target.runId)),
    ...TARGETS.map(target => 'run:' + target.runId),
  ]);
  for (const result of report.targets) {
    assert.equal(result.preflightObservations.length, 2); assert.equal(result.cancelHttpStatus, 202);
    assert.equal(result.cancelAccepted, true); assert.equal(result.terminalVerified, true);
    assert.equal(result.terminalConclusion, 'cancelled');
  }
  assert(!JSON.stringify(report).includes('Known local'));
});

test('a job that advances between observations receives no cancellation, without blocking the other exact target', async () => {
  const f = fixture({transformJobs: (target, count) => {
    const document = jobs(target);
    if (target.jobName === 'release' && count === 2) document.jobs[0].steps.find(step => step.number === 18).status = 'in_progress';
    return document;
  }});
  const report = await f.execute();
  assert.equal(report.completed, false); assert.equal(report.targets[0].cancelRequested, false);
  assert.match(report.targets[0].errorCode, /not_preflight/);
  assert.deepEqual(f.calls.filter(call => call.startsWith('cancel:')), ['cancel:46040261112']);
});

test('already terminal runs and a completion between observations are reported without POST', async () => {
  const counts = new Map();
  const f = fixture({transformRun: target => {
    const count = (counts.get(target.runId) ?? 0) + 1; counts.set(target.runId, count);
    return run(target, target.jobName === 'verify' || count === 2);
  }});
  const report = await f.execute();
  assert.equal(report.completed, true); assert.equal(f.calls.filter(call => call.startsWith('cancel:')).length, 0);
  assert(report.targets.every(value => value.status === 'already_completed' && !value.cancelRequested && !value.cancelAccepted));
});

test('conflict is never labelled accepted and never retried; actual terminal conclusion remains truthful', async () => {
  const f = fixture({cancelStatus: 409});
  const report = await f.execute();
  assert(report.targets.every(value => value.cancelHttpStatus === 409 && !value.cancelAccepted && value.terminalVerified));
  assert.equal(f.calls.filter(call => call.startsWith('cancel:')).length, 2);
});

test('bounded terminal polling cannot turn a 202 response into a fabricated terminal success', async () => {
  const f = fixture({terminal: false}), report = await f.execute();
  assert.equal(report.completed, false); assert(report.targets.every(value => value.cancelAccepted && !value.terminalVerified));
  assert.equal(f.waits.length, 23); assert(f.waits.every(value => value === 5000));
  assert.equal(f.calls.length, 58); assert.equal(f.calls.filter(call => call.startsWith('cancel:')).length, 2);
});

test('terminal observation with changed identity is refused after an accepted cancellation request', async () => {
  const f = fixture({transformRun: (target, cancelled) => cancelled
    ? {...run(target, true), run_attempt: 2} : run(target)});
  const report = await f.execute();
  assert.equal(report.completed, false);
  assert(report.targets.every(value => !value.terminalVerified && /run_binding/.test(value.errorCode)));
});

test('network client exposes only fixed GitHub API reads and one ordinary cancel endpoint with no redirects', async () => {
  const calls = [], client = createCancellationClient({environment: {GH_TOKEN: 'test-only-token'}, fetcher: async (url, init) => {
    calls.push({url, init}); return init.method === 'POST' ? new Response(null, {status: 202}) : Response.json({ok: true});
  }});
  for (const target of TARGETS) { await client.readRun(target); await client.readJobs(target); await client.cancel(target); }
  for (const {url, init} of calls) {
    assert.equal(new URL(url).origin, 'https://api.github.com'); assert.equal(init.redirect, 'error');
    assert.equal(init.body, undefined); assert(init.signal instanceof AbortSignal);
    assert.equal(init.headers.Authorization, 'Bearer test-only-token');
    assert.match(url, /^https:\/\/api\.github\.com\/repos\/jeep-jim\/AvtoCena\/actions\/runs\/(46040340638|46040261112)(?:\/attempts\/1\/jobs\?per_page=100|\/cancel)?$/);
    assert.equal(init.method, url.endsWith('/cancel') ? 'POST' : 'GET');
  }
  await assert.rejects(client.cancel({...TARGETS[0], runId: '1'}), /target/); assert.equal(calls.length, 6);
});

test('permission refusals, transport errors, malformed or oversized bodies fail closed without retry', async () => {
  for (const [status, message] of [[401, 'permission_denied'], [403, 'permission_denied'], [404, 'read_response']]) {
    let calls = 0; const client = createCancellationClient({environment: {GH_TOKEN: 'test-token'}, fetcher: async () => {
      calls++; return new Response('private response must not be printed', {status});
    }});
    await assert.rejects(client.readRun(TARGETS[0]), new RegExp(message)); assert.equal(calls, 1);
  }
  for (const body of ['invalid-json', 'x'.repeat(128 * 1024 + 1)]) {
    const client = createCancellationClient({environment: {GH_TOKEN: 'test-token'}, fetcher: async () => new Response(body)});
    await assert.rejects(client.readRun(TARGETS[0]), /json|body_budget/);
  }
  const unavailable = createCancellationClient({environment: {GH_TOKEN: 'test-token'}, fetcher: async () => { throw Error('secret raw error'); }});
  await assert.rejects(unavailable.cancel(TARGETS[0]), {message: 'japan_preflight_cancel_transport'});
});

test('request count and elapsed client budgets remain bounded', async () => {
  let calls = 0, clock = 0;
  const client = createCancellationClient({environment: {GH_TOKEN: 'test-token'}, now: () => clock,
    fetcher: async () => { calls++; return Response.json({}); }});
  for (let index = 0; index < 64; index++) await client.readRun(TARGETS[0]);
  await assert.rejects(client.readRun(TARGETS[0]), /budget/); assert.equal(calls, 64);
  const timed = createCancellationClient({environment: {GH_TOKEN: 'test-token'}, now: () => clock,
    fetcher: async () => assert.fail('expired client must not send a request')});
  clock = 180000; await assert.rejects(timed.readRun(TARGETS[0]), /budget/);
});

test('invocation cannot accept manual, wrong workflow/job, or a targeted run as its own controller', () => {
  const environment = {GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_WORKFLOW_REF: PROFILE.workflowRef,
    GITHUB_JOB: 'cancel', GITHUB_RUN_ID: '46050000000'};
  for (const change of [{GITHUB_EVENT_NAME: 'workflow_dispatch'}, {GITHUB_WORKFLOW_REF: 'foreign'},
    {GITHUB_JOB: 'release'}, {GITHUB_RUN_ID: TARGETS[0].runId}, {GITHUB_ACTIONS: 'false'}]) {
    assert.throws(() => verifyCancelInvocation({root: '/must-not-be-read', environment: {...environment, ...change}}), /invocation/);
  }
});

test('workflow has one separate marker, least required permissions, no host environment or alternative API capability', async () => {
  const workflow = await fs.readFile(new URL('../.github/workflows/japan-stalled-preflight-46040340638-cancel.yml', import.meta.url), 'utf8');
  assert(workflow.includes('paths: [' + PROFILE.markerPath + ']'));
  assert.match(workflow, /permissions:\n  contents: read\n  actions: write\n/);
  assert(!/workflow_dispatch:|schedule:|environment:|secrets\.|SSH|REGCLOUD|supplier|curl|npm ci/.test(workflow));
  assert(workflow.includes('group: japan-stalled-preflight-46040340638-cancel'));
  assert(workflow.includes('cancel-in-progress: false')); assert(workflow.includes('persist-credentials: false'));
  assert(workflow.includes('fetch-depth: 2')); assert(workflow.includes('timeout-minutes: 5'));
  assert(workflow.indexOf('--verify') < workflow.indexOf('GH_TOKEN:')); assert(workflow.includes('path: ' + PROFILE.reportName));
  for (const target of TARGETS) {
    const source = await fs.readFile(new URL('../' + target.workflowPath, import.meta.url), 'utf8');
    for (const name of Object.values(target.required)) assert(source.includes('name: ' + name), name);
  }
});
