import {createHash} from 'node:crypto';
import {selectJapanPowerBeforePriceSort, selectJapanPriceSort, japanPriceSortSelectionUrl}
  from './japan-price-sort-browser.mjs';
import {JAPAN_SOURCE_COUNT_ACCEPTANCE, verifyJapanSourceCountSummary, readVisibleSourceCount,
  checkedJapanSourceCountCursor} from './japan-source-count-browser.mjs';

const ORIGIN = 'https://avtocena.com', CITY = 'Новокузнецк';
const CARD = 'article.ac-catalog-card,article.ac-catalog-list-row';
const need = (value, code) => { if (!value) throw Error('japan_browser_source_price_' + code); };
const hash = value => createHash('sha256').update(value).digest('hex');
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const normalized = value => value.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
export const JAPAN_SOURCE_PRICE_ORDER_CONTRACT = 'japan-source-price-order-browser-v1';

export function japanSourcePriceOrderRequirement(value) {
  need(value === undefined || value === '0' || value === '1', 'option');
  return value === '1';
}

/** Only two independent scalar reads are added to this ordinary UI journey.
 * LIST pages are the actual rendered document and actual append responses. */
export function japanSourcePriceCountApi({power = false, countOnly = true} = {}) {
  need(typeof power === 'boolean' && typeof countOnly === 'boolean', 'count_query');
  const query = new URLSearchParams({market: 'japan', page: '1', pageSize: '24', city: CITY});
  if (power) query.set('powerTo', '160');
  if (countOnly) query.set('countOnly', '1');
  return '/api/catalog/search?' + query;
}

export function japanSourcePriceApiAllowed(value) {
  return typeof value === 'string' && [japanSourcePriceCountApi(), japanSourcePriceCountApi({power: true})].includes(value);
}

export function japanSourcePriceContinuation(value, {sort, expectedCursor} = {}) {
  need(['totalRub', 'totalRubDesc'].includes(sort), 'sort');
  let url; try { url = new URL(value, ORIGIN); } catch { need(false, 'continuation'); }
  const query = url.searchParams;
  need(url.origin === ORIGIN && !url.username && !url.password && !url.hash
    && ['/cars', '/cars/japan', '/api/catalog/search'].includes(url.pathname)
    && [...query.keys()].every(key => ['market', 'page', 'pageSize', 'city', 'powerTo', 'sort', 'after', 'marketPage', 'view'].includes(key)
      && query.getAll(key).length === 1)
    && (url.pathname === '/cars/japan' ? !query.has('market') || query.get('market') === 'japan' : query.get('market') === 'japan')
    && query.get('page') === '2' && query.get('city') === CITY && query.get('powerTo') === '160'
    && query.get('sort') === sort && (!query.has('pageSize') || query.get('pageSize') === '24')
    && (!query.has('marketPage') || query.get('marketPage') === '1')
    && (!query.has('view') || ['grid', 'list'].includes(query.get('view'))), 'continuation');
  const cursor = query.get('after');
  need(checkedJapanSourceCountCursor(cursor).version === 'j1'
    && (expectedCursor === undefined || cursor === expectedCursor), 'emitted_cursor');
  return cursor;
}

/** FINISH may be fractional. Compare its raw positive value, not the rounded
 * label and not the independently displayed delivered RUB estimate. Power
 * certainty does not partition an explicitly price-ordered source walk. */
export function verifyJapanSourcePriceRows(rows, sort) {
  need(['totalRub', 'totalRubDesc'].includes(sort) && Array.isArray(rows) && rows.length > 0 && rows.length <= 48
    && rows.every(row => /^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(row?.id || '') && positive(row.priceJpy))
    && new Set(rows.map(row => row.id)).size === rows.length, 'rows');
  for (let index = 1; index < rows.length; index++)
    need(sort === 'totalRub' ? rows[index - 1].priceJpy <= rows[index].priceJpy
      : rows[index - 1].priceJpy >= rows[index].priceJpy, 'global_order');
  return {shown: rows.length, sourcePrices: rows.map(row => row.priceJpy),
    idsSha256: hash(JSON.stringify(rows.map(row => row.id))),
    sourcePricesSha256: hash(JSON.stringify(rows.map(row => row.priceJpy))), sourcePriceOrder: true};
}

