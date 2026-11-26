import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyFrozenSpeedBaselines} from '../verify-frozen-speed-baselines.mjs';
import {verifyServingCompatibility} from './serving-compatibility.mjs';
import {createChinaStateStorage, createChinaState, validateChinaGenerationReference} from './china-state.mjs';
import {createChinaDailyRelease} from './daily-release.mjs';
import {runChinaDailyCycle} from './daily-controller.mjs';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHA = /^[a-f0-9]{40}$/;
const DAILY_SCHEDULES = Object.freeze(['0 14 * * *', '17 0,3,6,9,12,15,18,21 * * *']);
export const CHINA_DAILY_JOB_TIMEOUT_MINUTES = 360;
const need = (value, code) => { if (!value) throw Error('china_daily_entry_' + code); };
const safeCode = error => /^china_[a-z0-9_]{1,150}$/.test(error?.message ?? '') ? error.message : 'china_daily_entry_failed';
const gitAt = root => args => {
  try { return execFileSync('/usr/bin/git', ['--no-optional-locks', '--no-replace-objects', '-c', 'core.fsmonitor=false', ...args],
    {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 ** 2,
      env: {PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}}); }
  catch { throw Error('china_daily_entry_git_failed'); }
};

/** Real schedule/dispatch/marker verification. No marker synthesis, event-file edits,
 * or replacement of GITHUB_SHA by a pricing/serving revision. */
export async function verifyChinaDailyInvocation({root = ROOT, environment = process.env, git = gitAt(root), event}) {
  need(environment.GITHUB_REPOSITORY === 'jeep-jim/AvtoCena' && environment.GITHUB_REPOSITORY_ID === '1289722938'
    && environment.GITHUB_REF === 'refs/heads/main'
    && environment.GITHUB_WORKFLOW_REF === 'jeep-jim/AvtoCena/.github/workflows/catalog-next-china-daily.yml@refs/heads/main', 'workflow');
  need(environment.GITHUB_RUN_ATTEMPT === '1', 'attempt');
  need(SHA.test(environment.GITHUB_SHA ?? '') && /^[1-9]\d{0,19}$/.test(environment.GITHUB_RUN_ID ?? '')
    && ['workflow_dispatch', 'schedule', 'push'].includes(environment.GITHUB_EVENT_NAME), 'event');
  const sourceSha = git(['rev-parse', '--verify', 'HEAD']).trim();
  need(sourceSha === environment.GITHUB_SHA, 'controller_identity');
  git(['diff', '--quiet', '--no-ext-diff', '--no-textconv', 'HEAD', '--']);
  if (environment.GITHUB_EVENT_NAME === 'push') return Object.freeze(verifyReadonlyInvocation({root, env: environment,
    markerPath: '.github/market-runs/catalog-next-china-daily.json', operation: 'refresh-china-generation'}));
  if (event === undefined) {
    try { event = JSON.parse(await fs.readFile(environment.GITHUB_EVENT_PATH, 'utf8')); }
    catch { throw Error('china_daily_entry_event_file'); }
  }
  if (environment.GITHUB_EVENT_NAME === 'workflow_dispatch') need(environment.EXPECTED_CONTROLLER_SHA === sourceSha
    && event?.inputs?.controller_sha === sourceSha, 'manual_revision');
  else need(DAILY_SCHEDULES.includes(event?.schedule), 'schedule');
  return Object.freeze({version: 1, event: environment.GITHUB_EVENT_NAME, sourceSha,
    approvedSourceSha: sourceSha, markerPath: null});
}

/** The job's actual start comes from its authenticated GitHub attempt, not the
 * later start of this script. Metadata failure defers cleanup, never refresh. */
