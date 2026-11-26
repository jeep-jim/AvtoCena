import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {checkPhotoRuntimeTests, PHOTO_COMMON_TEST_FILES, JAPAN_RECOVERY_TEST_FILES,JAPAN_COMPLETION_TEST_FILES,JAPAN_COMPLETION_V2_TEST_FILES,JAPAN_USABILITY_TEST_FILES,CRM_CHINA_TEST_FILES,JAPAN_PAGINATION_TEST_FILES} from '../scripts/catalog-next/check-photo-runtime-tests.mjs';
import {CRM_CHINA_CODE_SCOPE, CRM_CHINA_CODE_PATHS, CRM_CHINA_RETAINED_RUNTIME} from '../scripts/catalog-next/crm-china-code-scope.mjs';
import {CRM_JAPAN_PHOTO_CODE_SCOPE, CRM_JAPAN_PHOTO_CODE_PATHS} from '../scripts/catalog-next/crm-japan-photo-code-scope.mjs';
import {JAPAN_PAGINATION_CODE_SCOPE,JAPAN_PAGINATION_CODE_PATHS,JAPAN_PAGINATION_RETAINED_RUNTIME} from '../scripts/catalog-next/japan-pagination-code-scope.mjs';
import {CHINA_RUNTIME_TEST_FILES} from '../scripts/catalog-next/check-runtime-tests.mjs';
import {CHINA_PHOTO_CODE_PATHS, CHINA_PHOTO_JAPAN_CODE_PATHS, JAPAN_RECOVERY_CODE_PATHS,
  JAPAN_RECOVERY_RETAINED_RUNTIME,JAPAN_COMPLETION_CODE_PATHS,JAPAN_COMPLETION_RETAINED_RUNTIME,JAPAN_COMPLETION_V2_CODE_PATHS,JAPAN_USABILITY_CODE_PATHS,JAPAN_USABILITY_RETAINED_RUNTIME} from '../scripts/catalog-next/photo-code-scope.mjs';

