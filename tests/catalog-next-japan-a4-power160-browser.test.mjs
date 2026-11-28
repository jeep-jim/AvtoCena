import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {JAPAN_SOURCE_COUNT_GATES, JAPAN_A4_POWER160_CONTINUATION_GATES,
  japanA4Power160ContinuationRequirement, japanA4Power160Api, japanA4Power160ApiAllowed,
  japanA4Power160Selection, verifyJapanA4Power160Page, verifyJapanA4Power160Append,
  verifyJapanA4Power160SsrPage, verifyJapanA4Power160DomRows,
  checkedJapanA4Power160ContinuationBrowserFixture} from '../scripts/catalog-next/japan-source-count-browser.mjs';
import {japanPageReadEvidence, japanSsrPageReadEvidence, verifyJapanPowerPage, verifyJapanKnownPowerOrder}
  from '../scripts/catalog-next/japan-browser-acceptance.mjs';
import {a4Power160ContinuationReport} from './helpers/japan-source-count-report-fixture.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const now = Date.now(), observedAt = new Date(now - 1000).toISOString(), city = 'Новокузнецк';
const cursor = page => `j2.k.${page}.0.${page}.${hash('selection')}.${hash('epoch')}.-`;
const url = (pathname = '/api/catalog/search', page = 1, after) => {
  const params = new URLSearchParams({market: 'japan', make: 'Audi', model: 'A4', city, powerTo: '160', page: String(page), pageSize: '24'});
  if (pathname === '/cars/japan' || pathname === '/cars/japan/Audi/A4') params.delete('market');
  if (pathname === '/cars/japan/Audi/A4') { params.delete('make'); params.delete('model'); }
  if (after) params.set('after', after);
  return 'https://avtocena.com' + pathname + '?' + params;
};
const row = index => ({id: 'ajes-stats-power-' + index, market: 'japan', japanSupplierPower:
  {offerId: 'ajes-stats-power-' + index, source: 'ajes_pw', unit: 'hp', hp: 150}});
function page(number = 1, shown = 12) {
  return {ok: true, page: number, pageSize: 24, total: null, countSummary: null,
    items: Array.from({length: shown}, (_, index) => row((number - 1) * 12 + index)),
    stale: false, interrupted: false, partial: true, selectionIncomplete: true, scanLimited: true,
    hasMore: true, nextCursor: cursor(number + 1), reads: 1, observedAt,
    powerFilterSummary: {shown, localPower: 0, supplierPower: shown, unknownPower: 0},
    sourceReceipts: [{version: 1, requestId: `12345678-1234-4234-8234-12345678901${number}`,
      queryHash: hash('source page ' + number), table: 'stats', kind: 'list', page: number, pageSize: 24,
      startedAt: observedAt, finishedAt: observedAt, stage: 'storage', supplierAttempted: false,
      outcome: 'fresh', observedAt}]};
}
const verify = (payload, status = 200) => verifyJapanA4Power160Page(payload, status,
  {query: url('/api/catalog/search', payload.page, payload.page === 2 ? cursor(2) : undefined),
    evidence: japanPageReadEvidence(payload), now});
const ssr = (payload, status = null) => verifyJapanA4Power160SsrPage({ids: payload.items.map(row => row.id),
  cursor: payload.nextCursor, status, now, evidence: japanSsrPageReadEvidence(JSON.stringify({version: 1, page: 1,
    afterSha256: hash(''), receipts: payload.sourceReceipts, omitted: 0}), {page: 1, after: ''})});

test('continuation is a separate opt-in and keeps the historical source-count gate unchanged', () => {
  assert.deepEqual(JAPAN_SOURCE_COUNT_GATES, ['japanSourceCountPassed']);
  assert.deepEqual(JAPAN_A4_POWER160_CONTINUATION_GATES, ['japanA4Power160ContinuationPassed']);
  assert(Object.isFrozen(JAPAN_A4_POWER160_CONTINUATION_GATES));
  for (const value of [undefined, '0']) assert.equal(japanA4Power160ContinuationRequirement(value), false);
  assert.equal(japanA4Power160ContinuationRequirement('1'), true);
  for (const value of [true, false, null, 0, 1, '', 'true'])
    assert.throws(() => japanA4Power160ContinuationRequirement(value), /power_continuation_option/);
  assert(japanA4Power160ApiAllowed(japanA4Power160Api()));
  for (const value of [japanA4Power160Api() + '&countOnly=1', japanA4Power160Api() + '&page=2',
    japanA4Power160Api().replace('make=Audi', 'make=AUDI'), 'https://avtocena.com' + japanA4Power160Api()])
    assert.equal(japanA4Power160ApiAllowed(value), false);
});

