import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {verifyFrozenSpeedBaselines} from '../verify-frozen-speed-baselines.mjs';
import {checkoutChinaDailyRuntimes} from './daily-entry.mjs';
import {buildChinaReleaseImage} from './build-release-image.mjs';
import {verifyChinaPhotoCodeRuntime} from './photo-code-scope.mjs';
import {createChinaDailyRelease} from './daily-release.mjs';
import {createChinaStateStorage} from './china-state.mjs';
import {runChinaCodeCycle} from './code-controller.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const need = (value, code) => { if (!value) throw Error('china_code_entry_' + code); };
const safeCode = error => /^china_[a-z0-9_]{1,150}$/.test(error?.message ?? '') ? error.message : 'china_code_entry_failed';
const log = value => process.stdout.write(JSON.stringify(value) + '\n');

export function verifyChinaCodeInvocation({root = ROOT, environment = process.env} = {}) {
  need(environment.GITHUB_WORKFLOW_REF === 'jeep-jim/AvtoCena/.github/workflows/catalog-next-china-photo-release.yml@refs/heads/main'
    && environment.GITHUB_JOB === 'release', 'workflow');
  return verifyReadonlyInvocation({root, env: environment,
    markerPath: '.github/market-runs/catalog-next-china-photo-release.json', operation: 'activate-china-photo-code'});
}

async function configuration(root, temporary) {
  const [pricingPlan, servingPlan, basePlan] = await Promise.all(['china-plan.json', 'china-code-serving-plan.json', 'china-serving-plan.json']
    .map(async name => JSON.parse(await fs.readFile(path.join(root, '.github/operations/catalog-next', name)))));
  need(servingPlan.retainedRuntime === basePlan.runtimeSha && servingPlan.pricingRuntimeSha === pricingPlan.runtimeSha
    && servingPlan.pricingRuntimeTree === pricingPlan.runtimeTree, 'plan_predecessor');
  const servingRoot = await fs.realpath(path.join(temporary, 'china-serving-runtime-' + servingPlan.runtimeSha));
  const verified = await verifyChinaPhotoCodeRuntime({runtimeRoot: servingRoot, servingPlan, pricingPlan});
  need(verified.frozenHttpOracleReusable === true && verified.retainedRuntime === basePlan.runtimeSha, 'scope');
  return {pricingPlan, servingPlan, servingRoot};
}

export async function runChinaPhotoCodeEntry({root = ROOT, environment = process.env} = {}) {
  const invocation = verifyChinaCodeInvocation({root, environment});
  verifyFrozenSpeedBaselines(root);
  need(environment.JSON_STORAGE_DRIVER === 'object', 'storage_driver');
  const runnerTemp = await fs.realpath(environment.RUNNER_TEMP);
  const {pricingPlan, servingPlan, servingRoot} = await configuration(root, runnerTemp);
  const image = JSON.parse(await fs.readFile(path.join(runnerTemp, 'china-release-build/image-receipt.json')));
  need(image.runtimeSha === servingPlan.runtimeSha && image.runtimeTree === servingPlan.runtimeTree
    && image.archiveRoundTripVerified === true && /^sha256:[a-f0-9]{64}$/.test(image.imageId ?? ''), 'image_binding');
  const progress = row => {
    if (typeof row?.phase !== 'string' || !/^[a-z0-9_:-]{1,120}$/.test(row.phase)) return;
    const result = {phase: row.phase, market: 'china'};
    for (const name of ['generationBytes', 'availableDiskBytes', 'neededBytes'])
      if (Number.isSafeInteger(row[name]) && row[name] >= 0) result[name] = row[name];
    log(result);
  };
  const release = createChinaDailyRelease({root, servingRoot, pricingPlan, servingPlan, controllerSha: invocation.sourceSha,
    runnerTemp, environment, onProgress: progress});
  const reportPath = path.join(root, 'catalog-next-china-photo-release-report.json');
  try {
    const report = await runChinaCodeCycle({plan: servingPlan, imageId: image.imageId, invocation,
      owner: {runId: environment.GITHUB_RUN_ID, attempt: environment.GITHUB_RUN_ATTEMPT, revision: invocation.sourceSha},
      storage: createChinaStateStorage({environment}), stageCodeRelease: release.stageCodeRelease,
      recoverRelease: release.recoverRelease, retirePreviousHost: release.retireHost,
      retireTerminalAppImage: release.retireTerminalAppImage, onProgress: progress,
      preserveRetention: ({readState, assertAuthority}) => import('./china-generation-gc-queue.mjs').then(module =>
        module.maintainChinaGenerationGcQueue({mode: 'enqueue-only', readState, assertAuthority, environment, onProgress: progress}))});
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', {mode: 0o600}); log(report);
    need(report.completed === true && ['accepted', 'already_accepted'].includes(report.status), 'not_accepted');
    return report;
  } catch (error) {
    const report = error?.report ?? {version: 1, kind: 'china-code-cycle-v1', market: 'china', completed: false,
      published: false, status: 'failed', errorCode: safeCode(error)};
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', {mode: 0o600}); log(report);
    throw Error(safeCode(error));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 3 && ['--checkout', '--verify', '--build', '--run'].includes(process.argv[2]), 'arguments');
    const mode = process.argv[2];
    if (mode === '--run') await runChinaPhotoCodeEntry();
    else if (mode === '--checkout') {
      await checkoutChinaDailyRuntimes({root: ROOT});
      log({phase: 'photo_exact_sources_checked_out', hostContacted: false});
    } else {
      verifyFrozenSpeedBaselines(ROOT);
      const runnerTemp = await fs.realpath(process.env.RUNNER_TEMP), config = await configuration(ROOT, runnerTemp);
      if (mode === '--verify') log({phase: 'photo_exact_source_verified', runtimeSha: config.servingPlan.runtimeSha,
        retainedRuntime: config.servingPlan.retainedRuntime, hostContacted: false});
      else await buildChinaReleaseImage({runtimeRoot: config.servingRoot, plan: config.servingPlan, pricingPlan: config.pricingPlan,
        runnerTemp, dockerHost: process.env.CHINA_BUILD_DOCKER_HOST, onProgress: log});
    }
  } catch (error) { log({phase: 'photo_code_failed', errorCode: safeCode(error)}); process.exitCode = 1; }
}
