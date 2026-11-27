import {createHash} from 'node:crypto';

const ORIGIN = 'https://avtocena.com';
const CITY = 'Новокузнецк';
const CARD = 'article.ac-catalog-card,article.ac-catalog-list-row';
const need = (value, code) => { if (!value) throw Error('japan_browser_stability_' + code); };
const hash = value => createHash('sha256').update(value).digest('hex');
const name = value => typeof value === 'string' && value.trim() === value && value.length > 0
  && value.length <= 100 && !/[\x00-\x1f\x7f<>|]/.test(value);
const normalized = value => String(value).normalize('NFKC').toUpperCase().replace(/\s+/g, ' ').trim();
const compact = value => normalized(value).replace(/[^\p{L}\p{N}]+/gu, '');
const sameMake = (value, expected) => name(value) && compact(value) === compact(expected);
const modelOptionIdentity = row => JSON.stringify([row.make, row.model]);
const sourceModelMatches = (source, selected) => compact(source) === compact(selected)
  || normalized(source).startsWith(normalized(selected) + ' ')
  || normalized(source).startsWith(normalized(selected) + '(');

export const JAPAN_STABILITY_GATES = Object.freeze(['japanModelSelectionPassed', 'japanCombinedFiltersPassed',
  'japanRelatedCardsPassed', 'japanVehiclePolicyPassed']);
export const JAPAN_STABILITY_MODELS_API = '/api/catalog/source-models?market=japan&make=Mazda';
export const JAPAN_STABILITY_BRANDS_API = '/api/catalog/brand-counts?market=japan';
export const JAPAN_LEGACY_MAZDA_THREE_PAGES = Object.freeze({
  literal: ORIGIN + '/cars/japan?' + new URLSearchParams({make: 'Mazda', model: '3', city: CITY}),
  canonical: ORIGIN + '/cars/japan/Mazda/3?' + new URLSearchParams({city: CITY}),
});

/** The controls preserve the selected source spellings in the canonical path. */
export function japanStabilitySelectionUrl(value, make, model) {
  if (!name(make) || model !== undefined && !name(model)) return false;
  try {
    const url = new URL(value);
    const expected = ORIGIN + '/cars/japan/' + encodeURIComponent(make)
      + (model === undefined ? '' : '/' + encodeURIComponent(model)) + '?' + new URLSearchParams({city: CITY});
    return url.href === expected;
  } catch { return false; }
}

export function japanStabilityChinaFamilyPage(generationId) {
  need(/^gen_china_[0-9]+_[0-9]+$/.test(generationId), 'china_generation');
  return ORIGIN + '/cars/china/Mercedes-Benz/B-Class?'
    + new URLSearchParams({city: CITY, preparedCut: generationId});
}

const cleanMake = value => value.replace(/\s+/g, ' ').trim();
const makeKey = value => cleanMake(value).toLocaleLowerCase('ru-RU');
const sortedValues = values => [...values].sort();
const sameValues = (left, right) => JSON.stringify(sortedValues(left)) === JSON.stringify(sortedValues(right));
const distinctMakes = values => [...new Map(values.map(value => [makeKey(value), cleanMake(value)])).values()];

/** The current public metadata contract has counts, not the retired
 * directoryComplete/makes fields. Empty or stale counts cannot certify a
 * complete directory even if visible-card fallbacks are still useful. */
export function checkedJapanStabilityBrandDirectory(payload, status, now = Date.now()) {
  const observed = Date.parse(payload?.generationId || '');
  need(status === 200 && payload?.stale === false && !payload.partial && !payload.interrupted && !payload.scanLimited
    && Number.isFinite(observed) && observed <= now + 60_000 && now - observed < 30 * 60_000,
  'brand_directory_unavailable');
  need(payload.counts && typeof payload.counts === 'object' && !Array.isArray(payload.counts), 'brand_directory_rows');
  const entries = Object.entries(payload.counts);
  need(entries.length > 0 && entries.every(([make, count]) => name(make)
    && Number.isSafeInteger(count) && count >= 0), 'brand_directory_rows');
  const makes = entries.filter(([, count]) => count > 0).map(([make]) => make);
  need(makes.length > 0, 'brand_directory_empty');
  return {makes, observedAt: new Date(observed).toISOString(),
    sourceNamesSha256: hash(JSON.stringify(sortedValues(makes)))};
}

export function verifyJapanStabilityBrandOptions(directory, values, state) {
  need(state === 'ready', 'brand_filter_unavailable');
  need(Array.isArray(values) && values.every(name), 'brand_filter_rows');
  const keys = values.map(makeKey), expected = distinctMakes(directory.makes).map(makeKey);
  need(keys.length > 0 && new Set(keys).size === keys.length && sameValues(keys, expected), 'brand_filter_names');
  return {sourceMakes: directory.makes.length, filterMakes: keys.length,
    sourceNamesSha256: directory.sourceNamesSha256, observedAt: directory.observedAt,
    completeSourceCovered: true, fallbackOnly: false};
}

