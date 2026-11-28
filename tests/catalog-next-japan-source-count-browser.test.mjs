import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {JAPAN_SOURCE_COUNT_ACCEPTANCE, JAPAN_SOURCE_COUNT_GATES, japanSourceCountRequirement,
  verifyJapanSourceCountSummary, verifyJapanSourceCountVisible, checkedJapanSourceCountCursor,
  japanSourceCountApi, japanSourceCountApiAllowed, japanSourceCountContinuation}
  from '../scripts/catalog-next/japan-source-count-browser.mjs';
import {japanExactCountQueryHash, JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE}
  from '../scripts/catalog-next/japan-exact-count-browser.mjs';
import {verifyJapanPriceSortCount} from '../scripts/catalog-next/japan-price-sort-browser.mjs';
import {verifyJapanSourceScopePage} from '../scripts/catalog-next/japan-browser-acceptance.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const now = Date.now(), observedAt = new Date(now - 1000).toISOString();
const query = japanSourceCountApi();
const summary = (complete = true, input = query) => ({total: 1234, stale: false, observedAt, upperBound: true,
  precision: 'source-upper-bound', selectionScope: 'source-candidates', sourceScopeComplete: complete,
  sourceCountProof: {version: 1, kind: 'japan-source-count', predicateVersion: 'japan-source-candidates-v1',
    requestedQueryHash: japanExactCountQueryHash(input), sourceQueryHash: hash('candidate sql'), evidenceEpoch: hash('evidence'),
    sourceTotal: 1234, sourceObservedAt: observedAt, sourceScopeComplete: complete, directoryComplete: true}});
const visible = (complete = true) => ({status: complete ? 'bounded' : 'source', sourceTotal: '1234',
  proofKind: 'japan-source-count', requestedQueryHash: japanExactCountQueryHash(query), observedAt,
  loadedCount: '24', exactCount: null, label: complete ? 'Найдено до 1\u00a0234' : 'В источнике: 1\u202f234'});
const j1 = 'j1.2.0.2.' + hash('selection') + '.-';
const j2 = 'j2.k.2.0.2.' + hash('selection') + '.' + hash('epoch') + '.-';
const continuation = cursor => 'https://avtocena.com/cars?' + new URLSearchParams({market: 'japan',
  make: 'Audi', model: 'A4', city: 'Новокузнецк', page: '2', after: cursor});

test('source count has its own explicit option and gate; it never activates exact acceptance', () => {
  assert.equal(JAPAN_SOURCE_COUNT_ACCEPTANCE, 'japan-source-count-v1');
  assert.deepEqual(JAPAN_SOURCE_COUNT_GATES, ['japanSourceCountPassed']);
  assert(Object.isFrozen(JAPAN_SOURCE_COUNT_GATES));
  assert.equal(japanSourceCountRequirement(undefined), false);
  assert.equal(japanSourceCountRequirement('0'), false);
  assert.equal(japanSourceCountRequirement('1'), true);
  for (const value of [true, false, null, 0, 1, 'true', '']) assert.throws(() => japanSourceCountRequirement(value), /option/);
});

test('positive source summary preserves exact query, source observation and distinct proof type', () => {
  const value = summary();
  assert.equal(verifyJapanSourceCountSummary(value, {query, now, positive: true, fresh: true}), value);
  assert.doesNotThrow(() => verifyJapanSourceCountSummary(summary(false), {query, now}));
  for (const patch of [{total: -1}, {total: 1233}, {upperBound: false}, {precision: 'exact'},
    {selectionScope: 'admitted'}, {countProof: {}}, {knownTotal: 1200}, {unknownTotal: 34},
    {sourceScopeComplete: false}, {observedAt: new Date(now + 1).toISOString()}])
    assert.throws(() => verifyJapanSourceCountSummary({...value, ...patch}, {query, now, positive: true, fresh: true}), /source_count_/);
  for (const patch of [{kind: 'japan-admitted-census'}, {version: 2}, {predicateVersion: 'japan-admitted-census-v1'},
    {sourceTotal: 1233}, {requestedQueryHash: hash('other query')}, {sourceQueryHash: ''},
    {directoryComplete: false}, {sourceObservedAt: new Date(now - 2000).toISOString()}])
    assert.throws(() => verifyJapanSourceCountSummary({...value, sourceCountProof: {...value.sourceCountProof, ...patch}}, {query, now}), /source_count_/);
  const old = new Date(now - 31 * 60_000).toISOString();
  const retained = {...value, stale: true, observedAt: old, sourceCountProof: {...value.sourceCountProof, sourceObservedAt: old}};
  assert.doesNotThrow(() => verifyJapanSourceCountSummary(retained, {query, now}));
  assert.throws(() => verifyJapanSourceCountSummary(retained, {query, now, fresh: true}), /summary/);
  assert.equal(retained.observedAt, old, 'accepting retained data must not renew its date');
});