export function verifyJapanSourcePriceDomRows(rows) {
  need(Array.isArray(rows) && rows.length > 0 && rows.length <= 48, 'dom_rows');
  return rows.map(row => {
    need(/^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(row?.id || '') && row.priceNodes === 1
      && typeof row.priceAttribute === 'string' && row.priceAttribute.trim() === row.priceAttribute
      && positive(Number(row.priceAttribute)) && typeof row.priceText === 'string'
      && normalized(row.priceText) === normalized('Аукцион: '
        + Number(row.priceAttribute).toLocaleString('ru-RU', {maximumFractionDigits: 2}) + ' ¥'), 'dom_price');
    return {id: row.id, priceJpy: Number(row.priceAttribute)};
  });
}

export function verifyJapanSourcePriceAppend({before, items, after, sort}) {
  need(Array.isArray(before) && before.length === 24 && Array.isArray(items) && items.length === 24
    && Array.isArray(after) && after.length === 48, 'append_rows');
  const added = items.map(row => {
    need(row?.market === 'japan' && row.japanCatalogPriceOrder === 'auction'
      && positive(row.japanAuctionPriceJpy), 'source_price');
    return {id: row.id, priceJpy: row.japanAuctionPriceJpy};
  });
  const expected = [...before, ...added];
  need(JSON.stringify(after) === JSON.stringify(expected), 'append_identity_order');
  const proof = verifyJapanSourcePriceRows(after, sort);
  return {...proof, loadedBefore: 24, added: 24, loadedAfter: 48, duplicateIds: 0,
    oldIdsPreserved: true, orderPreserved: true, sourcePricesMatchApi: true,
    beforeIdsSha256: hash(JSON.stringify(before.map(row => row.id))),
    addedIdsSha256: hash(JSON.stringify(added.map(row => row.id))),
    afterIdsSha256: proof.idsSha256};
}

export function verifyJapanSourcePriceFreshReceipts(evidence, {ssr = false, reads, observedAt, now = Date.now()} = {}) {
  need(typeof ssr === 'boolean' && evidence?.status === 'recorded' && evidence.limited === false
    && evidence.omitted === 0 && evidence.reason === undefined && Array.isArray(evidence.receipts)
    && evidence.receipts.length >= 1 && evidence.receipts.length <= 8
    && evidence.received === evidence.receipts.length
    && evidence.receipts.every(receipt => receipt.table === 'stats' && receipt.kind === 'list' && receipt.pageSize === 24
      && receipt.outcome === 'fresh' && receipt.reason === undefined && Number.isFinite(Date.parse(receipt.observedAt))
      && Date.parse(receipt.observedAt) <= now && now - Date.parse(receipt.observedAt) < 30 * 60_000), 'fresh_receipts');
  const firstObservation = Math.min(...evidence.receipts.map(receipt => Date.parse(receipt.observedAt)));
  if (ssr) need(evidence.page === 1 && evidence.afterSha256 === hash('') && evidence.bindingMatched === true, 'ssr_binding');
  else need(Number.isSafeInteger(reads) && reads === evidence.receipts.length
    && Date.parse(observedAt) === firstObservation, 'append_receipts');
  return {kind: ssr ? 'rendered-ssr' : 'append-api', observedAt: new Date(firstObservation).toISOString(),
    sourcePages: evidence.receipts.length, receiptsSha256: hash(JSON.stringify(evidence.receipts)),
    sourceReceiptsFresh: true, ...(ssr ? {page: 1, afterSha256: evidence.afterSha256, ssrBindingMatched: true} : {})};
}