export async function readChinaDailyDeadline({environment = process.env, fetcher = fetch, now = Date.now} = {}) {
  need(/^[1-9]\d{0,19}$/.test(environment.GITHUB_RUN_ID ?? '') && /^[1-9]\d{0,5}$/.test(environment.GITHUB_RUN_ATTEMPT ?? '')
    && SHA.test(environment.GITHUB_SHA ?? '') && environment.GITHUB_JOB === 'refresh'
    && typeof environment.GITHUB_TOKEN === 'string' && environment.GITHUB_TOKEN.length > 0, 'deadline_identity');
  const url = `https://api.github.com/repos/jeep-jim/AvtoCena/actions/runs/${environment.GITHUB_RUN_ID}/attempts/${environment.GITHUB_RUN_ATTEMPT}/jobs?per_page=100`;
  let response;
  try { response = await fetcher(url, {headers: {Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + environment.GITHUB_TOKEN, 'X-GitHub-Api-Version': '2022-11-28'},
    redirect: 'error', signal: AbortSignal.timeout(15000)}); }
  catch { throw Error('china_daily_entry_deadline_transport'); }
  need(response.ok, 'deadline_status');
  const parts = []; let size = 0;
  for await (const part of response.body ?? []) { size += part.byteLength; need(size <= 512 * 1024, 'deadline_size'); parts.push(Buffer.from(part)); }
  let value; try { value = JSON.parse(Buffer.concat(parts).toString()); } catch { throw Error('china_daily_entry_deadline_json'); }
  need(value?.total_count === 1 && Array.isArray(value.jobs) && value.jobs.length === 1, 'deadline_jobs');
  const job = value.jobs[0], started = Date.parse(job.started_at);
  need(job.name === 'refresh' && String(job.run_id) === environment.GITHUB_RUN_ID && job.head_sha === environment.GITHUB_SHA
    && job.status === 'in_progress' && job.conclusion === null && Number.isFinite(started) && started <= now(), 'deadline_job');
  return new Date(started + CHINA_DAILY_JOB_TIMEOUT_MINUTES * 60000).toISOString();
}

