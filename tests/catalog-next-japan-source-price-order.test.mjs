import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as scope from '../scripts/catalog-next/japan-stability-code-scope.mjs';
import {japanSourcePriceOrderRequirement, japanSourcePriceCountApi, japanSourcePriceApiAllowed,
  japanSourcePriceContinuation, verifyJapanSourcePriceRows, verifyJapanSourcePriceDomRows,
  verifyJapanSourcePriceAppend, verifyJapanSourcePriceFreshReceipts}
  from '../scripts/catalog-next/japan-source-price-order-browser.mjs';
import {sourcePriceOrderReport} from './helpers/japan-source-price-order-report-fixture.mjs';
import {sourceCountReport, a4Power160ContinuationReport} from './helpers/japan-source-count-report-fixture.mjs';
import {verifyJapanPriceSortCount} from '../scripts/catalog-next/japan-price-sort-browser.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const root = fileURLToPath(new URL('../', import.meta.url)), CITY = 'Новокузнецк';
const cursor = 'j2.k.2.0.2.' + hash('source query') + '.' + hash('epoch') + '.-';
const rows = (start, count, descending = false, powerLane = 'known') => Array.from({length: count}, (_, index) => ({
  id: 'ajes-stats-' + (start + index), priceJpy: (descending ? 100 - start - index : start + index) * 1000 + 0.25,
  powerLane, japanPowerUnknown: powerLane === 'unknown'}));
const apiItems = values => values.map(row => ({market: 'japan', id: row.id,
  japanCatalogPriceOrder: 'auction', japanAuctionPriceJpy: row.priceJpy,
  ...(row.powerLane === 'unknown' ? {japanPowerUnknown: true}
    : {japanSupplierPower: {offerId: row.id, hp: 150, unit: 'hp', source: 'ajes_pw'}})}));
const plainRows = values => values.map(({id, priceJpy, powerLane}) => ({id, priceJpy, powerLane}));

test('source order is an exact separate profile and retains all source, model and no-sort A4 guards', () => {
  const plan = {codeScope: scope.JAPAN_STABILITY_CODE_SCOPE,
    retainedRuntime: scope.JAPAN_STABILITY_SOURCE_PRICE_ORDER_RETAINED_RUNTIME,
    runtimeFiles: [...scope.JAPAN_STABILITY_SOURCE_PRICE_ORDER_CODE_PATHS],
    acceptancePolicy: scope.JAPAN_OBSERVED_TIMING_POLICY, countAcceptance: scope.JAPAN_SOURCE_COUNT_POLICY};
  assert(plan.runtimeFiles.length > 0);
  for (const removed of ['apps/web/lib/catalog/ajes-query.ts', 'apps/web/lib/catalog/japan-source-power-query.ts',
    'tests/japan-source-power-query.test.ts']) assert.equal(plan.runtimeFiles.includes(removed), false);
  for (const name of ['isExactJapanStabilityScope', 'japanObservedTimingRequired', 'japanPowerOrderRequired',
    'japanBrandDirectoryRequired', 'japanPriceSortRequired', 'japanLiteralFamilyRequired', 'japanSourceCountRequired',
    'japanA4Power160ContinuationRequired', 'japanSourcePriceOrderRequired']) assert.equal(scope[name](plan), true, name);
  assert.equal(scope.japanExactCountRequired(plan), false);
  for (const patch of [{runtimeFiles: plan.runtimeFiles.slice(1)},
    {runtimeFiles: [...plan.runtimeFiles, 'packages/engine/index.ts']},
    {retainedRuntime: scope.JAPAN_STABILITY_MODEL_CURSOR_RETAINED_RUNTIME}, {countAcceptance: undefined}])
    assert.equal(scope.isExactJapanStabilityScope({...plan, ...patch}), false);
  const old = {...plan, retainedRuntime: scope.JAPAN_STABILITY_MODEL_CURSOR_RETAINED_RUNTIME,
    runtimeFiles: [...scope.JAPAN_STABILITY_MODEL_CURSOR_CODE_PATHS]};
  assert.equal(old.runtimeFiles.length, 5); assert.equal(scope.japanSourcePriceOrderRequired(old), false);
  assert.equal(scope.JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS.length, 18);
});

