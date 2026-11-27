import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PROFILE = Object.freeze({
  workflowRef: 'jeep-jim/AvtoCena/.github/workflows/japan-stalled-preflight-46040340638-cancel.yml@refs/heads/main',
  markerPath: '.github/market-runs/japan-stalled-preflight-46040340638-cancel.json',
  operation: 'cancel-japan-stalled-preflight-46040340638',
  reportName: 'japan-stalled-preflight-46040340638-cancel-report.json',
});
const GATE = 'Verify bounded Japan directory retries on the exact runtime before host contact';
export const TARGETS = Object.freeze([
  Object.freeze({runId: '46040340638', headSha: '400da6f50fa12606c7625e0382a0441fa4eb5381',
    workflowPath: '.github/workflows/catalog-next-china-photo-release.yml', jobId: '140646157850', jobName: 'release',
    gateNumber: 10, lastStepNumber: 20, postNumbers: Object.freeze([39, 40]), required: Object.freeze({
      10: GATE, 11: 'Match the proven production Docker image store',
      16: 'Build the verified source and check its image roundtrip',
      17: 'Restore the exact previously built combined image and repeat its isolated roundtrip',
      18: 'Publish the code with existing China bytes and automatic rollback',
      19: 'Preserve bounded saved Japan failure metadata after an unsuccessful publication',
      20: 'Preserve aggregate publication and image proof',
    })}),
  Object.freeze({runId: '46040261112', headSha: 'cb293d98fca55acc4ec2a027c2fae71899d6d69c',
    workflowPath: '.github/workflows/verify-china-photo-code.yml', jobId: '140645894844', jobName: 'verify',
    gateNumber: 11, lastStepNumber: 24, postNumbers: Object.freeze([47, 48]), required: Object.freeze({
      11: GATE, 12: 'Test the native runtime and every required check for its reviewed scope',
      13: 'Verify ordinary Japan page filling on the exact candidate before host contact',
      14: 'Verify Japan supplier-only brand and model controls on the exact candidate',
      24: 'Preserve the browser recovery evidence',
    })}),
]);
const POST_NAMES = ['Post Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  'Post Run actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'];
const TERMINAL = new Set(['success', 'failure', 'cancelled', 'timed_out', 'neutral', 'skipped', 'action_required', 'stale', 'startup_failure']);
const need = (value, code) => { if (!value) throw Error('japan_preflight_cancel_' + code); };
const targetChecked = target => { need(TARGETS.includes(target), 'target'); return target; };
const safeError = error => /^japan_preflight_cancel_[a-z_]+$/.test(error?.message ?? '')
  ? error.message : 'japan_preflight_cancel_unavailable';

export function verifyCancelInvocation({root = ROOT, environment = process.env} = {}) {
  need(environment.GITHUB_ACTIONS === 'true' && environment.GITHUB_EVENT_NAME === 'push'
    && environment.GITHUB_WORKFLOW_REF === PROFILE.workflowRef && environment.GITHUB_JOB === 'cancel'
    && /^[1-9][0-9]{0,19}$/.test(environment.GITHUB_RUN_ID ?? '')
    && !TARGETS.some(target => target.runId === environment.GITHUB_RUN_ID), 'invocation');
  return verifyReadonlyInvocation({root, env: environment, markerPath: PROFILE.markerPath, operation: PROFILE.operation});
}

export function checkTargetRun(target, run) {
  targetChecked(target);
  need(String(run?.id) === target.runId && run.head_sha === target.headSha && run.path === target.workflowPath
    && run.run_attempt === 1 && run.event === 'push' && run.head_branch === 'main'
    && run.repository?.id === 1289722938 && run.repository?.full_name === 'jeep-jim/AvtoCena'
    && run.head_repository?.id === 1289722938, 'run_binding');
  need(run.status === 'in_progress' && run.conclusion === null
    || run.status === 'completed' && TERMINAL.has(run.conclusion), 'run_status');
  return {status: run.status, conclusion: run.conclusion};
}

export function checkPreflightJob(target, document) {
  targetChecked(target);
  need(document?.total_count === 1 && Array.isArray(document.jobs) && document.jobs.length === 1, 'jobs');
  const job = document.jobs[0];
  need(String(job.id) === target.jobId && String(job.run_id) === target.runId && job.name === target.jobName
    && job.run_attempt === 1 && job.head_sha === target.headSha
    && job.status === 'in_progress' && job.conclusion === null, 'job_binding');
  const steps = job.steps;
  need(Array.isArray(steps) && steps.length === target.lastStepNumber + POST_NAMES.length
    && new Set(steps.map(step => step.number)).size === steps.length, 'steps');
  for (let number = 1; number <= target.lastStepNumber; number++) {
    const step = steps.find(value => value.number === number);
    need(step && typeof step.name === 'string' && step.name.length > 0 && step.name.length <= 200, 'steps');
    if (target.required[number]) need(step.name === target.required[number], 'step_binding');
    need(number < target.gateNumber ? step.status === 'completed' && step.conclusion === 'success'
      : number === target.gateNumber ? step.status === 'in_progress' && step.conclusion === null
        : step.status === 'pending' && step.conclusion === null, 'not_preflight');
  }
  for (const [index, number] of target.postNumbers.entries()) {
    const step = steps.find(value => value.number === number);
    need(step?.name === POST_NAMES[index] && step.status === 'pending' && step.conclusion === null, 'not_preflight');
  }
  const snapshot = {runId: target.runId, headSha: target.headSha, jobId: target.jobId,
    steps: steps.map(({number, name, status, conclusion}) => ({number, name, status, conclusion}))};
  return {gateNumber: target.gateNumber, laterStepsPending: true,
    stepsSha256: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
}

/** Only the two fixed runs, their attempt-1 jobs and ordinary cancellation.
 * A denied request is terminal; this client has no force-cancel capability. */
export function createCancellationClient({environment = process.env, fetcher = globalThis.fetch, now = Date.now} = {}) {
  need(typeof environment.GH_TOKEN === 'string' && environment.GH_TOKEN.length > 0, 'token');
  const deadline = now() + 180_000; let requests = 0;
  async function request(target, operation) {
    targetChecked(target);
    need(['run', 'jobs', 'cancel'].includes(operation), 'operation');
    need(++requests <= 64 && now() < deadline, 'budget');
    const suffix = operation === 'run' ? '' : operation === 'jobs' ? '/attempts/1/jobs?per_page=100' : '/cancel';
    const url = 'https://api.github.com/repos/jeep-jim/AvtoCena/actions/runs/' + target.runId + suffix;
    let response;
    try {
      response = await fetcher(url, {method: operation === 'cancel' ? 'POST' : 'GET', redirect: 'error',
        headers: {Authorization: 'Bearer ' + environment.GH_TOKEN, Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28', 'Cache-Control': 'no-cache'},
        signal: AbortSignal.timeout(Math.min(8_000, deadline - now()))});
    } catch { throw Error('japan_preflight_cancel_transport'); }
    if ([401, 403].includes(response.status)) { await response.body?.cancel(); throw Error('japan_preflight_cancel_permission_denied'); }
    if (operation === 'cancel') {
      await response.body?.cancel();
      need([202, 409].includes(response.status), 'cancel_response');
      return {status: response.status};
    }
    need(response.status === 200, 'read_response');
    const chunks = []; let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.byteLength; need(size <= 128 * 1024, 'body_budget'); chunks.push(chunk);
      }
    } catch (error) { throw Error(safeError(error)); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw Error('japan_preflight_cancel_json'); }
  }
  return Object.freeze({readRun: target => request(target, 'run'), readJobs: target => request(target, 'jobs'),
    cancel: target => request(target, 'cancel')});
}

/** GitHub has no cancel-if-step compare-and-swap API. These are two fresh
 * preflight observations immediately before an ordinary cancel, followed by
 * separate terminal observations; they are never an atomicity claim. */
export async function cancelStalledPreflights({client, now = () => new Date().toISOString(),
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), onProgress = async () => {}} = {}) {
  need(client && ['readRun', 'readJobs', 'cancel'].every(key => typeof client[key] === 'function'), 'client');
  const report = {version: 1, kind: 'japan-stalled-preflight-cancellation-v1',
    githubRunCancellationOnly: true, forceCancellationUsed: false, atomicCancellationClaimed: false, targets: []};
  for (const target of TARGETS) {
    const result = {runId: target.runId, headSha: target.headSha, jobId: target.jobId,
      attempt: 1, cancelRequested: false, cancelAccepted: false, terminalVerified: false, preflightObservations: []};
    report.targets.push(result);
    try {
      for (let count = 0; count < 2; count++) {
        const run = checkTargetRun(target, await client.readRun(target));
        if (run.status === 'completed') {
          Object.assign(result, {status: 'already_completed', terminalVerified: true,
            terminalStatus: run.status, terminalConclusion: run.conclusion, terminalObservedAt: now()});
          break;
        }
        result.preflightObservations.push({...checkPreflightJob(target, await client.readJobs(target)), observedAt: now()});
      }
      if (!result.terminalVerified) {
        need(result.preflightObservations.length === 2
          && result.preflightObservations[0].stepsSha256 === result.preflightObservations[1].stepsSha256, 'state_changed');
        // No waits, report callbacks or unrelated requests between this last
        // validated jobs response and the one normal cancellation request.
        result.cancelRequested = true;
        const cancelled = await client.cancel(target);
        Object.assign(result, {status: cancelled.status === 202 ? 'cancellation_requested' : 'cancellation_conflict',
          cancelAccepted: cancelled.status === 202, cancelHttpStatus: cancelled.status});
      }
    } catch (error) { Object.assign(result, {status: 'refused_or_unavailable', errorCode: safeError(error)}); }
    await onProgress(report);
  }
  for (let round = 0; round < 24; round++) {
    const pending = report.targets.filter(value => value.cancelRequested && !value.terminalVerified && !value.errorCode);
    if (!pending.length) break;
    for (const result of pending) {
      try {
        const target = TARGETS.find(value => value.runId === result.runId);
        const run = checkTargetRun(target, await client.readRun(target));
        if (run.status === 'completed') Object.assign(result, {status: 'terminal_observed', terminalVerified: true,
          terminalStatus: run.status, terminalConclusion: run.conclusion, terminalObservedAt: now()});
      } catch (error) { Object.assign(result, {status: 'terminal_unverified', errorCode: safeError(error)}); }
    }
    await onProgress(report);
    if (round < 23 && report.targets.some(value => value.cancelRequested && !value.terminalVerified && !value.errorCode)) await wait(5_000);
  }
  report.completed = report.targets.length === TARGETS.length && report.targets.every(value => value.terminalVerified);
  report.observedAt = now();
  await onProgress(report);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let report;
  const save = async value => {
    const text = JSON.stringify(value, null, 2) + '\n'; need(Buffer.byteLength(text) <= 16 * 1024, 'report_budget');
    await fs.writeFile(path.join(ROOT, PROFILE.reportName), text, {mode: 0o600});
  };
  try {
    need(process.argv.length === 3 && ['--verify', '--cancel'].includes(process.argv[2]), 'arguments');
    const invocation = verifyCancelInvocation();
    if (process.argv[2] === '--verify') {
      process.stdout.write(JSON.stringify({kind: 'japan-preflight-cancel-invocation', verified: true,
        controllerSha: invocation.sourceSha, networkRequests: 0}) + '\n');
    } else {
      report = await cancelStalledPreflights({client: createCancellationClient(), onProgress: async value => {
        await save({...value, controllerSha: invocation.sourceSha});
        process.stdout.write(JSON.stringify({phase: 'cancellation_observation', targets: value.targets.map(
          ({runId, status, terminalVerified}) => ({runId, status, terminalVerified}))}) + '\n');
      }});
      report.controllerSha = invocation.sourceSha;
      if (!report.completed) process.exitCode = 1;
    }
  } catch (error) {
    report = {version: 1, kind: 'japan-stalled-preflight-cancellation-v1', completed: false,
      githubRunCancellationOnly: true, forceCancellationUsed: false, atomicCancellationClaimed: false, errorCode: safeError(error)};
    process.exitCode = 1;
  }
  if (report) { await save(report); process.stdout.write(JSON.stringify(report) + '\n'); }
}
