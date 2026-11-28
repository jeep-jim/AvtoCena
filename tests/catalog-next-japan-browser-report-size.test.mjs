import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sourcePriceOrderReport} from './helpers/japan-source-price-order-report-fixture.mjs';
import {serializeJapanBrowserReport, recordJapanResponse, japanSsrPageReadEvidence,
  collectJapanObservedTimings} from '../scripts/catalog-next/japan-browser-acceptance.mjs';
import {japanSourceSelectionAcceptancePassed, japanSourceCountAcceptancePassed,
  japanA4Power160ContinuationAcceptancePassed, JAPAN_OBSERVED_TIMING_POLICY}
  from '../scripts/catalog-next/japan-stability-code-scope.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const checkedAt = '2026-11-28T12:00:00.000Z', observedAt = '2026-11-28T11:59:00.000Z';
const release = 'c'.repeat(40), manifest = 'd'.repeat(64), nonce = 'e'.repeat(32);
const pageReceipts = (stage, kind = 'list') => Array.from({length: kind === 'list' ? 8 : 1}, (_, index) => ({
  version: 1, requestId: '12345678-1234-4234-8234-' + String(index + 1).padStart(12, '0'),
  queryHash: hash(stage), table: 'stats', kind, page: index + 1, pageSize: kind === 'list' ? 24 : 500,
  startedAt: observedAt, finishedAt: observedAt, stage: 'storage', supplierAttempted: false,
  outcome: 'fresh', observedAt,
}));
const ssr = stage => japanSsrPageReadEvidence(JSON.stringify({version: 1, page: 1,
  afterSha256: hash(''), receipts: pageReceipts(stage), omitted: 0}), {page: 1, after: ''});
const readiness = (stage, shown = 24) => ({checkedAt, dom: {status: 'recorded', roots: 1, shown,
  inspected: shown, selectedSort: null, power160Checked: true, loadedCount: shown,
  countStatus: shown ? 'source' : 'partial', knownPowerCards: shown, unknownPowerCards: 0,
  auctionPriceCards: shown, incompleteNotice: shown === 0, alerts: 0,
  continuation: {controls: 1, sameOrigin: true, sort: null, page: 2, cursorPresent: true,
    cursorVersion: 'j2', powerPhase: 'k', sourcePage: 9, withinPageSkip: 0}}, sourceReadEvidence: ssr(stage)});

/** A full synthetic source-selection journey, not evidence about production.
 * Every ordinary LIST observation uses the permitted eight-page receipt bound.
 * Keep the producer's completed progress copies, readiness and row diagnostics
 * so that the size regression covers the report that is actually serialized. */
