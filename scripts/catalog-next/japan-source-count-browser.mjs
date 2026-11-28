import {createHash} from 'node:crypto';
import {japanExactCountQueryHash, runJapanModelCoverageBrowser} from './japan-exact-count-browser.mjs';
import {japanA4Power160ContinuationAcceptancePassed} from './japan-stability-code-scope.mjs';

const ORIGIN = 'https://avtocena.com', CITY = 'Новокузнецк';
const need = (value, code) => { if (!value) throw Error('japan_browser_source_count_' + code); };
const natural = value => Number.isSafeInteger(value) && value >= 0;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const normalize = value => value.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
const numberText = value => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const JAPAN_SOURCE_COUNT_ACCEPTANCE = 'japan-source-count-v1';
export const JAPAN_SOURCE_COUNT_GATES = Object.freeze(['japanSourceCountPassed']);
export const JAPAN_A4_POWER160_CONTINUATION_CONTRACT = 'japan-a4-power160-continuation-browser-v1';
export const JAPAN_A4_POWER160_CONTINUATION_GATES = Object.freeze(['japanA4Power160ContinuationPassed']);

export function japanSourceCountRequirement(value) {
  need(value === undefined || value === '0' || value === '1', 'option');
  return value === '1';
}

export function japanA4Power160ContinuationRequirement(value) {
  need(value === undefined || value === '0' || value === '1', 'power_continuation_option');
  return value === '1';
}

/** Validate source candidates as their own observation. This never converts
 * the supplier scalar into an admitted or delivered-price selection total. */
export function verifyJapanSourceCountSummary(summary, {query, now = Date.now(), positive = false, fresh = false} = {}) {
  const proof = summary?.sourceCountProof;
  need(summary && natural(summary.total) && (!positive || summary.total > 0)
    && typeof summary.stale === 'boolean' && (!fresh || summary.stale === false)
    && summary.upperBound === true && summary.precision === 'source-upper-bound'
    && summary.selectionScope === 'source-candidates' && typeof summary.sourceScopeComplete === 'boolean'
    && !['countProof', 'knownTotal', 'unknownTotal'].some(key => Object.hasOwn(summary, key)), 'summary');
  need(proof?.version === 1 && proof.kind === 'japan-source-count'
    && proof.predicateVersion === 'japan-source-candidates-v1'
    && ['requestedQueryHash', 'sourceQueryHash', 'evidenceEpoch'].every(key => digest(proof[key]))
    && proof.sourceTotal === summary.total && proof.sourceObservedAt === summary.observedAt
    && proof.sourceScopeComplete === summary.sourceScopeComplete && typeof proof.directoryComplete === 'boolean'
    && (!proof.sourceScopeComplete || proof.directoryComplete), 'proof');
  const observed = Date.parse(summary.observedAt);
  need(typeof summary.observedAt === 'string' && Number.isFinite(now) && Number.isFinite(observed)
    && observed <= now && now - observed < (summary.stale ? 7 * 24 * 60 * 60_000 : 30 * 60_000), 'freshness');
  if (query !== undefined) need(proof.requestedQueryHash === japanExactCountQueryHash(query), 'query_binding');
  return summary;
}

/** The live UI binding may be checked on every existing visitor journey even
 * when its LIST deliberately omits COUNT. The dedicated journey supplies the
 * independent summary too, requiring equality with its actual source proof. */
export function verifyJapanSourceCountVisible(observation, {summary, query, loaded, now = Date.now(), auctionDatabaseLabel = false} = {}) {
  const {status, sourceTotal, proofKind, requestedQueryHash, observedAt, exactCount, label} = observation;
  need(['bounded', 'source'].includes(status) && natural(loaded) && loaded > 0
    && Number(observation.loadedCount) === loaded && typeof sourceTotal === 'string' && /^(?:0|[1-9]\d*)$/.test(sourceTotal)
    && Number.isSafeInteger(Number(sourceTotal)) && Number(sourceTotal) >= loaded
    && (exactCount === null || exactCount === undefined) && proofKind === 'japan-source-count'
    && digest(requestedQueryHash) && typeof label === 'string', 'visible');
  const observed = Date.parse(observedAt);
  need(typeof observedAt === 'string' && Number.isFinite(observed) && observed <= now
    && now - observed < 30 * 60_000 && query !== undefined
    && requestedQueryHash === japanExactCountQueryHash(query), 'visible_binding');
  need(typeof auctionDatabaseLabel === 'boolean' && normalize(label)
    === (auctionDatabaseLabel ? 'В базе аукционов: ' : status === 'bounded' ? 'Найдено до ' : 'В источнике: ')
      + numberText(Number(sourceTotal)), 'visible_label');
  if (summary !== undefined && summary !== null) {
    verifyJapanSourceCountSummary(summary, {query, now, positive: true, fresh: true});
    need(Number(sourceTotal) === summary.total && observedAt === summary.observedAt
      && status === (summary.sourceScopeComplete ? 'bounded' : 'source'), 'visible_summary');
  }
  return {status, sourceTotal: Number(sourceTotal), requestedQueryHash, observedAt,
    loadedCount: loaded, label};
}

