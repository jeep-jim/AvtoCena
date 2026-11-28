import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {checkedJapanExactCountBrowserFixture, checkedJapanAudiDirectory, verifyJapanModelCoverage,
  verifyJapanFiniteSelection} from '../scripts/catalog-next/japan-exact-count-browser.mjs';
import {EXACT_FIXTURE_IDS, BUDGET_FIXTURE_IDS, fixtureResult, fixtureDirectory} from './browser/japan-exact-count.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const binding = {runtimeSha: '1'.repeat(40), runtimeTree: '2'.repeat(40), helperSha256: hash('exact-helper')};
const now = new Date().toISOString(), city = 'Новокузнецк', query = {market: 'japan', city, powerTo: '160'};
const pages = params => {
  const result = [fixtureResult(params, now)];
  while (result.at(-1).hasMore) result.push(fixtureResult({...params, page: String(result.length + 1), after: result.at(-1).nextCursor}, now));
  return result;
};

function artifact() {
  const directory = checkedJapanAudiDirectory(fixtureDirectory(now), 200);
  const modelCoverage = {...verifyJapanModelCoverage(directory, directory), make: 'AUDI', typedBase: 'A4',
    typedFamilyNotNarrowed: true, modelExpansions: 1};
  const budgetQuery = {...query, make: 'AUDI', model: 'A4', budgetTo: '1303000'};
  const finite = verifyJapanFiniteSelection(pages(query), {query, expectedIds: EXACT_FIXTURE_IDS});
  const budgetFinite = verifyJapanFiniteSelection(pages(budgetQuery), {query: budgetQuery, expectedIds: BUDGET_FIXTURE_IDS});
  const sourceFiles = ['apps/web/components/catalog/catalog-sidebar.css', 'apps/web/components/catalog/MobileCatalogDropdowns.css',
    'apps/web/components/catalog/RecyclingPower.module.css', 'apps/web/app/globals.css'];
  const componentSha256 = Object.fromEntries([...sourceFiles,
    ...['CatalogFilters.tsx', 'CatalogLoadMore.tsx', 'CatalogCard.tsx', 'JapanCatalogCount.tsx',
      'CatalogSelectionContext.tsx', 'CatalogSidebar.tsx', 'catalog-load-more-action.tsx'].map(file => 'apps/web/components/catalog/' + file),
    'apps/web/lib/catalog/ajes-count-display.ts', 'apps/web/lib/catalog/catalog-routes.ts', 'apps/web/tailwind.config.ts']
    .map(file => [file, hash(file)]));
  const exactCount = {sourceBound: true, fullSelectionNumbers: true, liveExhaustiveScan: false, budgetExactCountPassed: true,
    checks: ['plain', 'make', 'model', 'combined', 'append', 'budget', 'budget_append'].map(kind => ({kind, exact: true, visibleExact: true})),
    budget: {exact: true, total: 38, budgetTo: 1_303_000, selectedCity: city, selectedFromVisibleCard: true, visibleWithinBudget: true,
      continuation: {followed: true, total: 38, sameCount: true, loaded: 38, exhausted: true}}};
  return {version: 1, kind: 'japan-exact-count-browser-v1', passed: true, ...binding,
    countProofContract: 'controlled-ui-mock-v1', liveSourceAccepted: false, backendCensusAccepted: false,
    productionRequests: 0, supplierRequests: 0, forbiddenTransportAttempts: 0,
    browserVersion: 'controlled-report-test', playwrightVersion: 'controlled-report-test',
    helperSha256: {'scripts/catalog-next/japan-exact-count-browser.mjs': binding.helperSha256,
      'scripts/catalog-next/japan-price-sort-browser.mjs': hash('price-helper'),
      'scripts/catalog-next/japan-browser-acceptance.mjs': hash('acceptance')},
    componentSha256, styles: {sourceFiles, componentBundleSha256: hash('component-css'), servedCssSha256: hash('served-css')},
    cases: ['preserved_controls', 'remounted_controls'].map(name => ({name, passed: true,
      priceSortPassed: true, exactCountPassed: true, modelCoveragePassed: true, budgetExactCountPassed: true,
      failedAppendKeepsTotal: true, pendingKeepsTotal: true, queryLoadedCountResets: true,
      lateOldAggregateIgnored: true, appendRestoresExactCount: true, lateOtherQueryDoesNotEraseCount: true,
      expiredCountDated: true, expiredCountNotCurrent: true, expiredAppendKeepsCards: true,
      priceCountTotal: 73, pageErrors: 0, requests: 12, finite, budgetFinite, modelCoverage, exactCount}))};
}