function railMakeValues(href, pageUrl) {
  let target, current;
  try { target = new URL(href, ORIGIN); current = new URL(pageUrl); }
  catch { need(false, 'brand_rail_link'); }
  const route = /^\/cars\/japan(?:\/([^/]+))?$/.exec(target.pathname);
  let pathMake;
  try { pathMake = route?.[1] === undefined ? undefined : decodeURIComponent(route[1]); }
  catch { need(false, 'brand_rail_link'); }
  need(target.origin === ORIGIN && !target.username && !target.password && !target.hash
    && current.origin === ORIGIN && current.pathname === '/cars/japan'
    && !current.searchParams.has('make') && !current.searchParams.has('model')
    && route && (pathMake === undefined || name(pathMake) && !/[\/\\\u0000-\u001f]/.test(pathMake))
    && [...new Set(target.searchParams.keys())].every(key => target.searchParams.getAll(key).length === 1)
    && !(pathMake && target.searchParams.has('make')), 'brand_rail_link');
  const raw = pathMake || target.searchParams.get('make');
  need(typeof raw === 'string' && raw.length > 0, 'brand_rail_link');
  const values = raw.split(',');
  need(values.every(name) && new Set(values).size === values.length, 'brand_rail_link');
  const actual = new URLSearchParams(target.search), expected = new URLSearchParams(current.search);
  actual.delete('make');
  for (const key of ['market', 'make', 'brand', 'page', 'after']) expected.delete(key);
  need(sameValues([...actual].map(entry => JSON.stringify(entry)), [...expected].map(entry => JSON.stringify(entry))),
    'brand_rail_context');
  return values;
}

/** Display aliases may group source names, but every link must retain all of
 * its actual source spellings. Extra rail makes require a verified visible
 * Japan card; those fallbacks never stand in for the complete counts response. */
export function verifyJapanStabilityBrandRail(directory, links, visibleRows, pageUrl, state, canonicalMake) {
  need(state === 'ready', 'brand_rail_unavailable');
  need(typeof canonicalMake === 'function', 'brand_rail_presentation');
  need(Array.isArray(visibleRows) && visibleRows.length > 0 && visibleRows.every(row => auctionRow(row) && name(row.make)),
    'brand_rail_visible_source');
  const visibleMakes = visibleRows.map(row => row.make), groups = new Map();
  for (const make of [...directory.makes, ...visibleMakes]) {
    const label = canonicalMake(make), key = label.toLocaleLowerCase('en-US');
    const group = groups.get(key) || {label, makes: new Set()};
    group.makes.add(make); groups.set(key, group);
  }
  need(Array.isArray(links) && links.length === groups.size && links.length > 0, 'brand_rail_names');
  const seen = new Set();
  for (const link of links) {
    const label = typeof link?.title === 'string' && /^Автомобили (.+) под заказ$/u.exec(link.title)?.[1];
    need(name(label), 'brand_rail_names');
    const key = label.toLocaleLowerCase('en-US'), group = groups.get(key);
    need(group && group.label === label && !seen.has(key), 'brand_rail_names'); seen.add(key);
    need(sameValues(railMakeValues(link.href, pageUrl), [...group.makes]), 'brand_rail_source_names');
  }
  const source = new Set(directory.makes);
  return {railMakes: groups.size, completeSourceCovered: true,
    visibleFallbackMakes: new Set(visibleMakes.filter(make => !source.has(make))).size, fallbackOnly: false,
    sourceLinksMatched: true, filterContextPreserved: true};
}

/** Safe metadata diagnostics distinguish an unavailable directory from malformed
 * rows without recording source names, payload bodies or private headers. */
export function japanStabilityBrandDirectoryShape(payload, status) {
  const counts = payload?.counts;
  const countsType = counts === undefined ? 'missing' : counts === null ? 'null'
    : Array.isArray(counts) ? 'array' : typeof counts;
  const entries = countsType === 'object' ? Object.entries(counts) : null;
  return {status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    stale: typeof payload?.stale === 'boolean' ? payload.stale : null, countsType,
    entryCount: entries?.length ?? null,
    positiveCount: entries ? entries.filter(([, count]) => Number.isSafeInteger(count) && count > 0).length : null,
    invalidCount: entries ? entries.filter(([make, count]) => !name(make) || !Number.isSafeInteger(count) || count < 0).length : null,
    countsSha256: counts === undefined ? null : hash(JSON.stringify(counts))};
}

function fallbackSourceMakes(visibleRows, payload, status) {
  need(Array.isArray(visibleRows) && visibleRows.length > 0
    && visibleRows.every(row => auctionRow(row) && name(row.make)), 'brand_fallback_visible_source');
  const counts = payload?.counts;
  const entries = status === 200 && counts && typeof counts === 'object' && !Array.isArray(counts)
    ? Object.entries(counts) : [];
  // Valid stale metadata may supply names, but never a complete/fresh verdict.
  // Malformed or failed metadata is discarded by the actual component.
  const source = entries.every(([make, count]) => name(make) && Number.isSafeInteger(count) && count >= 0)
    ? entries.filter(([, count]) => count > 0).map(([make]) => make) : [];
  return distinctMakes([...visibleRows.map(row => row.make), ...source]);
}

export function verifyJapanStabilityBrandFallback(values, visibleRows, payload, status) {
  const allowed = fallbackSourceMakes(visibleRows, payload, status).map(makeKey);
  need(Array.isArray(values) && values.length > 0 && values.every(name), 'brand_fallback_rows');
  const keys = values.map(makeKey);
  need(new Set(keys).size === keys.length && keys.every(value => allowed.includes(value))
    && visibleRows.every(row => keys.includes(makeKey(row.make))), 'brand_fallback_source_names');
  return {sourceFallbackVerified: true, fallbackMakes: keys.length,
    sourceNamesSha256: hash(JSON.stringify(sortedValues(values))), completeSourceCovered: false, fallbackOnly: true};
}

