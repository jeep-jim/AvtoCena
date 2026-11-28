import test from 'node:test';
import assert from 'node:assert/strict';
import {JAPAN_PRICE_SORT_GATES, checkedJapanPriceSortCursor, japanPriceSortApi, japanPriceSortApiAllowed,
  japanPriceSortPageApi, japanPriceSortSelectionUrl, verifyJapanPriceSortRows, verifyJapanPriceSortCount,
  verifyJapanPriceSortVisible, selectJapanPowerBeforePriceSort, selectJapanPriceSort} from '../scripts/catalog-next/japan-price-sort-browser.mjs';

const CITY = 'Новокузнецк', ORIGIN = 'https://avtocena.com';
const cursor = (page = 2) => 'j2.k.2.0.' + page + '.' + '1'.repeat(64) + '.' + '2'.repeat(64) + '.-';
const documentUrl = (sort = '', page = 1, after = cursor()) => ORIGIN + '/cars/japan?'
  + new URLSearchParams({city: CITY, powerTo: '160', ...(sort ? {sort} : {}),
    ...(page === 2 ? {page: '2', after} : {})});
const row = (id, price, unknown = false, extra = {}) => ({id: 'ajes-stats-' + id, market: 'japan',
  catalogPricingMode: 'seller', sellerPriceRub: 100_000, japanDeliveredPreview: price === null ? null : {totalRub: price},
  ...(unknown ? {japanPowerUnknown: true} : {japanSupplierPower: {hp: 150}}), ...extra});
const result = items => ({items, hasMore: false});

test('the new gates are separate and the exact visitor queries include both real price sort values', () => {
  assert.deepEqual(JAPAN_PRICE_SORT_GATES, ['japanPriceSortPassed', 'japanCountDisplayPassed']);
  assert(Object.isFrozen(JAPAN_PRICE_SORT_GATES));
  for (const sort of ['', 'totalRubDesc', 'totalRub']) {
    const api = japanPriceSortApi(sort);
    assert(japanPriceSortApiAllowed(api));
    assert.equal(new URL(api, ORIGIN).searchParams.get('sort'), sort || null);
    for (const suffix of ['&market=korea', ...(sort ? ['&sort=totalRub'] : []), '&page=2', '&stock=green', '&make=Toyota', '#bad'])
      assert.equal(japanPriceSortApiAllowed(api + suffix), false, suffix);
  }
  for (const sort of ['totalRubAsc', 'FINISH', 'year', 'totalRub,mileage', null])
    assert.throws(() => japanPriceSortApi(sort), /price_sort_query/);
  for (const wrong of [japanPriceSortApi().replace('market=japan', 'market=korea'),
    japanPriceSortApi().replace('powerTo=160', 'powerTo=200'),
    japanPriceSortApi().replace('pageSize=24', 'pageSize=48'),
    japanPriceSortApi().replace('/api/catalog/search', '/api/catalog/brand-counts'),
    ORIGIN + japanPriceSortApi(), 'https://supplier.example/api', '/api/crm/catalog'])
    assert.equal(japanPriceSortApiAllowed(wrong), false, wrong);
});

test('sorted page-two admission is exact, emitted and never expands to a pagination loop', () => {
  for (const sort of ['totalRubDesc', 'totalRub']) {
    const href = documentUrl(sort, 2);
    const api = japanPriceSortPageApi(href, {sort, expectedCursor: cursor()});
    assert.equal(api, japanPriceSortApi(sort, {page: 2, after: cursor()}));
    assert(japanPriceSortApiAllowed(api));
    assert.equal(japanPriceSortPageApi(href.slice(ORIGIN.length), {sort}), api);
    assert.equal(japanPriceSortPageApi(href.replace('/cars/japan?', '/cars?market=japan&'), {sort}), api);
    for (const wrong of [href + '&fuel=petrol', href + '&city=' + CITY, href.replace('page=2', 'page=3'),
      href.replace('/cars/japan', '/cars/china'), href.replace('avtocena.com', 'other.example')])
      assert.throws(() => japanPriceSortPageApi(wrong, {sort}), /price_sort_continuation_query/);
    assert.throws(() => japanPriceSortPageApi(href, {sort, expectedCursor: cursor().replace('.k.', '.u.')}), /emitted_cursor/);
  }
  assert.throws(() => japanPriceSortApi('', {page: 2, after: cursor()}), /query/);
  assert.throws(() => japanPriceSortApi('totalRub', {page: 3, after: cursor(3)}), /query/);
  assert.throws(() => japanPriceSortApi('totalRub', {page: 1, after: cursor()}), /query/);
  for (const value of ['', '2.0', 'jp1.' + '1'.repeat(32) + '.2.' + '1'.repeat(16), cursor(3),
    cursor().replace('.2.0.', '.1000001.0.'), cursor().replace('.2.0.', '.2.25.'),
    cursor().replace('.2.0.', '.2.1.')]) assert.throws(() => checkedJapanPriceSortCursor(value), /cursor/);
});