export async function readChinaDailyPlans(root = ROOT) {
  const [pricingPlan, servingPlan] = await Promise.all(['china-plan.json', 'china-serving-plan.json'].map(async name =>
    JSON.parse(await fs.readFile(path.join(root, '.github/operations/catalog-next', name), 'utf8'))));
  let codePlan;
  try { codePlan = JSON.parse(await fs.readFile(path.join(root, '.github/operations/catalog-next/china-code-serving-plan.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const servingPlans = [servingPlan, ...(codePlan === undefined ? [] : [codePlan])];
  need(pricingPlan.version === 1 && pricingPlan.market === 'china' && pricingPlan.minimumYear === 2014
    && [pricingPlan.runtimeSha, pricingPlan.runtimeTree, pricingPlan.retainedRuntime].every(value => SHA.test(value ?? ''))
    && servingPlans.every(plan => plan?.version === 1 && plan.market === 'china' && plan.minimumYear === 2014
      && [plan.runtimeSha, plan.runtimeTree, plan.retainedRuntime].every(value => SHA.test(value ?? ''))
      && plan.pricingRuntimeSha === pricingPlan.runtimeSha && plan.pricingRuntimeTree === pricingPlan.runtimeTree)
    && new Set(servingPlans.map(plan => plan.runtimeSha)).size === servingPlans.length, 'plans');
  return {pricingPlan, servingPlan, servingPlans};
}

/** State selects a reviewed plan, never an unreviewed checkout revision. Both
 * old and new runtimes remain available during a resumable code publication. */
export function selectChinaDailyServingPlan(planSet, runtimeSha) {
  const matches = planSet.servingPlans.filter(plan => plan.runtimeSha === runtimeSha);
  need(matches.length === 1, 'accepted_runtime');
  return matches[0];
}
const servingDirectoryName = (planSet, plan) => plan === planSet.servingPlan
  ? 'china-serving-runtime' : 'china-serving-runtime-' + plan.runtimeSha;

/** Two detached roots remain distinct throughout pricing and public-oracle
 * execution. A retained image is reused on the server; no Docker build here. */
export async function checkoutChinaDailyRuntimes({root = ROOT, runnerTemp = process.env.RUNNER_TEMP, git = gitAt(root)}) {
  const planSet = await readChinaDailyPlans(root), {pricingPlan, servingPlan, servingPlans} = planSet;
  const temporary = await fs.realpath(runnerTemp), pricingRoot = path.join(temporary, 'china-pricing-runtime');
  const servingRoots = Object.fromEntries(servingPlans.map(plan => [plan.runtimeSha, path.join(temporary, servingDirectoryName(planSet, plan))]));
  for (const directory of [pricingRoot, ...Object.values(servingRoots)]) {
    const exists = await fs.lstat(directory).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
    need(!exists, 'checkout_exists');
  }
  for (const revision of new Set([pricingPlan.retainedRuntime, pricingPlan.runtimeSha, ...servingPlans.map(plan => plan.runtimeSha)]))
    git(['fetch', '--no-tags', 'https://github.com/jeep-jim/AvtoCena.git', revision]);
  for (const [directory, revision] of [[pricingRoot, pricingPlan.runtimeSha],
    ...servingPlans.map(plan => [servingRoots[plan.runtimeSha], plan.runtimeSha])]) {
    git(['worktree', 'add', '--detach', directory, revision]);
    await fs.symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
  }
  return {pricingRoot, servingRoot: servingRoots[servingPlan.runtimeSha], servingRoots,
    pricingRuntimeSha: pricingPlan.runtimeSha, runtimeSha: servingPlan.runtimeSha};
}

/** Callable production entry. Only root-controlled dependency functions can be
 * replaced by local tests; no callback paths or source receipts come from CLI. */
export async function runChinaDailyEntry({root = ROOT, environment = process.env, capabilities = {}, log = () => {}} = {}) {
  const defaults = {verifyInvocation: verifyChinaDailyInvocation, verifyCompatibility: verifyServingCompatibility,
    verifyBaselines: verifyFrozenSpeedBaselines, runtimeGit: gitAt,
    createStorage: () => createChinaStateStorage({environment}), createRelease: createChinaDailyRelease, runCycle: runChinaDailyCycle,
    readDeadline: readChinaDailyDeadline,
    collectRetired: args => import('./china-generation-gc-queue.mjs').then(module => module.maintainChinaGenerationGcQueue(args))};
  need(capabilities && Object.keys(capabilities).every(key => Object.hasOwn(defaults, key) && typeof capabilities[key] === 'function'), 'capabilities');
  const use = {...defaults, ...capabilities};
  const reportPath = path.join(root, 'catalog-next-china-daily-report.json');
  try {
    const invocation = await use.verifyInvocation({root, environment});
    use.verifyBaselines(root);
    need(environment.JSON_STORAGE_DRIVER === 'object', 'storage_driver');
    const planSet = await readChinaDailyPlans(root), {pricingPlan} = planSet;
    const runnerTemp = await fs.realpath(environment.RUNNER_TEMP);
    const pricingRoot = await fs.realpath(path.join(runnerTemp, 'china-pricing-runtime'));
    const pricingGit = use.runtimeGit(pricingRoot);
    need(pricingGit(['rev-parse', 'HEAD']).trim() === pricingPlan.runtimeSha
      && pricingGit(['rev-parse', 'HEAD^{tree}']).trim() === pricingPlan.runtimeTree, 'pricing_checkout');
    pricingGit(['diff', '--quiet', '--no-ext-diff', 'HEAD', '--']);
    const storage = use.createStorage();
    need((await storage.assertPrivateBucket())?.verified === true, 'state_privacy');
    const state = createChinaState({storage}), accepted = await state.read('accepted');
    need(accepted.found && accepted.value.current, 'accepted_source_required');
    const reference = validateChinaGenerationReference(accepted.value.current, {requireAccepted: true});
    selectChinaDailyServingPlan(planSet, reference.runtimeSha);
    need(reference.pricingRuntimeSha === pricingPlan.runtimeSha, 'accepted_runtime');
    const progress = value => {
      if (typeof value?.phase !== 'string' || !/^[a-z0-9_:-]{1,120}$/.test(value.phase)) return;
      const record = {phase: value.phase, market: 'china'};
      for (const name of ['rows', 'sourceRows', 'parts', 'totalParts', 'bytes', 'storedBytes'])
        if (Number.isSafeInteger(value[name]) && value[name] >= 0) record[name] = value[name];
      log(record);
    };
    const releases = new Map();
    async function releaseFor(runtimeSha) {
      if (releases.has(runtimeSha)) return releases.get(runtimeSha);
      const servingPlan = selectChinaDailyServingPlan(planSet, runtimeSha);
      const servingRoot = await fs.realpath(path.join(runnerTemp, servingDirectoryName(planSet, servingPlan)));
      need(pricingRoot !== servingRoot, 'separate_runtime_roots');
      await use.verifyCompatibility({runtimeRoot: servingRoot, servingPlan, pricingPlan});
      const release = use.createRelease({root, servingRoot, pricingPlan, servingPlan, controllerSha: invocation.sourceSha,
        runnerTemp, environment, onProgress: progress});
      need(['stageRelease', 'recoverRelease', 'retireHost'].every(key => typeof release?.[key] === 'function'), 'retirement_hook');
      releases.set(runtimeSha, release); return release;
    }
    await releaseFor(reference.runtimeSha);
    const release = {
      async stageRelease(args) {
        const retained = validateChinaGenerationReference(args.previous?.value?.current, {requireAccepted: true});
        return (await releaseFor(retained.runtimeSha)).stageRelease(args);
      },
      async recoverRelease(args) {
        const candidate = validateChinaGenerationReference(args.intent?.value?.candidate);
        return (await releaseFor(candidate.runtimeSha)).recoverRelease(args);
      },
      async retireHost(args) {
        const retained = validateChinaGenerationReference(args.acceptedPublication?.accepted?.value?.current, {requireAccepted: true});
        return (await releaseFor(retained.runtimeSha)).retireHost(args);
      },
    };
    let deadlineAt = null;
    try { deadlineAt = await use.readDeadline({environment}); }
    catch { progress({phase: 'daily_cleanup_deadline_unavailable'}); }
    const report = await use.runCycle({runtimeRoot: pricingRoot, plan: pricingPlan, invocation,
      owner: {runId: environment.GITHUB_RUN_ID, attempt: environment.GITHUB_RUN_ATTEMPT, revision: invocation.sourceSha},
      runnerTemp, prepareReportPath: path.join(root, 'catalog-next-china-daily-generation-report.json'),
      trigger: invocation.event === 'schedule' ? 'schedule' : 'manual', storage,
      stageRelease: release.stageRelease, recoverRelease: release.recoverRelease, onProgress: progress,
      resumeCleanup: ({readState, assertAuthority}) => use.collectRetired({mode: 'enqueue-only', readState, assertAuthority,
        environment, onProgress: progress}),
      afterAccepted: ({previousAccepted, accepted, intent, readState, assertAuthority}) => use.collectRetired({
        mode: deadlineAt ? 'drain' : 'enqueue-only', ...(deadlineAt ? {deadlineAt} : {}), previousAccepted,
        acceptedPublication: {accepted, intent}, readState, assertAuthority, environment,
        beforeCollect: release.retireHost, onProgress: progress})});
    report.cleanupDeadlineAt = deadlineAt;
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', {mode: 0o600}); log(report); return report;
  } catch (error) {
    const report = error?.report?.kind === 'china-daily-cycle-v1' ? error.report : {version: 1, kind: 'china-daily-cycle-v1',
      market: 'china', completed: false, published: false, status: 'failed', errorCode: safeCode(error),
      applicationBuilds: 0, encyclopediaWrites: 0, otherMarketWrites: 0, deletions: 0};
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', {mode: 0o600}); log(report);
    const failure = Error(safeCode(error)); failure.report = report; throw failure;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const log = value => process.stdout.write(JSON.stringify(value) + '\n');
  try {
    need(process.argv.length === 3 && ['--checkout', '--run'].includes(process.argv[2]), 'arguments');
    if (process.argv[2] === '--checkout') {
      await verifyChinaDailyInvocation({root: ROOT});
      const result = await checkoutChinaDailyRuntimes({root: ROOT});
      log({phase: 'daily_exact_runtimes_checked_out', runtimeSha: result.runtimeSha, pricingRuntimeSha: result.pricingRuntimeSha});
    } else await runChinaDailyEntry({root: ROOT, log});
  } catch (error) { log({phase: 'daily_failed', errorCode: safeCode(error), published: false}); process.exitCode = 1; }
}