export function verifyJapanStabilityBrandRailFallback(links, visibleRows, directory, pageUrl, canonicalMake, initialObservation) {
  need(typeof canonicalMake === 'function' && Array.isArray(directory?.makes), 'brand_rail_presentation');
  const allowed = fallbackSourceMakes(visibleRows, null, 0);
  const first = initialObservation?.data, observed = Date.parse(first?.generationId || '');
  const stale = initialObservation?.status === 200 && first?.stale === true && Number.isFinite(observed)
    && observed <= Date.now() + 60_000 ? fallbackSourceMakes(visibleRows, first, 200) : [];
  const source = new Set([...allowed, ...directory.makes, ...stale]), seen = new Set(), covered = new Set();
  need(Array.isArray(links) && links.length > 0, 'brand_rail_fallback_rows');
  for (const link of links) {
    const label = typeof link?.title === 'string' && /^Автомобили (.+) под заказ$/u.exec(link.title)?.[1];
    need(name(label) && !seen.has(label), 'brand_rail_fallback_names'); seen.add(label);
    for (const make of railMakeValues(link.href, pageUrl)) {
      need(source.has(make) && canonicalMake(make) === label, 'brand_rail_fallback_source_names'); covered.add(make);
    }
  }
  need(allowed.every(make => covered.has(make)), 'brand_rail_fallback_visible_source');
  return {sourceFallbackVerified: true, fallbackMakes: covered.size, fallbackRails: links.length,
    sourceNamesSha256: hash(JSON.stringify(sortedValues([...covered]))), completeSourceCovered: false, fallbackOnly: true};
}

export function verifyJapanStabilityBrandRequestCount(actual, proofs) {
  need(Array.isArray(proofs) && proofs.length === 2 && proofs.every(proof =>
    proof?.completeSourceCovered === true && proof.fallbackOnly === false
    && [1, 2].includes(proof.metadataRequests) && typeof proof.railRetryUsed === 'boolean'
    && proof.dropdownRetryUsed === (proof.metadataRequests === 2))
    && Number.isSafeInteger(actual) && actual >= 2 && actual <= 4
    && actual === proofs.reduce((total, proof) => total + proof.metadataRequests, 0), 'brand_directory_request_count');
  return actual;
}

/** Observe real control requests only. An honest unavailable source UI permits
 * one actual Retry; success still requires the original fresh complete source
 * and exact option/rail identity checks. There is no explicit metadata fetch. */
