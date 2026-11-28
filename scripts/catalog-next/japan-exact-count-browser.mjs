import {createHash} from 'node:crypto';

const ORIGIN = 'https://avtocena.com';
const CITY = 'Новокузнецк';
const need = (value, code) => { if (!value) throw Error('japan_browser_exact_count_' + code); };
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const natural = value => Number.isSafeInteger(value) && value >= 0;
const ignoredCountKeys = new Set(['page', 'pageSize', 'after', 'sort', 'view', 'marketPage', 'countOnly', 'source']);
const sourceName = value => typeof value === 'string' && value.trim() === value && value.length > 0
  && value.length <= 100 && !/[\x00-\x1f\x7f<>|]/.test(value);
const normalized = value => String(value).normalize('NFKC').toUpperCase().replace(/\s+/g, ' ').trim();
const pairKey = row => JSON.stringify([row.make, row.model]);
export const JAPAN_EXACT_COUNT_GATES = Object.freeze(['japanExactCountPassed', 'japanModelCoveragePassed']);
export const JAPAN_MODEL_COVERAGE_GATES = Object.freeze(['japanModelCoveragePassed']);
export const JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE = 'japan-source-bounded-incremental-v1';

export function japanExactCountRequirement(value) {
  need(value === undefined || value === '0' || value === '1', 'option');
  return value === '1';
}

export function japanModelCoverageRequirement(value) {
  need(value === undefined || value === '0' || value === '1', 'model_coverage_option');
  return value === '1';
}

/** Public membership binding is independent of supplier alias resolution.
 * Pagination and presentation cannot change the size of the selected set. */
export function japanExactCountQueryHash(value) {
  let entries;
  if (typeof value === 'string') {
    const url = new URL(value, ORIGIN);
    need(url.origin === ORIGIN && !url.username && !url.password && !url.hash, 'query');
    need([...url.searchParams.keys()].every(key => url.searchParams.getAll(key).length === 1), 'query');
    entries = [...url.searchParams];
  } else {
    need(value && typeof value === 'object' && !Array.isArray(value), 'query');
    entries = Object.entries(value);
  }
  const query = {};
  const aliases = {brand: 'make', body: 'bodyType', budget: 'budgetTo'};
  for (const [key, input] of entries.filter(([key]) => !ignoredCountKeys.has(key))) {
    const item = Array.isArray(input) ? input[0] : input;
    if (item === undefined || item === null) continue;
    need(typeof item === 'string' || typeof item === 'number' && Number.isFinite(item), 'query');
    const value = String(item).trim(); if (value) query[key] = value;
  }
  for (const [alias, key] of Object.entries(aliases)) { if (!query[key] && query[alias]) query[key] = query[alias]; delete query[alias]; }
  need(query.market === 'japan', 'query_market');
  return hash(JSON.stringify(Object.fromEntries(Object.entries(query).sort(([a], [b]) => a.localeCompare(b, 'en')))));
}

/** Validate the declared v1 envelope's query, coverage and admission fields.
 * The controlled UI fixture supplies positive v1 mocks; this shape check does
 * not establish coherent source observation or backend census acceptance.
 * The production zero-v2 producer is separate and stays closed for positive
 * populations without a coherent source contract. No rows are fetched here. */
export function verifyJapanExactCount(payload, {query, loadedCount, now = Date.now()} = {}) {
  const summary = payload?.countSummary, proof = summary?.countProof;
  need(payload && natural(payload.total) && summary && summary.total === payload.total
    && summary.upperBound === false && summary.stale === false, 'summary');
  need(proof && proof.version === 1 && proof.kind === 'japan-admitted-census'
    && proof.complete === true && proof.predicateVersion === 'japan-admitted-census-v1', 'proof');
  need(['queryHash', 'requestedQueryHash', 'evidenceEpoch', 'sourceQueryHash', 'coverageHash']
    .every(key => digest(proof[key])), 'binding');
  if (query !== undefined) need(proof.requestedQueryHash === japanExactCountQueryHash(query), 'query_binding');
  need(['sourceTotal', 'sourceDistinctTotal', 'groupedTotal', 'baseAdmittedTotal', 'admittedTotal', 'groupCount', 'correctionCount'].every(key => natural(proof[key]))
    && natural(proof.pages) && (proof.sourceTotal === 0 || proof.pages > 0) && Number.isSafeInteger(proof.correctionDelta)
    && proof.groupedTotal === proof.sourceTotal && proof.sourceDistinctTotal === proof.sourceTotal && proof.admittedTotal === payload.total
    && proof.baseAdmittedTotal + proof.correctionDelta === proof.admittedTotal
    && Math.abs(proof.correctionDelta) <= proof.correctionCount
    && proof.admittedTotal <= proof.sourceTotal && proof.groupCount <= proof.sourceTotal
    && (proof.sourceTotal === 0) === (proof.groupCount === 0), 'coverage');
  need(natural(proof.knownTotal) && natural(proof.unknownTotal)
    && proof.knownTotal + proof.unknownTotal === proof.admittedTotal, 'power_coverage');
  need(!payload.partial && !payload.interrupted && !payload.scanLimited && payload.stale === false
    && !proof.partial && !proof.interrupted && !proof.scanLimited && !proof.stale, 'partial');
  const observed = Date.parse(proof.sourceObservedAt), completed = Date.parse(proof.sourceCompletedAt);
  const counted = Date.parse(summary.observedAt);
  need(Number.isFinite(observed) && Number.isFinite(completed) && Number.isFinite(counted)
    && summary.observedAt === proof.sourceObservedAt && observed <= now
    && observed <= completed && completed <= now + 60_000 && counted <= now + 60_000
    && now - observed < 30 * 60_000 && now - counted < 30 * 60_000, 'freshness');
  const loaded = loadedCount ?? payload.items?.length;
  need(natural(loaded) && payload.total >= loaded, 'loaded');
  if (Array.isArray(payload.items)) {
    need(Number.isSafeInteger(payload.page) && payload.page > 0
      && Number.isSafeInteger(payload.pageSize) && payload.pageSize > 0
      && typeof payload.hasMore === 'boolean', 'page');
    const through = (payload.page - 1) * payload.pageSize + payload.items.length;
    need(natural(through) && (payload.hasMore ? payload.total > through : payload.total === through), 'exhaustion');
  }
  return {total: payload.total, sourceTotal: proof.sourceTotal, groupCount: proof.groupCount,
    sourcePages: proof.pages, queryHash: proof.queryHash, requestedQueryHash: proof.requestedQueryHash,
    evidenceEpoch: proof.evidenceEpoch, coverageHash: proof.coverageHash,
    predicateVersion: proof.predicateVersion, sourceObservedAt: proof.sourceObservedAt,
    sourceCompletedAt: proof.sourceCompletedAt, exact: true, fullSelection: true};
}

