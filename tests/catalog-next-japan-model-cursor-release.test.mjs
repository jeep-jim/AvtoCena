import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as scope from '../scripts/catalog-next/japan-stability-code-scope.mjs';
import {checkedCatalogCodeScope} from '../scripts/catalog-next/photo-code-scope.mjs';
import {sourceCountReport, a4Power160ContinuationReport} from './helpers/japan-source-count-report-fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const plan = () => ({codeScope: scope.JAPAN_STABILITY_CODE_SCOPE,
  retainedRuntime: scope.JAPAN_STABILITY_MODEL_CURSOR_RETAINED_RUNTIME,
  runtimeFiles: [...scope.JAPAN_STABILITY_MODEL_CURSOR_CODE_PATHS],
  acceptancePolicy: scope.JAPAN_OBSERVED_TIMING_POLICY, countAcceptance: scope.JAPAN_SOURCE_COUNT_POLICY});

function rejectedReports() {
  const changes = [
    value => { delete value.japanA4Power160ContinuationRequired; },
    value => { value.japanA4Power160ContinuationPassed = false; },
    value => { value.japanSourceCountPassed = false; },
    value => { delete value.checks.a4Power160Continuation; },
    value => { value.checks.a4Power160Continuation.contract = 'unreviewed'; },
    value => { value.checks.a4Power160Continuation.selection.make = 'AUDI'; },
    value => { value.checks.a4Power160Continuation.selection.powerTo = 161; },
    value => { value.checks.a4Power160Continuation.selection.city = 'Москва'; },
    value => { value.checks.a4Power160Continuation.toggledThroughUi = false; },
    value => { value.checks.a4Power160Continuation.firstPageNavigation.sameFilter = false; },
    value => { value.checks.a4Power160Continuation.attempts.pop(); },
    value => { value.checks.a4Power160Continuation.attempts.reverse(); },
    value => { value.checks.a4Power160Continuation.ordinaryAppendRequests = 3; },
    value => { value.checks.a4Power160Continuation.explicitApiReads = 2; },
    value => { value.checks.a4Power160Continuation.fullSelectionExhaustionClaimed = true; },
    value => { value.checks.a4Power160Continuation.liveExhaustiveScan = true; },
    value => { value.checks.a4Power160Continuation.pageErrors = 1; },
  ];
  for (const [key, invalid] of [['status', 409], ['sameFilter', false], ['continuationCursor', 'changed'],
    ['cursor', 'j1.2.0.2.' + '4'.repeat(64) + '.-'], ['loadedBefore', 0], ['added', 25], ['loadedAfter', 6],
    ['duplicateIds', 1], ['oldIdsPreserved', false], ['orderPreserved', false], ['knownBeforeUnknown', false],
    ['beforeIdsSha256', ''], ['addedIdsSha256', ''], ['afterIdsSha256', '']])
    changes.push(value => { value.checks.a4Power160Continuation.attempts[1][key] = invalid; });
  for (const [key, invalid] of [['status', 503], ['shown', 7], ['stale', true], ['interrupted', true],
    ['partial', undefined], ['scanLimited', undefined], ['selectionIncomplete', undefined], ['hasMore', false],
    ['sourcePages', 9], ['sourcePages', true], ['receiptsSha256', ''], ['sourceReceiptsFresh', false],
    ['total', 592], ['total', undefined], ['selectionCompletenessClaimed', true],
    ['observedAt', '2026-11-28T12:00:00.001Z'], ['observedAt', '2026-11-28T11:30:00.000Z']])
    changes.push(value => { value.checks.a4Power160Continuation.attempts[0].nextPage[key] = invalid; });
  for (const [key, invalid] of [['kind', 'independent-api'], ['status', 409], ['shown', 24], ['page', 2],
    ['afterSha256', '0'.repeat(64)], ['ssrBindingMatched', false], ['sourcePages', 9], ['sourceReceiptsFresh', false],
    ['partial', false], ['scanLimited', true], ['selectionIncomplete', false], ['interrupted', false],
    ['hasMore', false], ['total', 592]])
    changes.push(value => { value.checks.a4Power160Continuation.attempts[0].firstPage[key] = invalid; });
  changes.push(value => { value.checks.a4Power160Continuation.attempts[1].firstPage.status = null; });
  return changes.map(change => { const value = a4Power160ContinuationReport(); change(value); return value; });
}

