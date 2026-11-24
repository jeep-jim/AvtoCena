import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync, spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const need = (value, code) => assert(value, 'china_runtime_tests_' + code);
const hash = value => createHash('sha256').update(value).digest('hex');
const environment = () => ({PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', JSON_STORAGE_DRIVER: 'local'});
export const COMPATIBILITY_TEST_FILES = Object.freeze([
  'tests/ajes-japan-only.test.ts',
  'tests/catalog-current-read-model-empty-market-policy.test.ts',
  'tests/catalog-editable-power-scenario.test.ts',
  'tests/catalog-market-page-boundary.test.ts',
  'tests/catalog-market-page-city.test.ts',
  'tests/home-editorial-empty.test.ts',
  'tests/home-initial-catalog.test.ts',
  'tests/offer-navigation-performance.test.ts',
  'tests/public-page-recovery.test.ts',
]);
export const CHINA_RUNTIME_TEST_FILES = Object.freeze([
  'tests/catalog-next-pricing-worker.test.mjs',
  'tests/catalog-next-query-index.test.ts',
  'tests/catalog-next-local-reader.test.ts',
  'tests/catalog-frozen-fx-batch.test.ts',
  'tests/catalog-next-home-isolation.test.ts',
  ...COMPATIBILITY_TEST_FILES,
]);

/** Only modifications to these existing test modules are permitted. A reviewed
 * fixture correction cannot create/delete/rename/chmod a file, edit runtime
 * code, alter the offline network guard or supply an executable test command. */
export function validateRuntimeCompatibilityPatch(raw) {
  need(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= 1024 * 1024, 'patch_size');
  let text;
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(raw); }
  catch { throw Error('china_runtime_tests_patch_encoding'); }
  need(!text.includes('\0') && text.startsWith('diff --git '), 'patch_format');
  const paths = [];
  for (const block of text.split(/\n(?=diff --git )/)) {
    const lines = block.split('\n');
    const match = lines[0].match(/^diff --git a\/(tests\/[a-z0-9-]+\.test\.ts) b\/\1$/);
    need(match && COMPATIBILITY_TEST_FILES.includes(match[1]), 'patch_path');
    const name = match[1];
    need(!paths.includes(name), 'patch_duplicate'); paths.push(name);
    need(lines.filter(line => /^index [a-f0-9]{7,40}\.\.[a-f0-9]{7,40} 100644$/.test(line)).length === 1
      && lines.filter(line => line.startsWith('--- ')).join('\n') === '--- a/' + name
      && lines.filter(line => line.startsWith('+++ ')).join('\n') === '+++ b/' + name
      && lines.some(line => /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line)), 'patch_modification');
    need(!lines.some(line => /^(?:new file mode|deleted file mode|old mode|new mode|similarity index|rename from|rename to|copy from|copy to|GIT binary patch|Binary files)/.test(line)), 'patch_operation');
  }
  need(paths.length > 0, 'patch_empty');
  return Object.freeze(paths.sort());
}

function git(runtimeRoot, args, input) {
  try {
    return execFileSync('/usr/bin/git', ['--no-optional-locks', ...args], {cwd: runtimeRoot,
      env: environment(), input, maxBuffer: 2 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']});
  } catch { throw Error('china_runtime_tests_git_failed'); }
}

function verifyRuntime(runtimeRoot, plan) {
  need(plan?.version === 1 && plan.market === 'china' && /^[a-f0-9]{40}$/.test(plan.runtimeSha ?? '')
    && /^[a-f0-9]{40}$/.test(plan.runtimeTree ?? ''), 'plan');
  need(String(git(runtimeRoot, ['rev-parse', '--show-toplevel'])).trim() === runtimeRoot, 'root');
  need(String(git(runtimeRoot, ['rev-parse', 'HEAD'])).trim() === plan.runtimeSha
    && String(git(runtimeRoot, ['rev-parse', 'HEAD^{tree}'])).trim() === plan.runtimeTree, 'identity');
  git(runtimeRoot, ['diff', '--quiet', '--no-ext-diff', 'HEAD', '--']);
}

async function runNativeTests({runtimeRoot, files}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--import', './tests/helpers/offline-fetch.mjs',
      '--test', '--test-concurrency=1', ...files], {cwd: runtimeRoot, env: environment(), stdio: ['ignore', 'inherit', 'inherit']});
    let timeout = false, killTimer;
    const timer = setTimeout(() => {
      timeout = true; child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5000); killTimer.unref();
    }, 20 * 60 * 1000);
    child.once('error', () => { clearTimeout(timer); clearTimeout(killTimer); reject(Error('china_runtime_tests_start')); });
    child.once('close', code => {
      clearTimeout(timer); clearTimeout(killTimer);
      if (timeout) reject(Error('china_runtime_tests_timeout')); else resolve(code);
    });
  });
}