export async function checkJapanStabilityBrandControl({view, controls, rail, visibleRows,
  expectedDirectory, onResponse = () => {}, capture = async () => {}, progress = {}}) {
  Object.assign(progress, {phase: 'opening', attempts: [], dropdownRetries: 0, railRetries: 0});
  const before = view.url(), trigger = controls.locator('button[aria-label="Выбрать марки автомобилей"]:visible');
  need(new URL(before).searchParams.get('city') === CITY && await trigger.count() === 1
    && await trigger.getAttribute('aria-expanded') === 'false', 'brand_control');
  progress.phase = 'controls_ready';
  const form = trigger.locator('xpath=ancestor::form[1]');
  progress.controlsKind = await form.getAttribute('role') === 'dialog' ? 'mobile' : 'desktop';
  if (progress.controlsKind === 'desktop') await waitForJapanStabilityControls(view);
  else await view.locator('form[role="dialog"][aria-label="Фильтры каталога"][aria-busy="false"]')
    .waitFor({state: 'visible', timeout: 15_000});
  const selectedInputs = () => form.locator('input[type="hidden"][name]').evaluateAll(nodes => nodes.map(node =>
    [node.name, node.value]).sort((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1])));
  const selectedBefore = await selectedInputs();
  progress.selectionSha256 = hash(JSON.stringify(selectedBefore));
  const parent = trigger.locator('..'), dropdown = parent.locator('.ac-filter-dropdown');
  const unavailable = parent.locator('.ac-filter-dropdown[data-japan-source-directory-state="unavailable"]');
  const retryName = 'Не удалось загрузить марки. Повторить';
  async function observe(action) {
    need(progress.attempts.length < 2, 'brand_directory_request_count');
    progress.phase = progress.attempts.length ? 'metadata_retry' : 'metadata_initial';
    const requestedAt = Date.now();
    const pending = view.waitForResponse(response => {
      try { const url = new URL(response.url()); return response.request().method() === 'GET' && url.origin === ORIGIN
        && url.pathname === '/api/catalog/brand-counts'; } catch { return false; }
    }, {timeout: 45_000});
    pending.catch(() => {});
    await action();
    const response = await pending, receivedAt = Date.now();
    need(response.url() === ORIGIN + JAPAN_STABILITY_BRANDS_API, 'brand_directory_query');
    const status = response.status();
    // Failed HTTP metadata cannot contribute source names or completeness.
    // Its body may remain unread by the UI; observing it must not block Retry.
    const data = status === 200 ? await response.json().catch(() => null) : null;
    const attempt = {...japanStabilityBrandDirectoryShape(data, status), attempt: progress.attempts.length + 1};
    progress.attempts.push(attempt);
    await onResponse({data, status, headers: response.headers(), requestedAt, receivedAt, durationMs: receivedAt - requestedAt});
    try { const directory = checkedJapanStabilityBrandDirectory(data, status); attempt.validation = 'fresh_complete'; return {data, status, directory}; }
    catch (error) {
      need(/^japan_browser_stability_brand_directory_(?:unavailable|rows|empty)$/.test(error?.message || ''), 'brand_directory_validation');
      attempt.validation = error.message.slice('japan_browser_stability_'.length);
      return {data, status, error};
    }
  }
  let observed = await observe(() => trigger.click());
  const initialObservation = observed;
  if (observed.error) {
    progress.phase = 'dropdown_unavailable';
    await unavailable.waitFor({state: 'visible', timeout: 15_000});
    const retry = dropdown.getByRole('button', {name: retryName, exact: true});
    need(await retry.count() === 1 && await retry.isVisible()
      && await dropdown.getByText('Марка не найдена', {exact: true}).count() === 0, 'brand_fallback_notice');
    const values = await dropdown.locator('button[data-facet-value]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-facet-value')));
    const fallback = verifyJapanStabilityBrandFallback(values, visibleRows, observed.data, observed.status);
    await visibleCardsMatch(view, view.locator('main.ac-ajes-catalog'), visibleRows);
    progress.dropdownFallback = fallback;
    progress.dropdownRetries = 1;
    observed = await observe(() => retry.click());
    if (observed.error) throw observed.error;
  }
  const {directory} = observed;
  if (expectedDirectory) need(sameValues(directory.makes, expectedDirectory.makes), 'brand_directory_changed');
  progress.phase = 'dropdown_ready';
  await dropdown.waitFor({state: 'visible', timeout: 15_000});
  await parent.locator('.ac-filter-dropdown[data-japan-source-directory-state="ready"]')
    .waitFor({state: 'visible', timeout: 15_000});
  const values = await dropdown.locator('button[data-facet-value]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-facet-value')));
  const proof = verifyJapanStabilityBrandOptions(directory, values, await dropdown.getAttribute('data-japan-source-directory-state'));
  need(await dropdown.getByText('Марка не найдена', {exact: true}).count() === 0
    && await dropdown.getByRole('button', {name: retryName, exact: true}).count() === 0, 'brand_filter_unavailable');
  progress.phase = 'dropdown_capture'; await capture(view);
  await trigger.click();
  need(view.url() === before && await trigger.getAttribute('aria-expanded') === 'false', 'brand_control_changed');
  if (rail) {
    progress.phase = 'rail_state';
    await rail.waitFor({state: 'visible', timeout: 60_000});
    const railSelector = 'main.ac-ajes-catalog section.ac-brand-rail';
    await view.locator(railSelector + '[data-japan-source-directory-state="ready"],'
      + railSelector + '[data-japan-source-directory-state="unavailable"]').waitFor({state: 'visible', timeout: 60_000});
    const readLinks = () => rail.locator('a[title^="Автомобили "]').evaluateAll(nodes => nodes.map(node =>
      ({title: node.getAttribute('title'), href: node.getAttribute('href')})));
    const {canonicalCatalogBrand} = await import('../../apps/web/lib/catalog/brands.ts');
    if (await rail.getAttribute('data-japan-source-directory-state') === 'unavailable') {
      progress.phase = 'rail_unavailable';
      const retry = rail.getByRole('button', {name: retryName, exact: true});
      need(await retry.count() === 1 && await retry.isVisible(), 'brand_rail_fallback_notice');
      await visibleCardsMatch(view, view.locator('main.ac-ajes-catalog'), visibleRows);
      progress.railFallback = verifyJapanStabilityBrandRailFallback(await readLinks(), visibleRows, directory, before,
        canonicalCatalogBrand, initialObservation);
      progress.phase = 'rail_retry'; progress.railRetries = 1; await retry.click();
    }
    progress.phase = 'rail_ready';
    await view.locator(railSelector + '[data-japan-source-directory-state="ready"]')
      .waitFor({state: 'visible', timeout: 60_000});
    Object.assign(proof, verifyJapanStabilityBrandRail(directory, await readLinks(), visibleRows, before,
      await rail.getAttribute('data-japan-source-directory-state'), canonicalCatalogBrand));
    if (progress.railRetries) {
      // router.refresh may remount the controls; do not open them again or wait
      // for a metadata request that the component's fresh cache need not make.
      await waitForJapanStabilityControls(view);
      await visibleCardsMatch(view, view.locator('main.ac-ajes-catalog'), visibleRows);
    }
    const bounds = await rail.boundingBox(), firstCard = await view.locator('main.ac-ajes-catalog').locator(CARD).first().boundingBox();
    need(bounds && firstCard && bounds.y + bounds.height <= firstCard.y, 'brand_rail_layout');
    proof.aboveCars = true;
  }
  need(view.url() === before && await trigger.getAttribute('aria-expanded') === 'false'
    && JSON.stringify(await selectedInputs()) === JSON.stringify(selectedBefore), 'brand_control_changed');
  progress.phase = 'complete';
  return {directory, proof: {...proof, selectedThroughUi: true, metadataRequests: progress.attempts.length,
    dropdownRetryUsed: progress.dropdownRetries === 1, railRetryUsed: progress.railRetries === 1, selectionUnchanged: true}};
}

export function japanStabilitySearchApi(kind, model) {
  need(['model', 'combined', 'related'].includes(kind), 'query_kind');
  const query = new URLSearchParams({market: 'japan', page: '1', pageSize: '24', city: CITY});
  if (kind === 'combined') {
    query.set('auctionGrade', '5'); query.set('transmission', 'automatic');
    query.set('fuel', 'petrol'); query.set('powerTo', '160');
  } else {
    need(name(model) && (kind !== 'related' || compact(model) === 'BCLASS'), 'query_model');
    query.set('make', kind === 'model' ? 'Mazda' : 'Mercedes-Benz'); query.set('model', model);
  }
  return '/api/catalog/search?' + query;
}

/** Additional reads are limited to the three actual visitor regressions. No
 * supplier URL, arbitrary API path, count scan or pagination loop is accepted. */
export function japanStabilityApiAllowed(value) {
  if (value === JAPAN_STABILITY_MODELS_API) return true;
  try {
    const url = new URL(value, ORIGIN), query = url.searchParams;
    if (url.origin !== ORIGIN || url.username || url.password || url.hash || url.pathname !== '/api/catalog/search'
      || [...new Set(query.keys())].some(key => query.getAll(key).length !== 1)) return false;
    if (query.get('auctionGrade') === '5') return value === japanStabilitySearchApi('combined');
    if (query.get('make') === 'Mazda') return value === japanStabilitySearchApi('model', query.get('model'));
    return query.get('make') === 'Mercedes-Benz' && value === japanStabilitySearchApi('related', query.get('model'));
  } catch { return false; }
}

