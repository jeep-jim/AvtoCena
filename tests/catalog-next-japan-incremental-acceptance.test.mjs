import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as scope from '../scripts/catalog-next/japan-stability-code-scope.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const strictPlan = () => ({codeScope: scope.JAPAN_STABILITY_CODE_SCOPE,
  retainedRuntime: scope.JAPAN_STABILITY_EXACT_COUNT_RETAINED_RUNTIME,
  runtimeFiles: [...scope.JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS],
  acceptancePolicy: scope.JAPAN_OBSERVED_TIMING_POLICY});
const incrementalPlan = () => ({...strictPlan(), countAcceptance: scope.JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY});
const coverageReport = (sourcePairs = 94) => ({
  countAcceptance: scope.JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY,
  japanModelCoverageRequired: true, japanModelCoveragePassed: true,
  japanExactCountRequired: false, japanExactCountPassed: null,
  checks: {modelCoverage: {sourcePairs, accessiblePairs: sourcePairs,
    allSourceModelsAccessible: true, noForeignModels: true, sourceMatchesUi: true,
    typedBase: 'A4', typedFamilyNotNarrowed: true, pairsSha256: 'a'.repeat(64),
    modelExpansions: Math.ceil(sourcePairs / 60) - 1, sourceFamilyModels: 1, make: 'AUDI',
    directory: {status: 200, stale: false, sourcePairs, pairsSha256: 'a'.repeat(64)},
    selection: {shown: 24, observedSourceNamesOnly: true},
    countHonest: true, fullPage: true, explicitApiReads: 3, liveExhaustiveScan: false, pageErrors: 0}},
});

function rejectedReports() {
  const result = [];
  for (const key of ['countAcceptance', 'japanModelCoverageRequired', 'japanModelCoveragePassed',
    'japanExactCountRequired', 'japanExactCountPassed', 'checks']) {
    const value = coverageReport(); delete value[key]; result.push(value);
  }
  for (const [key, value] of [['countAcceptance', 'other'], ['japanModelCoverageRequired', false],
    ['japanModelCoveragePassed', false], ['japanExactCountRequired', true], ['japanExactCountPassed', true],
    ['japanExactCountPassed', false], ['checks', null], ['checks', []]])
    result.push({...coverageReport(), [key]: value});
  for (const [key, value] of [
    ['sourcePairs', 0], ['sourcePairs', 94.5], ['sourcePairs', Number.MAX_SAFE_INTEGER + 1],
    ['accessiblePairs', 93], ['allSourceModelsAccessible', false], ['noForeignModels', false],
    ['sourceMatchesUi', false], ['typedFamilyNotNarrowed', false], ['typedBase', 'A5'], ['make', 'BMW'],
    ['pairsSha256', 'invalid'], ['modelExpansions', 0], ['modelExpansions', 2], ['modelExpansions', -1],
    ['sourceFamilyModels', 0], ['sourceFamilyModels', 95], ['countHonest', false], ['fullPage', false],
    ['explicitApiReads', 4], ['liveExhaustiveScan', true], ['pageErrors', 1],
    ['directory', null], ['selection', null],
  ]) {
    const report = coverageReport(); report.checks.modelCoverage[key] = value; result.push(report);
  }
  for (const [section, key, value] of [
    ['directory', 'status', 503], ['directory', 'stale', true], ['directory', 'sourcePairs', 93],
    ['directory', 'pairsSha256', 'b'.repeat(64)], ['selection', 'shown', 0], ['selection', 'shown', 25],
    ['selection', 'observedSourceNamesOnly', false],
  ]) {
    const report = coverageReport(); report.checks.modelCoverage[section][key] = value; result.push(report);
  }
  const small = coverageReport(1); small.checks.modelCoverage.directory.sourcePairs = true; result.push(small);
  const inventedExpansion = coverageReport(60); inventedExpansion.checks.modelCoverage.modelExpansions = 1;
  result.push(inventedExpansion);
  return result;
}

test('the explicit incremental profile preserves the exact reviewed delta and every existing functional requirement', () => {
  const strict = strictPlan(), incremental = incrementalPlan();
  assert.equal(strict.runtimeFiles.length, 46);
  assert.deepEqual(incremental.runtimeFiles, strict.runtimeFiles);
  assert.equal(incremental.retainedRuntime, strict.retainedRuntime);
  for (const plan of [strict, incremental]) {
    for (const check of [scope.isExactJapanStabilityScope, scope.japanObservedTimingRequired,
      scope.japanPowerOrderRequired, scope.japanBrandDirectoryRequired, scope.japanPriceSortRequired,
      scope.japanSourceNamesRequired, scope.japanLiteralFamilyRequired]) assert.equal(check(plan), true);
    assert.deepEqual(scope.japanStabilityCompatibilityPaths(plan), scope.japanStabilityCompatibilityPaths(strict));
  }
  assert.equal(scope.japanExactCountRequired(strict), true);
  assert.equal(scope.japanSourceBoundedIncrementalRequired(strict), false);
  assert.equal(scope.japanExactCountRequired(incremental), false);
  assert.equal(scope.japanSourceBoundedIncrementalRequired(incremental), true);
  assert.equal(scope.japanExactCountRequired({...incremental, countAcceptance: undefined}), true,
    'removing the explicit policy must restore strict census acceptance');
});

