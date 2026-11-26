import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {checkPhotoRuntimeTests, PHOTO_COMMON_TEST_FILES, JAPAN_RECOVERY_TEST_FILES} from '../scripts/catalog-next/check-photo-runtime-tests.mjs';
import {CHINA_RUNTIME_TEST_FILES} from '../scripts/catalog-next/check-runtime-tests.mjs';
import {CHINA_PHOTO_CODE_PATHS, CHINA_PHOTO_JAPAN_CODE_PATHS, JAPAN_RECOVERY_CODE_PATHS,
  JAPAN_RECOVERY_RETAINED_RUNTIME} from '../scripts/catalog-next/photo-code-scope.mjs';

const aj = ['tests/ajes-japan-only.test.ts', 'tests/ajes-first.test.ts', 'tests/ajes-last.test.ts'];
const power = ['tests/japan-pw-first.test.ts', 'tests/japan-pw-results.test.ts', 'tests/japan-pw-additional.test.ts'];
async function fixture(t, profile = false) {
  const combined = profile === true, japan = profile === 'catalog-japan-recovery-v1';
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-photo-tests-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const runtimeRoot = path.join(directory, 'runtime');
  await fs.mkdir(path.join(runtimeRoot, 'tests/helpers'), {recursive: true});
  await fs.mkdir(path.join(runtimeRoot, 'apps/web'), {recursive: true});
  const files = [...new Set([...PHOTO_COMMON_TEST_FILES, ...CHINA_RUNTIME_TEST_FILES, ...aj,
    ...(combined ? power : []), ...(japan ? JAPAN_RECOVERY_TEST_FILES : [])])];
  for (const name of files) await fs.writeFile(path.join(runtimeRoot, name), 'export const fixtureValue = 1;\n');
  const production = path.join(runtimeRoot, 'apps/web/untouched.ts');
  await fs.writeFile(production, 'original runtime bytes\n');
  await fs.writeFile(path.join(runtimeRoot, 'tests/helpers/offline-fetch.mjs'), 'original offline guard\n');
  const git = args => execFileSync('/usr/bin/git', args, {cwd: runtimeRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  git(['init', '--quiet']); git(['add', '.']);
  const commit = () => git(['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '--quiet', '--no-gpg-sign', '-m', 'fixture']);
  commit();
  const plan = {version: 1, market: 'china', codeScope: japan ? profile : combined ? 'catalog-photo-japan-power-v1' : 'catalog-photo-recovery-v1',
    runtimeFiles: [...(japan ? JAPAN_RECOVERY_CODE_PATHS : combined ? CHINA_PHOTO_JAPAN_CODE_PATHS : CHINA_PHOTO_CODE_PATHS)],
    ...(japan ? {retainedRuntime: JAPAN_RECOVERY_RETAINED_RUNTIME} : {})};
  const refreshPlan = () => Object.assign(plan, {runtimeSha: git(['rev-parse', 'HEAD']).trim(), runtimeTree: git(['rev-parse', 'HEAD^{tree}']).trim()});
  refreshPlan();
  const filename = path.join(runtimeRoot, aj[0]);
  await fs.writeFile(filename, 'export const fixtureValue = 2;\n');
  const patchPath = path.join(directory, 'reviewed.patch');
  await fs.writeFile(patchPath, git(['diff', '--binary', 'HEAD', '--', aj[0]]));
  git(['restore', '--source=HEAD', '--worktree', '--', aj[0]]);
  return {directory, runtimeRoot, files, plan, filename, production, git, patchPath, commit, refreshPlan};
}

test('photo-only runs the complete common and fixed union while the reviewed patch is applied, then restores exact bytes', async t => {
  const f = await fixture(t), events = [];
  // An untracked test cannot join the source-pinned test set through a glob.
  await fs.writeFile(path.join(f.runtimeRoot, 'tests/ajes-unreviewed.test.ts'), 'must never execute\n');
  const expected = [...new Set([...PHOTO_COMMON_TEST_FILES, ...CHINA_RUNTIME_TEST_FILES, ...aj])].sort();
  const result = await checkPhotoRuntimeTests({...f, onProgress: event => events.push(event), runTests: async input => {
    assert.equal(input.runtimeRoot, f.runtimeRoot); assert.deepEqual(input.files, expected);
    assert.equal(await fs.readFile(f.filename, 'utf8'), 'export const fixtureValue = 2;\n');
    assert.equal(await fs.readFile(f.production, 'utf8'), 'original runtime bytes\n');
    return 0;
  }});
  assert.equal(result.passed, true); assert.equal(result.runtimeRestored, true);
  assert.deepEqual(result.testFiles, expected);
  assert.ok(events.length >= 2); assert.ok(events.every(event => JSON.stringify(event.testFiles) === JSON.stringify(expected)));
  assert.equal(await fs.readFile(f.filename, 'utf8'), 'export const fixtureValue = 1;\n');
  assert.equal(f.git(['diff', '--name-only', 'HEAD', '--']), '');
  assert.equal(await fs.readFile(path.join(f.runtimeRoot, 'tests/ajes-unreviewed.test.ts'), 'utf8'), 'must never execute\n');
});

for (const failure of ['nonzero', 'throw', 'progress'])
  test('photo-only propagates ' + failure + ' and restores the patched test bytes', async t => {
    const f = await fixture(t); let called = false;
    await assert.rejects(checkPhotoRuntimeTests({...f,
      onProgress: () => { if (failure === 'progress') throw Error('fixture_progress_failure'); },
      runTests: async ({files}) => {
        called = true; assert.ok(files.includes('tests/photo-proxy.test.ts'));
        assert.equal(await fs.readFile(f.filename, 'utf8'), 'export const fixtureValue = 2;\n');
        if (failure === 'throw') throw Error('fixture_runner_failure');
        return 1;
      },
    }), failure === 'nonzero' ? /china_runtime_tests_failed/ : /fixture_(?:progress|runner)_failure/);
    assert.equal(called, failure !== 'progress');
    assert.equal(await fs.readFile(f.filename, 'utf8'), 'export const fixtureValue = 1;\n');
    assert.equal(f.git(['diff', '--name-only', 'HEAD', '--']), '');
  });

test('combined runs all common and PW tests without opening or applying a compatibility patch', async t => {
  const f = await fixture(t, true), expected = [...new Set([...PHOTO_COMMON_TEST_FILES, ...aj, ...power])].sort();
  const result = await checkPhotoRuntimeTests({...f, patchPath: path.join(f.directory, 'does-not-exist'), runTests: async ({files}) => {
    assert.deepEqual(files, expected);
    assert.equal(await fs.readFile(f.filename, 'utf8'), 'export const fixtureValue = 1;\n');
    assert.equal(f.git(['diff', '--name-only', 'HEAD', '--']), '');
    return 0;
  }});
  assert.equal(result.compatibilityPatchApplied, false); assert.equal(result.passed, true);
  assert.deepEqual(result.testFiles, expected); assert.equal(f.git(['diff', '--name-only', 'HEAD', '--']), '');
});

test('Japan recovery runs native retained China, all changed tests and the reviewed AJ suite without a compatibility patch', async t => {
  const f = await fixture(t, 'catalog-japan-recovery-v1'), events = [];
  await fs.writeFile(path.join(f.runtimeRoot, 'tests/ajes-unreviewed.test.ts'), 'must never execute\n');
  const expected = [...new Set([...JAPAN_RECOVERY_TEST_FILES, ...aj])].sort();
  for (const file of [...CHINA_RUNTIME_TEST_FILES, ...PHOTO_COMMON_TEST_FILES,
    ...JAPAN_RECOVERY_CODE_PATHS.filter(name => name.startsWith('tests/')),
    'tests/ajes-count-progressive.test.ts', 'tests/japan-drive-sql-budget.test.ts',
    'tests/japan-owner-exclusions.test.ts', 'tests/japan-stepwgn-owner-power.test.ts']) {
    assert.ok(expected.includes(file), 'required native assertion file: ' + file);
  }
  const result = await checkPhotoRuntimeTests({...f, patchPath: path.join(f.directory, 'does-not-exist'),
    onProgress: event => events.push(event), runTests: async ({files}) => {
      assert.deepEqual(files, expected);
      assert.equal(await fs.readFile(f.filename, 'utf8'), 'export const fixtureValue = 1;\n');
      assert.equal(f.git(['diff', '--name-only', 'HEAD', '--']), '');
      return 0;
    }});
  assert.equal(result.compatibilityPatchApplied, false); assert.equal(result.passed, true);
  assert.deepEqual(result.testFiles, expected);
  assert.ok(events.length >= 2 && events.every(event => event.compatibilityPatchApplied === false));
  assert.equal(f.git(['diff', '--name-only', 'HEAD', '--']), '');
});

for (const failure of ['nonzero', 'throw', 'progress'])
  test('Japan recovery propagates ' + failure + ' without reporting a false native success', async t => {
    const f = await fixture(t, 'catalog-japan-recovery-v1'), events = []; let calls = 0;
    await assert.rejects(checkPhotoRuntimeTests({...f, patchPath: path.join(f.directory, 'does-not-exist'),
      onProgress: event => { events.push(event); if (failure === 'progress') throw Error('fixture_progress_failure'); },
      runTests: async () => { calls++; if (failure === 'throw') throw Error('fixture_runner_failure'); return 1; }}),
    failure === 'nonzero' ? /china_photo_runtime_tests_failed/ : /fixture_(?:runner|progress)_failure/);
    assert.equal(calls, failure === 'progress' ? 0 : 1);
    assert.equal(events.some(event => event.passed === true), false);
    assert.equal(f.git(['diff', '--name-only', 'HEAD', '--']), '');
  });

for (const missing of ['tests/japan-source-power.test.ts', 'tests/home-japan-preview.test.ts',
  'tests/catalog-next-query-index.test.ts', 'tests/ajes-count-progressive.test.ts'])
  test('Japan recovery refuses missing required native test ' + missing, async t => {
    const f = await fixture(t, 'catalog-japan-recovery-v1');
    f.git(['rm', '--', missing]); f.commit(); f.refreshPlan(); let calls = 0;
    await assert.rejects(checkPhotoRuntimeTests({...f, runTests: async () => { calls++; return 0; }}), /china_photo_runtime_tests_test_missing/);
    assert.equal(calls, 0);
  });

test('Japan recovery refuses a different retained base before invoking native tests', async t => {
  const f = await fixture(t, 'catalog-japan-recovery-v1'); let calls = 0;
  await assert.rejects(checkPhotoRuntimeTests({...f, plan: {...f.plan, retainedRuntime: '0'.repeat(40)},
    runTests: async () => { calls++; return 0; }}), /china_photo_scope_retained_runtime/);
  assert.equal(calls, 0);
});

for (const failure of ['nonzero', 'throw']) test('combined propagates ' + failure + ' without a false success report', async t => {
  const f = await fixture(t, true), events = [];
  await assert.rejects(checkPhotoRuntimeTests({...f, onProgress: event => events.push(event), runTests: async () => {
    if (failure === 'throw') throw Error('fixture_runner_failure');
    return 1;
  }}), failure === 'throw' ? /fixture_runner_failure/ : /china_photo_runtime_tests_failed/);
  assert.equal(events.some(event => event.passed === true), false);
  assert.equal(f.git(['diff', '--name-only', 'HEAD', '--']), '');
});

for (const missing of ['aj-group', 'pw-group', 'one-reviewed-pw', 'common'])
  test('missing ' + missing + ' fails before patching or invoking tests', async t => {
    const f = await fixture(t, true);
    const remove = missing === 'aj-group' ? aj : missing === 'pw-group' ? power
      : missing === 'one-reviewed-pw' ? ['tests/japan-pw-first.test.ts'] : ['tests/photo-proxy.test.ts'];
    f.git(['rm', '--', ...remove]); f.commit(); f.refreshPlan();
    let calls = 0;
    await assert.rejects(checkPhotoRuntimeTests({...f, runTests: async () => { calls++; return 0; }}),
      /china_photo_runtime_tests_(?:aj_tests_missing|power_tests_missing|test_missing)/);
    assert.equal(calls, 0); assert.equal(f.git(['diff', '--name-only', 'HEAD', '--']), '');
  });

test('unknown scopes, missing scope, relabelled file sets, wrong source and dirty checkout cannot reach tests', async t => {
  const f = await fixture(t); let calls = 0;
  const runTests = async () => { calls++; return 0; };
  for (const codeScope of [undefined, 'caller-chosen-scope'])
    await assert.rejects(checkPhotoRuntimeTests({...f, plan: {...f.plan, codeScope}, runTests}), /china_photo_runtime_tests_scope/);
  await assert.rejects(checkPhotoRuntimeTests({...f, plan: {...f.plan, codeScope: 'catalog-photo-japan-power-v1'}, runTests}), /china_photo_scope_files/);
  await assert.rejects(checkPhotoRuntimeTests({...f, plan: {...f.plan, runtimeSha: '0'.repeat(40)}, runTests}), /china_runtime_tests_identity/);
  await fs.writeFile(f.production, 'pre-existing edit\n');
  await assert.rejects(checkPhotoRuntimeTests({...f, runTests}), /china_runtime_tests_git_failed/);
  assert.equal(calls, 0); assert.equal(await fs.readFile(f.production, 'utf8'), 'pre-existing edit\n');
  assert.equal(await fs.readFile(f.filename, 'utf8'), 'export const fixtureValue = 1;\n');
});

for (const scope of [false, 'catalog-japan-recovery-v1'])
test('a test cannot change production bytes and receive a passing result, and its edit is not erased: ' + scope, async t => {
  const f = await fixture(t, scope);
  await assert.rejects(checkPhotoRuntimeTests({...f, runTests: async () => {
    await fs.writeFile(f.production, 'unexpected runtime edit\n'); return 0;
  }}), /china_runtime_tests_git_failed/);
  assert.equal(await fs.readFile(f.filename, 'utf8'), 'export const fixtureValue = 1;\n');
  assert.equal(await fs.readFile(f.production, 'utf8'), 'unexpected runtime edit\n');
});
