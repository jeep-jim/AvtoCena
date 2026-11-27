import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkedCatalogCodeScope, CHINA_PHOTO_JAPAN_CODE_PATHS, JAPAN_RECOVERY_CODE_PATHS,
  JAPAN_COMPLETION_CODE_PATHS, JAPAN_COMPLETION_V2_CODE_PATHS, JAPAN_USABILITY_CODE_PATHS} from './photo-code-scope.mjs';
import {checkChinaRuntimeTests, CHINA_RUNTIME_TEST_FILES, verifyRuntimeTestsCheckout, runNativeTests}
  from './check-runtime-tests.mjs';
import {CRM_CHINA_CODE_SCOPE, CRM_CHINA_CODE_PATHS} from './crm-china-code-scope.mjs';
import {CRM_JAPAN_PHOTO_CODE_SCOPE} from './crm-japan-photo-code-scope.mjs';
import {JAPAN_PAGINATION_CODE_SCOPE, JAPAN_PAGINATION_CODE_PATHS} from './japan-pagination-code-scope.mjs';
import {JAPAN_STABILITY_CODE_SCOPE, JAPAN_STABILITY_CODE_PATHS} from './japan-stability-code-scope.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PHOTO_SCOPE = 'catalog-photo-recovery-v1', COMBINED_SCOPE = 'catalog-photo-japan-power-v1';
const JAPAN_SCOPE = 'catalog-japan-recovery-v1';
const JAPAN_COMPLETION_SCOPE = 'catalog-japan-completion-v1';
const JAPAN_COMPLETION_V2_SCOPE = 'catalog-japan-completion-v2';
const JAPAN_USABILITY_SCOPE = 'catalog-japan-usability-v1';
const need = (condition, code) => { if (!condition) throw Error('china_photo_runtime_tests_' + code); };
// This is the previous photo CI common suite. AJ and PW globs below expand
// against the exact source tree, and no caller can replace the selected files.
export const PHOTO_COMMON_TEST_FILES = Object.freeze([
  'tests/catalog-photo-retry.test.ts',
  'tests/photo-proxy.test.ts',
  'tests/catalog-detail-read-cache.test.ts',
  'tests/catalog-japan-filter-rail.test.ts',
  'tests/catalog-market-page-boundary.test.ts',
]);
// Retain every accepted China assertion, every changed Japan test, and the
// adjacent native AJ/drive/power/source suite reviewed for this recovery. The
// committed source already fixes the old fixtures; a compatibility patch is
// neither opened nor applied for this profile.
export const JAPAN_RECOVERY_TEST_FILES = Object.freeze([...new Set([
  ...CHINA_RUNTIME_TEST_FILES,
  ...PHOTO_COMMON_TEST_FILES,
  ...JAPAN_RECOVERY_CODE_PATHS.filter(name => name.startsWith('tests/')),
  'tests/ajes-catalog-progressive.test.ts',
  'tests/ajes-count-display.test.ts',
  'tests/ajes-count-progressive.test.ts',
  'tests/ajes-detail-queue-recovery.test.ts',
  'tests/ajes-filtered-page.test.ts',
  'tests/ajes-japan-feed.test.ts',
  'tests/ajes-japan-only.test.ts',
  'tests/ajes-list-admission.test.ts',
  'tests/ajes-market-preview.test.ts',
  'tests/ajes-model-loader.test.ts',
  'tests/ajes-model-recovery.test.ts',
  'tests/ajes-page-cache-recovery.test.ts',
  'tests/ajes-page-failure-evidence.test.ts',
  'tests/ajes-persistence-isolation.test.ts',
  'tests/ajes-prepared-admission.test.ts',
  'tests/ajes-queue-fallback.test.ts',
  'tests/ajes-queue-unavailable.test.ts',
  'tests/ajes-rail-late-count.test.ts',
  'tests/ajes-ready-metadata.test.ts',
  'tests/ajes-recovery-isolation.test.ts',
  'tests/ajes-retired-tables.test.ts',
  'tests/catalog-detail-read-cache.test.ts',
  'tests/japan-auction-statistics-source.test.ts',
  'tests/japan-carvector-jpauc-exact-scale.test.ts',
  'tests/japan-chassis-drive.test.ts',
  'tests/japan-default-fuel.test.ts',
  'tests/japan-delivered-preview.test.ts',
  'tests/japan-drive-saved-search.test.ts',
  'tests/japan-drive-sql-budget.test.ts',
  'tests/japan-drive.test.ts',
  'tests/japan-owner-exclusions.test.ts',
  'tests/japan-preview-consistency.test.ts',
  'tests/japan-sheet-restriction-display.test.ts',
  'tests/japan-source-power.test.ts',
  'tests/japan-stepwgn-owner-power.test.ts',
  'tests/japan-ui-completion.test.ts',
])].sort());
export const JAPAN_COMPLETION_TEST_FILES = Object.freeze([...new Set([
  ...JAPAN_RECOVERY_TEST_FILES,
  ...JAPAN_COMPLETION_CODE_PATHS.filter(name => /^tests\/[^/]+\.test\.ts$/.test(name)),
  'tests/selection-city-persistence.test.ts',
])].sort());
export const JAPAN_COMPLETION_V2_TEST_FILES = Object.freeze([...new Set([
  ...JAPAN_COMPLETION_TEST_FILES,
  ...JAPAN_COMPLETION_V2_CODE_PATHS.filter(name => /^tests\/[^/]+\.test\.ts$/.test(name)),
])].sort());

