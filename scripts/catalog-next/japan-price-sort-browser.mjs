import {createHash} from 'node:crypto';

const ORIGIN = 'https://avtocena.com';
const CITY = 'Новокузнецк';
const CARD = 'article.ac-catalog-card,article.ac-catalog-list-row';
const need = (value, code) => { if (!value) throw Error('japan_browser_price_sort_' + code); };
const hash = value => createHash('sha256').update(value).digest('hex');
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const sorts = ['', 'totalRubDesc', 'totalRub'];
export const JAPAN_PRICE_SORT_GATES = Object.freeze(['japanPriceSortPassed', 'japanCountDisplayPassed']);

/** A bounded ordinary visitor sequence. The initial power query is identical
 * to the established POWER request; only two explicit price orders are added. */
export function japanPriceSortApi(sort = '', {page = 1, after} = {}) {
  need(sorts.includes(sort) && [1, 2].includes(page), 'query');
  need(page === 1 ? after === undefined : sort !== '' && typeof after === 'string', 'query');
  const query = new URLSearchParams({market: 'japan', page: String(page), pageSize: '24', city: CITY, powerTo: '160'});
  if (sort) query.set('sort', sort);
  if (page === 2) { checkedJapanPriceSortCursor(after, 2); query.set('after', after); }
  return '/api/catalog/search?' + query;
}

export function checkedJapanPriceSortCursor(value, page = 2) {
  need(typeof value === 'string' && value.length <= 320 && [2, 3].includes(page), 'cursor');
  const match = /^j2\.([ku])\.([1-9]\d{0,6})\.(0|[1-9]\d?)\.([1-9]\d{0,6})\.([a-f0-9]{64})\.([a-f0-9]{64})\.(-|[a-f0-9]{64})$/.exec(value);
  need(match && Number(match[2]) <= 1_000_000 && Number(match[3]) <= 24
    && Number(match[4]) === page && (Number(match[3]) === 0 ? match[7] === '-' : match[7] !== '-'), 'cursor');
  return {phase: match[1], sourcePage: Number(match[2]), acceptedSkip: Number(match[3]), visiblePage: page,
    queryHash: match[5], epochHash: match[6], membershipHash: match[7], cursorSha256: hash(value)};
}

/** Recognize the real canonical document without accepting a second market,
 * duplicate query keys, extra filters or a guessed continuation. */
export function japanPriceSortSelectionUrl(value, {power = true, sort = '', page = 1, after} = {}) {
  if (!sorts.includes(sort) || ![1, 2].includes(page) || (!power && (sort || page !== 1))) return false;
  try {
    const url = new URL(value), query = url.searchParams;
    const expected = new Map([['city', CITY], ...(power ? [['powerTo', '160']] : []),
      ...(sort ? [['sort', sort]] : []), ...(page === 2 ? [['page', '2'], ['after', after]] : [])]);
    if (url.origin !== ORIGIN || url.pathname !== '/cars/japan' || url.username || url.password || url.hash) return false;
    if ([...query.keys()].some(key => query.getAll(key).length !== 1 || !expected.has(key))) return false;
    if (query.size !== expected.size || [...expected].some(([key, value]) => query.get(key) !== value)) return false;
    if (page === 2) checkedJapanPriceSortCursor(after, 2);
    return true;
  } catch { return false; }
}

export function japanPriceSortPageApi(value, {sort, expectedCursor} = {}) {
  need(['totalRubDesc', 'totalRub'].includes(sort), 'continuation_sort');
  let url; try { url = new URL(value, ORIGIN); } catch { need(false, 'continuation_query'); }
  const after = url.searchParams.get('after');
  if (url.pathname === '/cars' && url.searchParams.getAll('market').length === 1
    && url.searchParams.get('market') === 'japan') { url.pathname = '/cars/japan'; url.searchParams.delete('market'); }
  need(japanPriceSortSelectionUrl(url.href, {sort, page: 2, after}), 'continuation_query');
  need(expectedCursor === undefined || after === expectedCursor, 'emitted_cursor');
  return japanPriceSortApi(sort, {page: 2, after});
}

