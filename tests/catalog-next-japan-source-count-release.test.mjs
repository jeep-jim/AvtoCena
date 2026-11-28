import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as scope from '../scripts/catalog-next/japan-stability-code-scope.mjs';
import {checkedCatalogCodeScope} from '../scripts/catalog-next/photo-code-scope.mjs';
import {sourceCountReport} from './helpers/japan-source-count-report-fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const plan = () => ({codeScope: scope.JAPAN_STABILITY_CODE_SCOPE,
  retainedRuntime: scope.JAPAN_STABILITY_SOURCE_COUNT_RETAINED_RUNTIME,
  runtimeFiles: [...scope.JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS],
  acceptancePolicy: scope.JAPAN_OBSERVED_TIMING_POLICY, countAcceptance: scope.JAPAN_SOURCE_COUNT_POLICY});

function rejectedReports() {
  const changes = [
    value => { delete value.countAcceptance; },
    value => { value.countAcceptance = scope.JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY; },
    value => { value.japanExactCountRequired = true; },
    value => { value.japanExactCountPassed = true; },
    value => { value.japanSourceCountRequired = false; },
    value => { value.japanSourceCountPassed = false; },
    value => { value.japanModelCoveragePassed = false; },
    value => { value.checks.modelCoverage.accessiblePairs--; },
    value => { value.checks.modelCoverage.directory.browserMatchesApi = false; },
    value => { value.checks.modelCoverage.cardProvenanceSha256 = ''; },
    value => { delete value.checks.sourceCount; },
    value => { value.checkedAt = 'invalid'; },
    value => {
      const proof = value.checks.sourceCount;
      proof.summary.total = proof.summary.sourceCountProof.sourceTotal = proof.ui.sourceTotal = 23;
      proof.ui.label = 'Найдено до 23';
    },
  ];
  for (const [key, invalid] of [['contract', 'unreviewed'], ['summary', null], ['queryHashVerified', false],
    ['independentCount', false], ['admittedTotal', 1234], ['positiveAdmittedCensusClaimed', true],
    ['ui', null], ['pagination', null], ['liveExhaustiveScan', true], ['pageErrors', 1]])
    changes.push(value => { value.checks.sourceCount[key] = invalid; });
  for (const [key, invalid] of [['total', 0], ['total', 1.5], ['total', Number.MAX_SAFE_INTEGER + 1], ['stale', true],
    ['upperBound', false], ['precision', 'exact'], ['selectionScope', 'all-admitted'], ['sourceScopeComplete', null],
    ['observedAt', '2026-11-28T12:01:00.000Z'], ['observedAt', '2026-11-28T11:30:00.000Z'],
    ['countProof', {kind: 'japan-admitted-census'}], ['knownTotal', 1234], ['unknownTotal', 0]])
    changes.push(value => { value.checks.sourceCount.summary[key] = invalid; });
  for (const [key, invalid] of [['version', true], ['kind', 'quota-counter'], ['predicateVersion', 'unreviewed'],
    ['requestedQueryHash', 'wrong'], ['sourceQueryHash', 'wrong'], ['evidenceEpoch', 'wrong'], ['sourceTotal', 1235],
    ['sourceObservedAt', '2026-11-28T11:59:01.000Z'], ['sourceScopeComplete', false], ['directoryComplete', false]])
    changes.push(value => { value.checks.sourceCount.summary.sourceCountProof[key] = invalid; });
  for (const [key, invalid] of [['status', 'exact'], ['sourceTotal', 1235], ['requestedQueryHash', '9'.repeat(64)],
    ['observedAt', '2026-11-28T11:59:01.000Z'], ['loadedCount', 0], ['loadedCount', 25],
    ['label', 'Найдено 1 234'], ['label', 'Найдено до 24'], ['label', 'Количество уточняется']])
    changes.push(value => { value.checks.sourceCount.ui[key] = invalid; });
  for (const [key, invalid] of [['sameFilter', false], ['cursorBeforeCount', 'opaque'], ['cursorAfterCount', 'different'],
    ['continuationCursor', 'different'], ['continuationFollowed', false], ['loadedBefore', 23], ['loadedAfter', 24],
    ['loadedAfter', 49], ['duplicateIds', 1], ['freshSourcePages', false]])
    changes.push(value => { value.checks.sourceCount.pagination[key] = invalid; });
  return changes.map(change => { const value = sourceCountReport(); change(value); return value; });
}