/** Exact runtime bytes are restored even if one assertion or the harness
 * application fails. There is no accepted-failure list: every selected test
 * must pass. This does not run tsc or restore any unrelated generated files. */
export async function checkChinaRuntimeTests({runtimeRoot, plan, patchPath,
  runTests = runNativeTests, onProgress = () => {}}) {
  runtimeRoot = await fs.realpath(runtimeRoot);
  verifyRuntime(runtimeRoot, plan);
  const patchStat = await fs.lstat(patchPath);
  need(patchStat.isFile() && !patchStat.isSymbolicLink() && patchStat.nlink === 1, 'patch_file');
  const raw = await fs.readFile(patchPath), paths = validateRuntimeCompatibilityPatch(raw);
  for (const filename of paths) {
    const entry = String(git(runtimeRoot, ['ls-tree', '-z', 'HEAD', '--', filename]));
    need(new RegExp('^100644 blob [a-f0-9]{40}\\t' + filename.replaceAll('.', '\\.') + '\\x00$').test(entry), 'tracked_test');
  }
  git(runtimeRoot, ['apply', '--check', '-'], raw);
  let attempted = false, exitCode;
  try {
    attempted = true;
    git(runtimeRoot, ['apply', '-'], raw);
    const changed = String(git(runtimeRoot, ['diff', '--name-only', '-z', 'HEAD', '--'])).split('\0').filter(Boolean).sort();
    need(JSON.stringify(changed) === JSON.stringify(paths), 'changed_scope');
    await onProgress({phase: 'china_runtime_tests', runtimeSha: plan.runtimeSha,
      patchSha256: hash(raw), patchedTests: paths, testFiles: CHINA_RUNTIME_TEST_FILES});
    exitCode = await runTests({runtimeRoot, files: CHINA_RUNTIME_TEST_FILES});
    need(exitCode === 0, 'failed');
  } finally {
    if (attempted) git(runtimeRoot, ['restore', '--source=HEAD', '--worktree', '--', ...paths]);
    verifyRuntime(runtimeRoot, plan);
  }
  const result = {version: 1, runtimeSha: plan.runtimeSha, runtimeTree: plan.runtimeTree,
    patchSha256: hash(raw), patchedTests: paths, testFiles: CHINA_RUNTIME_TEST_FILES,
    passed: true, runtimeRestored: true, exitCode};
  await onProgress({phase: 'china_runtime_tests_passed', ...result});
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 3, 'arguments');
    const plan = JSON.parse(await fs.readFile(path.join(root, '.github/operations/catalog-next/china-serving-plan.json'), 'utf8'));
    await checkChinaRuntimeTests({runtimeRoot: process.argv[2], plan,
      patchPath: path.join(root, '.github/operations/catalog-next/runtime-test-compatibility.patch'),
      onProgress: value => console.log(JSON.stringify(value))});
  } catch (error) {
    console.error(/^china_runtime_tests_[a-z_]+$/.test(error?.message ?? '') ? error.message : 'china_runtime_tests_failed');
    process.exitCode = 1;
  }
}