export function verifyJapanExactCountStable(first, next) {
  need(first?.exact === true && next?.exact === true && first.total === next.total
    && ['queryHash', 'requestedQueryHash', 'evidenceEpoch', 'coverageHash', 'predicateVersion']
      .every(key => first[key] === next[key]), 'changed_selection');
  return {total: first.total, sameMembership: true, sameEvidence: true};
}

const checkedBudget = value => {
  need(typeof value === 'string' && /^[1-9]\d{0,7}$/.test(value)
    && Number(value) <= 30_000_000, 'budget');
  return value;
};

const checkedCursor = value => {
  need(typeof value === 'string' && value.length <= 320, 'api_cursor');
  const match = /^j2\.([ku])\.([1-9]\d{0,6})\.(0|[1-9]\d?)\.2\.([a-f0-9]{64})\.([a-f0-9]{64})\.(-|[a-f0-9]{64})$/.exec(value);
  need(match && Number(match[2]) <= 1_000_000 && Number(match[3]) <= 24
    && (Number(match[3]) === 0 ? match[6] === '-' : match[6] !== '-'), 'api_cursor');
};

export function japanExactCountApi(kind, {make = 'AUDI', page = 1, after, budgetTo} = {}) {
  need(['plain', 'make', 'model', 'combined', 'budget', 'models'].includes(kind)
    && ['AUDI', 'Audi'].includes(make) && [1, 2].includes(page), 'api_query');
  need(kind === 'budget' ? Boolean(checkedBudget(budgetTo)) : budgetTo === undefined, 'api_query');
  if (kind === 'models') {
    need(page === 1 && after === undefined, 'api_query');
    return '/api/catalog/source-models?' + new URLSearchParams({market: 'japan', make});
  }
  const query = new URLSearchParams({market: 'japan', page: String(page), pageSize: '24', city: CITY});
  if (kind !== 'plain') query.set('make', make);
  if (['model', 'combined', 'budget'].includes(kind)) query.set('model', 'A4');
  if (['combined', 'budget'].includes(kind)) query.set('powerTo', '160');
  if (kind === 'budget') query.set('budgetTo', budgetTo);
  if (page === 2) {
    need(['combined', 'budget'].includes(kind), 'api_query'); checkedCursor(after);
    query.set('after', after);
  } else need(after === undefined, 'api_query');
  return '/api/catalog/search?' + query;
}

export function japanExactCountApiAllowed(value) {
  try {
    const url = new URL(value, ORIGIN), query = url.searchParams;
    if (url.origin !== ORIGIN || url.username || url.password || url.hash
      || [...query.keys()].some(key => query.getAll(key).length !== 1)) return false;
    if (url.pathname === '/api/catalog/source-models')
      return value === japanExactCountApi('models', {make: query.get('make')});
    if (url.pathname !== '/api/catalog/search') return false;
    const kind = query.has('budgetTo') ? 'budget' : query.has('powerTo') ? 'combined' : query.has('model') ? 'model' : query.has('make') ? 'make' : 'plain';
    return value === japanExactCountApi(kind, {make: query.get('make') || 'AUDI', page: Number(query.get('page')),
      ...(query.has('budgetTo') ? {budgetTo: query.get('budgetTo')} : {}),
      ...(query.has('after') ? {after: query.get('after')} : {})});
  } catch { return false; }
}

/** Model acceptance adds only these three first-page reads. Power, budget,
 * arbitrary models and source continuations keep their separate contracts. */
export function japanModelCoverageApi(kind, options = {}) {
  need(['make', 'model', 'models'].includes(kind) && options && typeof options === 'object'
    && !Array.isArray(options) && Object.keys(options).every(key => key === 'make'), 'model_api_query');
  return japanExactCountApi(kind, options);
}

export function japanModelCoverageApiAllowed(value) {
  return typeof value === 'string' && ['AUDI', 'Audi'].some(make => ['make', 'model', 'models']
    .some(kind => value === japanModelCoverageApi(kind, {make})));
}

/** A bounded search may be incomplete even when all its visible cards are
 * fresh. A nonempty page cannot inherit a supplier total or a made-up zero. */
export function verifyJapanModelCount(payload) {
  need(Array.isArray(payload?.items) && payload.items.length > 0 && payload.page === 1
    && payload.pageSize === 24 && typeof payload.hasMore === 'boolean', 'model_count_page');
  if (payload.total === null) {
    need(payload.countSummary == null || payload.countSummary.upperBound === true, 'model_count_false_exact');
    return {exact: false, countHonest: true};
  }
  const summary = payload.countSummary;
  need(natural(payload.total) && payload.total === payload.items.length && payload.hasMore === false
    && payload.reads === 1 && natural(payload.received) && payload.received >= payload.items.length && payload.received < 24
    && summary?.total === payload.total && summary.upperBound === false && summary.stale === false
    && summary.observedAt === payload.observedAt && summary.countProof === undefined, 'model_count_false_exact');
  return {exact: true, countHonest: true};
}

/** Only the next link emitted for the current Audi/A4 selection is admitted.
 * CatalogLoadMore emits /cars?market=japan before canonical redirection. */
export function japanExactCountPageApi(value, {kind, make, budgetTo, expectedCursor} = {}) {
  need(['combined', 'budget'].includes(kind), 'append_query');
  let url; try { url = new URL(value, ORIGIN); } catch { need(false, 'append_query'); }
  need(url.origin === ORIGIN && !url.username && !url.password && !url.hash
    && [...url.searchParams.keys()].every(key => url.searchParams.getAll(key).length === 1), 'append_query');
  const query = Object.fromEntries(url.searchParams);
  if (url.pathname === '/cars/japan/' + encodeURIComponent(make) + '/A4') {
    need(!query.market && !query.make && !query.model, 'append_query');
    Object.assign(query, {market: 'japan', make, model: 'A4'});
  } else need(url.pathname === '/cars', 'append_query');
  if (query.budget !== undefined) { need(query.budgetTo === undefined, 'append_query'); query.budgetTo = query.budget; delete query.budget; }
  const after = query.after;
  need(after === expectedCursor, 'append_cursor');
  const api = japanExactCountApi(kind, {make, budgetTo, page: 2, after});
  const expected = Object.fromEntries(new URL(api, ORIGIN).searchParams); delete expected.pageSize;
  need(JSON.stringify(Object.entries(query).sort()) === JSON.stringify(Object.entries(expected).sort()), 'append_query');
  return api;
}

export function japanBudgetCandidate(prices) {
  need(Array.isArray(prices), 'budget_price');
  const known = prices.filter(row => typeof row?.id === 'string' && natural(row.amount)
    && row.amount > 0 && row.amount <= 30_000_000).sort((a, b) => a.amount - b.amount || a.id.localeCompare(b.id));
  need(known.length > 0, 'budget_price');
  return known[Math.floor((known.length - 1) / 2)];
}

