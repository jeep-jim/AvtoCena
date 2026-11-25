import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkedCatalogCodeScope, CHINA_PHOTO_JAPAN_CODE_PATHS} from './photo-code-scope.mjs';
import {checkChinaRuntimeTests, CHINA_RUNTIME_TEST_FILES, verifyRuntimeTestsCheckout, runNativeTests}
  from './check-runtime-tests.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PHOTO_SCOPE = 'catalog-photo-recovery-v1', COMBINED_SCOPE = 'catalog-photo-japan-power-v1';
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
    ...(codeScope === PHOTO_SCOPE ? CHINA_RUNTIME_TEST_FILES : power)])].sort();
  for (const filename of files) {
    need(sourceFiles.has(filename), 'test_missing');
    const stat = await fs.lstat(path.join(runtimeRoot, filename));
    need(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'test_file');
  }
  return files;
}

/** Photo-only keeps its accepted Japan code and therefore its reviewed legacy
 * test-fixture patch. The combined source already contains those fixture fixes
 * and must run every PW assertion without that patch. Both profiles retain
 * the exact offline runner, source identity checks, and a nonzero-exit gate. */
export async function checkPhotoRuntimeTests({runtimeRoot, plan, patchPath,
  runTests = runNativeTests, onProgress = () => {}}) {
  need([PHOTO_SCOPE, COMBINED_SCOPE].includes(plan?.codeScope), 'scope');
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