export function japanPriceSortApiAllowed(value) {
  try {
    const url = new URL(value, ORIGIN), query = url.searchParams;
    if (url.origin !== ORIGIN || url.username || url.password || url.hash || url.pathname !== '/api/catalog/search'
      || [...query.keys()].some(key => query.getAll(key).length !== 1)) return false;
    const page = Number(query.get('page')), sort = query.get('sort') || '';
    return value === japanPriceSortApi(sort, {page, ...(page === 2 ? {after: query.get('after')} : {})});
  } catch { return false; }
}

/** Compare the public delivered values, keeping rows without a calculation at
 * the end of each power lane. Seller rubles break ties only when both delivered
 * calculations are absent, matching the documented visible sort contract. */
const delivered = row => {
  const value = row.savedCalculationPreview
    ? row.totalRub || row.savedCalculationPreview.totalRub
    : row.japanDeliveredPreview?.totalRub || (row.catalogPricingMode !== 'seller' && row.totalRub)
      || row.deliveredCalculationPreview?.totalRub;
  return positive(value) ? value : null;
};
const priceComparison = (left, right, sort, visiblePrices) => {
  const price = row => delivered(row) === null ? null : visiblePrices ? visiblePrices.get(row.id) : delivered(row);
  const a = price(left), b = price(right);
  if (a === null || b === null) {
    if (a !== b) return a === null ? 1 : -1;
    const x = positive(left.sellerPriceRub) ? left.sellerPriceRub : null;
    const y = positive(right.sellerPriceRub) ? right.sellerPriceRub : null;
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return sort === 'totalRubDesc' ? y - x : x - y;
  }
  return sort === 'totalRubDesc' ? b - a : a - b;
};

export function verifyJapanPriceSortRows(payload, sort, {visiblePrices} = {}) {
  need(['totalRubDesc', 'totalRub'].includes(sort), 'order');
  need(Array.isArray(payload?.items) && payload.items.length > 0 && payload.items.length <= 24
    && (payload.hasMore !== true || payload.items.length === 24), 'rows');
  let unknownStarted = false, priced = 0, previous, known = 0, unknown = 0;
  for (const row of payload.items) {
    need(row?.market === 'japan' && /^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(row.id || ''), 'identity');
    const isUnknown = row.japanPowerUnknown === true;
    if (isUnknown) { unknownStarted = true; unknown++; }
    else { need(!unknownStarted && (positive(row.powerHp) || positive(row.japanSupplierPower?.hp)), 'power_lane'); known++; }
    if (delivered(row) !== null) { priced++; if (visiblePrices) need(positive(visiblePrices.get(row.id)), 'displayed_price'); }
    if (previous && (previous.japanPowerUnknown === true) === isUnknown)
      need(priceComparison(previous, row, sort, visiblePrices) <= 0, 'order');
    previous = row;
  }
  need(priced > 0 && new Set(payload.items.map(row => row.id)).size === payload.items.length, 'priced_rows');
  return {sort, shown: payload.items.length, knownPower: known, unknownPower: unknown,
    deliveredPrices: priced, knownBeforeUnknown: true, priceOrderWithinLoadedLanes: true, globalPriceOrderClaimed: false,
    priceBasis: visiblePrices ? 'displayed_selected_city' : 'supplied_fixture_prices'};
}

export function verifyJapanPriceSortCount({status, loadedCount, exactCount, text}, {loaded, total = null, hasMore = true} = {}) {
  need(Number.isSafeInteger(loaded) && loaded > 0 && Number(loadedCount) === loaded
    && typeof text === 'string' && text.trim().length > 0, 'count_visible');
  const normalized = text.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (status === 'exact') {
    need(Number.isSafeInteger(total) && total >= loaded && hasMore === false
      && String(total) === exactCount && !/уточняется/i.test(normalized), 'false_exact_count');
  } else {
    need(['partial', 'stale', 'pending'].includes(status) && (exactCount === null || exactCount === undefined)
      && normalized.includes('Загружено ' + loaded.toLocaleString('ru-RU').replace(/\u00a0/g, ' '))
      && /количество уточняется/i.test(normalized), 'count_visible');
  }
  return {loaded, status, exact: status === 'exact', visible: true, supplierCountNotPresentedAsExact: true};
}