export function checkedJapanStabilityDirectory(payload, status) {
  need(status === 200 && payload?.version === 1 && payload.stale === false
    && Array.isArray(payload.models) && payload.models.length > 0, 'directory_unavailable');
  const rows = payload.models.map(row => {
    need(Array.isArray(row) && row.length === 4 && sameMake(row[0], 'Mazda') && name(row[1])
      && Array.isArray(row[2]) && row[2].length === 0 && Number.isSafeInteger(row[3]) && row[3] > 0, 'directory_rows');
    return {model: row[1], total: row[3]};
  });
  need(new Set(rows.map(row => normalized(row.model))).size === rows.length, 'directory_duplicate');
  return rows;
}

export function selectJapanStabilityModel(directory, options) {
  need(Array.isArray(directory) && directory.length > 0 && Array.isArray(options) && options.length > 0, 'model_options');
  for (const option of options) need(sameMake(option.make, 'Mazda') && name(option.model)
    && directory.some(row => sourceModelMatches(row.model, option.model)), 'model_not_in_source');
  // The runtime preserves literal source make/model pairs, including distinct
  // source spellings of one brand. Only a repeated exact pair is a duplicate.
  need(new Set(options.map(modelOptionIdentity)).size === options.length, 'model_duplicate');
  // These priorities choose only an option actually rendered from this source.
  // They never turn an encyclopedia alias such as "3" into MAZDA3 or AXELA.
  const priority = value => ['MAZDA3', 'AXELA', 'DEMIO', 'CX5', 'CX3'].findIndex(prefix => compact(value).startsWith(prefix));
  const ranked = options.filter(row => !/\b(?:TITAN|BONGO|SCRUM)\b/.test(normalized(row.model)))
    .map(row => ({...row, rank: priority(row.model)}))
    .sort((a, b) => (a.rank < 0 ? 99 : a.rank) - (b.rank < 0 ? 99 : b.rank) || a.model.localeCompare(b.model));
  need(ranked.length > 0, 'passenger_model_missing');
  return {make: ranked[0].make, model: ranked[0].model};
}

export function verifyJapanStabilityModelRows(payload, selection, directory) {
  need(payload.items.every(row => sameMake(row.make, 'Mazda') && name(row.model)
    && sourceModelMatches(row.model, selection.model)
    && directory.some(source => compact(source.model) === compact(row.model))), 'model_filter_mismatch');
  return {make: 'Mazda', model: selection.model, shown: payload.items.length, sourceOptionsOnly: true, rowModelsMatched: true};
}

const legacyMazdaThreeFamily = value => {
  const requested = 'MAZDA3'; let prefix = '';
  for (const word of normalized(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/)) {
    prefix += word;
    if (prefix === requested || prefix.startsWith(requested) && /^[A-Z]+$/.test(prefix.slice(requested.length))) return true;
    if (!requested.startsWith(prefix)) return false;
  }
  return false;
};

/** The old Mazda/3 bookmark must resolve to an observed MAZDA3 family. Another
 * selectable Mazda model cannot prove this alias, nor can an empty/error page. */
export function verifyJapanLegacyMazdaThreeRows(payload, directory) {
  const family = directory.filter(row => name(row.model) && legacyMazdaThreeFamily(row.model));
  need(family.length > 0, 'legacy_mazda_three_source_missing');
  need(Array.isArray(payload?.items) && payload.items.length > 0 && payload.items.every(row =>
    sameMake(row.make, 'Mazda') && name(row.model) && legacyMazdaThreeFamily(row.model)
    && family.some(source => compact(source.model) === compact(row.model))), 'legacy_mazda_three_mismatch');
  return {make: 'Mazda', model: '3', resolvedFamily: 'MAZDA3', shown: payload.items.length,
    sourceFamilyModels: family.length, rowModelsMatched: true};
}

export function verifyJapanStabilityCombinedRows(payload) {
  need(payload.items.every(row => row.fuel === 'petrol' && row.transmission === 'automatic'
    && String(row.auctionGrade).trim() === '5'), 'combined_filter_mismatch');
  return {auctionGrade: '5', transmission: 'automatic', fuel: 'petrol', powerTo: 160, shown: payload.items.length};
}

const auctionRow = row => row?.market === 'japan' && /^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(row.id || '');
// AJ retains its raw make. These two exact spellings are explicit aliases of
// Mercedes-Benz in runtime brands.ts; no other brand or family is inferred.
const relatedMercedesMake = value => sameMake(value, 'Mercedes-Benz')
  || name(value) && /^(?:benz|mercedes)$/i.test(value);
// filterGreenCorner calls matchesCatalogModel: Mercedes discovery compares the
// complete B-Class tokens and permits a trailing trim, not another class or
// a partial token such as B-Classical. Mercedes has no discovery-name rewrite.
const greenFamilyMatches = (model, family) => {
  const requested=compact(family);let prefix='';
  for(const word of normalized(model).replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/)){
    prefix+=word;if(prefix===requested)return true;
    if(!requested.startsWith(prefix))return false;
  }
  return false;
};

/** Match the unchanged runtime Green stock and seller-price contracts. Stock
 * may fill a related rail, but cannot substitute for fresh auction evidence.
 * The source identity is required for the Green-specific ATB invoice rate. */