test('two scalar requests and the exact emitted j2 continuation cannot expand to source scans', () => {
  assert.equal(japanSourcePriceOrderRequirement('1'), true);
  for (const value of [undefined, '0']) assert.equal(japanSourcePriceOrderRequirement(value), false);
  for (const value of [true, null, 1, 'true', '']) assert.throws(() => japanSourcePriceOrderRequirement(value), /option/);
  for (const power of [false, true]) {
    const api = japanSourcePriceCountApi({power}); assert(japanSourcePriceApiAllowed(api));
    for (const suffix of ['&countOnly=1', '&page=2', '&make=Audi', '&powerTo=161', '#hash'])
      assert.equal(japanSourcePriceApiAllowed(api + suffix), false);
    assert.equal(japanSourcePriceApiAllowed(japanSourcePriceCountApi({power, countOnly: false})), false);
  }
  const href = 'https://avtocena.com/cars?' + new URLSearchParams({market: 'japan', city: CITY,
    powerTo: '160', sort: 'totalRub', page: '2', after: cursor});
  assert.equal(japanSourcePriceContinuation(href, {sort: 'totalRub', expectedCursor: cursor}), cursor);
  for (const value of [href + '&fuel=petrol', href.replace('powerTo=160', 'powerTo=161'),
    href.replace('page=2', 'page=3'), href.replace('totalRub', 'totalRubDesc'), href.replace('avtocena.com', 'supplier.example'),
    href.replace(cursor, 'j1.2.0.2.' + hash('source query') + '.-')])
    assert.throws(() => japanSourcePriceContinuation(value, {sort: 'totalRub'}));
});

test('actual 24-to-48 append preserves source order within each phase across the page boundary', () => {
  for (const descending of [false, true]) {
    for (const powerLane of ['known', 'unknown']) {
    const sort = descending ? 'totalRubDesc' : 'totalRub', before = rows(1, 24, descending, powerLane), added = rows(25, 24, descending, powerLane);
    const after = plainRows([...before, ...added]);
    const proof = verifyJapanSourcePriceAppend({before: plainRows(before), items: apiItems(added), after, sort});
    assert.equal(proof.loadedAfter, 48); assert.equal(proof.duplicateIds, 0);
    assert.equal(proof.sourcePriceOrder, true);
    assert.equal(proof.knownBeforeUnknown, true); assert.equal(proof.sourcePriceOrderWithinPowerLanes, true);
    assert.equal(proof.powerLanesSha256, hash(JSON.stringify(proof.powerLanes)));
    const restarted = rows(1, 24, descending, powerLane).map((row, index) => ({...row, id: 'ajes-stats-restart-' + index}));
    assert.doesNotThrow(() => verifyJapanSourcePriceRows(restarted, sort), 'a page alone still looks sorted');
    assert.throws(() => verifyJapanSourcePriceAppend({before: plainRows(before), items: apiItems(restarted),
      after: plainRows([...before, ...restarted]), sort}), /lane_price_order/);
    assert.throws(() => verifyJapanSourcePriceAppend({before: plainRows(before), items: apiItems(added),
      after: [after[1], after[0], ...after.slice(2)], sort}), /identity_order/);
    const wrong = apiItems(added); wrong[0].japanAuctionPriceJpy++;
    assert.throws(() => verifyJapanSourcePriceAppend({before: plainRows(before), items: wrong, after, sort}), /identity_order/);
    }
  }
});

test('K to U may reset source prices on page two but a return to K is rejected', () => {
  for (const descending of [false, true]) {
    const sort = descending ? 'totalRubDesc' : 'totalRub', known = rows(1, 30, descending);
    const unknown = rows(1, 18, descending, 'unknown').map(row => ({...row, id: row.id + '-unknown',
      priceJpy: row.priceJpy + (descending ? 100000 : -500)}));
    const before = plainRows(known.slice(0, 24)), added = [...known.slice(24), ...unknown];
    const proof = verifyJapanSourcePriceAppend({before, items: apiItems(added), after: plainRows([...known, ...unknown]), sort});
    assert.deepEqual(proof.powerLanes, [...Array(30).fill('known'), ...Array(18).fill('unknown')]);
    const unknownFirst = rows(1, 24, descending, 'unknown'), knownNext = rows(25, 24, descending);
    assert.throws(() => verifyJapanSourcePriceAppend({before: plainRows(unknownFirst), items: apiItems(knownNext),
      after: plainRows([...unknownFirst, ...knownNext]), sort}), /power_order/);
    const missing = apiItems(added); delete missing[0].japanSupplierPower;
    assert.throws(() => verifyJapanSourcePriceAppend({before, items: missing, after: plainRows([...known, ...unknown]), sort}), /source_power/);
    const mislabeled = apiItems(added); mislabeled[6].japanPowerUnknown = false;
    assert.throws(() => verifyJapanSourcePriceAppend({before, items: mislabeled, after: plainRows([...known, ...unknown]), sort}), /source_power/);
  }
});