test('canonical selected URLs preserve the exact city and reject stale page cursors after sort change', () => {
  assert(japanPriceSortSelectionUrl(ORIGIN + '/cars/japan?' + new URLSearchParams({city: CITY}), {power: false}));
  for (const sort of ['', 'totalRubDesc', 'totalRub']) {
    assert(japanPriceSortSelectionUrl(documentUrl(sort), {sort}));
    assert.equal(japanPriceSortSelectionUrl(documentUrl(sort) + '&page=1', {sort}), false);
    assert.equal(japanPriceSortSelectionUrl(documentUrl(sort).replace('powerTo=160', 'powerTo=150'), {sort}), false);
    assert.equal(japanPriceSortSelectionUrl(documentUrl(sort).replace('/japan?', '/japan/Mazda?'), {sort}), false);
    assert.equal(japanPriceSortSelectionUrl(documentUrl(sort) + '&after=' + cursor(), {sort}), false);
  }
});

test('the user screenshot zero-row state fails even when continuation is present', () => {
  for (const sort of ['totalRubDesc', 'totalRub']) {
    assert.throws(() => verifyJapanPriceSortRows({items: [], hasMore: true}, sort), /price_sort_rows/);
    assert.throws(() => verifyJapanPriceSortRows({items: [row('one', 1_000_000)], hasMore: true}, sort), /price_sort_rows/);
  }
});

test('price direction is verified independently inside each power lane, never globally across page batches', () => {
  for (const [sort, prices] of [['totalRub', [1_000_000, 2_000_000]], ['totalRubDesc', [2_000_000, 1_000_000]]]) {
    const page = result([row('k1', prices[0]), row('k2', prices[1]), row('u1', prices[0] / 2, true), row('u2', prices[1] / 2, true)]);
    const proof = verifyJapanPriceSortRows(page, sort);
    assert.equal(proof.knownPower, 2); assert.equal(proof.unknownPower, 2);
    assert.equal(proof.priceOrderWithinLoadedLanes, true); assert.equal(proof.globalPriceOrderClaimed, false);
    assert.throws(() => verifyJapanPriceSortRows(result([page.items[1], page.items[0], ...page.items.slice(2)]), sort), /price_sort_order/);
    assert.throws(() => verifyJapanPriceSortRows(result([page.items[0], page.items[2], page.items[1]]), sort), /power_lane/);
    // A later loaded page can have lower/higher values; that is not a claim of
    // an exhaustive global AJ delivered-price index.
    assert.doesNotThrow(() => verifyJapanPriceSortRows(result([row('next', prices[0] / 10)]), sort));
  }
});

test('missing delivered calculations follow real prices and use seller price only among missing values', () => {
  const page = result([row('known', 1_000_000), row('missing1', null, false, {sellerPriceRub: 500_000}),
    row('missing2', null, false, {sellerPriceRub: 400_000})]);
  assert.equal(verifyJapanPriceSortRows(page, 'totalRubDesc').deliveredPrices, 1);
  assert.throws(() => verifyJapanPriceSortRows(result([page.items[1], page.items[0], page.items[2]]), 'totalRubDesc'), /order/);
  assert.throws(() => verifyJapanPriceSortRows(result([page.items[0], page.items[2], page.items[1]]), 'totalRubDesc'), /order/);
  assert.throws(() => verifyJapanPriceSortRows(result([row('missing', null)]), 'totalRub'), /priced_rows/);
  assert.throws(() => verifyJapanPriceSortRows(result([row('same', 10), row('same', 10)]), 'totalRub'), /priced_rows/);
});