test('artifact reader binds exact runtime/helper and requires both real-control modes without asserting live acceptance', () => {
  const proof = checkedJapanExactCountBrowserFixture(artifact(), binding);
  assert.equal(proof.passed, true); assert.equal(proof.cases, 2); assert.equal(proof.finiteTotal, 73);
  assert.equal(proof.budgetExactCount, true); assert.equal(proof.liveSourceAccepted, false);
  assert.equal(proof.backendCensusAccepted, false); assert.equal(proof.countProofContract, 'controlled-ui-mock-v1');
  for (const patch of [{runtimeSha: '3'.repeat(40)}, {runtimeTree: '4'.repeat(40)}, {helperSha256: '5'.repeat(64)}])
    assert.throws(() => checkedJapanExactCountBrowserFixture(artifact(), {...binding, ...patch}), /fixture_binding/);
});

test('green boolean cannot hide absent exact proof, loaded-only totals, missing tail/models or incomplete recovery scenarios', () => {
  for (const mutate of [
    value => { value.passed = false; },
    value => { delete value.liveSourceAccepted; }, value => { value.liveSourceAccepted = true; },
    value => { delete value.backendCensusAccepted; }, value => { value.backendCensusAccepted = true; },
    value => { delete value.countProofContract; }, value => { value.countProofContract = 'live-source'; },
    value => { value.cases.pop(); },
    value => { value.cases[1].name = 'preserved_controls'; },
    value => { value.productionRequests = 1; }, value => { value.supplierRequests = 1; },
    value => { value.forbiddenTransportAttempts = 1; },
    value => { delete value.helperSha256['scripts/catalog-next/japan-price-sort-browser.mjs']; },
    value => { delete value.componentSha256['apps/web/components/catalog/CatalogSelectionContext.tsx']; },
    value => { value.styles.sourceFiles = value.styles.sourceFiles.filter(file => !file.endsWith('catalog-sidebar.css')); },
    value => { delete value.styles.componentBundleSha256; },
    value => { value.cases[0].priceCountTotal = 24; },
    value => { value.cases[0].appendRestoresExactCount = false; },
    value => { value.cases[0].lateOtherQueryDoesNotEraseCount = false; },
    value => { value.cases[0].expiredCountDated = false; },
    value => { value.cases[0].expiredCountNotCurrent = false; },
    value => { value.cases[0].expiredAppendKeepsCards = false; },
    value => { value.cases[0].finite.pageSizes = [24, 24, 24]; },
    value => { value.cases[0].finite.membershipSha256 = '9'.repeat(64); },
    value => { value.cases[0].finite.unknown = 22; },
    value => { value.cases[0].modelCoverage.accessiblePairs = 60; },
    value => { value.cases[0].modelCoverage.typedFamilyNotNarrowed = false; },
    value => { value.cases[0].exactCount.liveExhaustiveScan = true; },
    value => { value.cases[0].exactCount.checks = value.cases[0].exactCount.checks.filter(check => check.kind !== 'model'); },
    value => { value.cases[0].pageErrors = 1; },
  ]) {
    const value = artifact(); mutate(value);
    assert.throws(() => checkedJapanExactCountBrowserFixture(value, binding));
  }
});

test('a price budget is mandatory and must close its distinct city-priced selection, including continuation', () => {
  for (const mutate of [
    value => { value.cases[0].budgetExactCountPassed = false; },
    value => { value.cases[0].exactCount.budgetExactCountPassed = false; },
    value => { value.cases[0].exactCount.budget.total = 73; },
    value => { value.cases[0].exactCount.budget.budgetTo = 1_183_000; },
    value => { value.cases[0].exactCount.budget.selectedCity = 'Владивосток'; },
    value => { value.cases[0].exactCount.budget.selectedFromVisibleCard = false; },
    value => { value.cases[0].exactCount.budget.continuation.sameCount = false; },
    value => { value.cases[0].budgetFinite.pageSizes = [24]; },
    value => { value.cases[0].budgetFinite.membershipSha256 = 'a'.repeat(64); },
  ]) {
    const value = artifact(); mutate(value);
    assert.throws(() => checkedJapanExactCountBrowserFixture(value, binding));
  }
});