test('literal-model successor is exactly five paths and retains the accepted source-count runtime', () => {
  const value = plan();
  assert.deepEqual(value.runtimeFiles, ['apps/web/lib/catalog/ajes-model-resolution.ts',
    'tests/ajes-count-display.test.ts',
    'tests/ajes-model-cursor-continuity.test.ts', 'tests/ajes-model-recovery.test.ts',
    'tests/japan-model-directory-metadata.test.ts']);
  assert.equal(scope.isExactJapanStabilityScope(value), true);
  assert.equal(checkedCatalogCodeScope(value), scope.JAPAN_STABILITY_CODE_SCOPE);
  for (const required of ['japanObservedTimingRequired', 'japanPowerOrderRequired', 'japanBrandDirectoryRequired',
    'japanPriceSortRequired', 'japanLiteralFamilyRequired', 'japanSourceNamesRequired',
    'japanSourceCountRequired', 'japanA4Power160ContinuationRequired']) assert.equal(scope[required](value), true, required);
  assert.equal(scope.japanExactCountRequired(value), false);
  assert.deepEqual(scope.japanStabilityCompatibilityPaths(value), [...new Set([
    ...scope.JAPAN_STABILITY_METADATA_CODE_PATHS, ...scope.JAPAN_STABILITY_PRICE_SORT_CODE_PATHS,
    ...scope.JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS, ...scope.JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS,
    ...value.runtimeFiles])].sort());
  const historical = {...value, retainedRuntime: scope.JAPAN_STABILITY_SOURCE_COUNT_RETAINED_RUNTIME,
    runtimeFiles: [...scope.JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS]};
  assert.equal(historical.runtimeFiles.length, 18);
  assert.equal(scope.isExactJapanStabilityScope(historical), true);
  assert.equal(scope.japanSourceCountRequired(historical), true);
  assert.equal(scope.japanA4Power160ContinuationRequired(historical), false);
  for (const invalid of [
    {...value, retainedRuntime: historical.retainedRuntime}, {...historical, retainedRuntime: value.retainedRuntime},
    {...value, runtimeFiles: value.runtimeFiles.slice(0, 4)},
    {...value, runtimeFiles: value.runtimeFiles.filter(file => file !== 'tests/ajes-count-display.test.ts')},
    {...value, runtimeFiles: [...value.runtimeFiles, 'apps/web/lib/catalog/ajes-query.ts']},
    {...value, runtimeFiles: [...value.runtimeFiles, value.runtimeFiles[0]]},
    {...value, acceptancePolicy: undefined}, {...value, countAcceptance: undefined},
    {...value, countAcceptance: scope.JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY},
  ]) assert.equal(scope.isExactJapanStabilityScope(invalid), false);
});