export function checkedJapanSourceCountCursor(value, visiblePage = 2) {
  need(typeof value === 'string' && value.length <= 320 && natural(visiblePage)
    && visiblePage >= 2 && visiblePage <= 1_000_000, 'cursor');
  const ordinary = /^j1\.([1-9]\d{0,6})\.(0|[1-9]\d?)\.([1-9]\d{0,6})\.([a-f0-9]{64})\.(-|[a-f0-9]{64})$/.exec(value);
  if (ordinary) {
    need(Number(ordinary[1]) <= 1_000_000 && Number(ordinary[2]) < 24
      && Number(ordinary[3]) === visiblePage && (Number(ordinary[2]) === 0 ? ordinary[5] === '-' : ordinary[5] !== '-'), 'cursor');
    return {version: 'j1', visiblePage, queryHash: ordinary[4]};
  }
  const power = /^j2\.([ku])\.([1-9]\d{0,6})\.(0|[1-9]\d?)\.([1-9]\d{0,6})\.([a-f0-9]{64})\.([a-f0-9]{64})\.(-|[a-f0-9]{64})$/.exec(value);
  need(power && Number(power[2]) <= 1_000_000 && Number(power[3]) <= 24
    && Number(power[4]) === visiblePage && (Number(power[3]) === 0 ? power[7] === '-' : power[7] !== '-'), 'cursor');
  return {version: 'j2', visiblePage, queryHash: power[5], evidenceEpoch: power[6]};
}

/** Exactly two explicit public reads for the existing titlecase bookmark.
 * The continuation is observed from its ordinary UI click, not re-requested. */
export function japanSourceCountApi({countOnly = false} = {}) {
  need(typeof countOnly === 'boolean', 'api_query');
  const query = new URLSearchParams({market: 'japan', page: '1', pageSize: '24', city: CITY, make: 'Audi', model: 'A4'});
  if (countOnly) query.set('countOnly', '1');
  return '/api/catalog/search?' + query;
}

export function japanSourceCountApiAllowed(value) {
  return typeof value === 'string' && [japanSourceCountApi(), japanSourceCountApi({countOnly: true})].includes(value);
}

export function japanSourceCountContinuation(value, expectedCursor) {
  let url; try { url = new URL(value, ORIGIN); } catch { need(false, 'continuation'); }
  const query = url.searchParams;
  need(url.origin === ORIGIN && !url.username && !url.password && !url.hash
    && ['/cars', '/cars/japan', '/cars/japan/Audi/A4', '/api/catalog/search'].includes(url.pathname)
    && [...query.keys()].every(key => ['market', 'page', 'pageSize', 'city', 'make', 'model', 'after', 'marketPage', 'view'].includes(key)
      && query.getAll(key).length === 1)
    && query.get('city') === CITY && query.get('page') === '2'
    && (!query.has('pageSize') || query.get('pageSize') === '24')
    && (!query.has('marketPage') || query.get('marketPage') === '1')
    && (!query.has('view') || ['grid', 'list'].includes(query.get('view')))
    && (url.pathname === '/cars/japan/Audi/A4'
      ? (!query.has('market') || query.get('market') === 'japan') && (!query.has('make') || query.get('make') === 'Audi')
        && (!query.has('model') || query.get('model') === 'A4')
      : query.get('market') === 'japan' && query.get('make') === 'Audi' && query.get('model') === 'A4'), 'continuation');
  const cursor = query.get('after'); checkedJapanSourceCountCursor(cursor);
  need(expectedCursor === undefined || cursor === expectedCursor, 'emitted_cursor');
  return cursor;
}

/** Canonical public selection used for badge/query binding, without issuing
 * an independent first-page read in the continuation-only journey. */
export function japanA4Power160Api() {
  return japanSourceCountApi() + '&powerTo=160';
}

export function japanA4Power160ApiAllowed(value) {
  return typeof value === 'string' && value === japanA4Power160Api();
}

/** Canonical route segments and explicit query fields describe the same full
 * public selection. Reject duplicate keys, dropped filters and foreign routes. */
export function japanA4Power160Selection(value, {page = 1, expectedCursor} = {}) {
  let url; try { url = new URL(value, ORIGIN); } catch { need(false, 'power_continuation_selection'); }
  const params = url.searchParams, bookmark = url.pathname === '/cars/japan/Audi/A4';
  const japanRoute = url.pathname === '/cars/japan' || bookmark;
  need([1, 2].includes(page) && url.origin === ORIGIN && !url.username && !url.password && !url.hash
    && ['/cars', '/cars/japan', '/cars/japan/Audi/A4', '/api/catalog/search'].includes(url.pathname)
    && [...params.keys()].every(key => ['market', 'make', 'model', 'city', 'powerTo', 'page', 'pageSize', 'after', 'marketPage', 'view'].includes(key)
      && params.getAll(key).length === 1)
    && (japanRoute ? !params.has('market') || params.get('market') === 'japan' : params.get('market') === 'japan')
    && (bookmark ? (!params.has('make') || params.get('make') === 'Audi') && (!params.has('model') || params.get('model') === 'A4')
      : params.get('make') === 'Audi' && params.get('model') === 'A4')
    && params.get('city') === CITY && params.get('powerTo') === '160'
    && (!params.has('pageSize') || params.get('pageSize') === '24')
    && (!params.has('marketPage') || params.get('marketPage') === '1')
    && (!params.has('view') || ['grid', 'list'].includes(params.get('view')))
    && (page === 1 ? (!params.has('page') || params.get('page') === '1') && !params.has('after')
      : params.get('page') === '2'), 'power_continuation_selection');
  const cursor = params.get('after');
  if (page === 2) {
    need(checkedJapanSourceCountCursor(cursor).version === 'j2', 'power_continuation_cursor');
    need(expectedCursor === undefined || cursor === expectedCursor, 'power_continuation_emitted_cursor');
  }
  return {cursor, url: url.href};
}

