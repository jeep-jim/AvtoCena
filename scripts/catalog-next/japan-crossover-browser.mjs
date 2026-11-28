import {createHash} from 'node:crypto';
import {checkedJapanSourceCountCursor} from './japan-source-count-browser.mjs';
import {verifyJapanSourcePriceFreshReceipts, observeJapanSourcePriceReadiness} from './japan-source-price-order-browser.mjs';
import {JAPAN_CROSSOVER_POWER_CONTRACT, japanCrossoverAcceptancePassed} from './japan-crossover-proof.mjs';

export {japanCrossoverAcceptancePassed} from './japan-crossover-proof.mjs';
const ORIGIN = 'https://avtocena.com', CITY = 'Новокузнецк';
const CARD = 'article.ac-catalog-card,article.ac-catalog-list-row';
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (value, code) => { if (!value) throw Error('japan_browser_crossover_' + code); };
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
export const JAPAN_CROSSOVER_PAGE = '/cars/japan?' + new URLSearchParams({bodyType: 'suv', powerTo: '160', city: CITY});

export function japanCrossoverRequirement(value) {
  need(value === undefined || value === '0' || value === '1', 'option');
  return value === '1';
}

export function japanCrossoverSelection(value, {append = false, expectedCursor} = {}) {
  const url = new URL(value, ORIGIN), query = url.searchParams;
  need(url.origin === ORIGIN && !url.username && !url.password && !url.hash
    && ['/cars', '/cars/japan', '/api/catalog/search'].includes(url.pathname)
    && [...query.keys()].every(key => ['bodyType', 'powerTo', 'city', 'market', 'marketPage', 'pageSize', 'page', 'after', 'view'].includes(key)
      && query.getAll(key).length === 1)
    && query.get('bodyType') === 'suv' && query.get('powerTo') === '160' && query.get('city') === CITY
    && (url.pathname === '/cars/japan' ? !query.has('market') || query.get('market') === 'japan' : query.get('market') === 'japan')
    && (!query.has('marketPage') || query.get('marketPage') === '1')
    && (!query.has('pageSize') || query.get('pageSize') === '24')
    && (!query.has('view') || ['grid', 'list'].includes(query.get('view'))), 'selection');
  if (!append) { need(!query.has('after') && (!query.has('page') || query.get('page') === '1'), 'first_page'); return null; }
  const cursor = query.get('after');
  need(query.get('page') === '2' && checkedJapanSourceCountCursor(cursor).version === 'j2'
    && (expectedCursor === undefined || cursor === expectedCursor), 'emitted_cursor');
  return cursor;
}

export function verifyJapanCrossoverRows(rows) {
  need(Array.isArray(rows) && [24, 48].includes(rows.length)
    && new Set(rows.map(row => row?.id)).size === rows.length, 'rows');
  let unknown = false;
  for (const row of rows) {
    need(/^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(row?.id || '') && row.bodyType === 'suv', 'body');
    if (row.powerHp === null) unknown = true;
    else need(!unknown && positive(row.powerHp) && row.powerHp <= 160, 'power_order');
  }
  return rows;
}