test('canonical path and API retain the exact full A4 power/city selection and emitted cursor', () => {
  for (const pathname of ['/cars', '/cars/japan', '/cars/japan/Audi/A4', '/api/catalog/search']) {
    assert.equal(japanA4Power160Selection(url(pathname)).cursor, null);
    assert.equal(japanA4Power160Selection(url(pathname, 2, cursor(2)), {page: 2, expectedCursor: cursor(2)}).cursor, cursor(2));
  }
  const valid = url('/api/catalog/search', 2, cursor(2));
  for (const wrong of [valid.replace('powerTo=160', 'powerTo=159'), valid.replace('powerTo=160&', ''),
    valid.replace('make=Audi', 'make=AUDI'), valid.replace('model=A4', 'model=A3'),
    valid.replace('market=japan', 'market=korea'), valid.replace('city=', 'city=wrong'),
    valid + '&powerTo=160', valid + '&fuel=petrol', valid + '&sort=totalRub', valid + '#fragment',
    valid.replace('avtocena.com', 'supplier.invalid')])
    assert.throws(() => japanA4Power160Selection(wrong, {page: 2, expectedCursor: cursor(2)}), /power_continuation_selection/);
  assert.throws(() => japanA4Power160Selection(valid, {page: 2, expectedCursor: cursor(2).replace(hash('selection'), hash('other'))}), /emitted_cursor/);
  assert.throws(() => japanA4Power160Selection(valid.replace('j2.k.2.0.2.', 'j1.2.0.2.').replace('.' + hash('epoch'), ''), {page: 2}), /power_continuation_cursor/);
  assert.throws(() => japanA4Power160Selection(url('/cars/japan/Audi/A4') + '&market=china'), /selection/);
});

test('bounded partial rows may prove continuation without claiming a full page or a complete selection', () => {
  const value = page(), proof = verify(value);
  assert.equal(proof.shown, 12); assert.equal(proof.scanLimited, true); assert.equal(proof.partial, true);
  assert.equal(proof.selectionIncomplete, true); assert.equal(proof.selectionCompletenessClaimed, false);
  assert.equal(proof.sourcePages, 1); assert.equal(proof.sourceReceiptsFresh, true);
  assert.equal(proof.receiptsSha256, hash(JSON.stringify(value.sourceReceipts)));
  assert.equal(proof.observedAt, observedAt); assert.equal(proof.total, null);
  const full = {...page(1, 24), partial: false, scanLimited: false, selectionIncomplete: false};
  assert.equal(verify(full).shown, 24);
});

test('initial evidence comes from the actual rendered SSR page and leaves unavailable result flags unknown', () => {
  const value = page(), proof = ssr(value);
  assert.equal(proof.kind, 'rendered-ssr'); assert.equal(proof.status, null); assert.equal(proof.shown, 12);
  for (const key of ['partial', 'scanLimited', 'selectionIncomplete', 'interrupted']) assert.equal(proof[key], null);
  assert.equal(proof.afterSha256, hash('')); assert.equal(proof.ssrBindingMatched, true);
  assert.equal(ssr(value, 200).status, 200);
  const base = {ids: value.items.map(row => row.id), cursor: value.nextCursor, now,
    evidence: japanSsrPageReadEvidence(JSON.stringify({version: 1, page: 1, afterSha256: hash(''), receipts: value.sourceReceipts, omitted: 0}), {page: 1, after: ''})};
  for (const patch of [{status: 409}, {ids: [...base.ids, base.ids[0]]}, {ids: []},
    {evidence: {...base.evidence, bindingMatched: false}}, {evidence: {...base.evidence, afterSha256: hash('foreign')}},
    {evidence: {...base.evidence, receipts: []}}, {evidence: {...base.evidence, omitted: 1}},
    {evidence: {...base.evidence, receipts: [{...base.evidence.receipts[0], outcome: 'stale'}]}}])
    assert.throws(() => verifyJapanA4Power160SsrPage({...base, ...patch}), /power_continuation_ssr_/);
  assert.equal(verify({...page(1, 24), partial: false, scanLimited: false, selectionIncomplete: false}).shown, 24,
    'an independent API may fill24 while the rendered SSR evidence still binds12');
  assert.equal(proof.shown, 12);
});