test('city delivery can reverse base price order; the live oracle uses rendered selected-city amounts', () => {
  const first = row('higher-base-lower-delivery', 950_000), second = row('lower-base-higher-delivery', 900_000);
  const rows = result([first, second]);
  assert.throws(() => verifyJapanPriceSortRows(rows, 'totalRub'), /price_sort_order/);
  const visiblePrices = new Map([[first.id, 970_000], [second.id, 1_020_000]]);
  assert.equal(verifyJapanPriceSortRows(rows, 'totalRub', {visiblePrices}).priceBasis, 'displayed_selected_city');
  assert.throws(() => verifyJapanPriceSortRows(rows, 'totalRubDesc', {visiblePrices}), /price_sort_order/);
  assert.throws(() => verifyJapanPriceSortRows(rows, 'totalRub', {visiblePrices: new Map()}), /displayed_price/);
});

test('visible partial count follows loaded rows and never turns supplier upper bound into an exact total', () => {
  const count = (loaded = 24) => ({status: 'partial', loadedCount: String(loaded), exactCount: null,
    text: 'Загружено ' + loaded + ' · количество уточняется'});
  assert.equal(verifyJapanPriceSortCount(count(), {loaded: 24}).exact, false);
  assert.equal(verifyJapanPriceSortCount(count(48), {loaded: 48}).loaded, 48);
  for (const patch of [{loadedCount: '0'}, {loadedCount: '23'}, {exactCount: '10000'},
    {status: 'exact', exactCount: '10000'}, {text: ''}, {text: 'Количество уточняется'}, {text: 'Загружено 0 · количество уточняется'}])
    assert.throws(() => verifyJapanPriceSortCount({...count(), ...patch}, {loaded: 24}), /count/);
  assert.throws(() => verifyJapanPriceSortCount(count(), {loaded: 0}), /count_visible/);
  assert.doesNotThrow(() => verifyJapanPriceSortCount({status: 'exact', loadedCount: '12', exactCount: '12', text: '12'},
    {loaded: 12, total: 12, hasMore: false}));
  assert.throws(() => verifyJapanPriceSortCount({status: 'exact', loadedCount: '24', exactCount: '24', text: '24'},
    {loaded: 24, total: 24, hasMore: true}), /false_exact_count/);
});

/** Execute the actual browser-side ID readers against DOM-shaped cards. The
 * legacy locator is modelled too, so the overlapping-ID regression fails on
 * the old helper with the same 11-card strict-mode collision as Chromium. */
function visibleCards(hrefs) {
  const nodes = hrefs.map(href => ({href, querySelectorAll(selector) {
    assert.equal(selector, 'a[href]');
    // The image and title can both link to the same offer within one card.
    return [1, 2].map(() => ({getAttribute: name => name === 'href' ? href : null}));
  }}));
  const cards = {
    nth: index => ({waitFor: async () => assert(nodes[index])}),
    filter: ({has}) => ({waitFor: async () => assert.equal(nodes.filter(node => node.href.includes(has.token)).length, 1,
      'strict card wait must identify one offer, not every longer ID with the same prefix')}),
    evaluateAll: async (reader, expected) => reader(nodes, expected),
  };
  const badge = {waitFor: async () => {}, count: async () => 1,
    locator: () => ({count: async () => 0}),
    getAttribute: async name => ({'data-japan-count-status': 'partial', 'data-japan-loaded-count': String(nodes.length)})[name] ?? null,
    innerText: async () => 'Загружено ' + nodes.length + ' · количество уточняется'};
  const catalog = {locator: selector => selector.startsWith('article.') ? cards : badge,
    getByText: text => ({count: async () => text instanceof RegExp ? 1 : 0, isVisible: async () => true})};
  return {locator(selector) {
    if (selector === 'main.ac-ajes-catalog') return catalog;
    const token = /^a\[href\*="([^"]+)"\]$/.exec(selector)?.[1];
    assert(token, selector); return {token};
  }, async waitForFunction(predicate, input) {
    const previous = globalThis.document;
    globalThis.document = {querySelector: selector => {
      assert.equal(selector, 'main.ac-ajes-catalog'); return {querySelectorAll: () => nodes};
    }};
    try { assert.equal(predicate(input), true, 'exact offer membership must become ready'); }
    finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
  }};
}

