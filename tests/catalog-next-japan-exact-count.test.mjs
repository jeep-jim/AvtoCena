import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {JAPAN_EXACT_COUNT_GATES, japanExactCountRequirement, japanExactCountQueryHash,
  verifyJapanExactCount, verifyJapanExactCountStable, japanExactCountApi, japanExactCountApiAllowed,
  japanExactCountPageApi, japanBudgetCandidate, checkedJapanAudiDirectory, japanAudiA4Family,
  verifyJapanModelCoverage, collectJapanModelOptions, verifyJapanAudiRows, verifyJapanFiniteSelection}
  from '../scripts/catalog-next/japan-exact-count-browser.mjs';
import {verifyJapanPowerPage, verifyJapanPage, verifyJapanFullPage, verifyJapanVisibleVehiclePolicy,
  verifyJapanPaginationPair} from '../scripts/catalog-next/japan-browser-acceptance.mjs';
import {verifyJapanPriceSortCount, japanPriceSortApi} from '../scripts/catalog-next/japan-price-sort-browser.mjs';
import {EXACT_FIXTURE_IDS, BUDGET_FIXTURE_IDS, fixtureRows, fixtureResult, fixtureDirectory}
  from './browser/japan-exact-count.mjs';

const CITY = 'Новокузнецк', ORIGIN = 'https://avtocena.com', now = new Date().toISOString();
const query = {market: 'japan', city: CITY, powerTo: '160'};
const budgetQuery = {...query, make: 'AUDI', model: 'A4', budgetTo: '1303000'};
const hash = value => createHash('sha256').update(value).digest('hex');
const result = (patch = {}) => fixtureResult({...query, ...patch}, now);
const proofOf = payload => payload.countSummary.countProof;
const allPages = params => {
  const pages = [fixtureResult(params, now)];
  while (pages.at(-1).hasMore) pages.push(fixtureResult({...params, page: String(pages.length + 1), after: pages.at(-1).nextCursor}, now));
  return pages;
};

test('exact-count successor is feature-bound; historical profiles do not acquire new requirements', () => {
  assert.deepEqual(JAPAN_EXACT_COUNT_GATES, ['japanExactCountPassed', 'japanModelCoveragePassed']);
  assert(Object.isFrozen(JAPAN_EXACT_COUNT_GATES));
  assert.equal(japanExactCountRequirement(undefined), false);
  assert.equal(japanExactCountRequirement('0'), false); assert.equal(japanExactCountRequirement('1'), true);
  for (const value of [true, false, 1, 'true', '', null]) assert.throws(() => japanExactCountRequirement(value), /option/);
  const exact = result();
  assert.throws(() => verifyJapanPowerPage(exact), /false_exact_count/);
  assert.equal(verifyJapanPowerPage(exact, 1, {requireExactCount: true, query}).countHonest, true);
  const old = {...exact, total: null, countSummary: null};
  assert.equal(verifyJapanPowerPage(old).countHonest, true);
  assert.throws(() => verifyJapanPowerPage(old, 1, {requireExactCount: true, query}), /exact_count_summary/);
});

test('public count hash matches the producer canonical object and ignores only presentation/transport', () => {
  const expected = hash(JSON.stringify({city: CITY, market: 'japan', powerTo: '160'}));
  assert.equal(japanExactCountQueryHash(query), expected);
  assert.equal(japanExactCountQueryHash({...query, powerTo: [' 160 ', '220'], sort: 'totalRubDesc', page: '8',
    pageSize: '24', after: 'ignored', view: 'list', marketPage: '2', countOnly: '1', source: 'stats'}), expected);
  assert.equal(japanExactCountQueryHash({...query, brand: 'AUDI', body: 'sedan', budget: '1303000'}),
    japanExactCountQueryHash({...query, make: 'AUDI', bodyType: 'sedan', budgetTo: '1303000'}));
  assert.equal(japanExactCountQueryHash({...query, make: 'AUDI', brand: 'wrong'}), japanExactCountQueryHash({...query, make: 'AUDI'}));
  for (const patch of [{city: 'Москва'}, {model: 'A4'}, {powerTo: '150'}, {budgetTo: '1303000'}, {fuel: 'petrol'}])
    assert.notEqual(japanExactCountQueryHash({...query, ...patch}), expected);
  assert.equal(japanExactCountQueryHash(japanPriceSortApi('totalRub')), expected);
  for (const wrong of [null, [], {...query, market: 'china'}, ORIGIN + japanPriceSortApi() + '&city=Moscow',
    'https://foreign.example/api/catalog/search?market=japan']) assert.throws(() => japanExactCountQueryHash(wrong));
});