test('DOM power phases use the actual unknown marker and label, never other scenario power text', () => {
  const known = {id: row(1).id, unknownMarkers: 0, unknownVisible: false, unknownText: '', supplierMarkers: 1};
  const unknown = {id: row(2).id, unknownMarkers: 1, unknownVisible: true, unknownText: 'Мощность не указана', supplierMarkers: 0};
  assert.deepEqual(verifyJapanA4Power160DomRows([known, unknown]), [{id: row(1).id, unknown: false}, {id: row(2).id, unknown: true}]);
  for (const patch of [{unknownMarkers: 2}, {unknownVisible: false}, {unknownText: '160 л.с. · уточнить'}, {supplierMarkers: 1}])
    assert.throws(() => verifyJapanA4Power160DomRows([known, {...unknown, ...patch}]), /power_continuation_dom_rows/);
});

test('HTTP409, denied/stale source pages, missing receipts and invented observation dates never pass', () => {
  for (const status of [409, 400, 503]) assert.throws(() => verify(page(), status), /power_continuation_http/);
  for (const patch of [{ok: false}, {stale: true}, {interrupted: true}, {total: 592}, {countSummary: {total: 592}},
    {items: []}, {items: [row(1), row(1)]}, {reads: 0}, {reads: 9}, {sourceReceipts: []},
    {observedAt: new Date(now).toISOString()}, {selectionIncomplete: undefined}])
    assert.throws(() => verify({...page(), ...patch}), /power_continuation_/);
  for (const patch of [{outcome: 'stale'}, {outcome: 'unavailable', reason: 'visitor_restricted'},
    {outcome: 'fresh', reason: 'request_failed'}, {kind: 'models'}, {table: 'main'},
    {observedAt: new Date(now + 1).toISOString()}, {observedAt: new Date(now - 31 * 60_000).toISOString()}]) {
    const value = page(); value.sourceReceipts = [{...value.sourceReceipts[0], ...patch}];
    assert.throws(() => verify(value), /power_continuation_receipts/);
  }
  assert.throws(() => verify(page(1, 24)), /power_continuation_page/, 'scanLimited cannot describe a filled page');
});

test('positive append binds actual IDs/order and exact request cursor without an exact total', () => {
  const first = page(), next = page(2, 6), firstPage = ssr(first), nextPage = verify(next);
  verifyJapanPowerPage(first, 1, {countAcceptance: 'japan-source-count-v1'});
  verifyJapanPowerPage(next, 2, {countAcceptance: 'japan-source-count-v1'});
  const input = {first, next, firstPage, nextPage, cursor: first.nextCursor, responseUrl: url('/api/catalog/search', 2, first.nextCursor),
    visibleIds: [...first.items, ...next.items].map(row => row.id), powerOrder: verifyJapanKnownPowerOrder([first, next]), name: 'after_power_toggle'};
  const proof = verifyJapanA4Power160Append(input);
  assert.equal(proof.loadedBefore, 12); assert.equal(proof.added, 6); assert.equal(proof.loadedAfter, 18);
  assert.equal(proof.duplicateIds, 0); assert.equal(proof.oldIdsPreserved, true); assert.equal(proof.orderPreserved, true);
  assert.equal(proof.afterIdsSha256, hash(JSON.stringify(input.visibleIds)));
  for (const patch of [{visibleIds: [...input.visibleIds].reverse()}, {visibleIds: input.visibleIds.slice(1)},
    {next: {...next, items: [first.items[0], ...next.items.slice(1)]}}, {powerOrder: {knownBeforeUnknown: false, distinctRows: true}},
    {name: 'unobserved_retry'}, {firstPage: {...firstPage, hasMore: false}}])
    assert.throws(() => verifyJapanA4Power160Append({...input, ...patch}), /power_continuation_/);
});