test('the visible auction label binds raw fractional JPY and ignores unrelated RUB values', () => {
  const row = {id: 'ajes-stats-one', priceNodes: 1, priceAttribute: '12345.678', priceText: 'Аукцион: 12\u00a0345,68 ¥',
    powerPhase: 'known', unknownMarkers: 0, supplierMarkers: 1};
  assert.deepEqual(verifyJapanSourcePriceDomRows([row]), [{id: row.id, priceJpy: 12345.678, powerLane: 'known'}]);
  for (const patch of [{priceText: 'Аукцион: 12 345,67 ¥'}, {priceAttribute: '12345678'},
    {priceText: '12 345,68 ₽'}, {priceNodes: 2}, {priceAttribute: 'Infinity'}, {priceAttribute: '0'}])
    assert.throws(() => verifyJapanSourcePriceDomRows([{...row, ...patch}]), /dom_price/);
  const unknown = {...row, powerPhase: 'unknown', unknownMarkers: 1, unknownVisible: true,
    unknownText: 'Мощность не указана', supplierMarkers: 0};
  assert.equal(verifyJapanSourcePriceDomRows([unknown])[0].powerLane, 'unknown');
  for (const patch of [{powerPhase: undefined}, {powerPhase: 'unknown'}, {unknownMarkers: 1}, {supplierMarkers: 2}])
    assert.throws(() => verifyJapanSourcePriceDomRows([{...row, ...patch}]), /dom_power/);
  for (const patch of [{unknownMarkers: 0}, {unknownVisible: false}, {unknownText: '150 л.с.'}, {supplierMarkers: 1}])
    assert.throws(() => verifyJapanSourcePriceDomRows([{...unknown, ...patch}]), /dom_power/);
});

test('source price evidence rejects missing, stale, refused and mismatched SSR receipts', () => {
  const now = Date.now(), observedAt = new Date(now - 1000).toISOString();
  const evidence = {status: 'recorded', limited: false, omitted: 0, received: 1,
    page: 1, afterSha256: hash(''), bindingMatched: true,
    receipts: [{table: 'stats', kind: 'list', pageSize: 24, outcome: 'fresh', observedAt}]};
  assert.equal(verifyJapanSourcePriceFreshReceipts(evidence, {ssr: true, now}).sourceReceiptsFresh, true);
  assert.equal(verifyJapanSourcePriceFreshReceipts(evidence, {reads: 1, observedAt, now}).kind, 'append-api');
  for (const patch of [{status: 'missing'}, {bindingMatched: false}, {page: 2}, {limited: true}, {reason: 'visitor_restricted'},
    {receipts: [{...evidence.receipts[0], outcome: 'stale'}]}, {receipts: [{...evidence.receipts[0], reason: 'visitor_restricted'}]}])
    assert.throws(() => verifyJapanSourcePriceFreshReceipts({...evidence, ...patch}, {ssr: true, now}));
});