export function checkedJapanAudiDirectory(payload, status) {
  need(status === 200 && payload?.version === 1 && payload.stale === false
    && Array.isArray(payload.models) && payload.models.length > 0, 'directory');
  const models = payload.models.map(row => {
    need(Array.isArray(row) && row.length === 4 && sourceName(row[0]) && normalized(row[0]) === 'AUDI'
      && sourceName(row[1]) && Array.isArray(row[2]) && row[2].length === 0
      && Number.isSafeInteger(row[3]) && row[3] > 0, 'directory_row');
    return {make: row[0], model: row[1], total: row[3]};
  });
  need(new Set(models.map(pairKey)).size === models.length, 'directory_duplicate');
  need(models.some(row => japanAudiA4Family(row.model)), 'a4_missing');
  return models;
}

export function japanAudiA4Family(value) {
  const model = normalized(value).replace(/^AUDI\s+/, '').replace(/^A[\s-]+4(?=$|[^0-9])/, 'A4');
  return /^A4(?:$|[\s(\/-]|[A-Z]+(?:$|[\s(\/-]))/.test(model);
}

export function verifyJapanModelCoverage(directory, options) {
  need(Array.isArray(directory) && directory.length > 0 && Array.isArray(options), 'model_options');
  need(options.every(row => sourceName(row.make) && sourceName(row.model))
    && new Set(options.map(pairKey)).size === options.length, 'model_option_identity');
  const source = directory.map(pairKey).sort(), visible = options.map(pairKey).sort();
  need(JSON.stringify(source) === JSON.stringify(visible), 'model_coverage');
  return {sourcePairs: source.length, accessiblePairs: visible.length,
    allSourceModelsAccessible: true, noForeignModels: true, pairsSha256: hash(JSON.stringify(source))};
}

function checkedJapanSourceModelInputs(directory, visibleCards) {
  need(Array.isArray(directory) && directory.length > 0
    && directory.every(row => sourceName(row?.make) && normalized(row.make) === 'AUDI' && sourceName(row.model))
    && new Set(directory.map(pairKey)).size === directory.length, 'model_source_directory');
  need(Array.isArray(visibleCards) && visibleCards.length > 0 && visibleCards.length <= 24
    && visibleCards.every(row => row?.market === 'japan' && /^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(row.id || '')
      && sourceName(row.make) && normalized(row.make) === 'AUDI' && sourceName(row.model))
    && new Set(visibleCards.map(row => row.id)).size === visibleCards.length, 'model_visible_cards');
  const source = directory.map(pairKey).sort(), cards = [...new Set(visibleCards.map(pairKey))].sort();
  return {source, cards, allowed: new Set([...source, ...cards]),
    cardProvenanceSha256: hash(JSON.stringify(visibleCards.map(row => [row.id, row.make, row.model])
      .sort(([a], [b]) => a.localeCompare(b, 'en'))))};
}

/** The runtime picker unions the source directory with its already visible
 * auction cards. Every literal directory pair remains mandatory; another
 * spelling is permitted only when that exact pair occurs on a verified card.
 * This does not change the strict directory-equality verifier above. */
export function verifyJapanSourceModelCoverage(directory, options, visibleCards, progress = {}) {
  const {source, cards, allowed, cardProvenanceSha256} = checkedJapanSourceModelInputs(directory, visibleCards);
  need(Array.isArray(options), 'model_options');
  const valid = options.filter(row => sourceName(row?.make) && sourceName(row.model));
  const visible = [...new Set(valid.map(pairKey))].sort(), sourceSet = new Set(source), visibleSet = new Set(visible);
  const missing = source.filter(key => !visibleSet.has(key));
  const unbacked = visible.filter(key => !allowed.has(key));
  const extras = visible.filter(key => !sourceSet.has(key));
  const pairsSha256 = hash(JSON.stringify(source)), optionPairsSha256 = hash(JSON.stringify(visible));
  const visibleCardPairsSha256 = hash(JSON.stringify(cards));
  // These bounded public names are failure diagnostics, never an acceptance
  // proof. Record them before any equality/identity guard can reject the UI.
  const missingSample = missing.slice(0, 12), unbackedSample = unbacked.slice(0, 12 - missingSample.length);
  progress.modelOptions = {sourcePairs: source.length, optionPairs: options.length,
    uniqueOptionPairs: visible.length, visibleCardPairs: cards.length, allowedOptionPairs: allowed.size,
    invalidOptionPairs: options.length - valid.length, duplicateOptionPairs: valid.length - visible.length,
    missingDirectoryPairCount: missing.length, unbackedOptionPairCount: unbacked.length,
    missingDirectoryPairs: missingSample.map(value => JSON.parse(value)),
    unbackedOptionPairs: unbackedSample.map(value => JSON.parse(value)),
    diagnosticPairsOmitted: missing.length + unbacked.length - missingSample.length - unbackedSample.length,
    pairsSha256, optionPairsSha256, visibleCardPairsSha256, cardProvenanceSha256};
  need(valid.length === options.length && visible.length === options.length, 'model_option_identity');
  need(missing.length === 0 && unbacked.length === 0, 'model_coverage');
  return {coverageContract: 'directory-and-visible-cards-v1', sourcePairs: source.length,
    accessiblePairs: source.length, optionPairs: visible.length, cardBackedExtraPairs: extras.length,
    visibleCardPairs: cards.length, allSourceModelsAccessible: true, noForeignModels: true,
    sourceMatchesUi: true, allOptionsSourceBacked: true, uiEqualsDirectory: extras.length === 0,
    pairsSha256, optionPairsSha256, cardBackedExtraPairsSha256: hash(JSON.stringify(extras)),
    visibleCardPairsSha256, cardProvenanceSha256};
}

export function verifyJapanAudiRows(payload, directory) {
  need(Array.isArray(payload?.items) && payload.items.length > 0, 'a4_rows');
  need(payload.items.every(row => normalized(row.make) === 'AUDI' && japanAudiA4Family(row.model)
    && directory.some(source => normalized(source.make) === normalized(row.make)
      && normalized(source.model) === normalized(row.model))), 'a4_membership');
  return {make: 'AUDI', model: 'A4', shown: payload.items.length, observedSourceNamesOnly: true};
}

export function verifyJapanFiniteSelection(pages, {expectedIds, query} = {}) {
  need(Array.isArray(pages) && pages.length > 0 && Array.isArray(expectedIds)
    && new Set(expectedIds).size === expectedIds.length, 'finite_input');
  const ids = [], observations = []; let unknownStarted = false, known = 0, unknown = 0;
  for (const [index, page] of pages.entries()) {
    const proof = verifyJapanExactCount(page, {query});
    if (observations.length) verifyJapanExactCountStable(observations[0], proof);
    need(page.page === index + 1 && page.pageSize === 24 && page.hasMore === (index < pages.length - 1)
      && page.items.length === Math.min(24, expectedIds.length - index * 24), 'finite_pages');
    for (const row of page.items) {
      need(typeof row.id === 'string' && !ids.includes(row.id), 'finite_duplicate'); ids.push(row.id);
      if (row.japanPowerUnknown === true) { unknownStarted = true; unknown++; }
      else { need(!unknownStarted, 'finite_power_order'); known++; }
    }
    observations.push(proof);
  }
  need(pages.at(-1).nextCursor === null && observations[0].total === expectedIds.length
    && JSON.stringify([...ids].sort()) === JSON.stringify([...expectedIds].sort()), 'finite_membership');
  const proof = pages[0].countSummary.countProof;
  need(proof.knownTotal === known && proof.unknownTotal === unknown, 'finite_power_totals');
  return {total: ids.length, pageSizes: pages.map(page => page.items.length), known, unknown,
    distinctRows: true, noMissingRows: true, knownBeforeUnknown: true, finiteExhaustion: true,
    membershipSha256: hash(JSON.stringify([...ids].sort()))};
}

/** The CI artifact is tied to the candidate runtime and the helper that ran.
 * A finite controlled source proves the browser's consumption of exact counts;
 * it never stands in for the separate real-source acceptance. */
export function checkedJapanExactCountBrowserFixture(report, {runtimeSha, runtimeTree, helperSha256} = {}) {
  need(/^[a-f0-9]{40}$/.test(runtimeSha || '') && /^[a-f0-9]{40}$/.test(runtimeTree || '')
    && digest(helperSha256), 'fixture_binding');
  need(report?.version === 1 && report.kind === 'japan-exact-count-browser-v1' && report.passed === true
    && report.runtimeSha === runtimeSha && report.runtimeTree === runtimeTree
    && report.helperSha256?.['scripts/catalog-next/japan-exact-count-browser.mjs'] === helperSha256
    && ['scripts/catalog-next/japan-price-sort-browser.mjs', 'scripts/catalog-next/japan-browser-acceptance.mjs']
      .every(file => digest(report.helperSha256?.[file])), 'fixture_binding');
  need(report.countProofContract === 'controlled-ui-mock-v1'
    && report.liveSourceAccepted === false && report.backendCensusAccepted === false, 'fixture_scope');
  need(report.productionRequests === 0 && report.supplierRequests === 0 && report.forbiddenTransportAttempts === 0
    && typeof report.browserVersion === 'string' && report.browserVersion.length > 0
    && typeof report.playwrightVersion === 'string' && report.playwrightVersion.length > 0, 'fixture_transport');
  const components = ['CatalogFilters.tsx', 'CatalogLoadMore.tsx', 'CatalogCard.tsx', 'JapanCatalogCount.tsx',
    'CatalogSelectionContext.tsx', 'CatalogSidebar.tsx', 'catalog-load-more-action.tsx', 'catalog-sidebar.css',
    'MobileCatalogDropdowns.css', 'RecyclingPower.module.css'].map(file => 'apps/web/components/catalog/' + file);
  components.push('apps/web/lib/catalog/ajes-count-display.ts', 'apps/web/lib/catalog/catalog-routes.ts',
    'apps/web/app/globals.css', 'apps/web/tailwind.config.ts');
  need(components.every(file => digest(report.componentSha256?.[file]))
    && Array.isArray(report.styles?.sourceFiles) && report.styles.sourceFiles.every(file => digest(report.componentSha256?.[file]))
    && components.filter(file => file.endsWith('.css')).every(file => report.styles.sourceFiles.includes(file))
    && digest(report.styles.componentBundleSha256) && digest(report.styles.servedCssSha256), 'fixture_sources');
  need(Array.isArray(report.cases) && report.cases.length === 2
    && JSON.stringify(report.cases.map(row => row.name).sort()) === JSON.stringify(['preserved_controls', 'remounted_controls'].sort()), 'fixture_cases');
  for (const row of report.cases) {
    need(['passed', 'priceSortPassed', 'exactCountPassed', 'modelCoveragePassed', 'budgetExactCountPassed',
      'failedAppendKeepsTotal', 'pendingKeepsTotal', 'queryLoadedCountResets', 'lateOldAggregateIgnored',
      'appendRestoresExactCount', 'lateOtherQueryDoesNotEraseCount', 'expiredCountDated',
      'expiredCountNotCurrent', 'expiredAppendKeepsCards'].every(key => row[key] === true)
      && row.priceCountTotal === 73 && row.pageErrors === 0 && natural(row.requests) && row.requests > 0, 'fixture_case');
    const finite = row.finite;
    need(finite?.total === 73 && finite.known === 50 && finite.unknown === 23
      && JSON.stringify(finite.pageSizes) === '[24,24,24,1]'
      && ['distinctRows', 'noMissingRows', 'knownBeforeUnknown', 'finiteExhaustion'].every(key => finite[key] === true)
      && finite.membershipSha256 === hash(JSON.stringify(Array.from({length: 73}, (_, i) => 'ajes-stats-exact-' + i).sort())), 'fixture_finite');
    const priceFinite = row.budgetFinite;
    need(priceFinite?.total === 38 && priceFinite.known === 38 && priceFinite.unknown === 0
      && JSON.stringify(priceFinite.pageSizes) === '[24,14]'
      && ['distinctRows', 'noMissingRows', 'knownBeforeUnknown', 'finiteExhaustion'].every(key => priceFinite[key] === true)
      && priceFinite.membershipSha256 === hash(JSON.stringify([0, 1, ...Array.from({length: 36}, (_, i) => i + 14)]
        .map(i => 'ajes-stats-exact-' + i).sort())), 'fixture_budget_finite');
    const models = row.modelCoverage;
    need(models?.sourcePairs > 60 && models.accessiblePairs === models.sourcePairs
      && models.allSourceModelsAccessible === true && models.noForeignModels === true
      && models.typedBase === 'A4' && models.typedFamilyNotNarrowed === true && models.modelExpansions > 0
      && digest(models.pairsSha256), 'fixture_models');
    const exact = row.exactCount, budget = exact?.budget;
    need(exact?.sourceBound === true && exact.fullSelectionNumbers === true && exact.liveExhaustiveScan === false
      && exact.budgetExactCountPassed === true && budget?.exact === true && budget.total === 38
      && budget.selectedCity === CITY && budget.budgetTo === 1_303_000 && budget.continuation?.followed === true
      && budget.continuation.total === budget.total && budget.continuation.sameCount === true
      && budget.continuation.loaded === 38 && budget.continuation.exhausted === true
      && budget.selectedFromVisibleCard === true && budget.visibleWithinBudget === true
      && Array.isArray(exact.checks) && ['plain', 'make', 'model', 'combined', 'append', 'budget', 'budget_append']
        .every(kind => exact.checks.some(check => check.kind === kind && check.exact === true && check.visibleExact === true)), 'fixture_exact');
  }
  return {passed: true, runtimeSha, runtimeTree, helperSha256, cases: report.cases.length,
    exactCount: true, modelCoverage: true, budgetExactCount: true, finiteTotal: 73,
    countProofContract: 'controlled-ui-mock-v1', liveSourceAccepted: false, backendCensusAccepted: false,
    productionRequests: 0, supplierRequests: 0};
}

const selectedUrl = (value, make, model, power = false, budgetTo) => {
  try {
    const url = new URL(value), expected = new URL(ORIGIN + '/cars/japan'
      + (make ? '/' + encodeURIComponent(make) : '') + (model ? '/' + encodeURIComponent(model) : ''));
    expected.search = new URLSearchParams({city: CITY, ...(power ? {powerTo: '160'} : {}), ...(budgetTo ? {budgetTo} : {})});
    if (url.searchParams.has('budget')) {
      if (url.searchParams.getAll('budget').length !== 1 || url.searchParams.has('budgetTo')) return false;
      url.searchParams.set('budgetTo', url.searchParams.get('budget')); url.searchParams.delete('budget');
    }
    return url.origin === ORIGIN && !url.username && !url.password && !url.hash && url.pathname === expected.pathname
      && url.searchParams.size === expected.searchParams.size
      && [...expected.searchParams].every(([key, item]) => url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === item);
  } catch { return false; }
};

async function readyControls(view, progress) {
  const form = view.locator('form.ac-catalog-filter-panel:visible');
  await form.waitFor({state: 'visible', timeout: 30_000});
  await form.locator('button[aria-label="Расширенные фильтры"]:enabled[aria-busy="false"]')
    .waitFor({state: 'attached', timeout: 30_000});
  await view.locator('form.ac-catalog-filter-panel:visible[aria-busy="false"]')
    .waitFor({state: 'visible', timeout: 30_000});
  progress.readyChecks = (progress.readyChecks || 0) + 1;
  return form;
}

/** The loop expands only already downloaded model options. It never walks
 * supplier listings or silently accepts the picker's first sixty names. */
export async function collectJapanModelOptions(view, directory, progress = {}) {
  const options = view.locator('button[data-model-value][data-model-make]:visible');
  await options.nth(Math.min(60, directory.length) - 1).waitFor({state: 'visible', timeout: 60_000});
  for (let expansion = 0; expansion < Math.ceil(directory.length / 60); expansion++) {
    const more = view.getByRole('button', {name: /^Показать ещё · \d+$/, exact: false});
    if (await more.count() === 0) break;
    need(await more.count() === 1, 'model_more_unique');
    const previous = await options.count(); await more.click();
    await options.nth(previous).waitFor({state: 'visible', timeout: 30_000});
    progress.modelExpansions = (progress.modelExpansions || 0) + 1;
  }
  const rows = await options.evaluateAll(nodes => nodes.map(node =>
    ({make: node.getAttribute('data-model-make'), model: node.getAttribute('data-model-value')})));
  return {rows, proof: verifyJapanModelCoverage(directory, rows)};
}

/** A response event precedes React applying its directory. Wait for actual
 * directory pairs (or a bounded expansion exposing them), not a count that
 * the card-backed fallback may already satisfy. All waits inspect the DOM. */
export async function collectJapanSourceModelOptions(view, directory, visibleCards, progress = {}, make = 'AUDI') {
  const inputs = checkedJapanSourceModelInputs(directory, visibleCards);
  need(['AUDI', 'Audi'].includes(make), 'audi_make');
  const options = view.locator('button[data-model-value][data-model-make]:visible');
  const readOptions = () => options.evaluateAll(nodes => nodes.map(node =>
    ({make: node.getAttribute('data-model-make'), model: node.getAttribute('data-model-value')})));
  const bound = inputs.allowed.size, maxExpansions = Math.ceil(bound / 60) - 1, deadline = Date.now() + 60_000;
  try {
    for (let expansion = 0; expansion <= maxExpansions; expansion++) {
      const remaining = deadline - Date.now(); need(remaining > 0, 'model_directory_ready');
      const ready = await view.waitForFunction(({make, source, bound, limit}) => {
        const visible = node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
        const forms = [...document.querySelectorAll('form.ac-catalog-filter-panel')].filter(visible);
        if (forms.length !== 1 || forms[0].querySelector('input[name="make"]')?.value !== make) return false;
        const input = forms[0].querySelector('input[aria-label="Модель автомобиля"]');
        if (!input || input.value !== '' || input.getAttribute('aria-expanded') !== 'true') return false;
        const root = input.parentElement;
        const nodes = [...root.querySelectorAll('button[data-model-value][data-model-make]')].filter(visible);
        const pairs = new Set(nodes.map(node => JSON.stringify([node.getAttribute('data-model-make'), node.getAttribute('data-model-value')])));
        const more = [...root.querySelectorAll('button')].filter(node => visible(node) && /^Показать ещё · \d+$/.test(node.textContent.trim()));
        if (more.length === 0) return nodes.length <= bound && source.every(pair => pairs.has(pair));
        if (more.length !== 1 || nodes.length !== limit) return false;
        const remaining = Number(more[0].textContent.trim().match(/\d+$/)[0]);
        return Number.isSafeInteger(remaining) && remaining > 0
          && nodes.length + remaining >= source.length && nodes.length + remaining <= bound;
      }, {make, source: inputs.source, bound, limit: 60 * (expansion + 1)}, {timeout: remaining});
      await ready.dispose();
      const more = view.getByRole('button', {name: /^Показать ещё · \d+$/, exact: false});
      if (await more.count() === 0) break;
      need(await more.count() === 1 && expansion < maxExpansions, 'model_more_unique');
      await more.click(); progress.modelExpansions = (progress.modelExpansions || 0) + 1;
    }
    const rows = await readOptions(), proof = verifyJapanSourceModelCoverage(directory, rows, visibleCards, progress);
    progress.directoryOptionsReady = true;
    return {rows, proof};
  } catch (error) {
    try { verifyJapanSourceModelCoverage(directory, await readOptions(), visibleCards, progress); } catch {}
    throw error;
  }
}

/** A normal Audi/A4 visitor journey proves source-name coverage and the
 * selected family's visible first page. It needs no positive census and never
 * follows supplier listings to manufacture a full-selection count. */
export async function runJapanModelCoverageBrowser({context, report, read, capture, onStage, onPage,
  verifyPage, verifyFullPage, verifyVehiclePolicy, verifyVisible}) {
  need(report.japanExactCountRequired !== true && report.japanExactCountPassed !== true, 'model_profile');
  Object.assign(report, {countAcceptance: JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE,
    japanModelCoverageRequired: true, japanModelCoveragePassed: false,
    japanExactCountRequired: false, japanExactCountPassed: null});
  const progress = report.checks.modelCoverageProgress = {phase: 'navigate', readyChecks: 0, modelExpansions: 0};
  const pages = [], checks = []; let explicitApiReads = 0;
  const boundedRead = async api => {
    need(japanModelCoverageApiAllowed(api) && explicitApiReads < 3, 'model_api_scope');
    explicitApiReads++; return read(api);
  };
  onStage('model_coverage_audi_make');
  const view = await context.newPage(); onPage(view); let errors = 0;
  view.on('pageerror', () => { errors++; });
  await view.setViewportSize({width: 1440, height: 1000});
  const response = await view.goto(ORIGIN + '/cars/japan?' + new URLSearchParams({city: CITY}),
    {waitUntil: 'domcontentloaded', timeout: 90_000});
  need(response?.status() === 200, 'model_page_http');
  const inspect = async (kind, make) => {
    const api = japanModelCoverageApi(kind, {make}), result = await boundedRead(api);
    const page = verifyPage(result.data, result.status), full = verifyFullPage(result.data);
    const count = verifyJapanModelCount(result.data);
    const visible = await verifyVisible(view, result.data.items, result.data,
      {requireExactCount: false, countAcceptance: JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE, query: api});
    need(visible.uiMatchesApi === true && visible.rowOrderMatchesApi === true
      && visible.supplierCountNotPresentedAsExact === true && full.fullOrExhausted === true, 'model_visible');
    checks.push({kind, ...page, count, countStatus: visible.status, fullOrExhausted: true,
      uiMatchesApi: true, rowOrderMatchesApi: true});
    pages.push(result.data); return result.data;
  };
  let form = await readyControls(view, progress);
  progress.phase = 'audi_brand';
  await form.locator('button[aria-label="Выбрать марки автомобилей"]').click();
  const brand = view.locator('button[data-facet-value="AUDI" i]:visible');
  await brand.waitFor({state: 'visible', timeout: 60_000});
  need(await brand.count() === 1, 'audi_make_unique');
  const make = await brand.getAttribute('data-facet-value');
  need(['AUDI', 'Audi'].includes(make), 'audi_make'); await brand.click();
  await view.waitForURL(url => selectedUrl(url.href, make), {timeout: 60_000});
  form = await readyControls(view, progress);
  const trigger = form.locator('button[aria-label="Выбрать марки автомобилей"]');
  if (await trigger.getAttribute('aria-expanded') === 'true') await trigger.click();
  const makePage = await inspect('make', make);
  need(makePage.items.every(row => normalized(row.make) === 'AUDI'), 'model_make_membership');

  progress.phase = 'model_directory'; onStage('model_coverage_audi_models');
  const api = japanModelCoverageApi('models', {make}), result = await boundedRead(api);
  const directory = checkedJapanAudiDirectory(result.data, result.status);
  const input = form.locator('input[aria-label="Модель автомобиля"]:visible');
  const downloaded = view.waitForResponse(value => value.url() === ORIGIN + api
    && value.request().method() === 'GET', {timeout: 60_000});
  downloaded.catch(() => {}); await input.click(); await input.fill('');
  const modelResponse = await downloaded;
  const browserDirectory = checkedJapanAudiDirectory(await modelResponse.json(), modelResponse.status());
  need(JSON.stringify(directory) === JSON.stringify(browserDirectory), 'directory_changed');
  const coverage = await collectJapanSourceModelOptions(view, directory, makePage.items, progress, make);
  need(coverage.proof.optionPairs <= 60 || progress.modelExpansions > 0, 'model_expansion');
  await capture(view, 'japan-source-models-audi-desktop');

  progress.phase = 'typed_a4'; onStage('model_coverage_audi_a4');
  await input.fill('A4');
  await form.getByRole('button', {name: 'Применить', exact: true}).click();
  await view.waitForURL(url => selectedUrl(url.href, make, 'A4'), {timeout: 60_000});
  form = await readyControls(view, progress);
  need(await form.locator('input[type="hidden"][name="model"]').inputValue() === 'A4', 'typed_a4_narrowed');
  const openModel = form.locator('input[aria-label="Модель автомобиля"]');
  if (await openModel.getAttribute('aria-expanded') === 'true')
    await form.getByRole('button', {name: 'Закрыть список моделей', exact: true}).click();
  const model = await inspect('model', make), selection = verifyJapanAudiRows(model, directory);
  verifyVehiclePolicy(pages); need(errors === 0 && explicitApiReads === 3, 'model_complete');
  report.checks.modelCoverage = {...coverage.proof, make, sourceMatchesUi: true,
    typedBase: 'A4', typedFamilyNotNarrowed: true, modelExpansions: progress.modelExpansions,
    sourceFamilyModels: directory.filter(row => japanAudiA4Family(row.model)).length,
    directory: {status: result.status, stale: false, sourcePairs: directory.length,
      pairsSha256: coverage.proof.pairsSha256, browserMatchesApi: true},
    selection, countHonest: true, fullPage: true, checks,
    explicitApiReads, liveExhaustiveScan: false, pageErrors: errors};
  progress.phase = 'complete'; await capture(view, 'japan-source-models-audi-a4-desktop');
  report.japanModelCoveragePassed = true;
  await view.close(); onPage(null); return pages;
}

/** The source-bounded branch must be exercised with the actual runtime UI and
 * absent positive totals in both component-lifecycle modes. Its proof is
 * separate from the strict v1 count fixture above. */
export function checkedJapanModelCoverageBrowserFixture(report, expected) {
  if (expected !== undefined) checkedJapanExactCountBrowserFixture(report, expected);
  need(report?.passed === true && report.productionRequests === 0 && report.supplierRequests === 0
    && report.forbiddenTransportAttempts === 0 && Array.isArray(report.cases) && report.cases.length === 2,
  'model_fixture');
  need(JSON.stringify(report.cases.map(row => row.name).sort())
    === JSON.stringify(['preserved_controls', 'remounted_controls'].sort()), 'model_fixture_cases');
  for (const row of report.cases) {
    const proof = row.incrementalModelCoverage, models = proof?.modelCoverage;
    need(proof?.passed === true && proof.countAcceptance === JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE
      && proof.japanExactCountRequired === false && proof.japanExactCountPassed === null
      && proof.japanModelCoverageRequired === true && proof.japanModelCoveragePassed === true
      && proof.positiveExactCountsSupplied === 0 && proof.countsIncomplete === true, 'model_fixture_profile');
    need(Number.isSafeInteger(proof.directoryWait?.delayedResponses) && proof.directoryWait.delayedResponses > 0
      && proof.directoryWait.completedDelays === proof.directoryWait.delayedResponses
      && Number.isSafeInteger(proof.directoryWait.cardFallbackOptionsBeforeDirectory)
      && proof.directoryWait.cardFallbackOptionsBeforeDirectory > 0
      && proof.directoryWait.cardFallbackOptionsBeforeDirectory <= 24, 'model_fixture_directory_wait');
    need(models?.sourcePairs > 60 && models.sourcePairs === models.accessiblePairs
      && models.coverageContract === 'directory-and-visible-cards-v1'
      && Number.isSafeInteger(models.sourcePairs) && Number.isSafeInteger(models.optionPairs)
      && models.optionPairs === models.sourcePairs + models.cardBackedExtraPairs
      && models.cardBackedExtraPairs === 1 && Number.isSafeInteger(models.visibleCardPairs)
      && models.visibleCardPairs >= models.cardBackedExtraPairs && models.visibleCardPairs <= 24
      && models.uiEqualsDirectory === false && models.allOptionsSourceBacked === true
      && models.allSourceModelsAccessible === true && models.noForeignModels === true
      && models.sourceMatchesUi === true && ['AUDI', 'Audi'].includes(models.make)
      && ['pairsSha256', 'optionPairsSha256', 'cardBackedExtraPairsSha256', 'visibleCardPairsSha256', 'cardProvenanceSha256']
        .every(key => digest(models[key])) && models.optionPairsSha256 !== models.pairsSha256
      && models.typedBase === 'A4' && models.typedFamilyNotNarrowed === true
      && Number.isSafeInteger(models.modelExpansions) && models.modelExpansions > 0
      && models.modelExpansions <= Math.ceil(models.optionPairs / 60) - 1
      && Number.isSafeInteger(models.sourceFamilyModels) && models.sourceFamilyModels > 0
      && models.sourceFamilyModels <= models.sourcePairs
      && models.directory?.status === 200 && models.directory.stale === false
      && models.directory.sourcePairs === models.sourcePairs && models.directory.pairsSha256 === models.pairsSha256
      && models.directory.browserMatchesApi === true
      && models.selection?.shown === 24 && models.selection.observedSourceNamesOnly === true
      && models.fullPage === true && models.countHonest === true && models.explicitApiReads === 3
      && models.liveExhaustiveScan === false && models.pageErrors === 0
      && Array.isArray(models.checks) && models.checks.length === 2
      && models.checks.every(check => check.count?.exact === false && check.count.countHonest === true
        && check.total === null && check.countStatus === 'partial'
        && check.uiMatchesApi === true && check.rowOrderMatchesApi === true), 'model_fixture_proof');
  }
  return {passed: true, cases: report.cases.length, countAcceptance: JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE,
    positiveExactCountsSupplied: 0, exactCountAccepted: false, productionRequests: 0, supplierRequests: 0};
}

/** One normal Audi/A4 selection and a price bound from its visible cards,
 * each with at most one emitted continuation. Exhaustive
 * count/membership/lane closure is a finite local fixture, never a live dump. */
export async function runJapanExactCountBrowser({context, report, read, capture, onStage, onPage,
  verifyPage, verifyFullPage, verifyPowerPage, verifyVehiclePolicy, verifyVisible}) {
  const progress = report.checks.exactCountProgress = {phase: 'navigate', readyChecks: 0};
  const checks = [], pages = [];
  onStage('exact_count_plain');
  const view = await context.newPage(); onPage(view); let errors = 0;
  view.on('pageerror', () => { errors++; });
  await view.setViewportSize({width: 1440, height: 1000});
  const response = await view.goto(ORIGIN + '/cars/japan?' + new URLSearchParams({city: CITY}),
    {waitUntil: 'domcontentloaded', timeout: 90_000});
  need(response?.status() === 200, 'page_http');
  const inspect = async (kind, make = 'AUDI', budgetTo) => {
    const api = japanExactCountApi(kind, {make, budgetTo}), result = await read(api);
    if (kind === 'combined' && result.data?.total === 0) need(result.status === 200 && result.data.ok === true, 'empty_http');
    else { verifyPage(result.data, result.status); verifyFullPage(result.data); }
    const proof = verifyJapanExactCount(result.data, {query: api});
    const visible = await verifyVisible(view, result.data.items, result.data, {requireExactCount: true, query: api});
    checks.push({kind, ...proof, loaded: visible.loaded, visibleExact: visible.exact}); pages.push(result.data);
    return {payload: result.data, proof};
  };
  await inspect('plain');
  let form = await readyControls(view, progress);
  progress.phase = 'audi_brand'; onStage('exact_count_audi_make');
  await form.locator('button[aria-label="Выбрать марки автомобилей"]').click();
  const brand = view.locator('button[data-facet-value="AUDI" i]:visible');
  await brand.waitFor({state: 'visible', timeout: 60_000});
  need(await brand.count() === 1, 'audi_make_unique');
  const make = await brand.getAttribute('data-facet-value');
  need(['AUDI', 'Audi'].includes(make), 'audi_make'); await brand.click();
  await view.waitForURL(url => selectedUrl(url.href, make), {timeout: 60_000});
  form = await readyControls(view, progress);
  const trigger = form.locator('button[aria-label="Выбрать марки автомобилей"]');
  if (await trigger.getAttribute('aria-expanded') === 'true') await trigger.click();
  await inspect('make', make);

  progress.phase = 'model_directory'; onStage('exact_count_audi_models');
  const api = japanExactCountApi('models', {make}), directoryResponse = await read(api);
  const directory = checkedJapanAudiDirectory(directoryResponse.data, directoryResponse.status);
  const input = form.locator('input[aria-label="Модель автомобиля"]:visible');
  const downloaded = view.waitForResponse(value => value.url() === ORIGIN + api && value.request().method() === 'GET', {timeout: 60_000});
  downloaded.catch(() => {}); await input.click(); await input.fill('');
  const modelResponse = await downloaded;
  const browserDirectory = checkedJapanAudiDirectory(await modelResponse.json(), modelResponse.status());
  need(JSON.stringify(directory) === JSON.stringify(browserDirectory), 'directory_changed');
  const coverage = await collectJapanModelOptions(view, directory, progress);
  progress.phase = 'typed_a4';
  await input.fill('A4');
  await form.getByRole('button', {name: 'Применить', exact: true}).click();
  await view.waitForURL(url => selectedUrl(url.href, make, 'A4'), {timeout: 60_000});
  form = await readyControls(view, progress);
  need(await form.locator('input[type="hidden"][name="model"]').inputValue() === 'A4', 'typed_a4_narrowed');
  const openModel = form.locator('input[aria-label="Модель автомобиля"]');
  if (await openModel.getAttribute('aria-expanded') === 'true')
    await form.getByRole('button', {name: 'Закрыть список моделей', exact: true}).click();
  onStage('exact_count_audi_a4');
  const model = await inspect('model', make); verifyJapanAudiRows(model.payload, directory);

  progress.phase = 'combined_power'; onStage('exact_count_audi_combined');
  await form.locator('input[name="powerTo"][value="160"]').check();
  await view.waitForURL(url => selectedUrl(url.href, make, 'A4', true), {timeout: 60_000});
  await readyControls(view, progress);
  const combined = await inspect('combined', make);
  if (combined.payload.items.length) verifyJapanAudiRows(combined.payload, directory);
  verifyPowerPage(combined.payload, 1, {requireExactCount: true, query: japanExactCountApi('combined', {make})});
  const append = async (kind, first, budgetTo) => {
    if (!first.payload.hasMore) return {followed: false, exhausted: true, total: first.proof.total,
      loaded: first.payload.items.length, rows: first.payload.items};
    progress.phase = kind + '_append'; onStage('exact_count_audi_' + kind + '_append');
    const more = view.locator('main.ac-ajes-catalog').getByRole('button', {name: 'Показать ещё', exact: true});
    const nextApi = japanExactCountPageApi(await more.getAttribute('href'), {kind, make, budgetTo,
      expectedCursor: first.payload.nextCursor}), after = first.payload.nextCursor;
    const appended = view.waitForResponse(value => {
      const url = new URL(value.url());
      return value.request().method() === 'GET' && url.origin === ORIGIN && url.pathname === '/api/catalog/search'
        && url.searchParams.get('after') === after && url.searchParams.get('page') === '2';
    }, {timeout: 60_000});
    appended.catch(() => {}); await more.click(); need((await appended).status() === 200, 'append_http');
    const next = await read(nextApi); verifyPage(next.data, next.status); verifyFullPage(next.data);
    verifyPowerPage(next.data, 2, {requireExactCount: true, query: nextApi}); verifyJapanAudiRows(next.data, directory);
    const nextProof = verifyJapanExactCount(next.data, {query: nextApi}); verifyJapanExactCountStable(first.proof, nextProof);
    need(next.data.items.every(row => !first.payload.items.some(row0 => row0.id === row.id)), 'append_duplicate');
    const rows = [...first.payload.items, ...next.data.items]; let unknown = false;
    for (const row of rows) { if (row.japanPowerUnknown) unknown = true; else need(!unknown, 'append_power_order'); }
    const visible = await verifyVisible(view, rows, next.data, {requireExactCount: true, query: nextApi});
    pages.push(next.data); checks.push({kind: kind === 'combined' ? 'append' : 'budget_append', ...nextProof, loaded: visible.loaded, visibleExact: visible.exact});
    return {followed: true, exhausted: !next.data.hasMore, total: nextProof.total, distinctRows: true,
      sameCount: true, loaded: rows.length, cursorSha256: hash(after), rows};
  };
  const combinedContinuation = await append('combined', combined);
  const {rows: combinedRows, ...continuation} = combinedContinuation;

  // Use the displayed city-adjusted price, never the API's base/Vladivostok
  // amount. Candidate identity is taken from the already verified first page.
  progress.phase = 'budget_price'; onStage('exact_count_budget_price');
  const pricedIds = combined.payload.items.filter(row => row.savedCalculationPreview || row.japanDeliveredPreview
    || row.deliveredCalculationPreview || row.catalogPricingMode !== 'seller' && Number(row.totalRub) > 0).map(row => row.id);
  const visibleAmounts = await view.locator('main.ac-ajes-catalog article.ac-catalog-card,main.ac-ajes-catalog article.ac-catalog-list-row')
    .evaluateAll((nodes, expected) => nodes.flatMap(node => {
      const ids = [...new Set([...node.querySelectorAll('a[href]')].flatMap(link => {
        const match = /\/cars\/offer\/([^/?#]+)/.exec(link.getAttribute('href') || '');
        return match && expected.includes(match[1]) ? [match[1]] : [];
      }))];
      const prices = [...node.querySelectorAll('.ac-price')];
      const text = prices.length === 1 ? prices[0].textContent.replace(/[\s\u00a0\u202f]/g, '') : '';
      const match = /^(\d+)₽$/.exec(text);
      return ids.length === 1 && match ? [{id: ids[0], amount: Number(match[1])}] : [];
    }), pricedIds);
  const candidate = japanBudgetCandidate(visibleAmounts), budgetTo = String(candidate.amount);
  form = await readyControls(view, progress);
  let maximum = form.locator('input[aria-label="Цена: до"]:visible');
  if (await maximum.count() === 0) await form.locator('button[aria-label="Расширенные фильтры"]').click();
  maximum = form.locator('input[aria-label="Цена: до"]:visible');
  need(await maximum.count() === 1, 'budget_control');
  await maximum.fill(budgetTo); await maximum.press('Enter');
  await view.waitForURL(url => selectedUrl(url.href, make, 'A4', true, budgetTo), {timeout: 60_000});
  form = await readyControls(view, progress);
  need(await form.locator('input[type="hidden"][name="budget"]').inputValue() === budgetTo, 'budget_selection');
  const budgetResult = await inspect('budget', make, budgetTo);
  need(budgetResult.proof.total > 0 && budgetResult.proof.total <= combined.proof.total, 'budget_subset');
  verifyPowerPage(budgetResult.payload, 1, {requireExactCount: true, query: japanExactCountApi('budget', {make, budgetTo})});
  verifyJapanAudiRows(budgetResult.payload, directory);
  const budgetContinuation = await append('budget', budgetResult, budgetTo), {rows: budgetRows, ...budgetNext} = budgetContinuation;
  const budgetPrices = await view.locator('main.ac-ajes-catalog .ac-price').allTextContents();
  need(budgetPrices.length === budgetRows.length && budgetPrices.every(text => {
    const match = /^(\d+)₽$/.exec(text.replace(/[\s\u00a0\u202f]/g, ''));
    return match && Number(match[1]) > 0 && Number(match[1]) <= candidate.amount;
  }), 'budget_visible_prices');
  const budget = {exact: true, total: budgetResult.proof.total, budgetTo: candidate.amount, selectedCity: CITY,
    candidateIdSha256: hash(candidate.id), selectedFromVisibleCard: true, visibleWithinBudget: true, continuation: budgetNext};
  need(errors === 0, 'javascript'); verifyVehiclePolicy(pages);
  report.checks.exactCount = {checks, sourceBound: true, fullSelectionNumbers: true, continuation, budget,
    budgetExactCountPassed: true, liveExhaustiveScan: false,
    explicitApiReads: 6 + Number(continuation.followed) + Number(budgetNext.followed), pageErrors: errors};
  report.checks.modelCoverage = {...coverage.proof, make, typedBase: 'A4', typedFamilyNotNarrowed: true,
    modelExpansions: progress.modelExpansions || 0, sourceFamilyModels: directory.filter(row => japanAudiA4Family(row.model)).length};
  report.japanExactCountPassed = true; report.japanModelCoveragePassed = true;
  progress.phase = 'complete'; await capture(view, 'japan-exact-count-audi-a4-desktop');
  await view.close(); onPage(null); return pages;
}