export async function readJapanSourcePriceDomRows(view, expectedCount, sort) {
  need([24, 48].includes(expectedCount), 'dom_count');
  await view.waitForFunction(({selector, expectedCount, sort}) => {
    const root = document.querySelector('main.ac-ajes-catalog'), rows = [...(root?.querySelectorAll(selector) || [])];
    const selected = document.querySelector('form.ac-catalog-filter-panel .ac-sidebar-sort input[name="sort"]');
    return selected?.value === sort && rows.length === expectedCount
      && rows.every(row => row.querySelectorAll('[data-japan-auction-price-jpy]').length === 1)
      && root?.querySelector('[data-japan-loaded-count="' + expectedCount + '"]');
  }, {selector: CARD, expectedCount, sort}, {timeout: 60_000});
  const rows = await view.locator('main.ac-ajes-catalog').locator(CARD).evaluateAll(nodes => nodes.map(node => {
    const ids = [...new Set([...node.querySelectorAll('a[href]')].flatMap(link => {
      const match = /\/cars\/offer\/([^/?#]+)/.exec(link.getAttribute('href') || ''); return match ? [match[1]] : [];
    }))];
    const prices = [...node.querySelectorAll('[data-japan-auction-price-jpy]')];
    return {id: ids.length === 1 ? ids[0] : null, priceNodes: prices.length,
      priceAttribute: prices[0]?.getAttribute('data-japan-auction-price-jpy') ?? null,
      priceText: prices[0]?.textContent ?? null};
  }));
  const result = verifyJapanSourcePriceDomRows(rows);
  need(result.length === expectedCount, 'dom_count');
  return result;
}

/** Restore the supplier's globally ordered walk in the same bounded visitor
 * journey. Both directions include their actual page-two response; a page-
 * local sort with a cheaper/dearer restart at the boundary must fail. */
export async function runJapanSourcePriceOrderBrowser({context, report, read, capture, onStage, onPage,
  verifyPage, verifyFullPage, verifyPowerPage, verifyVehiclePolicy, pageReadEvidence, readSsrPageEvidence,
  observeResponse = () => {}}) {
  need(report.countAcceptance === JAPAN_SOURCE_COUNT_ACCEPTANCE && report.japanSourcePriceOrderRequired === true,
    'profile');
  const progress = report.checks.priceSortProgress = {phase: 'navigate', explicitApiReads: 0};
  const pages = [], counts = [], checks = [];
  const view = await context.newPage(); onPage(view); let errors = 0;
  view.on('pageerror', () => { errors++; });
  await view.setViewportSize({width: 1440, height: 1000});
  onStage('stability_source_price_plain_count');
  const initialResponse = await view.goto(ORIGIN + '/cars/japan?' + new URLSearchParams({city: CITY}),
    {waitUntil: 'domcontentloaded', timeout: 90_000});
  need(initialResponse?.status() === 200 && japanPriceSortSelectionUrl(view.url(), {power: false}), 'document');
  const count = async power => {
    const query = japanSourcePriceCountApi({power, countOnly: false});
    need(progress.explicitApiReads < 2, 'read_limit'); progress.explicitApiReads++;
    const received = await read(japanSourcePriceCountApi({power}));
    progress.countStatus = received.status;
    need(received.status === 200 && received.data?.ok === true && received.data.total === null
      && received.data.countIncomplete === true && Array.isArray(received.data.items) && received.data.items.length === 0,
    'count_response');
    const summary = verifyJapanSourceCountSummary(received.data.countSummary, {query, positive: true, fresh: true});
    const ui = await readVisibleSourceCount(view, summary, 24, query, {auctionDatabaseLabel: true});
    const value = {selection: power ? 'power160' : 'plain', query, summary, ui,
      independentCount: true, queryHashVerified: true, admittedTotal: null};
    counts.push(value); progress.counts = counts; return value;
  };
  await count(false);
  onStage('stability_source_price_power_count');
  await selectJapanPowerBeforePriceSort(view, progress);
  const powerCount = await count(true);
  need(counts[0].summary.sourceCountProof.requestedQueryHash !== powerCount.summary.sourceCountProof.requestedQueryHash
    && counts[0].summary.sourceCountProof.sourceQueryHash !== powerCount.summary.sourceCountProof.sourceQueryHash,
  'power_count_query');
  for (const sort of ['totalRubDesc', 'totalRub']) {
    onStage(sort === 'totalRubDesc' ? 'stability_source_price_desc' : 'stability_source_price_asc');
    await selectJapanPriceSort(view, sort, progress, {sourcePriceOrder: true});
    // The URL/control may update before the new document. The emitted j1 page2
    // cursor distinguishes the new 24-row first page from old j2/48-row state.
    await view.waitForFunction(() => {
      const root = document.querySelector('main.ac-ajes-catalog');
      const href = root?.querySelector('a.ac-catalog-more[role="button"]')?.getAttribute('href');
      try { return new URL(href, location.origin).searchParams.get('after')?.startsWith('j1.')
        && root.querySelectorAll('article.ac-catalog-card,article.ac-catalog-list-row').length === 24; }
      catch { return false; }
    }, undefined, {timeout: 60_000});
    const before = await readJapanSourcePriceDomRows(view, 24, sort);
    verifyJapanSourcePriceRows(before, sort);
    const firstPage = verifyJapanSourcePriceFreshReceipts(await readSsrPageEvidence(view, {page: 1, after: ''}), {ssr: true});
    const catalog = view.locator('main.ac-ajes-catalog'), more = catalog.locator('a.ac-catalog-more[role="button"]');
    need(await more.count() === 1, 'append_control');
    const cursor = japanSourcePriceContinuation(await more.getAttribute('href'), {sort});
    const cursorProof = checkedJapanSourceCountCursor(cursor);
    const initialCount = await readVisibleSourceCount(view, powerCount.summary, 24, powerCount.query, {auctionDatabaseLabel: true});
    Object.assign(progress, {phase: 'append', sort, cursor, beforeIdsSha256: hash(JSON.stringify(before.map(row => row.id))), firstPage});
    onStage(sort === 'totalRubDesc' ? 'stability_source_price_desc_append' : 'stability_source_price_asc_append');
    const requestedAt = Date.now();
    const pending = view.waitForResponse(response => {
      try { return response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/catalog/search'
        && japanSourcePriceContinuation(response.url(), {sort, expectedCursor: cursor}) === cursor; }
      catch { return false; }
    }, {timeout: 60_000});
    pending.catch(() => {}); await more.click(); const response = await pending;
    const received = {status: response.status(), data: await response.json().catch(() => null),
      headers: await response.allHeaders(), requestedAt, receivedAt: Date.now(), durationMs: Date.now() - requestedAt};
    observeResponse(received); progress.appendStatus = received.status;
    const next = received.data;
    const observation = verifyPage(next, received.status); verifyFullPage(next);
    verifyPowerPage(next, 2, {countAcceptance: JAPAN_SOURCE_COUNT_ACCEPTANCE, query: response.url()});
    need(next.page === 2 && next.pageSize === 24 && next.items.length === 24 && next.total === null && next.countSummary === null,
      'append_page');
    const nextPage = verifyJapanSourcePriceFreshReceipts(pageReadEvidence(next), {reads: next.reads, observedAt: next.observedAt});
    if (next.hasMore) {
      const following = checkedJapanSourceCountCursor(next.nextCursor, 3);
      need(following.version === 'j1' && following.queryHash === cursorProof.queryHash, 'next_cursor');
    } else need(next.nextCursor === null, 'next_cursor');
    const after = await readJapanSourcePriceDomRows(view, 48, sort);
    const append = verifyJapanSourcePriceAppend({before, items: next.items, after, sort});
    const finalCount = await readVisibleSourceCount(view, powerCount.summary, 48, powerCount.query, {auctionDatabaseLabel: true});
    need(japanPriceSortSelectionUrl(view.url(), {sort})
      && await catalog.getByRole('alert').count() === 0, 'append_selection');
    checks.push({sort, status: received.status, ...append, firstPage: {...firstPage, shown: 24},
      nextPage: {...nextPage, ...observation, shown: 24}, cursor, continuationCursor: cursor,
      sameFilter: true, followedEmittedCursor: true, initialCount, finalCount});
    progress.checks = checks; pages.push(next); verifyVehiclePolicy([next]);
    await capture(view, 'japan-source-price-' + (sort === 'totalRubDesc' ? 'descending' : 'ascending') + '-append-desktop');
  }
  need(errors === 0 && progress.explicitApiReads === 2 && checks.length === 2, 'complete');
  report.checks.priceSort = {contract: JAPAN_SOURCE_PRICE_ORDER_CONTRACT, selectedThroughUi: true, city: CITY, powerTo: 160,
    directions: ['totalRubDesc', 'totalRub'], priceBasis: 'source_FINISH_JPY', priceOrderScope: 'source_order_across_append',
    sourcePriceOrderAcrossPages: true, globalDeliveredPriceOrderClaimed: false, powerLanesReordered: false,
    counts, countSourceQueryChangesWithPower: true, explicitApiReads: 2, ordinaryAppendRequests: 2,
    liveExhaustiveScan: false, pageErrors: errors, checks};
  report.checks.countDisplay = {loadedCounts: [24, 24, 24, 48, 24, 48],
    visibleAfterEverySelection: true, appendUpdatesLoadedCount: true, supplierCountNotPresentedAsExact: true,
    broadCountVisible: true, powerCountBoundToNewQuery: true};
  report.japanPriceSortPassed = true; report.japanCountDisplayPassed = true; report.japanSourcePriceOrderPassed = true;
  progress.phase = 'complete'; await view.close(); onPage(null); return pages;
}