test('visible source label binds the positive count, requested query and original date without an exact counter', () => {
  for (const complete of [true, false]) {
    const input = visible(complete), proof = verifyJapanSourceCountVisible(input,
      {summary: summary(complete), query, loaded: 24, now});
    assert.equal(proof.status, complete ? 'bounded' : 'source');
    assert.equal(proof.sourceTotal, 1234); assert.equal(proof.loadedCount, 24);
    assert.equal(proof.label, input.label); assert.equal(proof.observedAt, observedAt);
    for (const patch of [{status: 'exact'}, {sourceTotal: '23'}, {sourceTotal: '01234'}, {sourceTotal: '1235'},
      {loadedCount: '0'}, {exactCount: '1234'}, {requestedQueryHash: hash('wrong')}, {proofKind: 'japan-admitted-census'},
      {label: 'Найдено 1234'}, {label: complete ? 'В источнике: 1 234' : 'Найдено до 1 234'}, {observedAt: new Date(now).toISOString()}])
      assert.throws(() => verifyJapanSourceCountVisible({...input, ...patch}, {summary: summary(complete), query, loaded: 24, now}), /source_count_/);
  }
});

test('common visitor count checker accepts source labels only under the new profile and validates loaded unknown labels', () => {
  const input = {...visible(), text: 'Найдено до 1 234\nВерхняя оценка. Показано 24.'};
  const options = {loaded: 24, total: null, countSummary: summary(), query, countAcceptance: JAPAN_SOURCE_COUNT_ACCEPTANCE};
  assert.equal(verifyJapanPriceSortCount(input, options).exact, false);
  assert.equal(verifyJapanPriceSortCount(input, options).sourceCount.sourceTotal, 1234);
  for (const countAcceptance of [undefined, JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE, 'japan-source-count-v2'])
    assert.throws(() => verifyJapanPriceSortCount(input, {...options, countAcceptance}), /count/);
  assert.throws(() => verifyJapanPriceSortCount(input, {...options, requireExactCount: true}), /count/);
  const unknown = {status: 'partial', loadedCount: '24', exactCount: null, text: 'Показано 24 · общий итог уточняется'};
  assert.equal(verifyJapanPriceSortCount(unknown, options).loaded, 24);
  for (const text of ['Количество уточняется', 'Показано 0 · общий итог уточняется', 'Показано 24', 'Найдено 0'])
    assert.throws(() => verifyJapanPriceSortCount({...unknown, text}, options), /count_visible/);
  assert.throws(() => verifyJapanPriceSortCount(unknown, {...options, total: 1234}), /count_visible/);
  for (const label of ['73', 'Найдено 73'])
    assert.equal(verifyJapanPriceSortCount({status: 'exact', loadedCount: '24', exactCount: '73', text: label + '\nПоказано 24.', label},
      {loaded: 24, total: 73, requireExactCount: true}).exact, true);
  assert.throws(() => verifyJapanPriceSortCount({status: 'exact', loadedCount: '24', exactCount: '1234', text: 'Найдено до 1 234', label: 'Найдено до 1 234'},
    {loaded: 24, total: 1234, requireExactCount: true}), /false_exact_count/);
});

