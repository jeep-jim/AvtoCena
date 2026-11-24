import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {checkChinaRuntimeTests, validateRuntimeCompatibilityPatch, CHINA_RUNTIME_TEST_FILES}
  from '../scripts/catalog-next/check-runtime-tests.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-test-harness-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const runtimeRoot = path.join(directory, 'runtime');
  await fs.mkdir(path.join(runtimeRoot, 'tests'), {recursive: true});
  await fs.mkdir(path.join(runtimeRoot, 'apps/web'), {recursive: true});
  const filename = path.join(runtimeRoot, 'tests/ajes-japan-only.test.ts');
  const production = path.join(runtimeRoot, 'apps/web/untouched.ts');
  await fs.writeFile(filename, 'export const fixtureValue = 1;\n');
  await fs.writeFile(production, 'original runtime bytes\n');
  const git = args => execFileSync('/usr/bin/git', args,
    {cwd: runtimeRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  git(['init', '--quiet']); git(['add', '.']);
  git(['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '--no-gpg-sign', '-m', 'fixture']);
  const plan = {version: 1, market: 'china', runtimeSha: git(['rev-parse', 'HEAD']).trim(), runtimeTree: git(['rev-parse', 'HEAD^{tree}']).trim()};
  await fs.writeFile(filename, 'export const fixtureValue = 2;\n');
  const patch = git(['diff', '--binary', 'HEAD', '--', 'tests/ajes-japan-only.test.ts']);
  const patchPath = path.join(directory, 'reviewed.patch'); await fs.writeFile(patchPath, patch);
  git(['restore', '--source=HEAD', '--worktree', '--', 'tests/ajes-japan-only.test.ts']);
  return {directory, runtimeRoot, filename, production, git, patch, patchPath, plan};
}

test('the exact runtime uses the reviewed test patch and restores its bytes after passing assertions', async t => {
  const f = await fixture(t);
  const result = await checkChinaRuntimeTests({...f, runTests: async ({runtimeRoot, files}) => {
    assert.equal(runtimeRoot, f.runtimeRoot);
    assert.deepEqual(files, CHINA_RUNTIME_TEST_FILES);
    assert.equal(await fs.readFile(f.filename, 'utf8'), 'export const fixtureValue = 2;\n');
    assert.equal(await fs.readFile(f.production, 'utf8'), 'original runtime bytes\n');
    return 0;
  }});
  assert.equal(result.passed, true); assert.equal(result.runtimeRestored, true);
  assert.equal(result.runtimeSha, f.plan.runtimeSha);
  assert.equal(await fs.readFile(f.filename, 'utf8'), 'export const fixtureValue = 1;\n');
  assert.equal(f.git(['diff', '--name-only', 'HEAD', '--']), '');
});

test('one failed assertion fails the gate and still restores only its own test edits', async t => {
  const f = await fixture(t), keep = path.join(f.runtimeRoot, 'unrelated-output.json');
  await fs.writeFile(keep, 'preserved');
  await assert.rejects(checkChinaRuntimeTests({...f, runTests: async () => 1}), /china_runtime_tests_failed/);
  assert.equal(await fs.readFile(f.filename, 'utf8'), 'export const fixtureValue = 1;\n');
  assert.equal(await fs.readFile(keep, 'utf8'), 'preserved');
  assert.equal(f.git(['diff', '--name-only', 'HEAD', '--']), '');
});

test('runtime paths, removed files, permissions, renames and duplicate targets cannot enter a test patch', async t => {
  const f = await fixture(t);
  assert.deepEqual(validateRuntimeCompatibilityPatch(Buffer.from(f.patch)), ['tests/ajes-japan-only.test.ts']);
  for (const invalid of [
    f.patch.replaceAll('tests/ajes-japan-only.test.ts', 'apps/web/untouched.ts'),
    f.patch.replaceAll('tests/ajes-japan-only.test.ts', 'tests/helpers/offline-fetch.mjs'),
    f.patch.replace('+++ b/tests/ajes-japan-only.test.ts', '+++ /dev/null'),
    f.patch.replace(/ 100644\n/, ' 100755\n'),
    f.patch.replace('index ', 'deleted file mode 100644\nindex '),
    f.patch.replace('index ', 'rename from tests/ajes-japan-only.test.ts\nindex '),
    f.patch + f.patch,
  ]) assert.throws(() => validateRuntimeCompatibilityPatch(Buffer.from(invalid)), /china_runtime_tests_patch_/);
});

test('a dirty or mismatched runtime is refused before applying a patch or running a test', async t => {
  const f = await fixture(t); let calls = 0;
  const runTests = async () => { calls++; return 0; };
  await assert.rejects(checkChinaRuntimeTests({...f, plan: {...f.plan, runtimeSha: '0'.repeat(40)}, runTests}), /china_runtime_tests_identity/);
  await fs.writeFile(f.production, 'pre-existing edit\n');
  await assert.rejects(checkChinaRuntimeTests({...f, runTests}), /china_runtime_tests_git_failed/);
  assert.equal(calls, 0);
  assert.equal(await fs.readFile(f.filename, 'utf8'), 'export const fixtureValue = 1;\n');
  assert.equal(await fs.readFile(f.production, 'utf8'), 'pre-existing edit\n');
});

test('a test changing an unrelated tracked source fails identity verification without erasing that edit', async t => {
  const f = await fixture(t);
  await assert.rejects(checkChinaRuntimeTests({...f, runTests: async () => {
    await fs.writeFile(f.production, 'unexpected runtime edit\n'); return 0;
  }}), /china_runtime_tests_git_failed/);
  assert.equal(await fs.readFile(f.filename, 'utf8'), 'export const fixtureValue = 1;\n');
  assert.equal(await fs.readFile(f.production, 'utf8'), 'unexpected runtime edit\n');
});