test('source-count successor requires its exact delta, accepted7f predecessor and distinct policy', () => {
  const value = plan();
  assert(value.runtimeFiles.length > 0, 'reviewed runtime delta must be frozen before publication');
  assert.equal(scope.isExactJapanStabilityScope(value), true);
  assert.equal(checkedCatalogCodeScope(value), scope.JAPAN_STABILITY_CODE_SCOPE);
  assert.equal(scope.japanSourceCountRequired(value), true);
  assert.equal(scope.japanCountAcceptance(value), scope.JAPAN_SOURCE_COUNT_POLICY);
  for (const required of ['japanObservedTimingRequired', 'japanPowerOrderRequired', 'japanBrandDirectoryRequired',
    'japanPriceSortRequired', 'japanLiteralFamilyRequired', 'japanSourceNamesRequired']) assert.equal(scope[required](value), true, required);
  assert.equal(scope.japanExactCountRequired(value), false);
  assert.equal(scope.japanSourceBoundedIncrementalRequired(value), false);
  assert.deepEqual(scope.japanStabilityCompatibilityPaths(value), [...new Set([
    ...scope.JAPAN_STABILITY_METADATA_CODE_PATHS, ...scope.JAPAN_STABILITY_PRICE_SORT_CODE_PATHS,
    ...scope.JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS, ...value.runtimeFiles])].sort());
  for (const bad of [
    {...value, runtimeFiles: value.runtimeFiles.slice(1)},
    {...value, runtimeFiles: [...value.runtimeFiles, 'packages/engine/src/index.ts']},
    {...value, runtimeFiles: [...value.runtimeFiles, value.runtimeFiles[0]]},
    {...value, retainedRuntime: scope.JAPAN_STABILITY_EXACT_COUNT_RETAINED_RUNTIME},
    {...value, acceptancePolicy: undefined}, {...value, acceptancePolicy: 'speed-must-be-faster'},
    {...value, countAcceptance: undefined}, {...value, countAcceptance: scope.JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY},
    {...value, runtimeFiles: [...scope.JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS]},
  ]) assert.equal(scope.isExactJapanStabilityScope(bad), false);
});

test('positive source acceptance preserves labels, model provenance and actual fresh continuation', () => {
  for (const complete of [true, false]) assert.equal(scope.japanSourceCountAcceptancePassed(sourceCountReport(undefined, complete)), true);
  const power = sourceCountReport(), p = power.checks.sourceCount.pagination;
  p.cursorBeforeCount = p.cursorAfterCount = p.continuationCursor = 'j2.k.2.0.2.' + '4'.repeat(64) + '.' + '5'.repeat(64) + '.-';
  assert.equal(scope.japanSourceCountAcceptancePassed(power), true);
  for (const report of rejectedReports()) assert.equal(scope.japanSourceCountAcceptancePassed(report), false, JSON.stringify(report));
  assert.equal(scope.japanSourceBoundedAcceptancePassed(sourceCountReport()), false, 'new source counts cannot relabel old incomplete-count proof');
});

test('Python host and JS validators agree for the successor profile and malformed source evidence', () => {
  const reports = [sourceCountReport(), sourceCountReport(undefined, false), ...rejectedReports()];
  const result = spawnSync('python3', ['-B', '-c', `
import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('release_host','scripts/catalog-next/release-host.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
profile=m.JAPAN_STABILITY_SOURCE_COUNT_CODE_FILES
assert profile
assert m.checked_japan_stability_image_files(sorted(profile),True,m.JAPAN_STABILITY_SOURCE_COUNT_RETAINED,m.JAPAN_SOURCE_COUNT_POLICY)==profile
for files,observed,retained,policy in [
 (profile,False,m.JAPAN_STABILITY_SOURCE_COUNT_RETAINED,m.JAPAN_SOURCE_COUNT_POLICY),
 (profile,True,m.JAPAN_STABILITY_EXACT_COUNT_RETAINED,m.JAPAN_SOURCE_COUNT_POLICY),
 (profile,True,m.JAPAN_STABILITY_SOURCE_COUNT_RETAINED,None),
 (profile,True,m.JAPAN_STABILITY_SOURCE_COUNT_RETAINED,m.JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY),
 (m.JAPAN_STABILITY_EXACT_COUNT_CODE_FILES,True,m.JAPAN_STABILITY_SOURCE_COUNT_RETAINED,m.JAPAN_SOURCE_COUNT_POLICY),
 (profile|{'packages/engine/src/index.ts'},True,m.JAPAN_STABILITY_SOURCE_COUNT_RETAINED,m.JAPAN_SOURCE_COUNT_POLICY)]:
 try:m.checked_japan_stability_image_files(sorted(files),observed,retained,policy)
 except Exception:pass
 else:raise AssertionError('invalid successor accepted')
print(json.dumps({'files':sorted(profile),'results':[m.japan_source_count_acceptance_passed(row) for row in json.load(sys.stdin)]}))
`], {cwd: root, input: JSON.stringify(reports), encoding: 'utf8', maxBuffer: 2 * 1024 * 1024});
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.files, [...plan().runtimeFiles].sort());
  assert.deepEqual(output.results, reports.map(scope.japanSourceCountAcceptancePassed));
});