async function controlsReady(view, progress) {
  const form = view.locator('form.ac-catalog-filter-panel:visible');
  await form.waitFor({state: 'visible', timeout: 30_000});
  await form.locator('button[aria-label="Расширенные фильтры"]:enabled[aria-busy="false"]')
    .waitFor({state: 'attached', timeout: 30_000});
  await view.locator('form.ac-catalog-filter-panel:visible[aria-busy="false"]')
    .waitFor({state: 'visible', timeout: 30_000});
  progress.readyChecks = (progress.readyChecks ?? 0) + 1;
  return form;
}

export async function selectJapanPowerBeforePriceSort(view, progress = {}) {
  need(japanPriceSortSelectionUrl(view.url(), {power: false}), 'initial_url');
  progress.phase = 'initial_controls_ready';
  const form = await controlsReady(view, progress), input = form.locator('input[name="powerTo"][value="160"]');
  need(await input.count() === 1 && !await input.isChecked(), 'initial_power');
  progress.phase = 'power_click'; await input.check();
  progress.phase = 'power_url';
  await view.waitForURL(url => japanPriceSortSelectionUrl(url.href), {timeout: 60_000});
  progress.phase = 'power_controls_ready';
  const selected = await controlsReady(view, progress);
  need(await selected.locator('input[name="powerTo"][value="160"]').isChecked(), 'power_selection');
  progress.powerSelectedThroughUi = true; progress.phase = 'power_selected';
}

export async function selectJapanPriceSort(view, sort, progress = {}) {
  need(['totalRubDesc', 'totalRub'].includes(sort), 'selection');
  progress.phase = 'sort_controls_ready';
  const form = await controlsReady(view, progress), trigger = form.locator('.ac-sidebar-sort button[aria-label^="Сортировка: "]');
  need(await trigger.count() === 1, 'sort_control');
  progress.phase = 'sort_open'; if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await form.locator('.ac-sidebar-sort button[aria-label^="Сортировка: "][aria-expanded="true"]')
    .waitFor({state: 'visible', timeout: 30_000});
  progress.phase = 'sort_select';
  await form.getByRole('button', {name: sort === 'totalRubDesc' ? 'Сначала дороже' : 'Сначала дешевле', exact: true}).click();
  progress.phase = 'sort_url';
  await view.waitForURL(url => japanPriceSortSelectionUrl(url.href, {sort}), {timeout: 60_000});
  progress.phase = 'sorted_controls_ready';
  const selected = await controlsReady(view, progress);
  need(await selected.locator('input[name="powerTo"][value="160"]').isChecked()
    && await selected.locator('.ac-sidebar-sort input[name="sort"]').inputValue() === sort, 'selected_values');
  // The Next page can remount the controls. Close only a still-open popup.
  const current = selected.locator('.ac-sidebar-sort button[aria-label^="Сортировка: "]');
  if (await current.getAttribute('aria-expanded') === 'true')
    await selected.getByRole('button', {name: 'Готово', exact: true}).click();
  need(japanPriceSortSelectionUrl(view.url(), {sort}), 'selected_url');
  progress.sortsSelectedThroughUi ??= []; progress.sortsSelectedThroughUi.push(sort); progress.phase = 'sort_selected';
}