function fullProfile({crossoverFailure = false} = {}) {
  const report = sourcePriceOrderReport(checkedAt);
  Object.assign(report, {version: 1, kind: 'catalog-japan-browser-v1', codeScope: 'catalog-japan-stability-v1',
    release, nonce, generationManifestSha256: manifest, oracleSha256: hash('oracle'), passed: !crossoverFailure,
    productionMutations: 0, directSupplierApiRequests: 0, supplierImageRequests: 48, explicitJapanApiRequests: 20,
    japanPreviewCalculationRequests: 1, japanCrossoverPower160Required: true,
    japanCrossoverPower160Passed: !crossoverFailure, timingPolicy: JAPAN_OBSERVED_TIMING_POLICY});
  for (const flag of ['japanFreshnessPassed', 'japanPowerApiPassed', 'japanUiPassed', 'japanVisibilityPassed',
    'readOnlyBrowserFence', 'japanPetrolPowerUiPassed', 'japanDetailPowerInputPassed', 'japanDeliveredCalculationPassed',
    'japanFullPagesPassed', 'japanPagination24Passed', 'japanCatalogWarningRemovedPassed', 'japanModelSelectionPassed',
    'japanCombinedFiltersPassed', 'japanRelatedCardsPassed', 'japanVehiclePolicyPassed', 'japanPowerOrderPassed',
    'japanBrandDirectoryPassed']) report[flag] = true;
  const stages = [
    ['plain_first'], ['plain_warm'], ['power_api'], ['pagination_plain_page_two'],
    ['stability_brand_directory_desktop', 'makes'], ['pagination_power_page_two'],
    ['completion_petrol_power_toggle'], ['stability_brand_directory_mobile', 'makes'], ['completion_petrol_page_two'],
    ['stability_source_models', 'models'], ['stability_legacy_mazda_three'], ['stability_model_selection'],
    ['stability_combined_filters'], ['stability_related_freshness'],
    ['stability_source_price_plain_count', 'count'], ['stability_source_price_power_count', 'count'],
    ['stability_source_price_desc_append'], ['stability_source_price_asc_append'],
    ['model_coverage_audi_make'], ['model_coverage_audi_models', 'models'], ['model_coverage_audi_a4'],
    ['source_count_audi_a4'], ['source_count_independent', 'count'], ['source_count_append'],
    ['source_count_a4_power160_after_power_toggle'], ['source_count_a4_power160_after_first_page_navigation'],
    ...(!crossoverFailure ? [['stability_crossover_power160_append']] : []),
  ];
  for (const [stage, kind = 'list'] of stages) recordJapanResponse(report, stage, {
    status: 200, requestedAt: Date.parse(observedAt), receivedAt: Date.parse(observedAt) + 10, durationMs: 10,
    headers: {'cache-control': 'private, max-age=15'}, data: {ok: true, observedAt, received: kind === 'list' ? 192 : 1,
      stale: false, partial: false, interrupted: false, scanLimited: false, hasMore: true, total: null,
      items: kind === 'list' ? Array(24).fill({}) : [], sourceReceipts: pageReceipts(stage, kind)},
  }, release);
  report.checks.health = ['before', 'after'].map(stage => ({stage, status: 200, ok: true, releaseSha: release,
    calculationVersion: hash('calculation'), durationMs: 10}));
  report.checks.ssrPageReadEvidence = ['pagination_plain_page_two', 'pagination_power_page_two', 'completion_petrol_page_two']
    .map(stage => ({stage, ...ssr(stage)}));
  report.checks.priceSortProgress = {phase: 'complete', explicitApiReads: 2,
    counts: report.checks.priceSort.counts, checks: report.checks.priceSort.checks,
    firstPageReadiness: ['totalRubDesc', 'totalRub'].map(sort => ({sort, beforeWait: readiness(sort)}))};
  report.checks.sourceCountProgress = {phase: 'complete', explicitApiReads: 2,
    summary: report.checks.sourceCount.summary, ui: report.checks.sourceCount.ui,
    cursorBeforeCount: report.checks.sourceCount.pagination.cursorBeforeCount,
    cursorAfterCount: report.checks.sourceCount.pagination.cursorAfterCount};
  const ids = Array.from({length: 24}, (_, index) => 'ajes-stats-synthetic-' + index);
  report.checks.a4Power160ContinuationProgress = {phase: 'complete', explicitApiReads: 0,
    ordinaryAppendRequests: 2, firstPageNavigations: 1,
    attempts: report.checks.a4Power160Continuation.attempts.map(attempt => ({phase: 'complete', ...attempt,
      beforeIds: ids, responseIds: ids, visibleIdsImmediatelyAfterResponse: ids, renderedEvidence: ssr(attempt.name),
      initialCount: report.checks.sourceCount.ui, loadedCount: attempt.loadedAfter}))};
  const cursor = 'j2.k.9.0.2.' + hash('crossover') + '.' + hash('epoch') + '.-';
  const page = {observedAt, sourcePages: 8, receiptsSha256: hash('crossover-receipts'), sourceReceiptsFresh: true, shown: 24};
  const firstPage = {...page, kind: 'rendered-ssr', page: 1, afterSha256: hash(''), ssrBindingMatched: true};
  report.checks.crossoverPower160Progress = {phase: crossoverFailure ? 'navigate' : 'complete',
    firstPageReadiness: {beforeWait: readiness('crossover', crossoverFailure ? 0 : 24)},
    ...(!crossoverFailure ? {firstPage, cursor, appendStatus: 200} : {})};
  if (crossoverFailure) {
    report.checks.crossoverPower160Progress.firstPageReadiness.failure = {
      timeout: true, observation: readiness('crossover', 0)};
    report.error = {stage: 'stability_crossover_power160', code: 'japan_browser_check_failed', timeout: true};
  } else {
    const powers = Array.from({length: 48}, (_, index) => index < 30 ? 150 : null);
    report.checks.crossoverPower160 = {contract: 'japan-crossover-power160-browser-v1', city: 'Новокузнецк',
      bodyType: 'suv', powerTo: 160, documentStatus: 200, loadedBefore: 24, added: 24, loadedAfter: 48,
      duplicateIds: 0, oldIdsPreserved: true, orderPreserved: true, allBodiesSuv: true, knownBeforeUnknown: true,
      powerValuesMatchApi: true, powers, powersSha256: hash(JSON.stringify(powers)),
      beforeIdsSha256: hash('before'), addedIdsSha256: hash('added'), afterIdsSha256: hash('after'),
      firstPage, nextPage: {...page, kind: 'append-api', status: 200, stale: false, partial: false, interrupted: false, total: null},
      cursor, continuationCursor: cursor, sameFilter: true, cityPreserved: true, bodyControlPreserved: true,
      powerControlPreserved: true, followedEmittedCursor: true, explicitApiReads: 0, ordinaryAppendRequests: 1,
      liveExhaustiveScan: false, pageErrors: 0, alerts: 0};
  }
  report.screenshots = Array.from({length: 28}, (_, index) => ({
    path: 'artifacts/catalog-japan-live/' + nonce + '/synthetic-observation-' + index + '.png', sha256: hash('screenshot-' + index)}));
  collectJapanObservedTimings(report);
  return report;
}