export const JAPAN_USABILITY_TEST_FILES = Object.freeze([...new Set([
  ...JAPAN_COMPLETION_V2_TEST_FILES,
  ...JAPAN_USABILITY_CODE_PATHS.filter(name => /^tests\/[^/]+\.test\.ts$/.test(name)),
])].sort());
export const CRM_CHINA_TEST_FILES = Object.freeze([...new Set([
  ...JAPAN_COMPLETION_V2_TEST_FILES,
  ...CRM_CHINA_CODE_PATHS.filter(name => /^tests\/[^/]+\.test\.ts$/.test(name)),
  'tests/catalog-collection-controls.test.ts',
])].sort());

export const JAPAN_PAGINATION_TEST_FILES = Object.freeze([...new Set([
  ...CRM_CHINA_TEST_FILES,
  ...JAPAN_PAGINATION_CODE_PATHS.filter(name => /^tests\/[^/]+\.test\.ts$/.test(name)),
])].sort());

export const JAPAN_STABILITY_TEST_FILES = Object.freeze([...new Set([
  ...JAPAN_PAGINATION_TEST_FILES,
  ...JAPAN_STABILITY_CODE_PATHS.filter(name => /^tests\/[^/]+\.test\.ts$/.test(name)),
])].sort());

async function selectedFiles(runtimeRoot, codeScope) {
  let tracked;
  try {
    tracked = String(execFileSync('/usr/bin/git', ['--no-optional-locks', 'ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', 'tests'],
      {cwd: runtimeRoot, env: {PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'},
        maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']})).split('\0').filter(Boolean);
  } catch { throw Error('china_photo_runtime_tests_tracked_tests'); }
  const sourceFiles = new Set(tracked);
  const aj = tracked.filter(name => /^tests\/ajes-[^/]+\.test\.ts$/.test(name));
  const power = tracked.filter(name => /^tests\/japan-pw-[^/]+\.test\.ts$/.test(name));
  need(aj.length > 0, 'aj_tests_missing');
  if (codeScope === COMBINED_SCOPE) {
    const required = CHINA_PHOTO_JAPAN_CODE_PATHS.filter(name => /^tests\/japan-pw-[^/]+\.test\.ts$/.test(name));
    need(power.length > 0 && required.every(name => power.includes(name)), 'power_tests_missing');
  }
  const files = [...new Set([...PHOTO_COMMON_TEST_FILES, ...aj,
    ...(codeScope === JAPAN_STABILITY_CODE_SCOPE ? JAPAN_STABILITY_TEST_FILES
      : codeScope === JAPAN_PAGINATION_CODE_SCOPE ? JAPAN_PAGINATION_TEST_FILES
      : codeScope === CRM_JAPAN_PHOTO_CODE_SCOPE ? CRM_CHINA_TEST_FILES
      : codeScope === CRM_CHINA_CODE_SCOPE ? CRM_CHINA_TEST_FILES
      : codeScope === JAPAN_USABILITY_SCOPE ? JAPAN_USABILITY_TEST_FILES
      : codeScope === JAPAN_COMPLETION_V2_SCOPE ? JAPAN_COMPLETION_V2_TEST_FILES
      : codeScope === JAPAN_COMPLETION_SCOPE ? JAPAN_COMPLETION_TEST_FILES
      : codeScope === JAPAN_SCOPE ? JAPAN_RECOVERY_TEST_FILES
      : codeScope === PHOTO_SCOPE ? CHINA_RUNTIME_TEST_FILES : power)])].sort();
  for (const filename of files) {
    need(sourceFiles.has(filename), 'test_missing');
    const stat = await fs.lstat(path.join(runtimeRoot, filename));
    need(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'test_file');
  }
  return files;
}

/** Photo-only keeps its accepted Japan code and therefore its reviewed legacy
 * test-fixture patch. The combined source already contains those fixture fixes
 * and must run every PW assertion without that patch. Japan recovery runs the
 * native retained China and Japan suites without a patch. All profiles retain
 * the exact offline runner, source identity checks, and a nonzero-exit gate. */
export async function checkPhotoRuntimeTests({runtimeRoot, plan, patchPath,
  runTests = runNativeTests, onProgress = () => {}}) {
  need([PHOTO_SCOPE, COMBINED_SCOPE, JAPAN_SCOPE, JAPAN_COMPLETION_SCOPE, JAPAN_COMPLETION_V2_SCOPE, JAPAN_USABILITY_SCOPE, CRM_CHINA_CODE_SCOPE, CRM_JAPAN_PHOTO_CODE_SCOPE, JAPAN_PAGINATION_CODE_SCOPE, JAPAN_STABILITY_CODE_SCOPE].includes(plan?.codeScope), 'scope');
  const codeScope = checkedCatalogCodeScope(plan);
  need(typeof runTests === 'function' && typeof onProgress === 'function', 'callbacks');
  runtimeRoot = await fs.realpath(runtimeRoot);
  verifyRuntimeTestsCheckout(runtimeRoot, plan);
  const files = await selectedFiles(runtimeRoot, codeScope);
  if (codeScope === PHOTO_SCOPE) {
    const result = await checkChinaRuntimeTests({runtimeRoot, plan, patchPath,
      runTests: async input => {
        need(input.runtimeRoot === runtimeRoot && JSON.stringify(input.files) === JSON.stringify(CHINA_RUNTIME_TEST_FILES), 'base_suite');
        return runTests({runtimeRoot, files});
      },
      onProgress: event => onProgress({...event, codeScope, testFiles: files}),
    });
    return {...result, codeScope, testFiles: files};
  }
  let exitCode;
  try {
    await onProgress({phase: 'china_photo_runtime_tests', runtimeSha: plan.runtimeSha, codeScope, testFiles: files, compatibilityPatchApplied: false});
    exitCode = await runTests({runtimeRoot, files});
    need(exitCode === 0, 'failed');
  } finally { verifyRuntimeTestsCheckout(runtimeRoot, plan); }
  const result = {version: 1, runtimeSha: plan.runtimeSha, runtimeTree: plan.runtimeTree, codeScope,
    testFiles: files, compatibilityPatchApplied: false, passed: true, runtimeRestored: true, exitCode};
  await onProgress({phase: 'china_photo_runtime_tests_passed', ...result});
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 3, 'arguments');
    const plan = JSON.parse(await fs.readFile(path.join(ROOT, '.github/operations/catalog-next/china-code-serving-plan.json'), 'utf8'));
    await checkPhotoRuntimeTests({runtimeRoot: process.argv[2], plan,
      patchPath: path.join(ROOT, '.github/operations/catalog-next/runtime-test-compatibility.patch'),
      onProgress: value => console.log(JSON.stringify(value))});
  } catch (error) {
    console.error(/^china_(?:photo_runtime_tests|runtime_tests|photo_scope)_[a-z_]+$/.test(error?.message ?? '')
      ? error.message : 'china_photo_runtime_tests_failed');
    process.exitCode = 1;
  }
}