export function validJapanStabilityGreenStock(row) {
  const rate = row?.calculationSnapshot?.currencyRate;
  let retiredImage = false;
  try { retiredImage = /(^|\.)(pro-auctions\.ru|pa-server\.ru|jptrade\.ru)$/i.test(new URL(row?.imageUrl).hostname); } catch {}
  return row?.sourceId === 'akebono_green_japan_open' && row.market === 'japan'
    && typeof row.id === 'string' && /^green-\d+$/.test(row.id) && row.offerType === 'fixed'
    && row.catalogPricingMode === 'seller' && row.calculationStatus === 'needs_data'
    && !(Number(row.totalRub) > 0) && Number.isFinite(row.sellerPriceRub) && row.sellerPriceRub > 0
    && Number(row.sourcePrice) > 0 && /^[A-Z]{3}$/.test(String(row.sourceCurrency || ''))
    && ['cbr', 'cbr_live', 'atb_akebono'].includes(rate?.rateSource)
    && rate.currency === row.sourceCurrency && Number(rate.sourcePrice) === Number(row.sourcePrice)
    && Number.isFinite(rate.effectiveRate) && rate.effectiveRate > 0
    && Math.round(Number(row.sourcePrice) * rate.effectiveRate) === row.sellerPriceRub
    && Array.isArray(row.images) && row.images.length > 0 && !retiredImage
    && !['operational', 'vin', 'frameNumber'].some(key => Object.hasOwn(row, key));
}

export function verifyJapanStabilityRelated(payload, status, currentId) {
  need(status === 200 && payload?.kind === 'related' && payload.current?.id === currentId
    && payload.current.market === 'china' && sameMake(payload.make, 'Mercedes-Benz')
    && name(payload.familyModel) && compact(payload.familyModel) === 'BCLASS'
    && Array.isArray(payload.crossMarketGroups), 'related_response');
  const groups = payload.crossMarketGroups.filter(group => group?.market === 'japan');
  need(groups.length === 1 && Array.isArray(groups[0].items) && groups[0].items.length > 0
    && groups[0].items.length <= 4, 'related_empty');
  const rows = groups[0].items;
  need(rows.some(auctionRow) && rows.every(row => (auctionRow(row) || validJapanStabilityGreenStock(row)
    && greenFamilyMatches(row.model,payload.familyModel))
    && relatedMercedesMake(row.make) && name(row.model))
    && new Set(rows.map(row => row.id)).size === rows.length, 'related_rows');
  return rows;
}

async function visibleCardsMatch(page, root, items) {
  const cards = root.locator(CARD);
  await cards.nth(items.length - 1).waitFor({state: 'attached', timeout: 60_000});
  need(await cards.count() === items.length, 'ui_count');
  for (const row of items) {
    const card = cards.filter({has: page.locator('a[href*="' + row.id + '"]')});
    await card.waitFor({state: 'attached', timeout: 30_000});
    need(await card.count() === 1, 'ui_identity');
  }
  need(await root.getByText('Не удалось загрузить эту страницу', {exact: true}).count() === 0, 'ui_load_error');
  return cards;
}

export async function runJapanLegacyMazdaThreeBrowser({context, directory, read, capture, onStage, onPage,
  verifyPage, verifyFullPage, navigateLegacyMazdaThree}) {
  onStage('stability_legacy_mazda_three');
  const view = await context.newPage(); onPage(view); let errors = 0;
  view.on('pageerror', () => { errors++; });
  await view.setViewportSize({width: 1440, height: 1000});
  const {response, redirectProof} = await navigateLegacyMazdaThree(view);
  need(response?.status() === 200, 'legacy_mazda_three_page_http');
  need(view.url() === JAPAN_LEGACY_MAZDA_THREE_PAGES.canonical, 'legacy_mazda_three_url');
  const result = await read(japanStabilitySearchApi('model', '3'));
  const observation = verifyPage(result.data, result.status);
  verifyFullPage(result.data);
  const proof = verifyJapanLegacyMazdaThreeRows(result.data, directory);
  await visibleCardsMatch(view, view.locator('main.ac-ajes-catalog'), result.data.items);
  need(errors === 0, 'legacy_mazda_three_javascript');
  await capture(view, 'japan-legacy-mazda-three-desktop');
  await view.close(); onPage(null);
  return {page: result.data, proof: {...observation, ...proof, literalBookmarkChecked: true,
    canonicalRedirect: redirectProof, uiMatchesApi: true, cityPreserved: true, pageErrors: errors}};
}

/** CatalogFilters already exposes this hydration contract: its settings button
 * is disabled/aria-busy in SSR until the component's interactive effect runs.
 * The sidebar deliberately hides that button; only the enclosing form must be
 * visible. Its own aria-busy additionally waits for the selected URL's props. */
export async function waitForJapanStabilityControls(view, progress = {}, phase = 'controls_ready') {
  need(['controls_ready', 'initial_controls_ready', 'after_brand_controls_ready', 'after_model_controls_ready'].includes(phase), 'model_progress_phase');
  progress.phase = phase;
  const form = view.locator('form.ac-catalog-filter-panel:visible');
  await form.waitFor({state: 'visible', timeout: 30_000});
  await form.locator('button[aria-label="Расширенные фильтры"]:enabled[aria-busy="false"]')
    .waitFor({state: 'attached', timeout: 30_000});
  await view.locator('form.ac-catalog-filter-panel:visible[aria-busy="false"]')
    .waitFor({state: 'visible', timeout: 30_000});
  progress.readyChecks = (progress.readyChecks ?? 0) + 1;
  return form;
}