test('the added explicit reads are exactly the existing titlecase A4 bookmark and one countOnly request', () => {
  for (const countOnly of [false, true]) {
    const value = japanSourceCountApi({countOnly}); assert(japanSourceCountApiAllowed(value));
    for (const suffix of ['&page=2', ...(countOnly ? ['&countOnly=1'] : []), '&market=korea', '&make=AUDI', '&fuel=diesel', '&stock=green', '#fragment'])
      assert.equal(japanSourceCountApiAllowed(value + suffix), false);
    for (const wrong of [value.replace('make=Audi', 'make=AUDI'), value.replace('model=A4', 'model=A3'),
      value.replace('page=1', 'page=2'), 'https://avtocena.com' + value]) assert.equal(japanSourceCountApiAllowed(wrong), false);
  }
  assert.equal(japanExactCountQueryHash(japanSourceCountApi({countOnly: true})), japanExactCountQueryHash(query));
});

test('continuation follows only the actual matching cursor and same raw query, with finite j1/j2 grammar', () => {
  for (const cursor of [j1, j2]) {
    assert.equal(checkedJapanSourceCountCursor(cursor).visiblePage, 2);
    assert.equal(japanSourceCountContinuation(continuation(cursor), cursor), cursor);
    assert.equal(japanSourceCountContinuation(continuation(cursor).replace('/cars?', '/api/catalog/search?') + '&marketPage=1', cursor), cursor);
    for (const wrong of [continuation(cursor).replace('make=Audi', 'make=AUDI'), continuation(cursor).replace('model=A4', 'model=A3'),
      continuation(cursor).replace('page=2', 'page=3'), continuation(cursor) + '&make=Audi', continuation(cursor) + '&fuel=petrol',
      continuation(cursor).replace('avtocena.com', 'supplier.example')]) assert.throws(() => japanSourceCountContinuation(wrong, cursor), /continuation/);
    assert.throws(() => japanSourceCountContinuation(continuation(cursor), 'different'), /emitted_cursor/);
  }
  for (const cursor of [j1.replace('.2.0.', '.1000001.0.'), j1.replace('.2.0.', '.2.24.'),
    j1.replace('.2.0.', '.2.1.'), j2.replace('.2.0.', '.2.25.'), j2.replace('.2.0.', '.2.01.'), 'jp1.unbound'])
    assert.throws(() => checkedJapanSourceCountCursor(cursor), /cursor/);
});

test('new source candidates can accompany only the existing verified source-scope partial page; old profile stays count-free', () => {
  const input = '/api/catalog/search?' + new URLSearchParams({market: 'japan', page: '1', pageSize: '24', city: 'Новокузнецк', powerTo: '160', fuel: 'petrol'});
  const receipt = {version: 1, requestId: '12345678-1234-4234-8234-123456789012', queryHash: hash('list'), table: 'stats', kind: 'list', page: 1, pageSize: 24,
    startedAt: observedAt, finishedAt: observedAt, stage: 'supplier', supplierAttempted: true, outcome: 'fresh', observedAt};
  const page = {page: 1, pageSize: 24, partial: true, selectionIncomplete: false, stale: false, interrupted: false, scanLimited: false,
    total: null, countSummary: summary(false, input), items: Array.from({length: 24}, (_, i) => ({id: i})), hasMore: true,
    reads: 1, nextCursor: j2, observedAt, sourceReceipts: [receipt]};
  assert.equal(verifyJapanSourceScopePage(page, {query: input, now, countAcceptance: JAPAN_SOURCE_COUNT_ACCEPTANCE}).freshSourcePages, 1);
  assert.throws(() => verifyJapanSourceScopePage(page, {query: input, now, countAcceptance: JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE}), /source_scope_partial/);
  for (const patch of [{stale: true}, {selectionIncomplete: true}, {interrupted: true}, {scanLimited: true}, {total: 1234},
    {sourceReceipts: [{...receipt, outcome: 'stale'}]}, {sourceReceipts: []}, {countSummary: {...summary(false, input), countProof: {}}}])
    assert.throws(() => verifyJapanSourceScopePage({...page, ...patch}, {query: input, now, countAcceptance: JAPAN_SOURCE_COUNT_ACCEPTANCE}), /source_(?:scope|count)_/);
});