function rejectedReports() {
  const changes = [
    value => { value.japanSourcePriceOrderRequired = false; },
    value => { value.japanSourcePriceOrderPassed = false; },
    value => { value.checks.priceSort.priceBasis = 'displayed_selected_city'; },
    value => { value.checks.priceSort.globalDeliveredPriceOrderClaimed = true; },
    value => { value.checks.priceSort.counts[1] = structuredClone(value.checks.priceSort.counts[0]); },
    value => { value.checks.priceSort.counts[1].summary.sourceCountProof.sourceQueryHash = hash('changed-source-power-predicate'); },
    value => { value.checks.priceSort.counts[0].summary.sourceCountProof.kind = 'quota-counter'; },
    value => { value.checks.priceSort.counts[0].ui.label = 'Найдено до 1 000'; },
    value => { value.checks.priceSort.counts[0].summary.stale = true; },
    value => { value.checks.priceSort.checks[1].sourcePrices[24] = 1; },
    value => { value.checks.priceSort.checks[0].sourcePrices[24] = 10000000; },
    value => { value.checks.priceSort.checks[1].sourcePrices[40] = 1; },
    value => { value.checks.priceSort.checks[0].sourcePrices[40] = 10000000; },
    value => { value.checks.priceSort.contract = 'japan-source-price-order-browser-v1'; },
    value => { value.checks.priceSort.countRequestedQueryChangesWithPower = false; },
    value => { value.checks.priceSort.countSourceQueryPreservedWithPower = false; },
    value => { value.checks.priceSort.checks[0].powerLanesSha256 = hash('wrong-lanes'); },
    value => { delete value.checks.priceSort.checks[0].powerLanesSha256; },
    value => { delete value.checks.priceSort.checks[0].powerLanes; },
    value => { value.checks.priceSort.checks[0].knownBeforeUnknown = false; },
    value => { value.checks.priceSort.checks[0].sourcePriceOrderWithinPowerLanes = false; },
    value => { const check = value.checks.priceSort.checks[0]; check.powerLanes[23] = 'unknown';
      check.powerLanesSha256 = hash(JSON.stringify(check.powerLanes)); },
    value => { const check = value.checks.priceSort.checks[0]; check.powerLanes[35] = 'known';
      check.powerLanesSha256 = hash(JSON.stringify(check.powerLanes)); },
    value => { value.checks.priceSort.checks[0].firstPage.kind = 'independent-api'; },
    value => { value.checks.priceSort.checks[0].firstPage.ssrBindingMatched = false; },
    value => { value.checks.priceSort.checks[0].nextPage.sourceReceiptsFresh = false; },
    value => { value.checks.priceSort.checks[0].nextPage.status = 409; },
    value => { value.checks.priceSort.checks[0].nextPage.partial = true; },
    value => { value.checks.priceSort.checks[0].oldIdsPreserved = false; },
    value => { value.checks.priceSort.checks[0].duplicateIds = 1; },
    value => { value.checks.priceSort.checks[0].finalCount.loadedCount = 24; },
    value => { value.checks.priceSort.explicitApiReads = 4; },
    value => { value.checks.priceSort.liveExhaustiveScan = true; },
  ];
  return changes.map(change => { const value = sourcePriceOrderReport(); change(value); return value; });
}

test('new labels preserve bounded count semantics and historical reports keep their exact old contract', () => {
  const value = sourcePriceOrderReport();
  assert.equal(scope.japanSourcePriceOrderAcceptancePassed(value), true);
  assert.equal(scope.japanSourceCountAcceptancePassed(value, {auctionDatabaseLabel: true}), true);
  assert.equal(scope.japanA4Power160ContinuationAcceptancePassed(value, {auctionDatabaseLabel: true}), true);
  assert.equal(scope.japanSourceCountAcceptancePassed(value), false);
  assert.equal(scope.japanSourceCountAcceptancePassed(sourceCountReport()), true);
  assert.equal(scope.japanA4Power160ContinuationAcceptancePassed(a4Power160ContinuationReport()), true);
  for (const report of rejectedReports()) assert.equal(scope.japanSourcePriceOrderAcceptancePassed(report), false);
  const unknown = {status: 'partial', loadedCount: '24', exactCount: null, text: 'Количество уточняется'};
  const options = {loaded: 24, total: null, countAcceptance: scope.JAPAN_SOURCE_COUNT_POLICY};
  assert.throws(() => verifyJapanPriceSortCount(unknown, options), /count_visible/);
  assert.equal(verifyJapanPriceSortCount(unknown, {...options, auctionDatabaseLabel: true}).exact, false);
});

test('Python and JS agree on new proof and retain exact historical profiles', () => {
  const reports = [sourcePriceOrderReport(), ...rejectedReports()];
  const result = spawnSync('python3', ['-B', '-c', `
import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('release_host','scripts/catalog-next/release-host.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
profile=m.JAPAN_STABILITY_SOURCE_PRICE_ORDER_CODE_FILES
assert m.checked_japan_stability_image_files(sorted(profile),True,m.JAPAN_STABILITY_SOURCE_PRICE_ORDER_RETAINED,m.JAPAN_SOURCE_COUNT_POLICY)==profile
assert len(m.JAPAN_STABILITY_SOURCE_COUNT_CODE_FILES)==18 and len(m.JAPAN_STABILITY_MODEL_CURSOR_CODE_FILES)==5
print(json.dumps({'files':sorted(profile),'results':[m.japan_source_price_order_acceptance_passed(row) for row in json.load(sys.stdin)]}))
`], {cwd: root, input: JSON.stringify(reports), encoding: 'utf8', maxBuffer: 2 * 1024 * 1024});
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.files, [...scope.JAPAN_STABILITY_SOURCE_PRICE_ORDER_CODE_PATHS].sort());
  assert.deepEqual(parsed.results, reports.map(scope.japanSourcePriceOrderAcceptancePassed));
});