/** This check proves fresh, useful rows for the continuation only. A bounded
 * scan or an unavailable names directory remains an explicit limitation; it
 * does not become a full-page, exhaustive-selection or exact-count claim. */
export function verifyJapanA4Power160Page(payload, status, {query, evidence, now = Date.now()} = {}) {
  const parsed = new URL(query, ORIGIN), page = Number(parsed.searchParams.get('page') || '1');
  japanA4Power160Selection(parsed.href, {page});
  need(status === 200 && payload?.ok === true && payload.page === page && payload.pageSize === 24,
    'power_continuation_http');
  need(payload.stale === false && payload.interrupted === false && payload.total === null && payload.countSummary === null
    && ['partial', 'scanLimited', 'selectionIncomplete', 'hasMore'].every(key => typeof payload[key] === 'boolean')
    && Array.isArray(payload.items) && payload.items.length > 0 && payload.items.length <= 24
    && payload.items.every(row => row?.market === 'japan' && /^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(row.id || ''))
    && new Set(payload.items.map(row => row.id)).size === payload.items.length
    && (!payload.scanLimited || payload.hasMore && payload.items.length < 24), 'power_continuation_page');
  need(natural(payload.reads) && payload.reads >= 1 && payload.reads <= 8
    && evidence?.status === 'recorded' && evidence.limited === false && evidence.omitted === 0
    && evidence.reason === undefined && evidence.receipts?.length === payload.reads
    && evidence.receipts.every(receipt => receipt.table === 'stats' && receipt.kind === 'list' && receipt.pageSize === 24
      && receipt.outcome === 'fresh' && receipt.reason === undefined && Number.isFinite(Date.parse(receipt.observedAt))
      && Date.parse(receipt.observedAt) <= now && now - Date.parse(receipt.observedAt) < 30 * 60_000),
  'power_continuation_receipts');
  const observed = Date.parse(payload.observedAt);
  need(Number.isFinite(observed) && observed === Math.min(...evidence.receipts.map(receipt => Date.parse(receipt.observedAt))),
    'power_continuation_observation');
  if (payload.hasMore) need(checkedJapanSourceCountCursor(payload.nextCursor, page + 1).version === 'j2', 'power_continuation_cursor');
  else need(payload.nextCursor === null, 'power_continuation_cursor');
  return {status, shown: payload.items.length, observedAt: payload.observedAt, stale: false, interrupted: false,
    partial: payload.partial, scanLimited: payload.scanLimited, selectionIncomplete: payload.selectionIncomplete,
    sourcePages: payload.reads, receiptsSha256: hash(JSON.stringify(evidence.receipts)), sourceReceiptsFresh: true,
    total: null, hasMore: payload.hasMore, selectionCompletenessClaimed: false};
}

export function verifyJapanA4Power160SsrPage({ids, cursor, evidence, status = null, now = Date.now()}) {
  need((status === null || status === 200) && Array.isArray(ids) && ids.length >= 1 && ids.length <= 24
    && ids.every(id => typeof id === 'string' && /^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(id))
    && new Set(ids).size === ids.length && checkedJapanSourceCountCursor(cursor).version === 'j2', 'power_continuation_ssr_rows');
  need(evidence?.page === 1 && evidence.afterSha256 === hash('') && evidence.bindingMatched === true
    && evidence.status === 'recorded' && evidence.limited === false && evidence.omitted === 0
    && Array.isArray(evidence.receipts) && evidence.receipts.length >= 1 && evidence.receipts.length <= 8
    && evidence.received === evidence.receipts.length
    && evidence.receipts.every(receipt => receipt.table === 'stats' && receipt.kind === 'list' && receipt.pageSize === 24
      && receipt.outcome === 'fresh' && receipt.reason === undefined && Number.isFinite(Date.parse(receipt.observedAt))
      && Date.parse(receipt.observedAt) <= now && now - Date.parse(receipt.observedAt) < 30 * 60_000),
  'power_continuation_ssr_receipts');
  return {kind: 'rendered-ssr', status, shown: ids.length,
    observedAt: new Date(Math.min(...evidence.receipts.map(receipt => Date.parse(receipt.observedAt)))).toISOString(),
    sourcePages: evidence.receipts.length, receiptsSha256: hash(JSON.stringify(evidence.receipts)), sourceReceiptsFresh: true,
    page: 1, afterSha256: evidence.afterSha256, ssrBindingMatched: true,
    partial: null, scanLimited: null, selectionIncomplete: null, interrupted: null, stale: false,
    total: null, hasMore: true, selectionCompletenessClaimed: false};
}

/** The production card exposes its unknown-power phase explicitly. Do not
 * parse unrelated scenario or thirty-minute power numbers from card text. */
export function verifyJapanA4Power160DomRows(rows) {
  need(Array.isArray(rows) && rows.length >= 1 && rows.length <= 48
    && rows.every(row => /^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(row?.id || '')
      && [0, 1].includes(row.unknownMarkers) && (row.unknownMarkers === 0
        || row.unknownVisible === true && normalize(row.unknownText) === 'Мощность не указана' && row.supplierMarkers === 0))
    && new Set(rows.map(row => row.id)).size === rows.length, 'power_continuation_dom_rows');
  return rows.map(row => ({id: row.id, unknown: row.unknownMarkers === 1}));
}

