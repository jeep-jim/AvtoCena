import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {JAPAN_STABILITY_CODE_SCOPE, JAPAN_STABILITY_CODE_PATHS, JAPAN_STABILITY_UI_CODE_PATHS,
  JAPAN_STABILITY_POWER_CODE_PATHS, JAPAN_STABILITY_RAILS_CODE_PATHS, JAPAN_STABILITY_RETAINED_RUNTIME,
  japanStabilityCodePaths, japanPowerOrderRequired, japanSourceNamesRequired, japanBrandDirectoryRequired,
  isExactJapanStabilityScope} from '../scripts/catalog-next/japan-stability-code-scope.mjs';
import {checkedCatalogCodeScope} from '../scripts/catalog-next/photo-code-scope.mjs';
import {checkedJapanFilterDirectoryFixture} from '../scripts/catalog-next/japan-filter-directory-proof.mjs';

const plan = (paths = JAPAN_STABILITY_RAILS_CODE_PATHS) => ({codeScope: JAPAN_STABILITY_CODE_SCOPE,
  retainedRuntime: JAPAN_STABILITY_RETAINED_RUNTIME, runtimeFiles: [...paths]});
const fallbackCases = ['brand-directory-fresh-empty-visible-and-retry',
  'brand-directory-stale-visible-and-retry', 'brand-directory-error-visible-and-retry'];
const sourceCases = ['source-options-only', 'make-change-clears-old-models', 'model-directory-failure-and-retry',
  'brand-directory-failure-and-retry', 'raw-source-selection', 'typed-source-make-aliases'];
const fixture = names => ({passed: true,
  scope: 'Actual Japan brand/model controls with bounded local source fixtures; no production or supplier calls',
  cases: [390, 1440].flatMap(width => names.map(name => ({width, name, passed: true})))});

test('complete Japan UI pins only its two reviewed rail views and preserves the existing profiles', () => {
  assert(Object.isFrozen(JAPAN_STABILITY_RAILS_CODE_PATHS));
  assert.equal(JAPAN_STABILITY_RAILS_CODE_PATHS.length, 56);
  assert.deepEqual(JAPAN_STABILITY_RAILS_CODE_PATHS.filter(name => !JAPAN_STABILITY_POWER_CODE_PATHS.includes(name)), [
    'apps/web/components/catalog/AjesRail.tsx', 'apps/web/components/home/HomeJapanFilteredRail.tsx',
    'tests/japan-rail-visibility.test.ts']);
  assert.equal(checkedCatalogCodeScope(plan()), JAPAN_STABILITY_CODE_SCOPE);
  assert.equal(japanStabilityCodePaths(plan()), JAPAN_STABILITY_RAILS_CODE_PATHS);
  assert.equal(japanPowerOrderRequired(plan()), true);
  assert.equal(japanSourceNamesRequired(plan()), true);
  assert.equal(japanBrandDirectoryRequired(plan()), true);
  for (const paths of [JAPAN_STABILITY_CODE_PATHS, JAPAN_STABILITY_UI_CODE_PATHS, JAPAN_STABILITY_POWER_CODE_PATHS]) {
    assert.equal(checkedCatalogCodeScope(plan(paths)), JAPAN_STABILITY_CODE_SCOPE);
    assert.equal(japanBrandDirectoryRequired(plan(paths)), false);
  }
  assert.equal(japanBrandDirectoryRequired({codeScope: 'catalog-japan-pagination24-v1'}), false);
  const python = spawnSync('python3', ['-I', '-B', '-c',
    "import importlib.util,json; s=importlib.util.spec_from_file_location('h','scripts/catalog-next/release-host.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps(sorted(m.JAPAN_STABILITY_RAILS_CODE_FILES)))"], {encoding: 'utf8'});
  assert.equal(python.status, 0, python.stderr);
  assert.deepEqual(JSON.parse(python.stdout), [...JAPAN_STABILITY_RAILS_CODE_PATHS]);
});