test('the incremental marker cannot authorize a different profile, predecessor, timing policy, or file set', () => {
  for (const countAcceptance of [null, false, true, '', 'japan-exact-count-v1', {}, []])
    assert.equal(scope.isExactJapanStabilityScope({...strictPlan(), countAcceptance}), false);
  for (const runtimeFiles of [
    scope.JAPAN_STABILITY_CODE_PATHS, scope.JAPAN_STABILITY_UI_CODE_PATHS, scope.JAPAN_STABILITY_POWER_CODE_PATHS,
    scope.JAPAN_STABILITY_RAILS_CODE_PATHS, scope.JAPAN_STABILITY_HOME_CODE_PATHS, scope.JAPAN_STABILITY_METADATA_CODE_PATHS,
    scope.JAPAN_STABILITY_PRICE_SORT_CODE_PATHS,
  ]) {
    const plan = {...incrementalPlan(), runtimeFiles: [...runtimeFiles], retainedRuntime:
      runtimeFiles === scope.JAPAN_STABILITY_PRICE_SORT_CODE_PATHS
        ? scope.JAPAN_STABILITY_PRICE_SORT_RETAINED_RUNTIME : scope.JAPAN_STABILITY_RETAINED_RUNTIME};
    assert.equal(scope.isExactJapanStabilityScope(plan), false);
    assert.throws(() => scope.japanSourceBoundedIncrementalRequired(plan));
  }
  for (const bad of [
    {...incrementalPlan(), codeScope: 'catalog-photo-recovery-v1'},
    {...incrementalPlan(), retainedRuntime: scope.JAPAN_STABILITY_PRICE_SORT_RETAINED_RUNTIME},
    {...incrementalPlan(), acceptancePolicy: undefined},
    {...incrementalPlan(), runtimeFiles: [...strictPlan().runtimeFiles, 'packages/engine/src/calculation/russiaCustomsV2.ts']},
    {...incrementalPlan(), runtimeFiles: [...strictPlan().runtimeFiles, strictPlan().runtimeFiles[0]]},
    ...strictPlan().runtimeFiles.map(file => ({...incrementalPlan(), runtimeFiles: strictPlan().runtimeFiles.filter(name => name !== file)})),
  ]) assert.equal(scope.isExactJapanStabilityScope(bad), false);
});

test('coverage-only acceptance requires actual source/UI and literal-family evidence and an honest incomplete census status', () => {
  for (const sourcePairs of [1, 59, 60, 61, 94, 121])
    assert.equal(scope.japanSourceBoundedAcceptancePassed(coverageReport(sourcePairs)), true);
  for (const report of rejectedReports()) assert.equal(scope.japanSourceBoundedAcceptancePassed(report), false);
  assert.equal(scope.japanSourceBoundedAcceptancePassed({
    ...coverageReport(), countAcceptance: undefined, japanExactCountRequired: true, japanExactCountPassed: true,
  }), false, 'a strict exact-count result cannot be relabeled as coverage-only evidence');
});

test('Python host admission and evidence validation use the same incremental contract while retaining strict historical profiles', () => {
  const accepted = [1, 59, 60, 61, 94, 121].map(coverageReport), rejected = rejectedReports();
  const result = spawnSync('python3', ['-I', '-B', '-c', String.raw`
import importlib.util,json,sys
s=importlib.util.spec_from_file_location('host','scripts/catalog-next/release-host.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
inputs=json.load(sys.stdin)
exact=m.JAPAN_STABILITY_EXACT_COUNT_CODE_FILES
assert m.checked_japan_stability_image_files(sorted(exact),True,m.JAPAN_STABILITY_EXACT_COUNT_RETAINED)==exact
assert m.checked_japan_stability_image_files(sorted(exact),True,m.JAPAN_STABILITY_EXACT_COUNT_RETAINED,
    m.JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY)==exact
old=m.JAPAN_STABILITY_PRICE_SORT_CODE_FILES
assert m.checked_japan_stability_image_files(sorted(old),True,m.JAPAN_STABILITY_PRICE_SORT_RETAINED)==old
for files,observed,retained,policy in [
    (old,True,m.JAPAN_STABILITY_PRICE_SORT_RETAINED,m.JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY),
    (exact,False,m.JAPAN_STABILITY_EXACT_COUNT_RETAINED,m.JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY),
    (exact,True,m.JAPAN_STABILITY_PRICE_SORT_RETAINED,m.JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY),
    *[(exact,True,m.JAPAN_STABILITY_EXACT_COUNT_RETAINED,value) for value in ['',False,{},[],'unknown']],
]:
    try:m.checked_japan_stability_image_files(sorted(files),observed,retained,policy)
    except m.ReleaseError:pass
    else:raise AssertionError('invalid incremental image accepted')
base={'mode':'code-update','codeScope':m.JAPAN_STABILITY_CODE_SCOPE,
      'retainedRuntime':m.JAPAN_STABILITY_EXACT_COUNT_RETAINED,
      'acceptancePolicy':m.JAPAN_OBSERVED_TIMING_POLICY,'countAcceptance':m.JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY}
for change in [*({'countAcceptance':value} for value in [None,False,'',{},[],'unknown']),
               {'mode':'generation-update'}, {'codeScope':m.PHOTO_CODE_SCOPE},
               {'retainedRuntime':m.JAPAN_STABILITY_PRICE_SORT_RETAINED}, {'acceptancePolicy':None}]:
    try:m.validate_plan({**base,**change})
    except m.ReleaseError as error:
        assert str(error) in ('china_host_count_acceptance_scope','china_host_timing_policy_scope'),str(error)
    else:raise AssertionError('invalid incremental plan accepted')
results=[m.japan_source_bounded_acceptance_passed(report) for report in inputs]
assert all(type(value) is bool for value in results)
print(json.dumps(results))
`], {cwd: root, input: JSON.stringify([...accepted, ...rejected]), encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [...accepted.map(() => true), ...rejected.map(() => false)]);
});
