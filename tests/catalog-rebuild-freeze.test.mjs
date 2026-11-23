import test from 'node:test';
import assert from 'node:assert/strict';
import {freezeWorkflows, githubClient, validateScope, REPOSITORY, REPOSITORY_ID} from '../.github/operations/catalog-rebuild-20261123/freeze.mjs';

const SHA = 'a'.repeat(40);
const TARGET = '.github/workflows/catalog-refresh-example.yml';
const PROTECTED = '.github/workflows/ci.yml';
const ROOT = `/repos/${REPOSITORY}`;
const scope = () => ({version: 1, repository: REPOSITORY, repositoryId: REPOSITORY_ID, baselineSha: SHA,
  workflows: [{path: TARGET, blobSha: SHA, reason: 'Fixture catalog writer'}], protectedWorkflows: [PROTECTED]});

function fixture({active = true, conflict = false, staleInventory = false, staleOnce = false, changedSource = false,
  changeBeforeDisable = false, nonterminalJob = false, otherRepositoryRun = false, unassigned = false, noJobs = false} = {}) {
  const calls = [], snapshots = [];
  const workflows = [
    {id: 10, path: TARGET, state: 'active'},
    {id: 20, path: PROTECTED, state: 'active'},
  ];
  const runs = active ? [{id: 101, workflow_id: 10, path: TARGET, status: unassigned ? 'queued' : 'in_progress', conclusion: null,
    run_attempt: 1, head_branch: 'main', created_at: '2026-11-11T20:50:23Z', updated_at: '2026-11-11T20:50:23Z',
    head_sha: SHA, event: 'schedule', repository: {id: REPOSITORY_ID, full_name: REPOSITORY}, head_repository: {id: otherRepositoryRun ? 99 : REPOSITORY_ID}}] : [];
  // The unrelated protected workflow stays running throughout the operation.
  runs.push({id: 202, workflow_id: 20, path: PROTECTED, status: 'in_progress', conclusion: null,
    head_sha: SHA, event: 'pull_request', repository: {id: REPOSITORY_ID, full_name: REPOSITORY}, head_repository: {id: REPOSITORY_ID}});
  let inventoryReads = 0, contentReads = 0;
  const api = async (method, path) => {
    calls.push({method, path});
    if (path === ROOT) return {id: REPOSITORY_ID, full_name: REPOSITORY};
    if (path.startsWith(`${ROOT}/contents/`)) {
      contentReads++;
      return {path: TARGET, sha: changedSource || (changeBeforeDisable && contentReads > 1) ? 'b'.repeat(40) : SHA};
    }
    if (path.startsWith(`${ROOT}/actions/workflows/`)) {
      const suffix = path.slice(`${ROOT}/actions/workflows/`.length);
      const id = Number(suffix.split('/')[0]);
      const row = workflows.find(w => w.id === id || w.path.split('/').at(-1) === suffix);
      assert(row, `unexpected_workflow:${suffix}`);
      if (method === 'PUT') {assert(suffix === `${row.id}/disable`); row.state = 'disabled_manually'; return null;}
      return structuredClone(row);
    }
    if (path.startsWith(`${ROOT}/actions/runs?`)) {
      inventoryReads++;
      if (staleInventory || (staleOnce && inventoryReads === 1)) return {total_count: 1, workflow_runs: []};
      const status = new URL('https://api.github.com' + path).searchParams.get('status');
      const matching = runs.filter(run => run.status === status);
      return {total_count: matching.length, workflow_runs: structuredClone(matching)};
    }
    const match = path.match(/\/actions\/runs\/(\d+)(.*)$/);
    if (match) {
      const row = runs.find(run => run.id === Number(match[1]));
      assert(row);
      if (match[2].startsWith('/jobs?') && noJobs) return {total_count: 0, jobs: []};
      if (match[2].startsWith('/jobs?')) return {total_count: 1, jobs: [{id: row.id * 10, run_id: row.id,
        status: row.status === 'completed' && !nonterminalJob ? 'completed' : 'in_progress'}]};
      if (method === 'POST') {
        assert(match[2] === '/cancel');
        if (conflict) return {conflict: true};
        row.status = 'completed'; row.conclusion = 'cancelled'; return null;
      }
      return structuredClone(row);
    }
    throw Error(`unexpected_api:${method}:${path}`);
  };
  return {calls, snapshots, api, workflows, runs, persist: async report => {snapshots.push(report);}, pause: async () => {}};
}