const aj = ['tests/ajes-japan-only.test.ts', 'tests/ajes-first.test.ts', 'tests/ajes-last.test.ts'];
const power = ['tests/japan-pw-first.test.ts', 'tests/japan-pw-results.test.ts', 'tests/japan-pw-additional.test.ts'];
async function fixture(t, profile = false) {
  const combined = profile === true, usability=profile==='catalog-japan-usability-v1', completionV2=profile==='catalog-japan-completion-v2',
    completion=profile==='catalog-japan-completion-v1'||completionV2||usability,
    japan = profile === 'catalog-japan-recovery-v1'||completion;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-photo-tests-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const runtimeRoot = path.join(directory, 'runtime');
  await fs.mkdir(path.join(runtimeRoot, 'tests/helpers'), {recursive: true});
  await fs.mkdir(path.join(runtimeRoot, 'apps/web'), {recursive: true});
  const files = [...new Set([...PHOTO_COMMON_TEST_FILES, ...CHINA_RUNTIME_TEST_FILES, ...aj,
    ...(combined ? power : []), ...(usability?JAPAN_USABILITY_TEST_FILES:completionV2?JAPAN_COMPLETION_V2_TEST_FILES:completion?JAPAN_COMPLETION_TEST_FILES:japan ? JAPAN_RECOVERY_TEST_FILES : [])])];
  for (const name of files) await fs.writeFile(path.join(runtimeRoot, name), 'export const fixtureValue = 1;\n');
  const production = path.join(runtimeRoot, 'apps/web/untouched.ts');
  await fs.writeFile(production, 'original runtime bytes\n');
  await fs.writeFile(path.join(runtimeRoot, 'tests/helpers/offline-fetch.mjs'), 'original offline guard\n');
  const git = args => execFileSync('/usr/bin/git', args, {cwd: runtimeRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  git(['init', '--quiet']); git(['add', '.']);
  const commit = () => git(['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '--quiet', '--no-gpg-sign', '-m', 'fixture']);
  commit();
  const plan = {version: 1, market: 'china', codeScope: japan ? profile : combined ? 'catalog-photo-japan-power-v1' : 'catalog-photo-recovery-v1',
    runtimeFiles: [...(usability?JAPAN_USABILITY_CODE_PATHS:completionV2?JAPAN_COMPLETION_V2_CODE_PATHS:completion?JAPAN_COMPLETION_CODE_PATHS:japan ? JAPAN_RECOVERY_CODE_PATHS : combined ? CHINA_PHOTO_JAPAN_CODE_PATHS : CHINA_PHOTO_CODE_PATHS)],
    ...(japan ? {retainedRuntime: usability?JAPAN_USABILITY_RETAINED_RUNTIME:completion?JAPAN_COMPLETION_RETAINED_RUNTIME:JAPAN_RECOVERY_RETAINED_RUNTIME} : {})};
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

for (const [scope, paths] of [[CRM_CHINA_CODE_SCOPE, CRM_CHINA_CODE_PATHS], [CRM_JAPAN_PHOTO_CODE_SCOPE, CRM_JAPAN_PHOTO_CODE_PATHS]])
for (const outcome of ['success', 'failure', 'missing_status']) test('CRM native suite preserves accepted 077 assertions: ' + scope + '/' + outcome, async t => {
  const f = await fixture(t, 'catalog-japan-completion-v2');
  for (const filename of CRM_CHINA_TEST_FILES) {
    await fs.mkdir(path.dirname(path.join(f.runtimeRoot, filename)), {recursive: true});
    try { await fs.writeFile(path.join(f.runtimeRoot, filename), 'export const fixtureValue = 1;\n', {flag: 'wx'}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  f.git(['add', '.']); f.commit(); f.refreshPlan();
  Object.assign(f.plan, {codeScope: scope, retainedRuntime: CRM_CHINA_RETAINED_RUNTIME, runtimeFiles: [...paths]});
  if (outcome === 'missing_status') { f.git(['rm', 'tests/china-catalog-status.test.ts']); f.commit(); f.refreshPlan(); }
  let calls = 0;
  const operation = () => checkPhotoRuntimeTests({...f, patchPath: path.join(f.directory, 'must-not-open'), runTests: async ({files}) => {
    calls++;
    assert.deepEqual(files, [...new Set([...CRM_CHINA_TEST_FILES, ...aj])].sort());
    assert.ok(files.includes('tests/ajes-empty-page-validation.test.ts'));
    assert.ok(files.includes('tests/catalog-collection-controls.test.ts'));
    assert.ok(files.includes('tests/catalog-photo-retry.test.ts'));
    assert.ok(!files.includes('tests/ajes-power-page.test.ts'), 'b25 tests cannot enter an accepted077 CRM candidate');
    return outcome === 'failure' ? 1 : 0;
  }});
  if (outcome === 'success') assert.equal((await operation()).compatibilityPatchApplied, false);
  else await assert.rejects(operation(), outcome === 'failure' ? /china_photo_runtime_tests_failed/ : /china_photo_runtime_tests_test_missing/);
  assert.equal(calls, outcome === 'missing_status' ? 0 : 1);
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

for(const scope of ['catalog-japan-recovery-v1','catalog-japan-completion-v1','catalog-japan-completion-v2','catalog-japan-usability-v1'])
test(scope+' runs native retained China, all changed tests and the reviewed AJ suite without a compatibility patch', async t => {
  const f = await fixture(t, scope), events = [];
  await fs.writeFile(path.join(f.runtimeRoot, 'tests/ajes-unreviewed.test.ts'), 'must never execute\n');
  const expected = [...new Set([...(scope==='catalog-japan-usability-v1'?JAPAN_USABILITY_TEST_FILES:scope==='catalog-japan-completion-v2'?JAPAN_COMPLETION_V2_TEST_FILES:scope==='catalog-japan-completion-v1'?JAPAN_COMPLETION_TEST_FILES:JAPAN_RECOVERY_TEST_FILES), ...aj])].sort();
  for (const file of [...CHINA_RUNTIME_TEST_FILES, ...PHOTO_COMMON_TEST_FILES,
    ...JAPAN_RECOVERY_CODE_PATHS.filter(name => name.startsWith('tests/')),
    'tests/ajes-count-progressive.test.ts', 'tests/japan-drive-sql-budget.test.ts',
    'tests/japan-owner-exclusions.test.ts', 'tests/japan-stepwgn-owner-power.test.ts',
    ...(['catalog-japan-completion-v1','catalog-japan-completion-v2','catalog-japan-usability-v1'].includes(scope)?['tests/japan-catalog-city.test.ts','tests/selection-city-persistence.test.ts']:[]),
    ...(['catalog-japan-completion-v2','catalog-japan-usability-v1'].includes(scope)?['tests/ajes-empty-page-validation.test.ts']:[]),
    ...(scope==='catalog-japan-usability-v1'?JAPAN_USABILITY_CODE_PATHS.filter(name=>/^tests\/[^/]+\.test\.ts$/.test(name)):[])]) {
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

for(const scope of ['catalog-japan-recovery-v1','catalog-japan-completion-v1','catalog-japan-completion-v2','catalog-japan-usability-v1'])
for (const failure of ['nonzero', 'throw', 'progress'])
  test(scope+' propagates ' + failure + ' without reporting a false native success', async t => {
    const f = await fixture(t, scope), events = []; let calls = 0;
    await assert.rejects(checkPhotoRuntimeTests({...f, patchPath: path.join(f.directory, 'does-not-exist'),
      onProgress: event => { events.push(event); if (failure === 'progress') throw Error('fixture_progress_failure'); },
      runTests: async () => { calls++; if (failure === 'throw') throw Error('fixture_runner_failure'); return 1; }}),
    failure === 'nonzero' ? /china_photo_runtime_tests_failed/ : /fixture_(?:runner|progress)_failure/);
    assert.equal(calls, failure === 'progress' ? 0 : 1);
    assert.equal(events.some(event => event.passed === true), false);
    assert.equal(f.git(['diff', '--name-only', 'HEAD', '--']), '');
  });

for(const scope of ['catalog-japan-recovery-v1','catalog-japan-completion-v1','catalog-japan-completion-v2','catalog-japan-usability-v1'])
for (const missing of ['tests/japan-source-power.test.ts', 'tests/home-japan-preview.test.ts',
  'tests/catalog-next-query-index.test.ts', 'tests/ajes-count-progressive.test.ts'])
  test(scope+' refuses missing required native test ' + missing, async t => {
    const f = await fixture(t, scope);
    f.git(['rm', '--', missing]); f.commit(); f.refreshPlan(); let calls = 0;
    await assert.rejects(checkPhotoRuntimeTests({...f, runTests: async () => { calls++; return 0; }}), /china_photo_runtime_tests_test_missing/);
    assert.equal(calls, 0);
  });

for(const scope of ['catalog-japan-recovery-v1','catalog-japan-completion-v1','catalog-japan-completion-v2','catalog-japan-usability-v1'])
test(scope+' refuses a different retained base before invoking native tests', async t => {
  const f = await fixture(t, scope); let calls = 0;
  await assert.rejects(checkPhotoRuntimeTests({...f, plan: {...f.plan, retainedRuntime: '0'.repeat(40)},
    runTests: async () => { calls++; return 0; }}), /china_photo_scope_retained_runtime/);
  assert.equal(calls, 0);
});

test('completion v2 cannot omit its new empty-page regression from the immutable source',async t=>{
  const f=await fixture(t,'catalog-japan-completion-v2');
  f.git(['rm','--','tests/ajes-empty-page-validation.test.ts']);f.commit();f.refreshPlan();let calls=0;
  await assert.rejects(checkPhotoRuntimeTests({...f,runTests:async()=>{calls++;return 0;}}),/china_photo_runtime_tests_test_missing/);
  assert.equal(calls,0);
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

for (const scope of [false, 'catalog-japan-recovery-v1','catalog-japan-completion-v1','catalog-japan-completion-v2'])
test('a test cannot change production bytes and receive a passing result, and its edit is not erased: ' + scope, async t => {
  const f = await fixture(t, scope);
  await assert.rejects(checkPhotoRuntimeTests({...f, runTests: async () => {
    await fs.writeFile(f.production, 'unexpected runtime edit\n'); return 0;
  }}), /china_runtime_tests_git_failed/);
  assert.equal(await fs.readFile(f.filename, 'utf8'), 'export const fixtureValue = 1;\n');
  assert.equal(await fs.readFile(f.production, 'utf8'), 'unexpected runtime edit\n');
});


for(const missing of JAPAN_USABILITY_CODE_PATHS.filter(name=>/^tests\/[^/]+\.test\.ts$/.test(name)))
test('usability source cannot omit its reviewed native regression '+missing,async t=>{
 const f=await fixture(t,'catalog-japan-usability-v1');
 f.git(['rm','--',missing]);f.commit();f.refreshPlan();let calls=0;
 await assert.rejects(checkPhotoRuntimeTests({...f,runTests:async()=>{calls++;return 0;}}),/china_photo_runtime_tests_test_missing/);
 assert.equal(calls,0);
});

for(const outcome of ['success','failure','missing_refill','missing_crm','missing_photo'])
test('pagination24 retains all a5ca native guards and makes changed tests mandatory: '+outcome,async t=>{
  const f=await fixture(t,'catalog-japan-completion-v2');
  for(const filename of JAPAN_PAGINATION_TEST_FILES){
    await fs.mkdir(path.dirname(path.join(f.runtimeRoot,filename)),{recursive:true});
    try{await fs.writeFile(path.join(f.runtimeRoot,filename),'export const fixtureValue = 1;\n',{flag:'wx'});}
    catch(error){if(error.code!=='EEXIST')throw error;}
  }
  f.git(['add','.']);f.commit();f.refreshPlan();
  Object.assign(f.plan,{codeScope:JAPAN_PAGINATION_CODE_SCOPE,retainedRuntime:JAPAN_PAGINATION_RETAINED_RUNTIME,runtimeFiles:[...JAPAN_PAGINATION_CODE_PATHS]});
  const missing={missing_refill:'tests/ajes-filtered-page.test.ts',missing_crm:'tests/china-catalog-status.test.ts',missing_photo:'tests/catalog-photo-retry.test.ts'}[outcome];
  if(missing){f.git(['rm',missing]);f.commit();f.refreshPlan();}
  let calls=0;
  const operation=()=>checkPhotoRuntimeTests({...f,patchPath:path.join(f.directory,'must-not-open'),runTests:async({files})=>{
    calls++;assert.deepEqual(files,[...new Set([...JAPAN_PAGINATION_TEST_FILES,...aj])].sort());
    for(const filename of CRM_CHINA_TEST_FILES)assert.ok(files.includes(filename));
    for(const filename of JAPAN_PAGINATION_CODE_PATHS.filter(name=>/^tests\/[^/]+\.test\.ts$/.test(name)))assert.ok(files.includes(filename));
    assert.ok(!files.includes('tests/ajes-power-page.test.ts'));
    return outcome==='failure'?1:0;
  }});
  if(outcome==='success')assert.equal((await operation()).compatibilityPatchApplied,false);
  else await assert.rejects(operation(),outcome==='failure'?/china_photo_runtime_tests_failed/:/china_photo_runtime_tests_test_missing/);
  assert.equal(calls,missing?0:1);
});