test('73 is the full admitted selection while each initial page contains 24; sort and append preserve its proof', () => {
  const pages = allPages(query), initial = verifyJapanExactCount(pages[0], {query});
  assert.equal(initial.total, 73); assert.equal(pages[0].items.length, 24); assert.equal(pages[0].hasMore, true);
  assert.deepEqual(pages.map(page => page.items.length), [24, 24, 24, 1]);
  for (const page of pages) {
    assert.equal(verifyJapanPage(page, 200).shown, page.items.length);
    assert.equal(verifyJapanFullPage(page).fullOrExhausted, true);
    assert.equal(verifyJapanPowerPage(page, page.page, {requireExactCount: true, query}).countHonest, true);
    verifyJapanExactCountStable(initial, verifyJapanExactCount(page, {query}));
  }
  for (const sort of ['totalRubDesc', 'totalRub'])
    verifyJapanExactCountStable(initial, verifyJapanExactCount(result({sort}), {query: {...query, sort}}));
  assert.equal(verifyJapanVisibleVehiclePolicy(pages).checked, 73);
  const pair = verifyJapanPaginationPair(pages[0], pages[1], {observedUrl: ORIGIN + '/cars/japan?'
    + new URLSearchParams({city: CITY, powerTo: '160', page: '2', after: pages[0].nextCursor}),
    kind: 'power', firstStatus: 200, nextStatus: 200, requirePowerOrder: true, requireExactCount: true});
  assert.equal(pair.exactCount.total, 73);
});

test('a total alone, source upper bound, incomplete groups, duplicate IDs, stale evidence and wrong parent query cannot pass', () => {
  const mutate = fn => { const value = result(); fn(value, proofOf(value)); return value; };
  for (const value of [
    mutate(value => { value.total = null; }),
    mutate(value => { value.countSummary.upperBound = true; }),
    mutate(value => { value.countSummary.stale = true; }),
    mutate(value => { delete value.countSummary.countProof; }),
    mutate((value, proof) => { proof.complete = false; }),
    mutate((value, proof) => { proof.groupedTotal--; }),
    mutate((value, proof) => { proof.sourceDistinctTotal--; }),
    mutate((value, proof) => { delete proof.sourceDistinctTotal; }),
    mutate((value, proof) => { proof.coverageHash = ''; }),
    mutate((value, proof) => { proof.predicateVersion = 'unreviewed'; }),
    mutate((value, proof) => { proof.pages = 0; }),
    mutate((value, proof) => { proof.unknownTotal--; }),
    mutate((value, proof) => { proof.sourceObservedAt = new Date(Date.now() - 31 * 60_000).toISOString(); }),
    mutate((value, proof) => { value.countSummary.observedAt = new Date(Date.now() - 60_000).toISOString(); }),
    mutate((value, proof) => { proof.sourceObservedAt = value.countSummary.observedAt = new Date(Date.now() + 30_000).toISOString(); }),
    mutate((value, proof) => { proof.sourceCompletedAt = new Date(Date.now() + 120_000).toISOString(); }),
    mutate((value, proof) => { proof.sourceObservedAt = 'invalid'; }),
    mutate(value => { value.partial = true; }), mutate(value => { value.scanLimited = true; }),
    mutate(value => { value.interrupted = true; }), mutate(value => { value.stale = true; }),
    mutate(value => { value.hasMore = false; }),
    mutate(value => { value.countSummary.total = 24; }),
  ]) assert.throws(() => verifyJapanExactCount(value, {query}));
  assert.throws(() => verifyJapanExactCount(result(), {query: {...query, city: 'Москва'}}), /query_binding/);
  assert.throws(() => verifyJapanExactCount(result(), {query, loadedCount: 74}), /loaded/);
  const first = verifyJapanExactCount(result(), {query});
  for (const key of ['queryHash', 'requestedQueryHash', 'evidenceEpoch', 'coverageHash'])
    assert.throws(() => verifyJapanExactCountStable(first, {...first, [key]: 'f'.repeat(64)}), /changed_selection/);
});

