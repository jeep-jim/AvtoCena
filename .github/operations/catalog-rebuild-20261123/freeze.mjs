import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const REPOSITORY = 'jeep-jim/AvtoCena';
export const REPOSITORY_ID = 1289722938;
const ROOT = `/repos/${REPOSITORY}`;
const ACTIVE = ['in_progress', 'queued', 'requested', 'waiting', 'pending'];
const FILE = /^\.github\/workflows\/[a-z0-9][a-z0-9-]*\.ya?ml$/;
const SHA = /^[a-f0-9]{40}$/;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateScope(scope) {
  assert(scope?.version === 1 && scope.repository === REPOSITORY && scope.repositoryId === REPOSITORY_ID, 'rebuild_scope_repository');
  assert(SHA.test(scope.baselineSha ?? ''), 'rebuild_scope_baseline');
  assert(Array.isArray(scope.workflows) && scope.workflows.length > 0, 'rebuild_scope_empty');
  assert(Array.isArray(scope.protectedWorkflows), 'rebuild_scope_protected');
  const paths = new Set();
  for (const row of scope.workflows) {
    assert(FILE.test(row.path ?? '') && SHA.test(row.blobSha ?? '') && typeof row.reason === 'string' && row.reason.length > 0, 'rebuild_scope_workflow');
    assert(!paths.has(row.path) && !scope.protectedWorkflows.includes(row.path), 'rebuild_scope_overlap');
    assert(!row.path.includes('catalog-rebuild'), 'rebuild_scope_self');
    assert(row.cancelActive === undefined || typeof row.cancelActive === 'boolean', 'rebuild_scope_cancel_policy');
    paths.add(row.path);
  }
  for (const path of scope.protectedWorkflows) assert(FILE.test(path), 'rebuild_scope_protected_path');
  assert(scope.observeOnlyWorkflows === undefined || Array.isArray(scope.observeOnlyWorkflows), 'rebuild_scope_observe_only');
  for (const path of scope.observeOnlyWorkflows ?? []) assert(scope.protectedWorkflows.includes(path) && !paths.has(path), 'rebuild_scope_observe_overlap');
  assert(scope.historicalUnassigned === undefined || Array.isArray(scope.historicalUnassigned), 'rebuild_scope_historical');
  const historicalIds = new Set();
  for (const row of scope.historicalUnassigned ?? []) {
    assert(Number.isSafeInteger(row.id) && row.id > 0 && !historicalIds.has(row.id) &&
      Number.isSafeInteger(row.workflowId) && row.workflowId > 0 && paths.has(row.path) && SHA.test(row.headSha ?? '') &&
      row.branch === 'main' && row.event === 'push' && row.attempt === 1 &&
      Number.isFinite(Date.parse(row.createdAt)) && row.updatedAt === row.createdAt, 'rebuild_scope_historical_identity');
    historicalIds.add(row.id);
  }
  return scope;
}

/** This client accepts only the operations needed by the reviewed stop plan.
 * It never writes repository files, changes secrets, enables workflows or
 * deletes artifacts, storage objects, runs or deployment environments. */
export function githubClient(token, fetcher = fetch) {
  assert(typeof token === 'string' && token.length > 0, 'rebuild_github_token_missing');
  return async (method, path) => {
    assert(path.startsWith(ROOT + '/') || path === ROOT, 'rebuild_api_repository');
    assert(method === 'GET' ||
      (method === 'PUT' && new RegExp(`^${ROOT}/actions/workflows/[1-9][0-9]*/disable$`).test(path)) ||
      (method === 'POST' && new RegExp(`^${ROOT}/actions/runs/[1-9][0-9]*/cancel$`).test(path)), 'rebuild_api_operation');
    const response = await fetcher('https://api.github.com' + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: {Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28'},
    });
    if (method === 'POST' && response.status === 409) return {conflict: true};
    assert(response.ok, `rebuild_github_http_${response.status}`);
    if (response.status === 204 || response.status === 202) return null;
    return response.json();
  };
}