export function verifyJapanCrossoverAppend({before, items, after}) {
  verifyJapanCrossoverRows(before); verifyJapanCrossoverRows(after);
  need(before.length === 24 && Array.isArray(items) && items.length === 24 && after.length === 48, 'append');
  const added = items.map(row => {
    const supplier = row?.japanSupplierPower;
    const powerHp = positive(row?.powerHp) ? row.powerHp : supplier?.offerId === row?.id
      && supplier.source === 'ajes_pw' && supplier.unit === 'hp' && Number.isSafeInteger(supplier.hp) && supplier.hp > 0
        ? supplier.hp : null;
    need(row?.market === 'japan' && (powerHp === null ? row.japanPowerUnknown === true : row.japanPowerUnknown !== true), 'power');
    return {id: row.id, bodyType: row.editorialSpecifications?.bodyType || row.bodyType, powerHp};
  });
  verifyJapanCrossoverRows(added);
  need(JSON.stringify(after) === JSON.stringify([...before, ...added]), 'append_identity');
  const powers = after.map(row => row.powerHp);
  return {loadedBefore: 24, added: 24, loadedAfter: 48, duplicateIds: 0, oldIdsPreserved: true, orderPreserved: true,
    allBodiesSuv: true, knownBeforeUnknown: true, powerValuesMatchApi: true, powers, powersSha256: hash(JSON.stringify(powers)),
    beforeIdsSha256: hash(JSON.stringify(before.map(row => row.id))), addedIdsSha256: hash(JSON.stringify(added.map(row => row.id))),
    afterIdsSha256: hash(JSON.stringify(after.map(row => row.id)))};
}