export async function verifyJapanPriceSortVisible(view, items, countInput, {sort, priceItems = items} = {}) {
  need(Array.isArray(items) && items.length > 0, 'ui_rows');
  const catalog = view.locator('main.ac-ajes-catalog'), cards = catalog.locator(CARD);
  await cards.nth(items.length - 1).waitFor({state: 'attached', timeout: 60_000});
  for (const row of items) await cards.filter({has: view.locator('a[href*="' + row.id + '"]')})
    .waitFor({state: 'attached', timeout: 30_000});
  const ids = await cards.evaluateAll((nodes, expected) => nodes.map(node => {
    const matches = [...node.querySelectorAll('a[href]')].flatMap(link => {
      const match = /\/cars\/offer\/([^/?#]+)/.exec(link.getAttribute('href') || '');
      return match && expected.includes(match[1]) ? [match[1]] : [];
    });
    return [...new Set(matches)].length === 1 ? matches[0] : null;
  }), items.map(row => row.id));
  need(JSON.stringify(ids) === JSON.stringify(items.map(row => row.id)), 'ui_order');
  const badge = catalog.locator('[data-japan-count-status][data-japan-loaded-count="' + items.length + '"]');
  await badge.waitFor({state: 'visible', timeout: 30_000});
  need(await badge.count() === 1, 'count_unique');
  const exact = badge.locator('[data-catalog-market-count]');
  const proof = verifyJapanPriceSortCount({status: await badge.getAttribute('data-japan-count-status'),
    loadedCount: await badge.getAttribute('data-japan-loaded-count'),
    exactCount: await badge.getAttribute('data-catalog-market-count')
      ?? (await exact.count() === 1 ? await exact.getAttribute('data-catalog-market-count') : null),
    text: await badge.innerText()}, {loaded: items.length, ...countInput});
  const footer = catalog.getByText(new RegExp('^Показано\\s+' + items.length + '(?:\\s|$)'));
  need(await footer.count() === 1 && await footer.isVisible(), 'loaded_count');
  need(await catalog.getByText('Не удалось загрузить эту страницу', {exact: true}).count() === 0
    && await catalog.getByText('По выбранным параметрам автомобили не найдены. Попробуйте изменить условия поиска.', {exact: true}).count() === 0, 'ui_error');
  let priceOrder;
  if (sort) {
    const prices = await cards.evaluateAll((nodes, expected) => nodes.map((node, index) => {
      const values = [...node.querySelectorAll('.ac-price')].map(value => value.textContent || '');
      const text = values.length === 1 ? values[0].replace(/[\s\u00a0\u202f]/g, '') : '';
      const match = /^(\d+)₽$/.exec(text);
      return [expected[index], match ? Number(match[1]) : null];
    }), items.map(row => row.id));
    priceOrder = verifyJapanPriceSortRows({items: priceItems, hasMore: countInput?.hasMore}, sort,
      {visiblePrices: new Map(prices)});
  }
  return {...proof, uiMatchesApi: true, rowOrderMatchesApi: true, ...(priceOrder ? {priceOrder} : {})};
}

/** One desktop journey, three first-page reads and one emitted continuation.
 * It cannot crawl an arbitrary supplier/page or turn elapsed time into a veto. */
export async function runJapanPriceSortBrowser({context, report, read, capture, onStage, onPage,
  verifyPage, verifyFullPage, verifyPowerPage, verifyVehiclePolicy}) {
  const progress = report.checks.priceSortProgress = {phase: 'page_navigation', readyChecks: 0};
  const pages = [], checks = [];
  onStage('stability_price_sort_power');
  const view = await context.newPage(); onPage(view); let errors = 0;
  view.on('pageerror', () => { errors++; });
  await view.setViewportSize({width: 1440, height: 1000});
  const response = await view.goto(ORIGIN + '/cars/japan?' + new URLSearchParams({city: CITY}),
    {waitUntil: 'domcontentloaded', timeout: 90_000});
  need(response?.status() === 200, 'page_http');
  await selectJapanPowerBeforePriceSort(view, progress);
  let value = await read(japanPriceSortApi());
  let observation = verifyPage(value.data, value.status); verifyFullPage(value.data); verifyPowerPage(value.data);
  pages.push(value.data);
  checks.push({phase: 'power', ...observation,
    count: await verifyJapanPriceSortVisible(view, value.data.items, value.data)});
  for (const sort of ['totalRubDesc', 'totalRub']) {
    onStage(sort === 'totalRubDesc' ? 'stability_price_sort_desc' : 'stability_price_sort_asc');
    await selectJapanPriceSort(view, sort, progress);
    value = await read(japanPriceSortApi(sort));
    observation = verifyPage(value.data, value.status); verifyFullPage(value.data); verifyPowerPage(value.data);
    const count = await verifyJapanPriceSortVisible(view, value.data.items, value.data, {sort});
    const {priceOrder: order} = count; pages.push(value.data);
    checks.push({...observation, ...order, count});
    await capture(view, 'japan-power-price-' + (sort === 'totalRubDesc' ? 'descending' : 'ascending') + '-desktop');
  }
  const first = value.data;
  need(first.hasMore === true, 'continuation_missing');
  const catalog = view.locator('main.ac-ajes-catalog'), more = catalog.getByRole('button', {name: 'Показать ещё', exact: true});
  need(await more.count() === 1, 'append_control');
  const href = await more.getAttribute('href');
  const api = japanPriceSortPageApi(href, {sort: 'totalRub', expectedCursor: first.nextCursor});
  const cursor = checkedJapanPriceSortCursor(first.nextCursor, 2);
  onStage('stability_price_sort_append'); progress.phase = 'append_click';
  const appendResponse = view.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.origin === ORIGIN && url.pathname === '/api/catalog/search'
      && url.searchParams.get('page') === '2' && url.searchParams.get('after') === first.nextCursor
      && url.searchParams.get('sort') === 'totalRub' && url.searchParams.get('powerTo') === '160'
      && url.searchParams.get('city') === CITY;
  }, {timeout: 60_000});
  appendResponse.catch(() => {});
  await more.click(); need((await appendResponse).status() === 200, 'append_http');
  value = await read(api);
  observation = verifyPage(value.data, value.status); verifyFullPage(value.data); verifyPowerPage(value.data, 2);
  need(value.data.page === 2 && first.page === 1 && first.pageSize === 24 && value.data.pageSize === 24, 'continuation_page');
  need(value.data.items.every(row => !first.items.some(previous => previous.id === row.id)), 'continuation_duplicate');
  const combined = [...first.items, ...value.data.items];
  let unknownSeen = false;
  for (const row of combined) { if (row.japanPowerUnknown === true) unknownSeen = true; else need(!unknownSeen, 'continuation_power_lane'); }
  if (value.data.hasMore) {
    const following = checkedJapanPriceSortCursor(value.data.nextCursor, 3);
    need(following.queryHash === cursor.queryHash && following.epochHash === cursor.epochHash, 'continuation_binding');
  } else need(value.data.nextCursor === null, 'continuation_exhausted');
  // Append keeps the selected first-page URL while adding the exact page-two
  // batch. Price order is checked per loaded page, never across these pages.
  need(japanPriceSortSelectionUrl(view.url(), {sort: 'totalRub'}), 'append_url');
  const count = await verifyJapanPriceSortVisible(view, combined, {total: null, hasMore: value.data.hasMore},
    {sort: 'totalRub', priceItems: value.data.items});
  const {priceOrder: order} = count;
  pages.push(value.data);
  checks.push({...observation, ...order, phase: 'append', count, followedEmittedCursor: true,
    distinctRows: true, cursorSha256: cursor.cursorSha256, loaded: combined.length});
  need(errors === 0, 'javascript');
  verifyVehiclePolicy(pages);
  progress.phase = 'complete';
  report.checks.priceSort = {selectedThroughUi: true, city: CITY, powerTo: 160,
    directions: ['totalRubDesc', 'totalRub'], explicitApiReads: 4, pageErrors: errors,
    priceOrderScope: 'each_loaded_page_and_power_lane', globalPriceOrderClaimed: false, checks};
  report.checks.countDisplay = {loadedCounts: checks.map(check => check.count.loaded),
    visibleAfterEverySelection: true, appendUpdatesLoadedCount: true, supplierCountNotPresentedAsExact: true};
  report.japanPriceSortPassed = true; report.japanCountDisplayPassed = true;
  await capture(view, 'japan-power-price-ascending-append-desktop');
  await view.close(); onPage(null);
  return pages;
}