function powerPhaseOrder(rows) {
  let unknownStarted = false, known = 0;
  for (const row of rows) {
    if (row.unknown) unknownStarted = true;
    else { need(!unknownStarted, 'power_continuation_power_order'); known++; }
  }
  need(known > 0 && new Set(rows.map(row => row.id)).size === rows.length, 'power_continuation_power_order');
  return {knownBeforeUnknown: true, distinctRows: true};
}

export function verifyJapanA4Power160Append({first, next, firstPage, nextPage, cursor, responseUrl, visibleIds, powerOrder, name}) {
  const continuationCursor = japanA4Power160Selection(responseUrl, {page: 2, expectedCursor: cursor}).cursor;
  need(['after_power_toggle', 'after_first_page_navigation'].includes(name) && firstPage.hasMore === true
    && first.nextCursor === cursor && firstPage.kind === 'rendered-ssr' && [null, 200].includes(firstPage.status) && nextPage.status === 200
    && first.page === 1 && next.page === 2, 'power_continuation_binding');
  const before = first.items.map(row => row.id), added = next.items.map(row => row.id), after = [...before, ...added];
  need(before.length === firstPage.shown && added.length === nextPage.shown && added.length > 0
    && new Set(after).size === after.length && JSON.stringify(visibleIds) === JSON.stringify(after),
  'power_continuation_identity');
  need(powerOrder?.knownBeforeUnknown === true && powerOrder.distinctRows === true, 'power_continuation_power_order');
  return {name, status: 200, sameFilter: true, cursor, continuationCursor, loadedBefore: before.length,
    added: added.length, loadedAfter: after.length, duplicateIds: 0, oldIdsPreserved: true, orderPreserved: true,
    knownBeforeUnknown: true, firstPage, nextPage, beforeIdsSha256: hash(JSON.stringify(before)),
    addedIdsSha256: hash(JSON.stringify(added)), afterIdsSha256: hash(JSON.stringify(after))};
}

async function powerControls(view) {
  const form = view.locator('form.ac-catalog-filter-panel:visible[aria-busy="false"]');
  await form.waitFor({state: 'visible', timeout: 60_000});
  await form.locator('button[aria-label="Расширенные фильтры"]:enabled[aria-busy="false"]')
    .waitFor({state: 'attached', timeout: 30_000});
  const toggle = form.locator('input[type="checkbox"][name="powerTo"][value="160"]');
  need(await toggle.count() === 1, 'power_continuation_control');
  return toggle;
}