/** One real brand/model selection; no sleep, retry or extra source request. */
export async function selectJapanStabilityModelThroughUi({view, directory, progress = {}}) {
  const controls = await waitForJapanStabilityControls(view, progress, 'initial_controls_ready');
  const brand = controls.locator('button[aria-label="Выбрать марки автомобилей"]:visible');
  progress.phase = 'brand_open'; await brand.click();
  progress.phase = 'brand_expanded';
  await controls.locator('button[aria-label="Выбрать марки автомобилей"][aria-expanded="true"]')
    .waitFor({state: 'visible', timeout: 30_000});
  progress.brandExpanded = true;
  progress.phase = 'brand_option';
  const brandOption = view.locator('button[data-facet-value="Mazda" i]:visible');
  const sourceMake = await brandOption.getAttribute('data-facet-value');
  need(sameMake(sourceMake, 'Mazda'), 'make_option_identity');
  progress.phase = 'brand_select'; await brandOption.click();
  progress.phase = 'brand_url';
  await view.waitForURL(url => japanStabilitySelectionUrl(url.href, sourceMake), {timeout: 60_000});
  progress.brandUrlMatched = true;
  await waitForJapanStabilityControls(view, progress, 'after_brand_controls_ready');
  progress.phase = 'brand_close';
  if (await brand.getAttribute('aria-expanded') === 'true') await brand.click();
  await controls.locator('button[aria-label="Выбрать марки автомобилей"][aria-expanded="false"]')
    .waitFor({state: 'visible', timeout: 30_000});
  progress.phase = 'model_open';
  const input = controls.locator('input[aria-label="Модель автомобиля"]:visible');
  await input.click();
  progress.phase = 'model_options';
  await view.locator('button[data-model-value]:visible').first().waitFor({state: 'visible', timeout: 60_000});
  const options = await view.locator('button[data-model-value]:visible').evaluateAll(nodes => nodes.map(node =>
    ({model: node.getAttribute('data-model-value'), make: node.getAttribute('data-model-make')})));
  progress.modelOptions = options.length;
  progress.modelDistinctPairs = new Set(options.map(modelOptionIdentity)).size;
  progress.modelDistinctNormalizedNames = new Set(options.map(row => normalized(row.model))).size;
  progress.modelOptionPairsSha256 = hash(JSON.stringify(options.map(modelOptionIdentity).sort()));
  const selected = selectJapanStabilityModel(directory, options);
  const option = view.locator(`button[data-model-value=${JSON.stringify(selected.model)}][data-model-make=${JSON.stringify(selected.make)}]:visible`);
  need(await option.count() === 1, 'selected_option_identity');
  // Resolve this exact pair again at click time: an arriving source directory
  // may insert or reorder options after the validated snapshot was collected.
  progress.phase = 'model_select'; await option.click();
  progress.phase = 'model_url';
  await view.waitForURL(url => japanStabilitySelectionUrl(url.href, sourceMake, selected.model), {timeout: 60_000});
  progress.modelUrlMatched = true;
  const selectedControls = await waitForJapanStabilityControls(view, progress, 'after_model_controls_ready');
  progress.phase = 'model_close';
  const selectedInput = selectedControls.locator('input[aria-label="Модель автомобиля"]:visible');
  const expanded = await selectedInput.getAttribute('aria-expanded');
  need(expanded === 'true' || expanded === 'false', 'model_popup_state');
  progress.modelPopupOpenAfterNavigation = expanded === 'true';
  // A canonical make→model transition can remount the Next leaf and close the
  // popup itself. In the preserved-component case use its real close control.
  if (expanded === 'true') {
    await selectedControls.getByRole('button', {name: 'Закрыть список моделей', exact: true}).click();
    progress.modelPopupClose = 'clicked_close';
  } else progress.modelPopupClose = 'already_closed_after_navigation';
  await selectedControls.locator('input[aria-label="Модель автомобиля"][aria-expanded="false"]')
    .waitFor({state: 'visible', timeout: 30_000});
  progress.phase = 'model_selected_value';
  need(await selectedControls.locator('input[type="hidden"][name="model"]').inputValue() === selected.model
    && await selectedInput.inputValue() === selected.model, 'model_selected_value');
  need(japanStabilitySelectionUrl(view.url(), sourceMake, selected.model), 'model_selection_preserved');
  need(new URL(view.url()).searchParams.get('city') === CITY, 'model_city');
  progress.selectedValueMatched = true; progress.phase = 'selection_complete';
  return {sourceMake, selected};
}

/** Ordinary, bounded public journeys supplement the unchanged Japan freshness,
 * power, pagination, price and neighbor-preservation acceptance. */