test('visible card waits distinguish ID 1 from 10–19 at every real offer path boundary', async () => {
  const items = Array.from({length: 24}, (_, index) => row('sort-1-' + index, 1_000_000 + index));
  const endings = ['', '/toyota-test-2022', '?city=' + encodeURIComponent(CITY), '#price'];
  const hrefs = items.map((item, index) => (index % 2 ? ORIGIN : '') + '/cars/offer/' + item.id + endings[index % endings.length]);
  assert.equal(hrefs.filter(href => href.includes('ajes-stats-sort-1-1')).length, 11);
  const proof = await verifyJapanPriceSortVisible(visibleCards(hrefs), items, {total: null, hasMore: true});
  assert.equal(proof.rowOrderMatchesApi, true); assert.equal(proof.loaded, 24);
  const reversed = [...hrefs]; [reversed[1], reversed[10]] = [reversed[10], reversed[1]];
  await assert.rejects(verifyJapanPriceSortVisible(visibleCards(reversed), items, {total: null, hasMore: true}), /ui_order/);
  const missing = [...hrefs]; missing[1] = hrefs[10];
  await assert.rejects(verifyJapanPriceSortVisible(visibleCards(missing), items, {total: null, hasMore: true}), /exact offer membership/);
});

/** The helpers must wait for real hydration and acknowledgement before the
 * next choice. This fake only records control protocol; Chromium coverage
 * below uses the exact-runtime production components. */
function controlsJourney({wrongCity = false, wrongValue = false, remount = false} = {}) {
  let url = ORIGIN + '/cars/japan?' + new URLSearchParams({city: CITY}), power = false, sort = '', open = false;
  const events = [], progress = {};
  const ready = selector => ({async waitFor({state}) {
    events.push(selector.includes('Расширенные') ? 'hydrated' : selector.includes('aria-busy') ? 'acknowledged' : 'visible');
    if (selector.includes('Расширенные')) assert.equal(state, 'attached');
  }});
  const selection = next => {
    sort = next; url = documentUrl(next); if (wrongCity) url = url.replace(encodeURIComponent(CITY), 'Moscow');
    if (remount) open = false;
  };
  const locator = selector => {
    if (selector === 'form.ac-catalog-filter-panel:visible' || selector === 'form.ac-catalog-filter-panel:visible[aria-busy="false"]')
      return {...ready(selector), locator, getByRole};
    if (selector.includes('Расширенные фильтры')) return ready(selector);
    if (selector === 'input[name="powerTo"][value="160"]') return {count: async () => 1, isChecked: async () => power,
      check: async () => { events.push('power'); power = true; selection(''); }};
    if (selector === '.ac-sidebar-sort input[name="sort"]') return {inputValue: async () => wrongValue ? 'year' : sort};
    if (selector.startsWith('.ac-sidebar-sort button[aria-label^="Сортировка: "]')) return {
      count: async () => 1, getAttribute: async () => String(open), click: async () => { events.push('open'); open = true; },
      waitFor: async () => assert(open),
    };
    assert.fail(selector);
  };
  function getByRole(role, {name, exact}) {
    assert.equal(role, 'button'); assert(exact);
    return {async click() {
      if (name === 'Готово') { events.push('close'); open = false; }
      else { assert(open); const next = name === 'Сначала дороже' ? 'totalRubDesc' : name === 'Сначала дешевле' ? 'totalRub' : null;
        assert(next); events.push(next); selection(next); }
    }};
  }
  const view = {url: () => url, locator, async waitForURL(predicate) { events.push('url'); assert(predicate(new URL(url))); }};
  return {view, progress, events};
}

for (const remount of [false, true]) test('the same real control protocol preserves power/city through DESC then ASC, remount=' + remount, async () => {
  const {view, progress, events} = controlsJourney({remount});
  await selectJapanPowerBeforePriceSort(view, progress);
  await selectJapanPriceSort(view, 'totalRubDesc', progress);
  await selectJapanPriceSort(view, 'totalRub', progress);
  assert.equal(progress.readyChecks, 6);
  assert.deepEqual(progress.sortsSelectedThroughUi, ['totalRubDesc', 'totalRub']);
  assert.equal(progress.powerSelectedThroughUi, true);
  assert.deepEqual(events.filter(value => ['power', 'totalRubDesc', 'totalRub'].includes(value)), ['power', 'totalRubDesc', 'totalRub']);
  assert.equal(events.filter(value => value === 'close').length, remount ? 0 : 2);
  assert(events.indexOf('hydrated') < events.indexOf('power'));
});

test('the UI journey rejects a city lost during power selection and a sort value different from its URL', async () => {
  const wrongCity = controlsJourney({wrongCity: true});
  await assert.rejects(selectJapanPowerBeforePriceSort(wrongCity.view));
  const wrongSort = controlsJourney({wrongValue: true});
  await selectJapanPowerBeforePriceSort(wrongSort.view);
  await assert.rejects(selectJapanPriceSort(wrongSort.view, 'totalRubDesc'), /selected_values/);
});