test('signed editorial corrections are supported and an authoritative empty source is distinct from a missing count', () => {
  const corrected = result(); Object.assign(proofOf(corrected), {baseAdmittedTotal: 74, correctionCount: 1, correctionDelta: -1});
  assert.equal(verifyJapanExactCount(corrected, {query}).total, 73);
  proofOf(corrected).correctionCount = 0;
  assert.throws(() => verifyJapanExactCount(corrected, {query}), /coverage/);
  const empty = result(); Object.assign(empty, {total: 0, items: [], hasMore: false, nextCursor: null});
  Object.assign(empty.countSummary, {total: 0});
  Object.assign(proofOf(empty), {sourceTotal: 0, sourceDistinctTotal: 0, groupedTotal: 0, baseAdmittedTotal: 0,
    admittedTotal: 0, groupCount: 0, pages: 0, correctionCount: 0, correctionDelta: 0, knownTotal: 0, unknownTotal: 0});
  assert.equal(verifyJapanExactCount(empty, {query}).total, 0);
  assert.throws(() => verifyJapanExactCount({...empty, countSummary: []}, {query}), /summary/);
});

test('exact visible count remains 73 after append48; loaded count is independent and never substituted', () => {
  const badge = loaded => ({status: 'exact', loadedCount: String(loaded), exactCount: '73', text: '73'});
  for (const loaded of [24, 48, 72, 73]) assert.equal(verifyJapanPriceSortCount(badge(loaded),
    {loaded, total: 73, hasMore: loaded < 73, requireExactCount: true}).exact, true);
  assert.throws(() => verifyJapanPriceSortCount(badge(24), {loaded: 24, total: 73}), /false_exact_count/);
  for (const patch of [{text: 'Загружено 24'}, {text: 'Количество уточняется'}, {exactCount: '24'}, {status: 'partial'}])
    assert.throws(() => verifyJapanPriceSortCount({...badge(24), ...patch}, {loaded: 24, total: 73, requireExactCount: true}));
});

test('finite source closure proves every ID, final partial page and complete known-before-unknown partition', () => {
  const pages = allPages(query), proof = verifyJapanFiniteSelection(pages, {query, expectedIds: EXACT_FIXTURE_IDS});
  assert.deepEqual(proof.pageSizes, [24, 24, 24, 1]); assert.equal(proof.known, 50); assert.equal(proof.unknown, 23);
  for (const mutate of [
    values => { values[1].items[0] = values[0].items[0]; },
    values => { values[2].items.pop(); },
    values => { [values[0].items[0], values[2].items[3]] = [values[2].items[3], values[0].items[0]]; },
    values => { values[3].nextCursor = values[0].nextCursor; },
  ]) { const broken = structuredClone(pages); mutate(broken); assert.throws(() => verifyJapanFiniteSelection(broken, {query, expectedIds: EXACT_FIXTURE_IDS})); }
  assert.throws(() => verifyJapanFiniteSelection(pages, {query, expectedIds: [...EXACT_FIXTURE_IDS.slice(0, -1), 'ajes-stats-missing']}), /membership/);
});

test('price budget uses a displayed city amount and closes a different 38-car source selection', () => {
  const displayed = result().items.map(row => ({id: row.id,
    amount: row.japanDeliveredPreview.totalRub - row.japanDeliveredPreview.deliveryPricingBasis.deliveryRub + 120_000}));
  const candidate = japanBudgetCandidate(displayed);
  assert.equal(candidate.amount, 1_303_000); assert(displayed.some(row => row.id === candidate.id && row.amount === candidate.amount));
  const pages = allPages(budgetQuery), proof = verifyJapanFiniteSelection(pages, {query: budgetQuery, expectedIds: BUDGET_FIXTURE_IDS});
  assert.equal(proof.total, 38); assert.deepEqual(proof.pageSizes, [24, 14]); assert.equal(proof.unknown, 0);
  assert.notEqual(proofOf(pages[0]).requestedQueryHash, proofOf(result()).requestedQueryHash);
  assert.equal(japanExactCountQueryHash({...budgetQuery, budgetTo: undefined, budget: '1303000'}), japanExactCountQueryHash(budgetQuery));
  assert.throws(() => verifyJapanExactCount({...pages[0], countSummary: null}, {query: budgetQuery}), /summary/);
  assert.throws(() => japanBudgetCandidate([{id: 'unpriced', amount: null}]), /budget_price/);
});

