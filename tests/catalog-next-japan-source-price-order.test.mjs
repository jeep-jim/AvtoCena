import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import * as scope from '../scripts/catalog-next/japan-stability-code-scope.mjs';
import {japanSourcePriceOrderRequirement, japanSourcePriceCountApi, japanSourcePriceApiAllowed,
  japanSourcePriceContinuation, verifyJapanSourcePriceRows, verifyJapanSourcePriceDomRows,
  verifyJapanSourcePriceAppend, verifyJapanSourcePriceFreshReceipts, readJapanSourcePriceFirstPage}
  from '../scripts/catalog-next/japan-source-price-order-browser.mjs';
import {sourcePriceOrderReport} from './helpers/japan-source-price-order-report-fixture.mjs';
import {sourceCountReport, a4Power160ContinuationReport} from './helpers/japan-source-count-report-fixture.mjs';
import {verifyJapanPriceSortCount} from '../scripts/catalog-next/japan-price-sort-browser.mjs';
import {readJapanSsrPageEvidence} from '../scripts/catalog-next/japan-browser-acceptance.mjs';

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

test('K candidate successor is exact28 while f83 remains exact24 and all functional gates stay required', () => {
  const oldFiles = scope.JAPAN_STABILITY_SOURCE_PRICE_ORDER_CODE_PATHS;
  const files = scope.JAPAN_STABILITY_SOURCE_PRICE_CANDIDATE_CODE_PATHS;
  assert.equal(oldFiles.length, 24); assert.equal(files.length, 28);
  assert.deepEqual(files.filter(name => !oldFiles.includes(name)), [
    'apps/web/lib/catalog/ajes-query.ts', 'apps/web/lib/catalog/japan-known-power-query.ts',
    'tests/helpers/ajes-mysql-oracle.ts', 'tests/japan-known-power-query.test.ts',
  ]);
  const plan = {codeScope: scope.JAPAN_STABILITY_CODE_SCOPE,
    retainedRuntime: scope.JAPAN_STABILITY_SOURCE_PRICE_ORDER_RETAINED_RUNTIME, runtimeFiles: [...files],
    acceptancePolicy: scope.JAPAN_OBSERVED_TIMING_POLICY, countAcceptance: scope.JAPAN_SOURCE_COUNT_POLICY};
  assert.equal(scope.japanStabilityCodePaths(plan), files);
  for (const name of ['isExactJapanStabilityScope', 'japanObservedTimingRequired', 'japanPowerOrderRequired',
    'japanBrandDirectoryRequired', 'japanPriceSortRequired', 'japanLiteralFamilyRequired', 'japanSourceCountRequired',
    'japanA4Power160ContinuationRequired', 'japanSourcePriceOrderRequired']) assert.equal(scope[name](plan), true, name);
  assert.equal(scope.japanExactCountRequired(plan), false);
  assert.equal(scope.japanSourceBoundedIncrementalRequired(plan), false);
  for (const name of files) assert.equal(scope.isExactJapanStabilityScope({...plan,
    runtimeFiles: files.filter(value => value !== name)}), false, name);
  for (const patch of [{runtimeFiles: [...files, files[0]]}, {runtimeFiles: [...files, 'packages/engine/index.ts']},
    {retainedRuntime: 'f83fc7d9983fad8619984128196d5f72eaa292aa'}, {acceptancePolicy: undefined},
    {countAcceptance: undefined}, {countAcceptance: scope.JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY}])
    assert.equal(scope.isExactJapanStabilityScope({...plan, ...patch}), false);
  assert.equal(scope.japanStabilityCodePaths({...plan, runtimeFiles: [...oldFiles]}), oldFiles);
  assert.equal(scope.japanSourcePriceOrderRequired({...plan, runtimeFiles: [...oldFiles]}), true);
  const retainedCompatibility = scope.japanStabilityCompatibilityPaths({...plan, runtimeFiles: [...oldFiles]});
  assert.deepEqual(scope.japanStabilityCompatibilityPaths(plan), [...new Set([...retainedCompatibility, ...files])].sort());
  assert.ok(retainedCompatibility.includes('apps/web/lib/catalog/ajes-client.ts'));
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

function sourcePriceReadinessFixture({sort, shown = 0, scanLimited = false, malformed = false, cursorOverride}) {
  const now = new Date().toISOString(), calls = {dom: 0, receipts: 0, ready: 0, rows: 0};
  const timeout = Object.assign(Error('controlled ready timeout'), {name: 'TimeoutError'});
  const receipts = Array.from({length: scanLimited ? 8 : 1}, (_, index) => ({version: 1,
    requestId: '12345678-1234-4234-8234-' + String(index + 1).padStart(12, '0'),
    queryHash: hash('source-sort:' + sort), table: 'stats', kind: 'list', page: index + 1, pageSize: 24,
    startedAt: now, finishedAt: now, stage: shown || scanLimited ? 'storage' : 'empty_verification',
    supplierAttempted: !shown && !scanLimited, outcome: shown || scanLimited ? 'fresh' : 'unavailable',
    ...(shown || scanLimited ? {observedAt: now} : {reason: 'empty_response'})}));
  const annotation = JSON.stringify({version: 1, page: 1, afterSha256: hash(''), receipts, omitted: 0,
    ...(malformed ? {private: 'PRIVATE_RESPONSE_AND_URL'} : {})});
  const values = rows(1, shown, sort === 'totalRubDesc');
  const cards = values.map(row => ({getAttribute: name => name === 'data-japan-power-phase' ? 'known' : null,
    querySelectorAll(selector) {
      if (selector === 'a[href]') return [{getAttribute: () => '/cars/offer/' + row.id}];
      if (selector === '[data-japan-auction-price-jpy]') return [{
        getAttribute: () => String(row.priceJpy), textContent: 'Аукцион: ' + row.priceJpy.toLocaleString('ru-RU') + ' ¥'}];
      if (selector === '[data-japan-power-unknown="true"]') return [];
      if (selector === '[data-japan-supplier-power="true"]') return [{}];
      throw Error('unexpected card selector: ' + selector);
    }}));
  const next = cursorOverride ?? 'j2.k.' + (scanLimited ? '9' : '2') + '.0.2.' + hash('new sort') + '.' + hash('epoch') + '.-';
  const more = {getAttribute: () => '/cars?' + new URLSearchParams({market: 'japan', city: CITY,
    powerTo: '160', sort, page: '2', after: next})};
  const count = {getAttribute: name => name === 'data-japan-loaded-count' ? String(shown) : 'bounded'};
  const selected = {value: sort}, power = {checked: true};
  const form = {querySelector: selector => selector.includes('name="sort"') ? selected : power};
  const root = {getAttribute: () => annotation,
    querySelector(selector) {
      if (selector === 'a.ac-catalog-more[role="button"]') return more;
      if (selector === '[data-japan-loaded-count]' || selector === '[data-japan-loaded-count="' + shown + '"]') return count;
      return null;
    }, querySelectorAll(selector) {
      if (selector === 'article.ac-catalog-card,article.ac-catalog-list-row') return cards;
      if (selector === 'a.ac-catalog-more[role="button"]') return [more];
      if (selector === 'p[role="status"]') return shown ? [] : [{textContent: 'Показана часть автомобилей. Полный список пока недоступен.'}];
      if (selector === '[role="alert"]') return [];
      throw Error('unexpected root selector: ' + selector);
    }};
  const document = {querySelectorAll: selector => selector === 'main.ac-ajes-catalog' ? [root] : [],
    querySelector: selector => selector === 'main.ac-ajes-catalog' ? root : selector.includes('name="sort"') ? selected : form};
  const evaluate = (fn, input) => runInNewContext('(' + fn.toString() + ')(input)',
    {document, location: {origin: 'https://avtocena.com'}, URL, input});
  const view = {
    evaluate: async (fn, input) => { calls.dom++; return structuredClone(evaluate(fn, input)); },
    waitForFunction: async (fn, input, options) => {
      const kind = input.attribute ? 'receipts' : input.expectedCount ? 'rows' : 'ready'; calls[kind]++;
      assert.equal(options.timeout, kind === 'receipts' ? 5000 : 60000);
      const result = evaluate(fn, input); if (!result) throw timeout;
      return {jsonValue: async () => result, dispose: async () => {}};
    },
    locator: selector => { assert.equal(selector, 'main.ac-ajes-catalog'); return {
      locator: selector => { assert.equal(selector, 'article.ac-catalog-card,article.ac-catalog-list-row'); return {
        evaluateAll: async fn => structuredClone(evaluate(fn, cards)),
      }; },
    }; },
    goto: async () => { throw Error('diagnostic must not navigate'); },
    request: {get: async () => { throw Error('diagnostic must not request'); }},
  };
  return {view, values, calls, timeout, receipts};
}

test('empty and bounded-scan sorted pages retain DOM and SSR evidence while the real 24-card wait still fails', async () => {
  for (const sort of ['totalRubDesc', 'totalRub']) for (const scanLimited of [false, true]) {
    const fixture = sourcePriceReadinessFixture({sort, scanLimited}), progress = {phase: 'sort_selected'};
    await assert.rejects(readJapanSourcePriceFirstPage(fixture.view, {sort, previousCursor: cursor, progress,
      readSsrPageEvidence: readJapanSsrPageEvidence}), error => error === fixture.timeout);
    assert.equal(progress.firstPageReadiness.length, 1);
    const diagnostic = progress.firstPageReadiness[0]; assert.equal(diagnostic.sort, sort);
    assert.equal(diagnostic.failure.timeout, true);
    for (const observation of [diagnostic.beforeWait, diagnostic.failure.observation]) {
      assert.equal(observation.dom.shown, 0); assert.equal(observation.dom.loadedCount, 0);
      assert.equal(observation.dom.incompleteNotice, true); assert.equal(observation.dom.selectedSort, sort);
      assert.equal(observation.dom.power160Checked, true); assert.equal(observation.dom.continuation.cursorVersion, 'j2');
      assert.equal(observation.dom.continuation.sourcePage, scanLimited ? 9 : 2);
      assert.equal(observation.dom.continuation.withinPageSkip, 0);
      assert.equal(observation.dom.continuation.page, 2);
      assert.deepEqual(observation.sourceReadEvidence.receipts, fixture.receipts);
      assert.equal(observation.sourceReadEvidence.bindingMatched, true);
    }
    assert.deepEqual(fixture.calls, {dom: 2, receipts: 2, ready: 1, rows: 0});
    assert.equal(progress.firstPage, undefined); assert.equal(progress.checks, undefined);
  }
});

test('continuation diagnostics expose only bounded numeric positions from a shaped j2 cursor', async () => {
  for (const bad of [cursor.replace('.2.0.2.', '.1000001.0.2.'), cursor.replace('.2.0.2.', '.2.49.2.'),
    cursor.replace('.2.0.2.', '.2.1.2.'), 'j2.k.PRIVATE_CURSOR']) {
    const fixture = sourcePriceReadinessFixture({sort: 'totalRubDesc', cursorOverride: bad}), progress = {};
    await assert.rejects(readJapanSourcePriceFirstPage(fixture.view, {sort: 'totalRubDesc', previousCursor: cursor,
      progress, readSsrPageEvidence: readJapanSsrPageEvidence}), error => error === fixture.timeout);
    const continuation = progress.firstPageReadiness[0].failure.observation.dom.continuation;
    assert.equal(continuation.sourcePage, null); assert.equal(continuation.withinPageSkip, null);
    assert.equal(JSON.stringify(progress).includes(bad), false);
  }
});

test('readiness observations preserve the existing successful DOM gate and cannot hide or replace its timeout', async () => {
  const sort = 'totalRub', fixture = sourcePriceReadinessFixture({sort, shown: 24}), progress = {};
  const before = await readJapanSourcePriceFirstPage(fixture.view, {sort, previousCursor: cursor, progress,
    readSsrPageEvidence: readJapanSsrPageEvidence});
  assert.deepEqual(before, plainRows(fixture.values));
  assert.equal(verifyJapanSourcePriceRows(before, sort).shown, 24);
  assert.equal(progress.firstPageReadiness[0].failure, undefined);
  assert.deepEqual(fixture.calls, {dom: 1, receipts: 1, ready: 1, rows: 1});
  const broken = sourcePriceReadinessFixture({sort}), failed = {};
  broken.view.evaluate = async () => { throw Error('PRIVATE_BROWSER_ERROR'); };
  await assert.rejects(readJapanSourcePriceFirstPage(broken.view, {sort, previousCursor: cursor, progress: failed,
    readSsrPageEvidence: async () => { throw Error('PRIVATE_RECEIPT_ERROR'); }}), error => error === broken.timeout);
  for (const observation of [failed.firstPageReadiness[0].beforeWait, failed.firstPageReadiness[0].failure.observation]) {
    assert.deepEqual(observation.dom, {status: 'unavailable'});
    assert.deepEqual(observation.sourceReadEvidence, {status: 'unavailable'});
  }
  assert.equal(JSON.stringify(failed).includes('PRIVATE_'), false);
});

test('malformed SSR diagnostics stay omitted without leaking their contents or accepting an empty page', async () => {
  const fixture = sourcePriceReadinessFixture({sort: 'totalRubDesc', malformed: true}), progress = {};
  await assert.rejects(readJapanSourcePriceFirstPage(fixture.view, {sort: 'totalRubDesc', previousCursor: cursor,
    progress, readSsrPageEvidence: readJapanSsrPageEvidence}), error => error === fixture.timeout);
  for (const observation of [progress.firstPageReadiness[0].beforeWait, progress.firstPageReadiness[0].failure.observation]) {
    assert.equal(observation.sourceReadEvidence.status, 'omitted');
    assert.equal(observation.sourceReadEvidence.receipts.length, 0);
    assert.equal(observation.dom.shown, 0);
  }
  assert.equal(JSON.stringify(progress).includes('PRIVATE_'), false);
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
profiles=m.JAPAN_STABILITY_SOURCE_PRICE_CODE_PROFILES
assert len(profiles)==4 and [len(profile) for profile in profiles]==[24,28,41,44]
for profile in profiles:
 assert m.checked_japan_stability_image_files(sorted(profile),True,m.JAPAN_STABILITY_SOURCE_PRICE_ORDER_RETAINED,m.JAPAN_SOURCE_COUNT_POLICY)==profile
 for rejected in [sorted(profile)[1:],sorted(profile)+['packages/engine/index.ts'],sorted(profile)+[sorted(profile)[0]]]:
  try: m.checked_japan_stability_image_files(rejected,True,m.JAPAN_STABILITY_SOURCE_PRICE_ORDER_RETAINED,m.JAPAN_SOURCE_COUNT_POLICY)
  except m.ReleaseError: pass
  else: raise AssertionError('non-exact profile accepted')
 for observed,retained,policy in [(False,m.JAPAN_STABILITY_SOURCE_PRICE_ORDER_RETAINED,m.JAPAN_SOURCE_COUNT_POLICY),(True,'f83fc7d9983fad8619984128196d5f72eaa292aa',m.JAPAN_SOURCE_COUNT_POLICY),(True,m.JAPAN_STABILITY_SOURCE_PRICE_ORDER_RETAINED,None)]:
  try: m.checked_japan_stability_image_files(sorted(profile),observed,retained,policy)
  except m.ReleaseError: pass
  else: raise AssertionError('missing profile condition accepted')
assert len(m.JAPAN_STABILITY_SOURCE_COUNT_CODE_FILES)==18 and len(m.JAPAN_STABILITY_MODEL_CURSOR_CODE_FILES)==5
print(json.dumps({'files':[sorted(profile) for profile in profiles],'results':[m.japan_source_price_order_acceptance_passed(row) for row in json.load(sys.stdin)]}))
`], {cwd: root, input: JSON.stringify(reports), encoding: 'utf8', maxBuffer: 2 * 1024 * 1024});
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.files, [[...scope.JAPAN_STABILITY_SOURCE_PRICE_ORDER_CODE_PATHS].sort(),
    [...scope.JAPAN_STABILITY_SOURCE_PRICE_CANDIDATE_CODE_PATHS].sort(),
    [...scope.JAPAN_STABILITY_SOURCE_SELECTION_CODE_PATHS].sort(),
    [...scope.JAPAN_STABILITY_SOURCE_SELECTION_RECOVERY_CODE_PATHS].sort()]);
  assert.deepEqual(parsed.results, reports.map(scope.japanSourcePriceOrderAcceptancePassed));
});