test('disables only reviewed writers, cancels their jobs and preserves CI', async () => {
  const f = fixture();
  const result = await freezeWorkflows({scope: scope(), ...f, apply: true});
  assert.equal(result.disabled, true);
  assert.equal(result.quiescent, true);
  assert.equal(f.workflows[0].state, 'disabled_manually');
  assert.equal(f.workflows[1].state, 'active');
  assert.equal(f.runs.find(run => run.id === 202).status, 'in_progress');
  assert.deepEqual(f.calls.filter(call => call.method !== 'GET'), [
    {method: 'PUT', path: `${ROOT}/actions/workflows/10/disable`},
    {method: 'POST', path: `${ROOT}/actions/runs/101/cancel`},
  ]);
  assert.equal(result.runs[0].jobsBefore[0].status, 'in_progress');
  assert.equal(result.runs[0].jobsAfter[0].status, 'completed');
  assert.equal(f.snapshots[0].workflows[0].before, 'active');
});

test('dry run preserves all workflow states and requests no cancellation', async () => {
  const f = fixture();
  const result = await freezeWorkflows({scope: scope(), ...f});
  assert.equal(result.applied, false);
  assert.equal(result.quiescent, false);
  assert(f.calls.every(call => call.method === 'GET'));
});

test('all source hashes are checked before the first mutation', async () => {
  const f = fixture({changedSource: true});
  await assert.rejects(freezeWorkflows({scope: scope(), ...f, apply: true}), /source_changed/);
  assert(f.calls.every(call => call.method === 'GET'));
});

test('a source change after preflight is rejected again before disabling', async () => {
  const f = fixture({changeBeforeDisable: true});
  await assert.rejects(freezeWorkflows({scope: scope(), ...f, apply: true}), /source_changed/);
  assert(f.calls.every(call => call.method === 'GET'));
});

test('an inconsistent count/list snapshot cannot establish quiescence', async () => {
  const f = fixture({staleInventory: true});
  await assert.rejects(freezeWorkflows({scope: scope(), ...f, apply: true}), /count_mismatch/);
  assert.equal(f.snapshots.at(-1).quiescent, false);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
});

test('one transient count/list inconsistency is retried within the bounded census', async () => {
  const f = fixture({staleOnce: true});
  const result = await freezeWorkflows({scope: scope(), ...f, apply: true});
  assert.equal(result.quiescent, true);
});

test('HTTP 409 on cancellation remains unresolved and never becomes cancelled', async () => {
  const f = fixture({conflict: true});
  const result = await freezeWorkflows({scope: scope(), ...f, apply: true});
  assert.equal(result.disabled, true);
  assert.equal(result.quiescent, false);
  assert.equal(result.runs[0].conflict, true);
  assert.equal(result.runs[0].cancelRequested, false);
  assert.equal(result.runs[0].status, 'in_progress');
  assert.equal(result.remaining[0].id, 101);
});

test('completed run with a nonterminal job cannot establish quiescence', async () => {
  const f = fixture({nonterminalJob: true});
  const result = await freezeWorkflows({scope: scope(), ...f, apply: true});
  assert.equal(result.runs[0].status, 'completed');
  assert.equal(result.runs[0].jobsAfter[0].status, 'in_progress');
  assert.equal(result.quiescent, false);
});

test('an active app switch is disabled for future runs but never interrupted', async () => {
  const s = scope(); s.workflows[0].cancelActive = false;
  const f = fixture();
  const result = await freezeWorkflows({scope: s, ...f, apply: true});
  assert.equal(result.disabled, true);
  assert.equal(result.quiescent, false);
  assert.equal(result.runs[0].cancelSkipped, 'active-release-must-complete-or-roll-back');
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
});

test('a run from another repository is never cancelled', async () => {
  const f = fixture({otherRepositoryRun: true});
  await assert.rejects(freezeWorkflows({scope: scope(), ...f, apply: true}), /cancel_scope_changed/);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
});

test('scope rejects protected targets, duplicates and self-disabling', () => {
  const protectedScope = scope(); protectedScope.workflows[0].path = PROTECTED;
  assert.throws(() => validateScope(protectedScope), /scope_overlap/);
  const duplicates = scope(); duplicates.workflows.push({...duplicates.workflows[0]});
  assert.throws(() => validateScope(duplicates), /scope_overlap/);
  const self = scope(); self.workflows[0].path = '.github/workflows/catalog-rebuild-checkpoint.yml';
  assert.throws(() => validateScope(self), /scope_self/);
});