test('the complete UI profile cannot omit either rail, alter pricing, duplicate a file or change its retained runtime', () => {
  const original = plan();
  const invalid = [
    ...original.runtimeFiles.map(file => ({...original, runtimeFiles: original.runtimeFiles.filter(name => name !== file)})),
    {...original, runtimeFiles: [...original.runtimeFiles, 'packages/engine/src/index.ts']},
    {...original, runtimeFiles: [...original.runtimeFiles, original.runtimeFiles[0]]},
    {...original, retainedRuntime: '0'.repeat(40)},
  ];
  for (const candidate of invalid) {
    assert.equal(isExactJapanStabilityScope(candidate), false);
    assert.throws(() => checkedCatalogCodeScope(candidate));
    assert.throws(() => japanBrandDirectoryRequired(candidate), /brand_directory_scope/);
  }
});

test('visible brand preservation and retry require every real browser case on both widths', () => {
  const valid = fixture([...sourceCases, ...fallbackCases]);
  assert.equal(checkedJapanFilterDirectoryFixture(valid, {requireSourceNames: true, requireVisibleFallback: true}).cases.length, 18);
  for (const older of [fixture(sourceCases.slice(0, 4)), fixture(sourceCases)]) {
    assert.equal(checkedJapanFilterDirectoryFixture(older).passed, true);
    assert.throws(() => checkedJapanFilterDirectoryFixture(older, {requireVisibleFallback: true}), /visible_fallback_required/);
  }
  for (let index = 0; index < valid.cases.length; index++) {
    const missing = structuredClone(valid); missing.cases.splice(index, 1);
    assert.throws(() => checkedJapanFilterDirectoryFixture(missing, {requireVisibleFallback: true}), /fixture/);
    const failed = structuredClone(valid); failed.cases[index].passed = false;
    assert.throws(() => checkedJapanFilterDirectoryFixture(failed, {requireVisibleFallback: true}), /cases/);
  }
  const duplicate = structuredClone(valid); duplicate.cases[17] = duplicate.cases[0];
  assert.throws(() => checkedJapanFilterDirectoryFixture(duplicate, {requireVisibleFallback: true}), /cases/);
});

test('literal Audi family coverage is a distinct mandatory twenty-case gate', () => {
  const name = 'audi-family-stale-failed-retry-and-explicit-make';
  const legacy = fixture([...sourceCases, ...fallbackCases]);
  const valid = fixture([...sourceCases, ...fallbackCases, name]);
  assert.equal(checkedJapanFilterDirectoryFixture(valid, {requireSourceNames: true,
    requireVisibleFallback: true, requireLiteralFamily: true}).cases.length, 20);
  assert.throws(() => checkedJapanFilterDirectoryFixture(legacy, {requireLiteralFamily: true}), /literal_family_required/);
  for (let index = 0; index < valid.cases.length; index++) {
    const missing = structuredClone(valid); missing.cases.splice(index, 1);
    assert.throws(() => checkedJapanFilterDirectoryFixture(missing, {requireLiteralFamily: true}), /fixture/);
    const wrong = structuredClone(valid); wrong.cases[index].name = 'normalized-audi-family';
    assert.throws(() => checkedJapanFilterDirectoryFixture(wrong, {requireLiteralFamily: true}), /cases/);
    const failed = structuredClone(valid); failed.cases[index].passed = false;
    assert.throws(() => checkedJapanFilterDirectoryFixture(failed, {requireLiteralFamily: true}), /cases/);
  }
  const duplicate = structuredClone(valid); duplicate.cases[19] = duplicate.cases[9];
  assert.throws(() => checkedJapanFilterDirectoryFixture(duplicate, {requireLiteralFamily: true}), /cases/);
});

test('both workflows require visible fallback proof from the exact selected source before building', async () => {
  for (const filename of ['verify-china-photo-code.yml', 'catalog-next-china-photo-release.yml']) {
    const workflow = await fs.readFile('.github/workflows/' + filename, 'utf8');
    const step = workflow.split('\n      - name: ').find(value => value.startsWith('Verify Japan supplier-only brand and model controls'));
    assert(step.includes('requireVisibleFallback: japanBrandDirectoryRequired(plan)'));
    assert(step.includes('cd "$RUNNER_TEMP/china-serving-runtime-$STABILITY_SHA"'));
    assert(!step.includes('continue-on-error') && !step.includes('|| true'));
  }
});