test('new API scope is only Audi/A4, the selected city, its chosen budget and one emitted next page', () => {
  for (const kind of ['plain', 'make', 'model', 'combined', 'models', 'budget']) {
    const options = kind === 'budget' ? {budgetTo: '1303000'} : {};
    const api = japanExactCountApi(kind, options); assert(japanExactCountApiAllowed(api));
    for (const suffix of ['&market=korea', '&city=Moscow', '&stock=green', '#invalid']) assert.equal(japanExactCountApiAllowed(api + suffix), false);
    assert.equal(japanExactCountApiAllowed(ORIGIN + api), false);
  }
  for (const kind of ['combined', 'budget']) {
    const params = kind === 'budget' ? budgetQuery : {...query, make: 'AUDI', model: 'A4'};
    const first = fixtureResult(params, now), options = {kind, make: 'AUDI', expectedCursor: first.nextCursor,
      ...(kind === 'budget' ? {budgetTo: '1303000'} : {})};
    const href = '/cars?' + new URLSearchParams({...params, page: '2', after: first.nextCursor});
    const api = japanExactCountPageApi(href, options); assert(japanExactCountApiAllowed(api));
    assert.equal(api, japanExactCountPageApi(href.replace('budgetTo=', 'budget='), options));
    const canonical = '/cars/japan/AUDI/A4?' + new URLSearchParams({city: CITY, powerTo: '160',
      ...(kind === 'budget' ? {budget: '1303000'} : {}), page: '2', after: first.nextCursor});
    assert.equal(japanExactCountPageApi(canonical, options), api);
    for (const wrong of [href + '&sort=totalRubDesc', href + '&city=Moscow', href.replace('page=2', 'page=3'),
      href.replace('market=japan', 'market=china'), 'https://foreign.example' + href])
      assert.throws(() => japanExactCountPageApi(wrong, options));
    for (const token of [first.nextCursor.replace('.k.2.0.', '.k.0.0.'), first.nextCursor.replace('.k.2.0.', '.k.2.25.'),
      first.nextCursor.replace('.k.2.0.', '.k.2.1.'), first.nextCursor.replace('.k.2.0.', '.k.1000001.0.')])
      assert.throws(() => japanExactCountApi(kind, {...options, page: 2, after: token}));
  }
  for (const budgetTo of ['0', '-1', '30000001', '1.5', '1e6']) assert.throws(() => japanExactCountApi('budget', {budgetTo}));
});

test('Audi family includes observed spelling variants but excludes A40/RS4; UI must expose every source pair', async () => {
  const directory = checkedJapanAudiDirectory(fixtureDirectory(now), 200);
  assert.equal(directory.length, 94); assert.equal(directory.some(row => row.model === 'A4'), false);
  for (const model of ['A4', 'A4 AVANT', 'A4 ALLROAD', 'A-4', 'A 4', 'Ａ４', 'A4L', 'Audi A4']) assert(japanAudiA4Family(model), model);
  for (const model of ['A40', 'RS4', 'A400', 'Q4']) assert.equal(japanAudiA4Family(model), false, model);
  const options = directory.map(({make, model}) => ({make, model}));
  assert.equal(verifyJapanModelCoverage(directory, options).allSourceModelsAccessible, true);
  for (const wrong of [options.slice(0, 60), options.slice(1), [...options, options[0]], [...options, {make: 'Audi', model: 'invented'}]])
    assert.throws(() => verifyJapanModelCoverage(directory, wrong));
  assert.equal(verifyJapanAudiRows(result({make: 'AUDI', model: 'A4'}), directory).observedSourceNamesOnly, true);
  assert.throws(() => verifyJapanAudiRows({items: [fixtureRows(now)[83]]}, directory), /a4_membership/);
  for (const patch of [{stale: true}, {models: []}, {models: [...fixtureDirectory(now).models, fixtureDirectory(now).models[0]]}])
    assert.throws(() => checkedJapanAudiDirectory({...fixtureDirectory(now), ...patch}, 200));
});

test('the actual model expansion helper reaches beyond sixty and rejects a silently truncated picker', async () => {
  const directory = checkedJapanAudiDirectory(fixtureDirectory(now), 200);
  function picker(truncated = false) {
    let limit = 60;
    const current = () => directory.slice(0, limit);
    const options = {count: async () => current().length,
      nth: index => ({waitFor: async () => assert(index < current().length)}),
      evaluateAll: async callback => callback(current().map(row => ({getAttribute: key => key === 'data-model-make' ? row.make : row.model})))};
    return {locator: () => options, getByRole: () => ({count: async () => Number(!truncated && limit < directory.length),
      click: async () => { limit += 60; }})};
  }
  const progress = {}, checked = await collectJapanModelOptions(picker(), directory, progress);
  assert.equal(checked.proof.accessiblePairs, 94); assert.equal(progress.modelExpansions, 1);
  await assert.rejects(collectJapanModelOptions(picker(true), directory), /model_coverage/);
});