test('two filtered ordinary appends may be partial but must preserve selection, cards and fresh bounded evidence', () => {
  const partial = a4Power160ContinuationReport();
  assert.equal(scope.japanA4Power160ContinuationAcceptancePassed(partial), true);
  const renderedTwelve = a4Power160ContinuationReport(), appended = renderedTwelve.checks.a4Power160Continuation.attempts[0];
  appended.added = 24; appended.loadedAfter = 36;
  Object.assign(appended.nextPage, {shown: 24, partial: false, scanLimited: false, selectionIncomplete: false});
  assert.equal(scope.japanA4Power160ContinuationAcceptancePassed(renderedTwelve), true,
    'twelve rendered rows can be followed by twenty-four actual appended rows');
  const full = a4Power160ContinuationReport();
  for (const attempt of full.checks.a4Power160Continuation.attempts) {
    Object.assign(attempt.nextPage, {partial: false, scanLimited: false, selectionIncomplete: false, sourcePages: 1});
    attempt.nextPage.hasMore = false;
  }
  assert.equal(scope.japanA4Power160ContinuationAcceptancePassed(full), true);
  assert.equal(scope.japanSourceCountAcceptancePassed(sourceCountReport()), true, 'historical source proof stays valid');
  assert.equal(scope.japanA4Power160ContinuationAcceptancePassed(sourceCountReport()), false, 'it cannot substitute for the new journey');
  for (const report of rejectedReports()) assert.equal(scope.japanA4Power160ContinuationAcceptancePassed(report), false);
});

test('Python host and JS agree on the five-path profile and filtered continuation evidence', () => {
  const reports = [sourceCountReport(), a4Power160ContinuationReport(), ...rejectedReports()];
  const result = spawnSync('python3', ['-B', '-c', `
import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('release_host','scripts/catalog-next/release-host.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
profile=m.JAPAN_STABILITY_MODEL_CURSOR_CODE_FILES
assert m.checked_japan_stability_image_files(sorted(profile),True,m.JAPAN_STABILITY_MODEL_CURSOR_RETAINED,m.JAPAN_SOURCE_COUNT_POLICY)==profile
for files,retained in [(profile,m.JAPAN_STABILITY_SOURCE_COUNT_RETAINED),(m.JAPAN_STABILITY_SOURCE_COUNT_CODE_FILES,m.JAPAN_STABILITY_MODEL_CURSOR_RETAINED),
 (profile-{'tests/japan-model-directory-metadata.test.ts'},m.JAPAN_STABILITY_MODEL_CURSOR_RETAINED),
 (profile-{'tests/ajes-count-display.test.ts'},m.JAPAN_STABILITY_MODEL_CURSOR_RETAINED),
 (profile|{'apps/web/lib/catalog/ajes-query.ts'},m.JAPAN_STABILITY_MODEL_CURSOR_RETAINED)]:
 try:m.checked_japan_stability_image_files(sorted(files),True,retained,m.JAPAN_SOURCE_COUNT_POLICY)
 except Exception:pass
 else:raise AssertionError('invalid model cursor profile accepted')
print(json.dumps({'files':sorted(profile),'results':[m.japan_a4_power160_continuation_acceptance_passed(row) for row in json.load(sys.stdin)]}))
`], {cwd: root, input: JSON.stringify(reports), encoding: 'utf8', maxBuffer: 2 * 1024 * 1024});
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.files, [...plan().runtimeFiles].sort());
  assert.deepEqual(output.results, reports.map(scope.japanA4Power160ContinuationAcceptancePassed));
});

test('all publication workflows bind the new required gate to the exact runtime fixture', () => {
  for (const name of ['verify-japan-exact-count-candidate', 'verify-china-photo-code', 'catalog-next-china-photo-release']) {
    const workflow = readFileSync(new URL('../.github/workflows/' + name + '.yml', import.meta.url), 'utf8');
    assert.match(workflow, /a4_power160_continuation_required=' \+ japanA4Power160ContinuationRequired\(plan\)/);
    assert.match(workflow, /CATALOG_JAPAN_A4_POWER160_CONTINUATION_REQUIRED: \$\{\{ steps\.photo_scope\.outputs\.a4_power160_continuation_required/);
    assert.match(workflow, /if \(japanA4Power160ContinuationRequired\(plan\)\) checkedJapanA4Power160ContinuationBrowserFixture\(report,/);
    assert.match(workflow, /helperSha256:createHash\('sha256'\)\.update\(fs\.readFileSync\('scripts\/catalog-next\/japan-source-count-browser\.mjs'\)\)/);
  }
});