async function visibleIds(view) {
  return view.locator('main.ac-ajes-catalog article.ac-catalog-card,main.ac-ajes-catalog article.ac-catalog-list-row')
    .evaluateAll(nodes => nodes.map(node => {
      const identities = [...new Set([...node.querySelectorAll('a[href]')].flatMap(link => {
        const match = /\/cars\/offer\/(ajes-stats-[A-Za-z0-9_-]{1,64})(?:[/?#]|$)/.exec(link.getAttribute('href') || '');
        return match ? [match[1]] : [];
      }))];
      return identities.length === 1 ? identities[0] : null;
    }));
}

async function visiblePowerRows(view) {
  const rows = await view.locator('main.ac-ajes-catalog article.ac-catalog-card,main.ac-ajes-catalog article.ac-catalog-list-row')
    .evaluateAll(nodes => nodes.map(node => {
      const identities = [...new Set([...node.querySelectorAll('a[href]')].flatMap(link => {
        const match = /\/cars\/offer\/(ajes-stats-[A-Za-z0-9_-]{1,64})(?:[/?#]|$)/.exec(link.getAttribute('href') || '');
        return match ? [match[1]] : [];
      }))], unknown = [...node.querySelectorAll('[data-japan-power-unknown="true"]')];
      return {id: identities.length === 1 ? identities[0] : null, unknownMarkers: unknown.length,
        unknownVisible: unknown.length === 1 && unknown[0].getClientRects().length > 0,
        unknownText: unknown.length === 1 ? unknown[0].textContent || '' : '',
        supplierMarkers: node.querySelectorAll('[data-japan-supplier-power="true"]').length};
    }));
  return verifyJapanA4Power160DomRows(rows);
}

async function verifyPowerVisible(view, expected) {
  const catalog = view.locator('main.ac-ajes-catalog');
  await view.waitForFunction(ids => {
    const nodes = [...document.querySelectorAll('main.ac-ajes-catalog article.ac-catalog-card,main.ac-ajes-catalog article.ac-catalog-list-row')];
    return nodes.length === ids.length && nodes.every((node, index) => [...node.querySelectorAll('a[href]')]
      .some(link => /\/cars\/offer\/([^/?#]+)/.exec(link.getAttribute('href') || '')?.[1] === ids[index]));
  }, expected, {timeout: 60_000});
  need(JSON.stringify(await visibleIds(view)) === JSON.stringify(expected), 'power_continuation_identity');
  const badge = catalog.locator('[data-japan-count-status][data-japan-loaded-count="' + expected.length + '"]');
  await badge.waitFor({state: 'visible', timeout: 30_000});
  const label = badge.locator('[data-japan-count-label]');
  need(await badge.count() === 1 && await label.count() === 1 && await label.isVisible()
    && ['bounded', 'source', 'partial', 'stale', 'pending'].includes(await badge.getAttribute('data-japan-count-status'))
    && await badge.getAttribute('data-catalog-market-count') === null
    && await badge.locator('[data-catalog-market-count]').count() === 0
    && (await label.innerText()).trim().length > 0, 'power_continuation_loaded_count');
  const footer = catalog.locator('p[role="status"]').filter({hasText: new RegExp('^Показано\\s+' + expected.length + '(?:\\s|$)')});
  need(await footer.count() === 1 && await footer.isVisible()
    && await catalog.locator('[role="alert"]').count() === 0, 'power_continuation_ui');
  return {status: await badge.getAttribute('data-japan-count-status'), label: await label.innerText(), loadedCount: expected.length};
}

/** Initial rows and cursor come from the rendered SSR response. A second
 * first-page read can legitimately fill a different bounded batch, so no such
 * read substitutes for the actual cards. Each append is one ordinary click. */
export async function runJapanA4Power160ContinuationBrowser({view, report, capture, onStage,
  verifyPowerPage, verifyVehiclePolicy, pageReadEvidence, readSsrPageEvidence, observeResponse = () => {}, pageErrors = () => 0}) {
  need(report.japanA4Power160ContinuationRequired === true && report.japanSourceCountPassed === true
    && report.countAcceptance === JAPAN_SOURCE_COUNT_ACCEPTANCE && report.japanExactCountRequired === false
    && report.japanExactCountPassed === null, 'power_continuation_profile');
  const progress = report.checks.a4Power160ContinuationProgress = {phase: 'power_toggle', explicitApiReads: 0,
    ordinaryAppendRequests: 0, firstPageNavigations: 0, attempts: []};
  onStage('source_count_a4_power160_toggle');
  const toggle = await powerControls(view);
  need(!await toggle.isChecked(), 'power_continuation_initial');
  await toggle.check();
  await view.waitForURL(url => { try { japanA4Power160Selection(url.href); return true; } catch { return false; } }, {timeout: 60_000});
  need(await (await powerControls(view)).isChecked(), 'power_continuation_selected');
  const selectedUrl = japanA4Power160Selection(view.url()).url;
  const pages = [], attempts = [];
  const append = async (name, documentStatus = null) => {
    progress.phase = name; onStage('source_count_a4_power160_' + name);
    need(progress.explicitApiReads === 0 && progress.ordinaryAppendRequests < 2, 'power_continuation_read_limit');
    await view.waitForFunction(() => {
      const nodes = document.querySelectorAll('main.ac-ajes-catalog article.ac-catalog-card,main.ac-ajes-catalog article.ac-catalog-list-row');
      const more = document.querySelector('main.ac-ajes-catalog a.ac-catalog-more[role="button"]');
      const after = more && new URL(more.getAttribute('href'), location.origin).searchParams.get('after');
      // Readiness only; the shared strict runtime cursor grammar is checked
      // immediately afterwards, without a second parser in the DOM wait.
      const parts = String(after || '').split('.');
      return nodes.length > 0 && nodes.length <= 24 && parts[0] === 'j2' && parts[4] === '2';
    }, undefined, {timeout: 60_000});
    japanA4Power160Selection(view.url());
    const more = view.locator('main.ac-ajes-catalog a.ac-catalog-more[role="button"]');
    need(await more.count() === 1 && await more.isVisible(), 'power_continuation_control');
    const cursor = japanA4Power160Selection(await more.getAttribute('href'), {page: 2}).cursor;
    const rendered = await visiblePowerRows(view), beforeIds = rendered.map(row => row.id);
    const renderedEvidence = await readSsrPageEvidence(view, {page: 1, after: ''});
    const observation = {name, cursor, phase: 'first_page', beforeIds, renderedEvidence};
    progress.attempts.push(observation);
    const firstPage = verifyJapanA4Power160SsrPage({ids: beforeIds, cursor, status: documentStatus,
      evidence: renderedEvidence});
    const first = {page: 1, items: rendered, nextCursor: cursor};
    const initialCount = await verifyPowerVisible(view, beforeIds);
    Object.assign(observation, {firstPage, phase: 'append', initialCount});
    const requestedAt = Date.now();
    const waited = view.waitForResponse(value => {
      try { return value.request().method() === 'GET' && new URL(value.url()).pathname === '/api/catalog/search'
        && japanA4Power160Selection(value.url(), {page: 2, expectedCursor: cursor}).cursor === cursor; } catch { return false; }
    }, {timeout: 60_000});
    waited.catch(() => {}); progress.ordinaryAppendRequests++;
    await more.click(); const received = await waited;
    const nextResponse = {status: received.status(), data: await received.json().catch(() => null), headers: await received.allHeaders(),
      requestedAt, receivedAt: Date.now(), durationMs: Date.now() - requestedAt};
    observeResponse(nextResponse);
    Object.assign(observation, {status: nextResponse.status,
      continuationCursor: japanA4Power160Selection(received.url(), {page: 2, expectedCursor: cursor}).cursor,
      responseIds: Array.isArray(nextResponse.data?.items) ? nextResponse.data.items.map(row => row?.id).filter(id =>
        typeof id === 'string' && /^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(id)).slice(0, 24) : [],
      visibleIdsImmediatelyAfterResponse: await visibleIds(view)});
    const next = nextResponse.data;
    const nextPage = verifyJapanA4Power160Page(next, nextResponse.status,
      {query: received.url(), evidence: pageReadEvidence(next)});
    verifyPowerPage(next, 2, {countAcceptance: JAPAN_SOURCE_COUNT_ACCEPTANCE, query: received.url()});
    const powerOrder = powerPhaseOrder([...rendered, ...next.items.map(row => ({id: row.id, unknown: row.japanPowerUnknown === true}))]);
    verifyVehiclePolicy([next]);
    const loaded = [...first.items, ...next.items];
    observation.loadedCount = await verifyPowerVisible(view, loaded.map(row => row.id));
    const afterRendered = await visiblePowerRows(view); powerPhaseOrder(afterRendered);
    need(JSON.stringify(afterRendered.map(row => row.unknown)) === JSON.stringify([...rendered.map(row => row.unknown),
      ...next.items.map(row => row.japanPowerUnknown === true)]), 'power_continuation_power_order');
    japanA4Power160Selection(view.url());
    need(await (await powerControls(view)).isChecked()
      && await view.locator('main.ac-ajes-catalog [role="alert"]').count() === 0, 'power_continuation_ui');
    const proof = verifyJapanA4Power160Append({first, next, firstPage, nextPage, cursor,
      responseUrl: received.url(), visibleIds: await visibleIds(view), powerOrder, name});
    Object.assign(observation, {phase: 'complete', ...proof}); attempts.push(proof); pages.push(next);
    await capture(view, 'japan-a4-power160-' + name.replaceAll('_', '-') + '-desktop');
  };
  await append('after_power_toggle');
  progress.phase = 'first_page_navigation'; onStage('source_count_a4_power160_first_page');
  // A normal document navigation uses the observed selected address. It does
  // not change the visitor, expire a cache or manufacture a refresh token.
  const firstPageUrl = new URL(selectedUrl); firstPageUrl.searchParams.delete('page'); firstPageUrl.searchParams.delete('after');
  japanA4Power160Selection(firstPageUrl.href);
  progress.firstPageNavigations++;
  const documentResponse = await view.goto(firstPageUrl.href, {waitUntil: 'domcontentloaded', timeout: 90_000});
  need(documentResponse?.status() === 200, 'power_continuation_document');
  japanA4Power160Selection(view.url());
  need(await (await powerControls(view)).isChecked(), 'power_continuation_selected');
  const firstPageNavigation = {status: 200, sameFilter: true, powerChecked: true, cityPreserved: true};
  await append('after_first_page_navigation', documentResponse.status());
  need(progress.explicitApiReads === 0 && progress.ordinaryAppendRequests === 2
    && progress.firstPageNavigations === 1 && pageErrors() === 0, 'power_continuation_complete');
  report.checks.a4Power160Continuation = {contract: JAPAN_A4_POWER160_CONTINUATION_CONTRACT,
    selection: {market: 'japan', make: 'Audi', model: 'A4', city: CITY, powerTo: 160},
    toggledThroughUi: true, firstPageNavigation, attempts, explicitApiReads: 0, ordinaryAppendRequests: 2,
    firstPageNavigations: 1, liveExhaustiveScan: false, fullSelectionExhaustionClaimed: false, pageErrors: 0};
  progress.phase = 'complete'; report.japanA4Power160ContinuationPassed = true;
  return pages;
}

/** The new gate is checked on both real control lifecycles. Controlled
 * freshness changes are reported separately from actual live observations. */
export function checkedJapanA4Power160ContinuationBrowserFixture(report, {runtimeSha, runtimeTree, helperSha256, sourcePriceOrderRequired = false} = {}) {
  need(/^[a-f0-9]{40}$/.test(runtimeSha || '') && /^[a-f0-9]{40}$/.test(runtimeTree || '') && digest(helperSha256)
    && report?.version === 1 && report.kind === 'japan-exact-count-browser-v1' && report.passed === true
    && report.runtimeSha === runtimeSha && report.runtimeTree === runtimeTree
    && report.helperSha256?.['scripts/catalog-next/japan-source-count-browser.mjs'] === helperSha256
    && typeof sourcePriceOrderRequired === 'boolean'
    && (report.japanSourcePriceOrderRequired === true) === sourcePriceOrderRequired,
  'power_continuation_fixture_binding');
  need(report.productionRequests === 0 && report.supplierRequests === 0 && report.forbiddenTransportAttempts === 0
    && report.liveSourceAccepted === false && report.backendCensusAccepted === false
    && report.countProofContract === 'controlled-ui-mock-v1'
    && ['apps/web/lib/catalog/ajes-model-resolution.ts', 'apps/web/lib/catalog/ajes-filtered-page.ts',
      'apps/web/lib/catalog/ajes-ssr-read-evidence.ts']
      .every(file => digest(report.componentSha256?.[file]))
    && Array.isArray(report.cases) && report.cases.length === 2
    && JSON.stringify(report.cases.map(row => row.name).sort()) === '["preserved_controls","remounted_controls"]',
  'power_continuation_fixture_scope');
  for (const row of report.cases) {
    const value = row.a4Power160ContinuationAcceptance, source = row.sourceCountAcceptance;
    need(row.passed === true && row.pageErrors === 0 && value?.passed === true && source?.passed === true
      && (source.japanSourcePriceOrderRequired === true) === sourcePriceOrderRequired
      && value.controlledBackendContract === 'runtime-resolver-and-power-reader-v1' && japanA4Power160ContinuationAcceptancePassed({
      countAcceptance: source.countAcceptance, checkedAt: value.checkedAt,
      japanSourceCountRequired: true, japanSourceCountPassed: true, japanModelCoverageRequired: true, japanModelCoveragePassed: true,
      japanExactCountRequired: false, japanExactCountPassed: null,
      japanA4Power160ContinuationRequired: value.japanA4Power160ContinuationRequired,
      japanA4Power160ContinuationPassed: value.japanA4Power160ContinuationPassed,
      checks: {sourceCount: source.sourceCount, modelCoverage: source.modelCoverage, a4Power160Continuation: value.proof},
    }, {auctionDatabaseLabel: sourcePriceOrderRequired}), 'power_continuation_fixture_proof');
    need(Array.isArray(value.controlledTransitions) && value.controlledTransitions.length === 4
      && JSON.stringify(value.controlledTransitions.map(item => item.from + ':' + item.to).sort())
        === '["fresh:missing","fresh:stale","missing:fresh","stale:fresh"]'
      && value.controlledTransitions.every(item => item.status === 200 && natural(item.added) && item.added > 0 && item.added <= 24
        && item.renderedBefore === 12 && item.added === 24 && item.loadedAfter === 36
        && item.cursorStable === true && item.evidenceEpochStable === true && item.oldIdsPreserved === true
        && item.duplicateIds === 0 && item.runtimeResolver === true && item.runtimePowerReader === true
        && item.sourceReadsFresh === true && item.selectionCompletenessClaimed === false
        && item.firstSelectionIncomplete === (item.from !== 'fresh') && item.nextSelectionIncomplete === (item.to !== 'fresh')
        && digest(item.addedIdsSha256) && checkedJapanSourceCountCursor(item.cursor).version === 'j2'),
    'power_continuation_fixture_transitions');
  }
  return {passed: true, runtimeSha, runtimeTree, helperSha256, cases: 2,
    contract: JAPAN_A4_POWER160_CONTINUATION_CONTRACT, controlledTransitions: 8, liveSourceAccepted: false};
}

export async function readVisibleSourceCount(view, summary, loaded, query, {auctionDatabaseLabel = false} = {}) {
  const badge = view.locator('main.ac-ajes-catalog [data-japan-count-status][data-japan-loaded-count="' + loaded + '"]');
  await badge.waitFor({state: 'visible', timeout: 60_000});
  // The independent request does not mutate the page. Wait for its ordinary
  // streamed count to bind to the same query and observation before asserting.
  await view.waitForFunction(({loaded, hash, observedAt, total}) => {
    const nodes = document.querySelectorAll('main.ac-ajes-catalog [data-japan-count-status][data-japan-loaded-count="' + loaded + '"]');
    return nodes.length === 1 && nodes[0].getAttribute('data-japan-count-query-hash') === hash
      && nodes[0].getAttribute('data-japan-count-observed-at') === observedAt
      && nodes[0].getAttribute('data-japan-source-total') === String(total);
  }, {loaded, hash: summary.sourceCountProof.requestedQueryHash, observedAt: summary.observedAt, total: summary.total}, {timeout: 60_000});
  need(await badge.count() === 1, 'visible_unique');
  const label = badge.locator('[data-japan-count-label]');
  need(await label.count() === 1 && await label.isVisible(), 'visible_label');
  const exact = badge.locator('[data-catalog-market-count]');
  need(await exact.count() === 0, 'false_admitted_total');
  return verifyJapanSourceCountVisible({status: await badge.getAttribute('data-japan-count-status'),
    loadedCount: await badge.getAttribute('data-japan-loaded-count'),
    sourceTotal: await badge.getAttribute('data-japan-source-total'),
    proofKind: await badge.getAttribute('data-japan-count-proof'),
    requestedQueryHash: await badge.getAttribute('data-japan-count-query-hash'),
    observedAt: await badge.getAttribute('data-japan-count-observed-at'),
    exactCount: await badge.getAttribute('data-catalog-market-count'), label: await label.innerText()},
  {summary, loaded, query, auctionDatabaseLabel});
}

/** Retain the exact source-directory/card union proof, then exercise one real
 * saved Audi/A4 URL. A COUNT failure or denied second page is a failed gate;
 * useful visible rows and transport diagnostics are left in the failure report. */
export async function runJapanSourceCountBrowser({context, report, read, capture, onStage, onPage,
  verifyPage, verifyFullPage, verifyVehiclePolicy, verifyVisible, verifyPowerPage, pageReadEvidence, readSsrPageEvidence,
  observeResponse = () => {}, auctionDatabaseLabel = false}) {
  need(report.countAcceptance === JAPAN_SOURCE_COUNT_ACCEPTANCE && report.japanExactCountRequired === false
    && report.japanExactCountPassed === null && report.japanSourceCountRequired === true, 'profile');
  const modelReport = {checks: report.checks, japanExactCountRequired: false, japanExactCountPassed: null};
  const modelPages = await runJapanModelCoverageBrowser({context, report: modelReport, read, capture, onStage, onPage,
    verifyPage, verifyFullPage, verifyVehiclePolicy,
    verifyVisible: (view, items, payload, options) => verifyVisible(view, items, payload,
      {...options, countAcceptance: JAPAN_SOURCE_COUNT_ACCEPTANCE, auctionDatabaseLabel})});
  need(modelReport.japanModelCoveragePassed === true, 'model_coverage');
  report.japanModelCoveragePassed = true;
  const progress = report.checks.sourceCountProgress = {phase: 'navigate', explicitApiReads: 0};
  const view = await context.newPage(); onPage(view); let errors = 0;
  view.on('pageerror', () => { errors++; });
  await view.setViewportSize({width: 1440, height: 1000});
  onStage('source_count_audi_a4');
  const documentUrl = ORIGIN + '/cars/japan/Audi/A4?' + new URLSearchParams({city: CITY});
  const documentResponse = await view.goto(documentUrl, {waitUntil: 'domcontentloaded', timeout: 90_000});
  need(documentResponse?.status() === 200 && view.url() === documentUrl, 'document');
  const boundedRead = async api => {
    need(japanSourceCountApiAllowed(api) && progress.explicitApiReads < 2, 'api_scope');
    progress.explicitApiReads++; return read(api);
  };
  const query = japanSourceCountApi(), firstResponse = await boundedRead(query), first = firstResponse.data;
  verifyPage(first, firstResponse.status); verifyFullPage(first);
  need(first.page === 1 && first.pageSize === 24 && first.hasMore === true
    && first.total === null && first.countSummary === null, 'independent_list');
  await verifyVisible(view, first.items, first,
    {countAcceptance: JAPAN_SOURCE_COUNT_ACCEPTANCE, query, auctionDatabaseLabel});
  const more = view.locator('main.ac-ajes-catalog a.ac-catalog-more[role="button"]');
  need(await more.count() === 1, 'append_control');
  const cursorBeforeCount = japanSourceCountContinuation(await more.getAttribute('href'), first.nextCursor);
  progress.phase = 'independent_count'; onStage('source_count_independent');
  const counted = await boundedRead(japanSourceCountApi({countOnly: true}));
  need(counted.status === 200 && counted.data?.ok === true && counted.data.total === null
    && counted.data.countIncomplete === true && Array.isArray(counted.data.items) && counted.data.items.length === 0, 'response');
  const summary = verifyJapanSourceCountSummary(counted.data.countSummary, {query, positive: true, fresh: true});
  const ui = await readVisibleSourceCount(view, summary, first.items.length, query, {auctionDatabaseLabel});
  const cursorAfterCount = japanSourceCountContinuation(await more.getAttribute('href'), cursorBeforeCount);
  need(view.url() === documentUrl, 'selection_changed');
  // Keep the independently verified count visible in a failed append report.
  // These observations are not a continuation verdict or an acceptance gate.
  Object.assign(progress, {summary, ui, cursorBeforeCount, cursorAfterCount});
  progress.phase = 'append'; onStage('source_count_append');
  const requestedAt = Date.now();
  const appendResponse = view.waitForResponse(response => {
    try { return response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/catalog/search'
      && japanSourceCountContinuation(response.url(), cursorAfterCount) === cursorAfterCount; } catch { return false; }
  }, {timeout: 60_000});
  appendResponse.catch(() => {});
  await more.click(); const response = await appendResponse;
  const nextResponse = {status: response.status(), data: await response.json().catch(() => null),
    headers: await response.allHeaders(), requestedAt, receivedAt: Date.now(), durationMs: Date.now() - requestedAt};
  observeResponse(nextResponse);
  const next = nextResponse.data;
  verifyPage(next, nextResponse.status); verifyFullPage(next);
  need(next.page === 2 && next.pageSize === 24 && next.total === null && next.countSummary === null, 'append_page');
  const loaded = [...first.items, ...next.items];
  need(next.items.length > 0 && new Set(loaded.map(row => row.id)).size === loaded.length, 'append_duplicate');
  await verifyVisible(view, loaded, {total: null, countSummary: summary, hasMore: next.hasMore},
    {countAcceptance: JAPAN_SOURCE_COUNT_ACCEPTANCE, query, auctionDatabaseLabel});
  need(view.url() === documentUrl && errors === 0 && progress.explicitApiReads === 2, 'complete');
  verifyVehiclePolicy([first, next]);
  report.checks.sourceCount = {contract: 'japan-source-count-browser-v1', summary,
    queryHashVerified: true, independentCount: true, admittedTotal: null, positiveAdmittedCensusClaimed: false, ui,
    pagination: {sameFilter: true, cursorBeforeCount, cursorAfterCount,
      continuationCursor: japanSourceCountContinuation(response.url(), cursorAfterCount), continuationFollowed: true,
      loadedBefore: first.items.length, loadedAfter: loaded.length, duplicateIds: 0, freshSourcePages: true},
    liveExhaustiveScan: false, pageErrors: errors};
  progress.phase = 'complete'; report.japanSourceCountPassed = true;
  await capture(view, 'japan-source-count-audi-a4-append-desktop');
  const powerPages = report.japanA4Power160ContinuationRequired === true
    ? await runJapanA4Power160ContinuationBrowser({view, report, capture, onStage,
      verifyPowerPage, verifyVehiclePolicy, pageReadEvidence, readSsrPageEvidence, observeResponse, pageErrors: () => errors}) : [];
  await view.close(); onPage(null); return [...modelPages, first, next, ...powerPages];
}