test('a small report keeps even completed diagnostic fields losslessly', () => {
  const report = sourcePriceOrderReport(checkedAt);
  report.checks.priceSortProgress = {phase: 'complete', counts: report.checks.priceSort.counts,
    checks: report.checks.priceSort.checks, firstPageReadiness: [{beforeWait: readiness('price')}]};
  assert.ok(Buffer.byteLength(JSON.stringify(report)) < 128 * 1024);
  assert.deepEqual(JSON.parse(serializeJapanBrowserReport(report)), report);
});

for (const [progress, stage] of [['priceSortProgress', 'stability_source_price_asc_append'],
  ['a4Power160ContinuationProgress', 'source_count_a4_power160_after_first_page_navigation'],
  ['sourceCountProgress', 'source_count_append'], ['crossoverPower160Progress', 'stability_crossover_power160_append']])
test('capture or close failure preserves active progress even after a valid complete proof: ' + progress, () => {
  const report = fullProfile(); report.passed = false;
  report.error = {stage, code: 'japan_browser_check_failed', timeout: true};
  assert.equal(report.checks[progress].phase, 'complete');
  const saved = JSON.parse(serializeJapanBrowserReport(report));
  assert.deepEqual(saved.checks[progress], report.checks[progress]);
  assert.deepEqual(saved.checks.responses, report.checks.responses);
  assert.deepEqual(saved.error, report.error); assert.equal(saved.passed, false);
});

test('a complete progress marker cannot replace a missing or failed final proof', () => {
  for (const patch of [report => { delete report.checks.priceSort; },
    report => { report.checks.priceSort.checks[0].loadedAfter = 47; },
    report => { report.checks.priceSortProgress.phase = 'append'; }]) {
    const report = fullProfile(); patch(report);
    const saved = JSON.parse(serializeJapanBrowserReport(report));
    assert.deepEqual(saved.checks.priceSortProgress, report.checks.priceSortProgress);
    assert.deepEqual(saved.checks.priceSort, report.checks.priceSort);
  }
});

for (const crossoverFailure of [false, true]) test('compact full profile preserves every field within observed-Japan bounds: ' +
  (crossoverFailure ? 'crossover timeout' : 'passed selection'), () => {
  const report = fullProfile({crossoverFailure}), original = structuredClone(report);
  const prettyBytes = Buffer.byteLength(JSON.stringify(report, null, 2) + '\n');
  const raw = Buffer.from(serializeJapanBrowserReport(report)), saved = JSON.parse(raw);
  assert.ok(prettyBytes > 128 * 1024, 'the complete indented fixture exceeds the historical report limit');
  assert.ok(raw.length > 128 * 1024, 'the complete compact fixture also requires the observed-Japan capacity');
  assert.ok(raw.length <= 256 * 1024, 'all proofs, progress copies and active failure diagnostics fit the finite report bound');
  assert.deepEqual(saved, original); assert.deepEqual(report, original);
  assert.equal(japanSourceCountAcceptancePassed(saved, {auctionDatabaseLabel: true}), true);
  assert.equal(japanA4Power160ContinuationAcceptancePassed(saved, {auctionDatabaseLabel: true}), true);
  assert.equal(japanSourceSelectionAcceptancePassed(saved), !crossoverFailure);
  const envelope = Buffer.from(JSON.stringify({japanReportBase64: raw.toString('base64'), japanReportSha256: hash(raw),
    // Other already bounded CRM and retry proofs share the envelope. Reserve
    // both complete 32 KiB slots rather than checking Japan in isolation.
    crmReportBase64: Buffer.alloc(32 * 1024).toString('base64'),
    japanPhotoRetryReportBase64: Buffer.alloc(32 * 1024).toString('base64')}));
  assert.ok(envelope.length > 256 * 1024, 'the complete nested proof requires the matching observed-Japan envelope capacity');
  assert.ok(envelope.length <= 512 * 1024, 'the full nested proof fits the finite observed-Japan envelope bound');
  if (crossoverFailure) {
    assert.equal(saved.passed, false); assert.equal(saved.japanCrossoverPower160Passed, false);
    assert.equal(saved.error.stage, 'stability_crossover_power160');
    const evidence = saved.checks.crossoverPower160Progress.firstPageReadiness;
    for (const observation of [evidence.beforeWait, evidence.failure.observation]) {
      assert.equal(observation.dom.shown, 0); assert.equal(observation.dom.incompleteNotice, true);
      assert.equal(observation.sourceReadEvidence.receipts.length, 8);
      assert.equal(observation.sourceReadEvidence.bindingMatched, true);
    }
    assert.deepEqual(saved.checks.responses, original.checks.responses);
    assert.deepEqual(saved.checks.crossoverPower160Progress, original.checks.crossoverPower160Progress);
  }
});
