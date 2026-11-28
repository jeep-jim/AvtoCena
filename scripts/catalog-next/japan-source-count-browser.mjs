import {japanExactCountQueryHash, runJapanModelCoverageBrowser} from './japan-exact-count-browser.mjs';

const ORIGIN = 'https://avtocena.com', CITY = 'Новокузнецк';
const need = (value, code) => { if (!value) throw Error('japan_browser_source_count_' + code); };
const natural = value => Number.isSafeInteger(value) && value >= 0;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const normalize = value => value.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
const numberText = value => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const JAPAN_SOURCE_COUNT_ACCEPTANCE = 'japan-source-count-v1';
export const JAPAN_SOURCE_COUNT_GATES = Object.freeze(['japanSourceCountPassed']);

export function japanSourceCountRequirement(value) {
  need(value === undefined || value === '0' || value === '1', 'option');
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
export function verifyJapanSourceCountVisible(observation, {summary, query, loaded, now = Date.now()} = {}) {
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
  need(normalize(label) === (status === 'bounded' ? 'Найдено до ' : 'В источнике: ') + numberText(Number(sourceTotal)), 'visible_label');
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

async function readVisibleSourceCount(view, summary, loaded, query) {
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
  {summary, loaded, query});
}

/** Retain the exact source-directory/card union proof, then exercise one real
 * saved Audi/A4 URL. A COUNT failure or denied second page is a failed gate;
 * useful visible rows and transport diagnostics are left in the failure report. */
export async function runJapanSourceCountBrowser({context, report, read, capture, onStage, onPage,
  verifyPage, verifyFullPage, verifyVehiclePolicy, verifyVisible, observeResponse = () => {}}) {
  need(report.countAcceptance === JAPAN_SOURCE_COUNT_ACCEPTANCE && report.japanExactCountRequired === false
    && report.japanExactCountPassed === null && report.japanSourceCountRequired === true, 'profile');
  const modelReport = {checks: report.checks, japanExactCountRequired: false, japanExactCountPassed: null};
  const modelPages = await runJapanModelCoverageBrowser({context, report: modelReport, read, capture, onStage, onPage,
    verifyPage, verifyFullPage, verifyVehiclePolicy,
    verifyVisible: (view, items, payload, options) => verifyVisible(view, items, payload,
      {...options, countAcceptance: JAPAN_SOURCE_COUNT_ACCEPTANCE})});
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
    {countAcceptance: JAPAN_SOURCE_COUNT_ACCEPTANCE, query});
  const more = view.locator('main.ac-ajes-catalog a.ac-catalog-more[role="button"]');
  need(await more.count() === 1, 'append_control');
  const cursorBeforeCount = japanSourceCountContinuation(await more.getAttribute('href'), first.nextCursor);
  progress.phase = 'independent_count'; onStage('source_count_independent');
  const counted = await boundedRead(japanSourceCountApi({countOnly: true}));
  need(counted.status === 200 && counted.data?.ok === true && counted.data.total === null
    && counted.data.countIncomplete === true && Array.isArray(counted.data.items) && counted.data.items.length === 0, 'response');
  const summary = verifyJapanSourceCountSummary(counted.data.countSummary, {query, positive: true, fresh: true});
  const ui = await readVisibleSourceCount(view, summary, first.items.length, query);
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
    {countAcceptance: JAPAN_SOURCE_COUNT_ACCEPTANCE, query});
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
  await view.close(); onPage(null); return [...modelPages, first, next];
}