async function paginated(api, path, field, validate, pause) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = [], ids = new Set();
    let count, drift = false;
    for (let page = 1; ; page++) {
      const result = await api('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      assert(Number.isSafeInteger(result?.total_count) && result.total_count >= 0 && result.total_count < 1000 &&
        Array.isArray(result[field]) && result[field].length <= 100, 'rebuild_inventory_invalid');
      count ??= result.total_count;
      if (result.total_count !== count) drift = true;
      for (const row of result[field]) {
        validate(row);
        if (ids.has(row.id)) drift = true;
        ids.add(row.id);
        rows.push(row);
      }
      if (result[field].length < 100) break;
      assert(page < 10, 'rebuild_inventory_page_limit');
    }
    if (!drift && rows.length === count && ids.size === count) return rows;
    if (attempt < 2) await pause(750);
  }
  throw new Error('rebuild_inventory_count_mismatch');
}

export async function listActiveRuns(api, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const runs = new Map();
  for (const status of ACTIVE) {
    const rows = await paginated(api, `${ROOT}/actions/runs?status=${status}`, 'workflow_runs', run => {
      assert(Number.isSafeInteger(run.id) && run.id > 0 && Number.isSafeInteger(run.workflow_id) && run.workflow_id > 0 &&
        FILE.test(run.path ?? '') && SHA.test(run.head_sha ?? '') &&
        [...ACTIVE, 'completed'].includes(run.status) &&
        run.repository?.id === REPOSITORY_ID && run.repository?.full_name === REPOSITORY, 'rebuild_run_repository');
    }, pause);
    for (const run of rows) runs.set(run.id, run);
  }
  return [...runs.values()].filter(run => run.status !== 'completed');
}

async function readJobs(api, run, pause) {
  return paginated(api, `${ROOT}/actions/runs/${run.id}/jobs?filter=all`, 'jobs', job => {
    assert(Number.isSafeInteger(job.id) && job.id > 0 && job.run_id === run.id &&
      ['queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested'].includes(job.status), 'rebuild_job_identity');
  }, pause);
}

// The existing publication authority already records this exact contradictory
// GitHub entry: both cancellation APIs returned 409 / never queued. It has no
// assigned jobs. This is not a general exemption for queued or empty runs and
// never proves that the run is cancelled, terminal, or unable to start later.
async function verifyHistoricalUnassigned(scope, api, run, pause) {
  const expected = (scope.historicalUnassigned ?? []).find(row => row.id === run.id);
  if (!expected) return false;
  const matches = value => value?.id === expected.id && value.workflow_id === expected.workflowId &&
    value.path === expected.path && value.head_sha === expected.headSha && value.head_branch === expected.branch &&
    value.event === expected.event && value.run_attempt === expected.attempt && value.created_at === expected.createdAt &&
    value.updated_at === expected.updatedAt && value.repository?.id === REPOSITORY_ID &&
    value.repository.full_name === REPOSITORY && value.head_repository?.id === REPOSITORY_ID &&
    value.status === 'queued' && value.conclusion === null;
  assert(matches(run), 'rebuild_historical_run_changed');
  for (let pass = 0; pass < 2; pass++) {
    const current = await api('GET', `${ROOT}/actions/runs/${run.id}`);
    assert(matches(current), 'rebuild_historical_run_changed');
    assert((await readJobs(api, current, pause)).length === 0, 'rebuild_historical_run_assigned');
  }
  const final = await api('GET', `${ROOT}/actions/runs/${run.id}`);
  assert(matches(final), 'rebuild_historical_run_changed');
  return true;
}

const runRow = run => ({id: run.id, workflowId: run.workflow_id, path: run.path, status: run.status,
  conclusion: run.conclusion ?? null, headSha: run.head_sha, event: run.event});