function fixtureArtifact() {
  const expected = {runtimeSha: 'a'.repeat(40), runtimeTree: 'b'.repeat(40), helperSha256: hash('source-helper')};
  const report = a4Power160ContinuationReport(new Date(now).toISOString());
  const value = {passed: true, checkedAt: report.checkedAt, japanA4Power160ContinuationRequired: true,
    japanA4Power160ContinuationPassed: true, controlledBackendContract: 'runtime-resolver-and-power-reader-v1',
    proof: report.checks.a4Power160Continuation,
    controlledTransitions: [['fresh', 'stale'], ['stale', 'fresh'], ['fresh', 'missing'], ['missing', 'fresh']].map(([from, to]) => ({
      from, to, status: 200, renderedBefore: 12, added: 24, loadedAfter: 36,
      cursor: cursor(2), addedIdsSha256: hash('added'), cursorStable: true,
      evidenceEpochStable: true, oldIdsPreserved: true, duplicateIds: 0, runtimeResolver: true, runtimePowerReader: true,
      sourceReadsFresh: true, firstSelectionIncomplete: from !== 'fresh', nextSelectionIncomplete: to !== 'fresh',
      selectionCompletenessClaimed: false,
    }))};
  return {expected, artifact: {version: 1, kind: 'japan-exact-count-browser-v1', passed: true,
    runtimeSha: expected.runtimeSha, runtimeTree: expected.runtimeTree,
    helperSha256: {'scripts/catalog-next/japan-source-count-browser.mjs': expected.helperSha256},
    componentSha256: Object.fromEntries(['apps/web/lib/catalog/ajes-model-resolution.ts', 'apps/web/lib/catalog/ajes-filtered-page.ts',
      'apps/web/lib/catalog/ajes-ssr-read-evidence.ts'].map(file => [file, hash(file)])),
    productionRequests: 0, supplierRequests: 0, forbiddenTransportAttempts: 0,
    liveSourceAccepted: false, backendCensusAccepted: false, countProofContract: 'controlled-ui-mock-v1',
    cases: ['preserved_controls', 'remounted_controls'].map(name => ({name, passed: true, pageErrors: 0,
      sourceCountAcceptance: {passed: true, countAcceptance: report.countAcceptance,
        sourceCount: structuredClone(report.checks.sourceCount), modelCoverage: structuredClone(report.checks.modelCoverage)},
      a4Power160ContinuationAcceptance: structuredClone(value)}))}};
}

test('fixture checker binds the helper/runtime and all four actual controlled metadata transitions in both lifecycles', () => {
  const {artifact, expected} = fixtureArtifact();
  assert.equal(checkedJapanA4Power160ContinuationBrowserFixture(artifact, expected).controlledTransitions, 8);
  for (const mutate of [
    value => { value.runtimeSha = 'c'.repeat(40); }, value => { value.supplierRequests = 1; },
    value => { delete value.componentSha256['apps/web/lib/catalog/ajes-model-resolution.ts']; },
    value => { value.cases.pop(); }, value => { value.cases[1].name = 'preserved_controls'; },
    value => { value.cases[0].sourceCountAcceptance.sourceCount.summary.total = 0; },
    value => { value.cases[0].a4Power160ContinuationAcceptance.proof.attempts[1].status = 409; },
    value => { value.cases[0].a4Power160ContinuationAcceptance.controlledTransitions.pop(); },
    value => { value.cases[0].a4Power160ContinuationAcceptance.controlledTransitions[0].cursorStable = false; },
    value => { value.cases[0].a4Power160ContinuationAcceptance.controlledTransitions[1].runtimeResolver = false; },
    value => { value.cases[0].a4Power160ContinuationAcceptance.controlledTransitions[2].sourceReadsFresh = false; },
    value => { value.cases[0].a4Power160ContinuationAcceptance.controlledTransitions[2].nextSelectionIncomplete = false; },
  ]) {
    const changed = structuredClone(artifact); mutate(changed);
    assert.throws(() => checkedJapanA4Power160ContinuationBrowserFixture(changed, expected), /power_continuation_fixture/);
  }
});