export async function runJapanStabilityBrowser({context, report, generationId, read, capture, onStage, onPage,
  verifyPage, verifyFullPage, verifyPowerPage, verifyVehiclePolicy, navigateLegacyMazdaThree}) {
  const pages = [];
  onStage('stability_source_models');
  const directoryResponse = await read(JAPAN_STABILITY_MODELS_API);
  const directory = checkedJapanStabilityDirectory(directoryResponse.data, directoryResponse.status);

  const legacy = await runJapanLegacyMazdaThreeBrowser({context, directory, read, capture, onStage, onPage,
    verifyPage, verifyFullPage, navigateLegacyMazdaThree});
  pages.push(legacy.page); report.checks.legacyModelSelection = legacy.proof;

  onStage('stability_model_selection');
  const modelProgress = report.checks.modelSelectionProgress = {phase: 'page_navigation', readyChecks: 0};
  let view = await context.newPage(); onPage(view); let errors = 0;
  view.on('pageerror', () => { errors++; });
  await view.setViewportSize({width: 1440, height: 1000});
  let response = await view.goto(ORIGIN + '/cars/japan?' + new URLSearchParams({city: CITY}),
    {waitUntil: 'domcontentloaded', timeout: 90_000});
  need(response?.status() === 200, 'model_page_http');
  const {selected} = await selectJapanStabilityModelThroughUi({view, directory, progress: modelProgress});
  modelProgress.phase = 'model_api';
  const modelResponse = await read(japanStabilitySearchApi('model', selected.model));
  const modelObservation = verifyPage(modelResponse.data, modelResponse.status);
  verifyFullPage(modelResponse.data);
  const modelProof = verifyJapanStabilityModelRows(modelResponse.data, selected, directory);
  pages.push(modelResponse.data);
  let catalog = view.locator('main.ac-ajes-catalog');
  modelProgress.phase = 'model_ui_rows';
  await visibleCardsMatch(view, catalog, modelResponse.data.items);
  need(errors === 0, 'model_javascript');
  report.checks.modelSelection = {...modelObservation, ...modelProof, directoryModels: directory.length,
    selectedThroughUi: true, uiMatchesApi: true, cityPreserved: true, pageErrors: errors};
  report.japanModelSelectionPassed = true;
  modelProgress.phase = 'model_capture';
  await capture(view, 'japan-source-model-selection-desktop');
  modelProgress.phase = 'complete';
  await view.close(); onPage(null);

  onStage('stability_combined_filters');
  view = await context.newPage(); onPage(view); errors = 0; view.on('pageerror', () => { errors++; });
  await view.setViewportSize({width: 390, height: 900});
  const combinedApi = japanStabilitySearchApi('combined');
  const combinedQuery = new URL(combinedApi, ORIGIN).searchParams;
  for(const key of ['market','page','pageSize'])combinedQuery.delete(key);
  response = await view.goto(ORIGIN + '/cars/japan?' + combinedQuery, {waitUntil: 'domcontentloaded', timeout: 90_000});
  need(response?.status() === 200, 'combined_page_http');
  const combinedResponse = await read(combinedApi);
  const combinedObservation = verifyPage(combinedResponse.data, combinedResponse.status);
  verifyFullPage(combinedResponse.data); verifyPowerPage(combinedResponse.data);
  const combinedProof = verifyJapanStabilityCombinedRows(combinedResponse.data);
  pages.push(combinedResponse.data);
  catalog = view.locator('main.ac-ajes-catalog');
  await visibleCardsMatch(view, catalog, combinedResponse.data.items);
  const combinedUrl = new URL(view.url());
  need([...combinedQuery].every(([key, value]) => combinedUrl.searchParams.get(key) === value), 'combined_url');
  need(errors === 0, 'combined_javascript');
  report.checks.combinedFilters = {...combinedObservation, ...combinedProof, uiMatchesApi: true, cityPreserved: true, pageErrors: errors};
  report.japanCombinedFiltersPassed = true;
  await capture(view, 'japan-grade-five-petrol-automatic-power-mobile');
  await view.close(); onPage(null);

  onStage('stability_other_market_detail');
  const chinaPage = japanStabilityChinaFamilyPage(generationId);
  view = await context.newPage(); onPage(view); errors = 0; view.on('pageerror', () => { errors++; });
  await view.setViewportSize({width: 1440, height: 1000});
  response = await view.goto(chinaPage, {waitUntil: 'domcontentloaded', timeout: 90_000});
  need(response?.status() === 200, 'china_page_http');
  need(view.url() === chinaPage, 'china_url');
  const sourceCard = view.locator(CARD).filter({hasText: /B-Class/i}).first();
  await sourceCard.waitFor({state: 'visible', timeout: 60_000});
  const link = sourceCard.locator('a[href*="/cars/offer/"]').first();
  const detail = new URL(await link.getAttribute('href'), ORIGIN);
  const match = /^\/cars\/offer\/([A-Za-z0-9_-]+)(?:\/[^/]+)?$/.exec(detail.pathname);
  need(detail.origin === ORIGIN && match && detail.searchParams.get('market') === 'china'
    && detail.searchParams.get('preparedCut') === generationId && detail.searchParams.get('city') === CITY, 'china_link');
  const currentId = match[1];
  const recommendationResponse = view.waitForResponse(value => {
    const url = new URL(value.url());
    return value.request().method() === 'GET' && url.origin === ORIGIN && url.pathname === '/api/catalog/recommendations'
      && url.searchParams.get('kind') === 'related' && url.searchParams.get('id') === currentId;
  }, {timeout: 90_000});
  recommendationResponse.catch(() => {});
  await link.click(); await view.waitForURL(url => url.href === detail.href, {timeout: 90_000});
  const recommendations = view.locator('[data-deferred-recommendations="related"]');
  await recommendations.scrollIntoViewIfNeeded();
  const relatedResponse = await recommendationResponse;
  const related = await relatedResponse.json();
  onStage('stability_related_freshness');
  // Record the one matching visitor search even when the recommendation rail
  // is empty, so an actual source restriction has its own bounded receipt.
  const fresh = await read(japanStabilitySearchApi('related', 'B-Class'));
  const freshObservation = verifyPage(fresh.data, fresh.status); verifyFullPage(fresh.data); pages.push(fresh.data);
  const rows = verifyJapanStabilityRelated(related, relatedResponse.status(), currentId);
  const freshIds = new Set(fresh.data.items.map(row => row.id));
  const auctionRows = rows.filter(auctionRow);
  need(auctionRows.every(row => freshIds.has(row.id)), 'related_fresh_identity');
  const japan = recommendations.locator('[data-related-market="japan"]');
  await japan.waitFor({state: 'visible', timeout: 60_000});
  await visibleCardsMatch(view, japan, rows);
  need(errors === 0, 'related_javascript');
  report.checks.relatedCards = {currentOfferSha256: hash(currentId), currentMarket: 'china', familyModel: 'B-Class',
    market: 'japan', cards: rows.length, uiMatchesApi: true, freshSourceIdsMatched: true,
    freshAuctionCards: auctionRows.length, validatedGreenStockCards: rows.length - auctionRows.length,
    freshObservation, pageErrors: errors};
  report.japanRelatedCardsPassed = true;
  report.checks.vehiclePolicy = verifyVehiclePolicy(pages); report.japanVehiclePolicyPassed = true;
  await capture(view, 'japan-related-cards-on-china-detail-desktop');
  await view.close(); onPage(null);
}