export async function freezeWorkflows({scope, api, apply = false, persist, pause = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  validateScope(scope);
  const repository = await api('GET', ROOT);
  assert(repository.id === REPOSITORY_ID && repository.full_name === REPOSITORY, 'rebuild_repository_identity');
  const report = {version: 1, repository: REPOSITORY, startedAt: new Date().toISOString(), applied: apply,
    scope: 'explicit-reviewed-legacy-workflows', baselineSha: scope.baselineSha,
    workflows: [], protectedWorkflows: [], runs: [], disabled: false, quiescent: false,
    sharedActiveBefore: [], sharedActiveAfter: [], historicalUnassigned: [], completeWriterBoundary: false,
    quiescenceBasis: 'No assigned writers observed in the explicit scope; historical unassigned records are not cancelled or terminal.',
    storageWrites: 0, storageDeletes: 0, leaseChanges: 0};
  const save = async () => { await persist(structuredClone(report)); };
  try {
    // Validate every target and preserve its prior state before the first mutation.
    for (const row of scope.workflows) {
      const workflow = await api('GET', `${ROOT}/actions/workflows/${row.path.split('/').at(-1)}`);
      assert(Number.isSafeInteger(workflow?.id) && workflow.id > 0 && workflow.path === row.path, 'rebuild_workflow_identity');
      const file = await api('GET', `${ROOT}/contents/${row.path}?ref=main`);
      assert(file?.path === row.path && file.sha === row.blobSha, 'rebuild_workflow_source_changed');
      report.workflows.push({id: workflow.id, path: row.path, before: workflow.state, after: null, reason: row.reason, cancelActive: row.cancelActive !== false});
    }
    for (const path of scope.protectedWorkflows) {
      const workflow = await api('GET', `${ROOT}/actions/workflows/${path.split('/').at(-1)}`);
      assert(workflow.path === path && Number.isSafeInteger(workflow.id), 'rebuild_protected_workflow_identity');
      report.protectedWorkflows.push({id: workflow.id, path, before: workflow.state, after: null});
    }
    await save();
    if (!apply) return report;

    // Stop all future trigger chains before cancelling any currently running writer.
    for (const row of report.workflows) {
      const file = await api('GET', `${ROOT}/contents/${row.path}?ref=main`);
      assert(file?.path === row.path && file.sha === scope.workflows.find(target => target.path === row.path).blobSha, 'rebuild_workflow_source_changed');
      if (row.before === 'active') await api('PUT', `${ROOT}/actions/workflows/${row.id}/disable`);
      const after = await api('GET', `${ROOT}/actions/workflows/${row.id}`);
      assert(after.id === row.id && after.path === row.path && after.state.startsWith('disabled'), 'rebuild_disable_unconfirmed');
      row.after = after.state;
      await save();
    }
    report.disabled = true;
    const targets = new Map(report.workflows.map(row => [row.id, row.path]));
    const observe = new Set(report.protectedWorkflows.filter(row => (scope.observeOnlyWorkflows ?? []).includes(row.path)).map(row => row.id));
    const beforeRuns = await listActiveRuns(api, pause);
    report.sharedActiveBefore = beforeRuns.filter(run => observe.has(run.workflow_id)).map(runRow);
    const active = beforeRuns.filter(run => targets.has(run.workflow_id));
    for (const run of active) {
      assert(run.path === targets.get(run.workflow_id) && run.head_repository?.id === REPOSITORY_ID, 'rebuild_cancel_scope_changed');
      const before = await api('GET', `${ROOT}/actions/runs/${run.id}`);
      assert(before.id === run.id && before.workflow_id === run.workflow_id && before.repository?.id === REPOSITORY_ID &&
        before.path === run.path && before.head_sha === run.head_sha, 'rebuild_cancel_run_changed');
      const row = {...runRow(before), cancelRequested: false, conflict: false};
      const jobs = await readJobs(api, before, pause);
      row.jobsBefore = jobs.map(job => ({id: job.id, status: job.status}));
      report.runs.push(row);
      await save();
      if (await verifyHistoricalUnassigned(scope, api, before, pause)) {
        row.historicalUnassigned = true;
        row.cancelSkipped = 'verified-historical-unassigned-record';
        report.historicalUnassigned.push(runRow(before));
        await save();
        continue;
      }
      if (before.status !== 'completed' && report.workflows.find(target => target.id === run.workflow_id).cancelActive) {
        const result = await api('POST', `${ROOT}/actions/runs/${run.id}/cancel`);
        row.cancelRequested = !result?.conflict;
        row.conflict = Boolean(result?.conflict);
        await save();
      } else if (before.status !== 'completed') {
        row.cancelSkipped = 'active-release-must-complete-or-roll-back';
        await save();
      }
    }
    // Bounded wait; no force-cancellation or lease clearing. Old zero-job entries
    // remain explicitly unresolved, never re-labelled as successfully cancelled.
    for (let attempt = 0; attempt < 12; attempt++) {
      let pending = 0;
      for (const row of report.runs) {
        if (row.historicalUnassigned) continue;
        const current = await api('GET', `${ROOT}/actions/runs/${row.id}`);
        assert(current.id === row.id && current.workflow_id === row.workflowId && current.path === row.path &&
          current.repository?.id === REPOSITORY_ID && current.head_sha === row.headSha, 'rebuild_poll_run_changed');
        row.status = current.status;
        row.conclusion = current.conclusion ?? null;
        if (row.status !== 'completed') pending++;
      }
      await save();
      if (!pending) break;
      if (attempt < 11) await pause(5000);
    }
    const actualRemaining = async runs => {
      const remaining = [];
      for (const run of runs.filter(run => targets.has(run.workflow_id))) {
        if (await verifyHistoricalUnassigned(scope, api, run, pause)) {
          if (!report.historicalUnassigned.some(row => row.id === run.id)) report.historicalUnassigned.push(runRow(run));
          continue;
        }
        remaining.push(run);
      }
      return remaining;
    };
    const remaining = await actualRemaining(await listActiveRuns(api, pause));
    report.remaining = remaining.map(runRow);
    let jobsTerminal = true;
    for (const row of report.runs) {
      if (row.historicalUnassigned) {
        await verifyHistoricalUnassigned(scope, api, await api('GET', `${ROOT}/actions/runs/${row.id}`), pause);
        row.jobsAfter = [];
        continue;
      }
      const jobs = await readJobs(api, row, pause);
      row.jobsAfter = jobs.map(job => ({id: job.id, status: job.status}));
      jobsTerminal &&= jobs.every(job => job.status === 'completed');
    }
    // A second complete status census catches runs which moved between status
    // pages while the first census and job readbacks were being collected.
    const finalRuns = await listActiveRuns(api, pause);
    report.sharedActiveAfter = finalRuns.filter(run => observe.has(run.workflow_id)).map(runRow);
    const confirm = await actualRemaining(finalRuns);
    report.remaining = [...new Map([...report.remaining, ...confirm.map(runRow)].map(run => [run.id, run])).values()];
    report.quiescent = report.remaining.length === 0 && jobsTerminal && report.runs.every(run => run.status === 'completed' || run.historicalUnassigned);
    for (const row of report.protectedWorkflows) {
      const after = await api('GET', `${ROOT}/actions/workflows/${row.id}`);
      assert(after.id === row.id && after.path === row.path && after.state === row.before, 'rebuild_protected_workflow_changed');
      row.after = after.state;
    }
    for (const row of report.workflows) {
      const after = await api('GET', `${ROOT}/actions/workflows/${row.id}`);
      assert(after.id === row.id && after.path === row.path && after.state.startsWith('disabled'), 'rebuild_workflow_reenabled');
    }
    report.finishedAt = new Date().toISOString();
    await save();
    return report;
  } catch (error) {
    report.quiescent = false;
    report.error = error instanceof Error ? error.message : 'rebuild_freeze_failed';
    await save();
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const scopeBytes = await fs.readFile(new URL('./scope.json', import.meta.url));
  const marker = JSON.parse(await fs.readFile(new URL('./start.json', import.meta.url), 'utf8'));
  assert(marker.version === 1 && marker.operation === 'freeze-and-checkpoint' && marker.scopeSha256 === digest(scopeBytes), 'rebuild_marker_scope');
  const boundaryBytes = await fs.readFile(new URL('./boundaries.json', import.meta.url));
  assert(marker.checkpointBoundariesSha256 === digest(boundaryBytes), 'rebuild_marker_boundaries');
  assert(process.env.GITHUB_REPOSITORY === REPOSITORY && process.env.GITHUB_REPOSITORY_ID === String(REPOSITORY_ID), 'rebuild_environment_repository');
  const output = process.env.REBUILD_FREEZE_REPORT;
  assert(typeof output === 'string' && output.length > 0, 'rebuild_report_path_missing');
  const report = await freezeWorkflows({scope: JSON.parse(scopeBytes), api: githubClient(process.env.GH_TOKEN),
    apply: process.argv.includes('--apply'), persist: value => fs.writeFile(output, JSON.stringify(value, null, 2) + '\n')});
  console.log(JSON.stringify({disabled: report.disabled, quiescent: report.quiescent, workflows: report.workflows.length,
    remaining: report.remaining?.length ?? null, sharedActive: report.sharedActiveAfter.length, completeWriterBoundary: false,
    historicalUnassigned: report.historicalUnassigned.length,
    storageWrites: 0, storageDeletes: 0, leaseChanges: 0}));
  if (report.applied && (!report.disabled || !report.quiescent || report.sharedActiveAfter.length > 0)) process.exitCode = 2;
}