async function visibleRows(view, count) {
  await view.waitForFunction(({selector, count}) => {
    const root = document.querySelector('main.ac-ajes-catalog'), form = document.querySelector('form.ac-catalog-filter-panel');
    return root?.querySelectorAll(selector).length === count && root.querySelector('[data-japan-loaded-count="' + count + '"]')
      && form?.querySelector('input[name="bodyType"]')?.value === 'suv'
      && form.querySelector('input[name="powerTo"][value="160"]')?.checked === true;
  }, {selector: CARD, count}, {timeout: 60_000});
  const rows = await view.locator('main.ac-ajes-catalog').locator(CARD).evaluateAll(nodes => nodes.map(node => {
    const ids = [...new Set([...node.querySelectorAll('a[href]')].flatMap(link => {
      const match = /\/cars\/offer\/([^/?#]+)/.exec(link.getAttribute('href') || ''); return match ? [match[1]] : [];
    }))];
    const phase = node.getAttribute('data-japan-power-phase'), unknown = node.querySelector('[data-japan-power-unknown="true"]');
    const values = [...(node.textContent || '').matchAll(/(\d+(?:[.,]\d+)?)\s*л\.\s*с\./g)].map(match => Number(match[1].replace(',', '.')));
    return {id: ids.length === 1 ? ids[0] : null, bodyType: node.getAttribute('data-catalog-body-type'),
      powerHp: phase === 'known' && values.length === 1 ? values[0] : null, phase,
      unknownVisible: Boolean(unknown && unknown.getClientRects().length && unknown.textContent?.trim() === 'Мощность не указана')};
  }));
  need(rows.every(row => row.powerHp === null ? row.phase === 'unknown' && row.unknownVisible : row.phase === 'known' && !row.unknownVisible), 'dom_power');
  return verifyJapanCrossoverRows(rows.map(({id, bodyType, powerHp}) => ({id, bodyType, powerHp})));
}

/** Reuse the bounded DOM/SSR observer before readiness can time out. These
 * observations read the existing page only and cannot satisfy the row gate. */
export async function readJapanCrossoverFirstPage(view, {progress, readSsrPageEvidence}) {
  const diagnostic = progress.firstPageReadiness = {
    beforeWait: await observeJapanSourcePriceReadiness(view, readSsrPageEvidence)};
  try { return await visibleRows(view, 24); }
  catch (error) {
    diagnostic.failure = {timeout: error?.name === 'TimeoutError',
      observation: await observeJapanSourcePriceReadiness(view, readSsrPageEvidence)};
    throw error;
  }
}

/** The screenshot route is opened once; its emitted page-two request is
 * observed from one normal click. No independent LIST or supplier request. */
export async function runJapanCrossoverBrowser({context, report, capture, onStage, onPage,
  verifyPage, verifyFullPage, verifyPowerPage, verifyVehiclePolicy, pageReadEvidence, readSsrPageEvidence,
  observeResponse = () => {}}) {
  need(report.japanCrossoverPower160Required === true, 'profile');
  const progress = report.checks.crossoverPower160Progress = {phase: 'navigate'};
  onStage('stability_crossover_power160');
  const view = await context.newPage(); onPage(view); let errors = 0;
  view.on('pageerror', () => { errors++; });
  await view.setViewportSize({width: 1440, height: 1000});
  const document = await view.goto(ORIGIN + JAPAN_CROSSOVER_PAGE, {waitUntil: 'domcontentloaded', timeout: 90_000});
  need(document?.status() === 200, 'document'); japanCrossoverSelection(view.url());
  const before = await readJapanCrossoverFirstPage(view, {progress, readSsrPageEvidence});
  const firstPage = verifyJapanSourcePriceFreshReceipts(await readSsrPageEvidence(view, {page: 1, after: ''}), {ssr: true});
  const catalog = view.locator('main.ac-ajes-catalog'), more = catalog.locator('a.ac-catalog-more[role="button"]');
  need(await more.count() === 1, 'append_control');
  const cursor = japanCrossoverSelection(await more.getAttribute('href'), {append: true});
  const emitted = checkedJapanSourceCountCursor(cursor);
  Object.assign(progress, {phase: 'append', firstPage, cursor}); onStage('stability_crossover_power160_append');
  const requestedAt = Date.now();
  const pending = view.waitForResponse(response => {
    try { return response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/catalog/search'
      && japanCrossoverSelection(response.url(), {append: true, expectedCursor: cursor}) === cursor; }
    catch { return false; }
  }, {timeout: 60_000});
  pending.catch(() => {}); await more.click(); const response = await pending;
  const next = await response.json(), received = {status: response.status(), data: next,
    headers: await response.allHeaders(), requestedAt, receivedAt: Date.now(), durationMs: Date.now() - requestedAt};
  observeResponse(received); progress.appendStatus = received.status;
  const options = {countAcceptance: report.countAcceptance, query: response.url()};
  const observation = verifyPage(next, received.status, Date.now(), options);
  verifyFullPage(next, options); verifyPowerPage(next, 2, options); verifyVehiclePolicy([next]);
  need(next.page === 2 && next.pageSize === 24 && next.items.length === 24 && next.interrupted === false, 'append_page');
  const nextPage = verifyJapanSourcePriceFreshReceipts(pageReadEvidence(next), {reads: next.reads, observedAt: next.observedAt});
  if (next.hasMore) {
    const following = checkedJapanSourceCountCursor(next.nextCursor, 3);
    need(following.version === 'j2' && following.queryHash === emitted.queryHash
      && following.evidenceEpoch === emitted.evidenceEpoch
      && (!cursor.startsWith('j2.u.') || next.nextCursor.startsWith('j2.u.')), 'next_cursor');
  } else need(next.nextCursor === null, 'next_cursor');
  const after = await visibleRows(view, 48), append = verifyJapanCrossoverAppend({before, items: next.items, after});
  japanCrossoverSelection(view.url());
  need(errors === 0 && await catalog.getByRole('alert').count() === 0, 'alerts');
  report.checks.crossoverPower160 = {contract: JAPAN_CROSSOVER_POWER_CONTRACT, city: CITY, bodyType: 'suv', powerTo: 160,
    documentStatus: 200, ...append, firstPage: {...firstPage, shown: 24},
    nextPage: {...nextPage, ...observation, interrupted: next.interrupted, shown: 24},
    cursor, continuationCursor: cursor, sameFilter: true, cityPreserved: true, bodyControlPreserved: true,
    powerControlPreserved: true, followedEmittedCursor: true, explicitApiReads: 0, ordinaryAppendRequests: 1,
    liveExhaustiveScan: false, pageErrors: errors, alerts: 0};
  report.japanCrossoverPower160Passed = true; progress.phase = 'complete';
  await capture(view, 'japan-crossover-power160-append-desktop');
  await view.close(); onPage(null); return next;
}