test('shared writers are reported separately and never disabled or cancelled', async () => {
  const s = scope(); s.observeOnlyWorkflows = [PROTECTED];
  const f = fixture();
  const result = await freezeWorkflows({scope: s, ...f, apply: true});
  assert.equal(result.quiescent, true); // Applies only to the explicit stopped scope.
  assert.equal(result.completeWriterBoundary, false);
  assert.deepEqual(result.sharedActiveAfter.map(run => run.id), [202]);
  assert.equal(f.workflows[1].state, 'active');
  assert(!f.calls.some(call => call.method === 'POST' && call.path.includes('/202/')));
});

test('a final guard failure cannot leave a report claiming quiescence', async () => {
  const f = fixture();
  const original = f.api;
  f.api = async (method, path) => {
    if (method === 'GET' && path === `${ROOT}/actions/workflows/20`) return {id: 20, path: PROTECTED, state: 'disabled_manually'};
    return original(method, path);
  };
  await assert.rejects(freezeWorkflows({scope: scope(), ...f, apply: true}), /protected_workflow_changed/);
  assert.equal(f.snapshots.at(-1).quiescent, false);
  assert.equal(f.snapshots.at(-1).error, 'rebuild_protected_workflow_changed');
});

function historicalScope() {
  const s = scope();
  s.historicalUnassigned = [{id: 101, workflowId: 10, path: TARGET, headSha: SHA, branch: 'main',
    event: 'schedule', attempt: 1, createdAt: '2026-11-11T20:50:23Z', updatedAt: '2026-11-11T20:50:23Z'}];
  // The actual admitted record is a push run; use the same identity in fixtures.
  s.historicalUnassigned[0].event = 'push';
  return s;
}

test('only the frozen historical record may remain unassigned without being labelled cancelled', async () => {
  const f = fixture({unassigned: true, noJobs: true}); f.runs[0].event = 'push';
  const result = await freezeWorkflows({scope: historicalScope(), ...f, apply: true});
  assert.equal(result.quiescent, true);
  assert.equal(result.runs[0].status, 'queued');
  assert.equal(result.runs[0].cancelRequested, false);
  assert.equal(result.runs[0].historicalUnassigned, true);
  assert.deepEqual(result.historicalUnassigned.map(run => run.id), [101]);
  assert.deepEqual(result.remaining, []);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
  assert(f.calls.filter(call => call.path.includes('/101/jobs?')).length >= 6);
});

test('unknown empty queued records are not exempted when cancellation is rejected', async () => {
  const f = fixture({unassigned: true, noJobs: true, conflict: true});
  const result = await freezeWorkflows({scope: scope(), ...f, apply: true});
  assert.equal(result.quiescent, false);
  assert.deepEqual(result.historicalUnassigned, []);
  assert.equal(result.remaining[0].id, 101);
});

test('any assigned job or changed historical identity blocks the exception', async () => {
  const assigned = fixture({unassigned: true}); assigned.runs[0].event = 'push';
  await assert.rejects(freezeWorkflows({scope: historicalScope(), ...assigned, apply: true}), /historical_run_assigned/);
  for (const [field, value] of [['head_sha', 'b'.repeat(40)], ['run_attempt', 2], ['updated_at', '2026-11-12T20:50:23Z']]) {
    const f = fixture({unassigned: true, noJobs: true}); f.runs[0].event = 'push'; f.runs[0][field] = value;
    await assert.rejects(freezeWorkflows({scope: historicalScope(), ...f, apply: true}), /historical_run_changed/);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
  }
});

test('HTTP client rejects operations beyond disabling and ordinary cancellation', async () => {
  const requests = [];
  const api = githubClient('test-token', async (url, options) => {requests.push({url, options}); return {ok: true, status: 204};});
  for (const [method, path] of [
    ['PUT', `${ROOT}/actions/workflows/10/enable`],
    ['DELETE', `${ROOT}/actions/runs/101`],
    ['POST', `${ROOT}/actions/runs/101/force-cancel`],
    ['PUT', `${ROOT}/actions/secrets/A_KEY`],
    ['GET', '/repos/another/owner/actions/runs'],
  ]) await assert.rejects(api(method, path), /rebuild_api_/);
  assert.equal(requests.length, 0);
  await api('PUT', `${ROOT}/actions/workflows/10/disable`);
  assert.equal(requests[0].url, `https://api.github.com${ROOT}/actions/workflows/10/disable`);
  assert.equal(requests[0].options.redirect, 'error');
});
