import {JAPAN_PAGINATION_CODE_PATHS} from './japan-pagination-code-scope.mjs';

/** Exact Japan-only delta from accepted a5ca to the reviewed source plan.
 * The source plan separately pins the complete SHA, tree and binary diff hash.
 * Every retained pagination file remains mandatory; unrelated paths cannot be
 * authorized through this scope.
 */
export const JAPAN_STABILITY_CODE_SCOPE = 'catalog-japan-stability-v1';
export const JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY = 'japan-source-bounded-incremental-v1';
export const JAPAN_STABILITY_RETAINED_RUNTIME = 'a5ca426eec2663eb17c2df69fe2bfed46e2b8740';
export const JAPAN_STABILITY_CODE_PATHS = Object.freeze([
  'apps/web/app/api/catalog/brand-counts/route.ts',
  'apps/web/app/api/catalog/recommendations/data.ts',
  'apps/web/app/api/catalog/source-models/route.ts',
  'apps/web/components/catalog/AjesCatalog.tsx',
  'apps/web/components/catalog/CatalogBrandMultiSelect.tsx',
  'apps/web/components/catalog/CatalogFilters.tsx',
  'apps/web/components/catalog/CatalogLoadMore.tsx',
  'apps/web/components/catalog/RelatedOffersView.tsx',
  'apps/web/components/catalog/VehicleModelSearch.tsx',
  'apps/web/components/catalog/catalog-load-more-action.tsx',
  'apps/web/lib/catalog/ajes-catalog.ts',
  'apps/web/lib/catalog/ajes-client.ts',
  'apps/web/lib/catalog/ajes-error-response.ts',
  'apps/web/lib/catalog/ajes-filtered-page.ts',
  'apps/web/lib/catalog/ajes-model-resolution.ts',
  'apps/web/lib/catalog/ajes-query-cache.ts',
  'apps/web/lib/catalog/ajes-query.ts',
  'apps/web/lib/catalog/ajes-read-receipt.ts',
  'apps/web/lib/catalog/ajes-request-diagnostic.ts',
  'apps/web/lib/catalog/ajes-runtime.ts',
  'apps/web/lib/catalog/ajes-ssr-read-evidence.ts',
  'apps/web/lib/catalog/inventory-admission.ts',
  'apps/web/lib/catalog/japan-vehicle-policy.ts',
  'apps/web/lib/catalog/model-suggestion-loader.ts',
  'apps/web/lib/catalog/related-card-visibility.ts',
  'tests/ajes-catalog-progressive.test.ts',
  'tests/ajes-count-progressive.test.ts',
  'tests/ajes-detail-queue-recovery.test.ts',
  'tests/ajes-empty-page-validation.test.ts',
  'tests/ajes-filtered-page.test.ts',
  'tests/ajes-japan-feed.test.ts',
  'tests/ajes-japan-only.test.ts',
  'tests/ajes-model-loader.test.ts',
  'tests/ajes-model-recovery.test.ts',
  'tests/ajes-prepared-admission.test.ts',
  'tests/ajes-query-stability.test.ts',
  'tests/ajes-queue-fallback.test.ts',
  'tests/ajes-read-receipt.test.ts',
  'tests/ajes-ssr-read-evidence.test.ts',
  'tests/browser/ajes-pagination-fixture.tsx',
  'tests/browser/ajes-pagination.mjs',
  'tests/browser/japan-filter-directory.mjs',
  'tests/browser/model-suggestions.mjs',
  'tests/japan-drive-sql-budget.test.ts',
  'tests/japan-model-directory-metadata.test.ts',
  'tests/japan-recommendations.test.ts',
  'tests/japan-source-power.test.ts',
  'tests/japan-vehicle-policy.test.ts',
  'tests/related-offer-selection.test.ts',
]);

/** The UI correction preserves Japan source names and the power provenance
 * shown with a saved calculation preview. Preserve the original exact 49-file
 * profile for its existing receipts; the successor adds three reviewed views. */
export const JAPAN_STABILITY_UI_CODE_PATHS = Object.freeze([
  ...JAPAN_STABILITY_CODE_PATHS,
  'apps/web/components/catalog/BrandLogoRail.tsx',
  'apps/web/components/catalog/CatalogCard.tsx',
  'apps/web/components/catalog/CatalogContent.tsx',
].sort());
/** The ordered power walk supplies one immutable evidence snapshot to the
 * ordinary Japan reader; no protected editor or calculation source changes. */
export const JAPAN_STABILITY_POWER_CODE_PATHS = Object.freeze([
  ...JAPAN_STABILITY_UI_CODE_PATHS,
  'apps/web/lib/catalog/ajes-public.ts',
].sort());
/** The final visible-directory repair also removes the long summary from
 * Japan's general-catalog and home rails. Both views are an exact successor,
 * with the stronger live directory and fallback-fixture proofs mandatory. */
export const JAPAN_STABILITY_RAILS_CODE_PATHS = Object.freeze([
  ...JAPAN_STABILITY_POWER_CODE_PATHS,
  'apps/web/components/catalog/AjesRail.tsx',
  'apps/web/components/home/HomeJapanFilteredRail.tsx',
  'tests/japan-rail-visibility.test.ts',
].sort());
/** The owner-directed independent release keeps timing as observations and
 * removes the retained home's dependency on the obsolete aggregate reader.
 * This policy is authorized only for reviewed successors, never old receipts. */
export const JAPAN_OBSERVED_TIMING_POLICY = 'japan-functional-observed-timing-v1';
export const JAPAN_STABILITY_HOME_CODE_PATHS = Object.freeze([
  ...JAPAN_STABILITY_RAILS_CODE_PATHS,
  'apps/web/lib/catalog/storage.ts',
  'tests/catalog-next-home-isolation.test.ts',
].sort());
/** Metadata recovery also updates the existing TTL regression's positive
 * source fixture. Preserve the exact 58-file profile and its receipts. */
export const JAPAN_STABILITY_METADATA_CODE_PATHS = Object.freeze([
  ...JAPAN_STABILITY_HOME_CODE_PATHS,
  'tests/ajes-ready-metadata.test.ts',
].sort());
/** Price sorting and truthful loaded counts start from the accepted B9 image.
 * Its earlier 59-file delta remains immutable historical evidence. */
export const JAPAN_STABILITY_PRICE_SORT_RETAINED_RUNTIME = 'b9e9122b75f4e588088d0241476b18df7f047d96';
export const JAPAN_STABILITY_PRICE_SORT_CODE_PATHS = Object.freeze([
  'apps/web/components/catalog/AjesCatalog.tsx',
  'apps/web/components/catalog/CatalogLoadMore.tsx',
  'apps/web/components/catalog/CatalogSelectionContext.tsx',
  'apps/web/components/catalog/JapanCatalogCount.tsx',
  'apps/web/lib/catalog/ajes-catalog.ts',
  'apps/web/lib/catalog/ajes-count-display.ts',
  'tests/ajes-catalog-progressive.test.ts',
  'tests/ajes-count-display.test.ts',
  'tests/ajes-ssr-read-evidence.test.ts',
  'tests/browser/ajes-pagination.mjs',
  'tests/japan-source-power.test.ts',
]);
/** Exact admitted counts and complete model selections are a separate
 * successor. The accepted loaded-count release remains the rollback image. */
export const JAPAN_STABILITY_EXACT_COUNT_RETAINED_RUNTIME = '20fd18d12b3f5c7aabef860e1b53da0d505dfd64';
export const JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS = Object.freeze([
  'apps/web/components/catalog/AjesCatalog.tsx',
  'apps/web/components/catalog/AjesRail.tsx',
  'apps/web/components/catalog/CatalogFilters.tsx',
  'apps/web/components/catalog/CatalogLoadMore.tsx',
  'apps/web/components/catalog/CatalogSelectionContext.tsx',
  'apps/web/components/catalog/JapanCatalogCount.tsx',
  'apps/web/components/catalog/VehicleModelSearch.tsx',
  'apps/web/components/catalog/catalog-load-more-action.tsx',
  'apps/web/components/home/HomeJapanFilteredRail.tsx',
  'apps/web/lib/catalog/ajes-admission.ts',
  'apps/web/lib/catalog/ajes-catalog.ts',
  'apps/web/lib/catalog/ajes-census-protocol.ts',
  'apps/web/lib/catalog/ajes-census.ts',
  'apps/web/lib/catalog/ajes-client.ts',
  'apps/web/lib/catalog/ajes-count-display.ts',
  'apps/web/lib/catalog/ajes-count-pricing-context.ts',
  'apps/web/lib/catalog/ajes-filtered-page.ts',
  'apps/web/lib/catalog/ajes-make-resolution.ts',
  'apps/web/lib/catalog/ajes-model-resolution.ts',
  'apps/web/lib/catalog/ajes-public.ts',
  'apps/web/lib/catalog/ajes-query-cache.ts',
  'apps/web/lib/catalog/ajes-query.ts',
  'apps/web/lib/catalog/ajes-read-receipt.ts',
  'apps/web/lib/catalog/ajes-request-diagnostic.ts',
  'apps/web/lib/catalog/ajes-saved-search.ts',
  'tests/ajes-catalog-progressive.test.ts',
  'tests/ajes-census.test.ts',
  'tests/ajes-count-display.test.ts',
  'tests/ajes-count-pricing-context.test.ts',
  'tests/ajes-count-progressive.test.ts',
  'tests/ajes-filtered-page.test.ts',
  'tests/ajes-japan-feed.test.ts',
  'tests/ajes-japan-only.test.ts',
  'tests/ajes-model-recovery.test.ts',
  'tests/ajes-query-stability.test.ts',
  'tests/ajes-rail-late-count.test.ts',
  'tests/ajes-ssr-read-evidence.test.ts',
  'tests/browser/ajes-pagination.mjs',
  'tests/browser/japan-filter-directory.mjs',
  'tests/catalog-japan-filter-rail.test.ts',
  'tests/catalog-page-request.test.ts',
  'tests/home-japan-preview.test.ts',
  'tests/japan-drive-saved-search.test.ts',
  'tests/japan-model-directory-metadata.test.ts',
  'tests/japan-rail-visibility.test.ts',
  'tests/japan-source-power.test.ts',
]);
/** A distinct successor reports the provider's scalar candidate count without
 * relabeling it as a complete admitted census. Its accepted 7f image is retained. */
export const JAPAN_SOURCE_COUNT_POLICY = 'japan-source-count-v1';
export const JAPAN_STABILITY_SOURCE_COUNT_RETAINED_RUNTIME = '7f7a316905cd8109352431ed4722108b3449c3ec';
export const JAPAN_STABILITY_SOURCE_COUNT_RETAINED_IMAGE = 'sha256:59b6be6c59c0895b42cf6766fcba0150d862d3dfc7e09ce2e51f6e17ea7177c0';
export const JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS = Object.freeze([
  'apps/web/app/(public)/api/catalog/search/route.ts',
  'apps/web/components/catalog/CatalogFilters.tsx',
  'apps/web/components/catalog/CatalogSelectionContext.tsx',
  'apps/web/components/catalog/JapanCatalogCount.tsx',
  'apps/web/lib/catalog/ajes-catalog.ts',
  'apps/web/lib/catalog/ajes-count-display.ts',
  'apps/web/lib/catalog/ajes-filtered-page.ts',
  'apps/web/lib/catalog/ajes-source-count.ts',
  'tests/ajes-catalog-count-continuation.test.ts',
  'tests/ajes-catalog-progressive.test.ts',
  'tests/ajes-count-display.test.ts',
  'tests/ajes-count-progressive.test.ts',
  'tests/ajes-filtered-page.test.ts',
  'tests/ajes-model-recovery.test.ts',
  'tests/ajes-source-count-display.test.ts',
  'tests/ajes-source-count.test.ts',
  'tests/japan-rail-visibility.test.ts',
  'tests/japan-source-power.test.ts',
]);
/** Keep the accepted source-count profile above intact. This smaller successor
 * stabilizes literal model membership and requires its own filtered journey. */
export const JAPAN_STABILITY_MODEL_CURSOR_RETAINED_RUNTIME = '66537bb7470645acf995ab8a792a4fadb98ad1e4';
export const JAPAN_STABILITY_MODEL_CURSOR_RETAINED_IMAGE = 'sha256:1086ca08d15c553e436796ab9d79df6538a62d4e8f163e81c76f64d22241a9b7';
export const JAPAN_STABILITY_MODEL_CURSOR_CODE_PATHS = Object.freeze([
  'apps/web/lib/catalog/ajes-model-resolution.ts',
  'tests/ajes-count-display.test.ts',
  'tests/ajes-model-cursor-continuity.test.ts',
  'tests/ajes-model-recovery.test.ts',
  'tests/japan-model-directory-metadata.test.ts',
]);
const reviewedProfiles = Object.freeze([JAPAN_STABILITY_CODE_PATHS, JAPAN_STABILITY_UI_CODE_PATHS,
  JAPAN_STABILITY_POWER_CODE_PATHS, JAPAN_STABILITY_RAILS_CODE_PATHS, JAPAN_STABILITY_HOME_CODE_PATHS,
  JAPAN_STABILITY_METADATA_CODE_PATHS, JAPAN_STABILITY_PRICE_SORT_CODE_PATHS, JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS,
  JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS, JAPAN_STABILITY_MODEL_CURSOR_CODE_PATHS]);

export function japanStabilityCodePaths(plan) {
  const files = plan?.runtimeFiles;
  if (!Array.isArray(files) || new Set(files).size !== files.length) return null;
  return reviewedProfiles.find(paths => paths.length > 0 && files.length === paths.length && paths.every(name => files.includes(name))) ?? null;
}

export function isExactJapanStabilityScope(plan) {
  const paths = japanStabilityCodePaths(plan);
  return JAPAN_STABILITY_CODE_PATHS.length > 0
    && JAPAN_PAGINATION_CODE_PATHS.every(name => JAPAN_STABILITY_CODE_PATHS.includes(name))
    && plan?.codeScope === JAPAN_STABILITY_CODE_SCOPE
    && plan.retainedRuntime === (paths === JAPAN_STABILITY_MODEL_CURSOR_CODE_PATHS
      ? JAPAN_STABILITY_MODEL_CURSOR_RETAINED_RUNTIME : paths === JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS
      ? JAPAN_STABILITY_SOURCE_COUNT_RETAINED_RUNTIME : paths === JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS
      ? JAPAN_STABILITY_EXACT_COUNT_RETAINED_RUNTIME : paths === JAPAN_STABILITY_PRICE_SORT_CODE_PATHS
        ? JAPAN_STABILITY_PRICE_SORT_RETAINED_RUNTIME : JAPAN_STABILITY_RETAINED_RUNTIME)
    && paths !== null
    && ([JAPAN_STABILITY_HOME_CODE_PATHS, JAPAN_STABILITY_METADATA_CODE_PATHS, JAPAN_STABILITY_PRICE_SORT_CODE_PATHS,
      JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS, JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS, JAPAN_STABILITY_MODEL_CURSOR_CODE_PATHS].includes(paths)
      ? plan.acceptancePolicy === JAPAN_OBSERVED_TIMING_POLICY
      : plan.acceptancePolicy === undefined)
    && ([JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS, JAPAN_STABILITY_MODEL_CURSOR_CODE_PATHS].includes(paths) ? plan.countAcceptance === JAPAN_SOURCE_COUNT_POLICY
      : plan.countAcceptance === undefined || (paths === JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS
        && plan.countAcceptance === JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY));
}

export function japanObservedTimingRequired(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return false;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_observed_timing_scope');
  return [JAPAN_STABILITY_HOME_CODE_PATHS, JAPAN_STABILITY_METADATA_CODE_PATHS,
    JAPAN_STABILITY_PRICE_SORT_CODE_PATHS, JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS,
    JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS, JAPAN_STABILITY_MODEL_CURSOR_CODE_PATHS].includes(japanStabilityCodePaths(plan));
}

export function japanPowerOrderRequired(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return false;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_power_order_scope');
  return [JAPAN_STABILITY_POWER_CODE_PATHS, JAPAN_STABILITY_RAILS_CODE_PATHS,
    JAPAN_STABILITY_HOME_CODE_PATHS, JAPAN_STABILITY_METADATA_CODE_PATHS,
    JAPAN_STABILITY_PRICE_SORT_CODE_PATHS, JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS,
    JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS, JAPAN_STABILITY_MODEL_CURSOR_CODE_PATHS].includes(japanStabilityCodePaths(plan));
}

export function japanBrandDirectoryRequired(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return false;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_brand_directory_scope');
  return [JAPAN_STABILITY_RAILS_CODE_PATHS, JAPAN_STABILITY_HOME_CODE_PATHS,
    JAPAN_STABILITY_METADATA_CODE_PATHS, JAPAN_STABILITY_PRICE_SORT_CODE_PATHS, JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS,
    JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS, JAPAN_STABILITY_MODEL_CURSOR_CODE_PATHS].includes(japanStabilityCodePaths(plan));
}

export function japanPriceSortRequired(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return false;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_price_sort_scope');
  return [JAPAN_STABILITY_PRICE_SORT_CODE_PATHS, JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS,
    JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS, JAPAN_STABILITY_MODEL_CURSOR_CODE_PATHS].includes(japanStabilityCodePaths(plan));
}

export function japanExactCountRequired(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return false;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_exact_count_scope');
  return japanStabilityCodePaths(plan) === JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS
    && plan.countAcceptance === undefined;
}

/** This separately named profile accepts the reviewed source/model corrections
 * with live directory coverage. It does not assert a positive admitted census;
 * a plan without the marker retains the original strict exact-count contract. */
export function japanSourceBoundedIncrementalRequired(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return false;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_count_acceptance_scope');
  return plan.countAcceptance === JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY;
}

export function japanLiteralFamilyRequired(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return false;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_literal_family_scope');
  return [JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS, JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS,
    JAPAN_STABILITY_MODEL_CURSOR_CODE_PATHS].includes(japanStabilityCodePaths(plan));
}

export function japanSourceBoundedAcceptancePassed(report) {
  return report?.countAcceptance === JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY && japanModelCoverageAcceptancePassed(report);
}

export function japanSourceCountRequired(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return false;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_source_count_scope');
  return [JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS, JAPAN_STABILITY_MODEL_CURSOR_CODE_PATHS].includes(japanStabilityCodePaths(plan));
}

export function japanA4Power160ContinuationRequired(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return false;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_a4_power160_continuation_scope');
  return japanStabilityCodePaths(plan) === JAPAN_STABILITY_MODEL_CURSOR_CODE_PATHS;
}

/** The marker is a code-transition contract, never a daily generation policy. */
export function japanCountAcceptance(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return undefined;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_count_acceptance_scope');
  return plan.countAcceptance;
}

function japanModelCoverageAcceptancePassed(report) {
  const proof = report?.checks?.modelCoverage;
  return report?.japanModelCoverageRequired === true && report.japanModelCoveragePassed === true
    && report.japanExactCountRequired === false && report.japanExactCountPassed === null
    && Number.isSafeInteger(proof?.sourcePairs) && proof.sourcePairs > 0
    && proof.accessiblePairs === proof.sourcePairs
    && proof.coverageContract === 'directory-and-visible-cards-v1'
    && Number.isSafeInteger(proof.cardBackedExtraPairs) && proof.cardBackedExtraPairs >= 0
    && Number.isSafeInteger(proof.visibleCardPairs) && proof.visibleCardPairs >= 1 && proof.visibleCardPairs <= 24
    && proof.cardBackedExtraPairs <= proof.visibleCardPairs
    && Number.isSafeInteger(proof.optionPairs) && proof.optionPairs === proof.sourcePairs + proof.cardBackedExtraPairs
    && proof.uiEqualsDirectory === (proof.cardBackedExtraPairs === 0) && proof.allOptionsSourceBacked === true
    && ['allSourceModelsAccessible', 'noForeignModels', 'sourceMatchesUi', 'typedFamilyNotNarrowed', 'countHonest', 'fullPage']
      .every(key => proof[key] === true)
    && ['AUDI', 'Audi'].includes(proof.make) && proof.typedBase === 'A4'
    && ['pairsSha256', 'optionPairsSha256', 'cardBackedExtraPairsSha256', 'visibleCardPairsSha256', 'cardProvenanceSha256']
      .every(key => /^[a-f0-9]{64}$/.test(proof[key] ?? ''))
    && (proof.optionPairsSha256 === proof.pairsSha256) === proof.uiEqualsDirectory
    && Number.isSafeInteger(proof.modelExpansions) && proof.modelExpansions >= 0
    && (proof.modelExpansions > 0) === (proof.optionPairs > 60)
    && proof.modelExpansions <= Math.ceil(proof.optionPairs / 60) - 1
    && Number.isSafeInteger(proof.sourceFamilyModels) && proof.sourceFamilyModels > 0
    && proof.sourceFamilyModels <= proof.sourcePairs
    && proof.directory?.status === 200 && proof.directory.stale === false
    && proof.directory.sourcePairs === proof.sourcePairs && proof.directory.pairsSha256 === proof.pairsSha256
    && proof.directory.browserMatchesApi === true
    && Number.isSafeInteger(proof.selection?.shown) && proof.selection.shown >= 1 && proof.selection.shown <= 24
    && proof.selection.observedSourceNamesOnly === true
    && proof.explicitApiReads === 3 && proof.liveExhaustiveScan === false && proof.pageErrors === 0;
}

function sourceCountCursor(value) {
  if (typeof value !== 'string' || value.length > 320) return false;
  const ordinary = /^j1\.([1-9]\d{0,6})\.(\d{1,2})\.([1-9]\d{0,6})\.([a-f0-9]{64})\.(-|[a-f0-9]{64})$/.exec(value);
  if (ordinary) return Number(ordinary[1]) <= 1_000_000 && Number(ordinary[2]) <= 23
    && Number(ordinary[3]) <= 1_000_000 && (Number(ordinary[2]) === 0) === (ordinary[5] === '-');
  const power = /^j2\.([ku])\.([1-9]\d{0,6})\.(\d{1,2})\.([1-9]\d{0,6})\.([a-f0-9]{64})\.([a-f0-9]{64})\.(-|[a-f0-9]{64})$/.exec(value);
  return Boolean(power) && Number(power[2]) <= 1_000_000 && Number(power[3]) <= 24
    && Number(power[4]) <= 1_000_000 && (Number(power[3]) === 0) === (power[7] === '-');
}

/** Candidate counts are accepted only with their own source and UI evidence.
 * Data freshness is separate from request duration; elapsed speed is not a gate. */
export function japanSourceCountAcceptancePassed(report) {
  const proof = report?.checks?.sourceCount, summary = proof?.summary, source = summary?.sourceCountProof;
  const ui = proof?.ui, pagination = proof?.pagination;
  const checkedAt = Date.parse(report?.checkedAt), observedAt = Date.parse(summary?.observedAt);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const hash64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const totalText = integer(summary?.total) ? String(summary.total).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : undefined;
  return report?.countAcceptance === JAPAN_SOURCE_COUNT_POLICY && japanModelCoverageAcceptancePassed(report)
    && report.japanSourceCountRequired === true && report.japanSourceCountPassed === true
    && proof?.contract === 'japan-source-count-browser-v1'
    && integer(summary?.total) && summary.total > 0 && summary.stale === false
    && summary.upperBound === true && summary.precision === 'source-upper-bound'
    && summary.selectionScope === 'source-candidates' && typeof summary.sourceScopeComplete === 'boolean'
    && !Object.hasOwn(summary, 'countProof') && !Object.hasOwn(summary, 'knownTotal') && !Object.hasOwn(summary, 'unknownTotal')
    && source?.version === 1 && source.kind === 'japan-source-count' && source.predicateVersion === 'japan-source-candidates-v1'
    && ['requestedQueryHash', 'sourceQueryHash', 'evidenceEpoch'].every(key => hash64(source[key]))
    && source.sourceTotal === summary.total && source.sourceObservedAt === summary.observedAt
    && source.sourceScopeComplete === summary.sourceScopeComplete && typeof source.directoryComplete === 'boolean'
    && (!source.sourceScopeComplete || source.directoryComplete)
    && Number.isFinite(checkedAt) && Number.isFinite(observedAt) && observedAt <= checkedAt
    && checkedAt - observedAt < 30 * 60_000
    && proof.queryHashVerified === true && proof.independentCount === true
    && proof.admittedTotal === null && proof.positiveAdmittedCensusClaimed === false
    && ui?.status === (source.sourceScopeComplete ? 'bounded' : 'source')
    && ui.sourceTotal === summary.total && ui.requestedQueryHash === source.requestedQueryHash
    && ui.observedAt === summary.observedAt && integer(ui.loadedCount) && ui.loadedCount >= 1 && ui.loadedCount <= 24
    && ui.sourceTotal >= ui.loadedCount
    && typeof ui.label === 'string' && ui.label.replace(/[\u00a0\u202f]/g, ' ')
      === (source.sourceScopeComplete ? 'Найдено до ' : 'В источнике: ') + totalText
    && pagination?.sameFilter === true && sourceCountCursor(pagination.cursorBeforeCount)
    && pagination.cursorAfterCount === pagination.cursorBeforeCount
    && pagination.continuationCursor === pagination.cursorBeforeCount && pagination.continuationFollowed === true
    && pagination.loadedBefore === ui.loadedCount && integer(pagination.loadedAfter)
    && pagination.loadedAfter > pagination.loadedBefore && pagination.loadedAfter <= pagination.loadedBefore + 24
    && pagination.duplicateIds === 0 && pagination.freshSourcePages === true
    && proof.liveExhaustiveScan === false && proof.pageErrors === 0;
}

/** A filtered continuation is separate from an exhaustive selection proof.
 * The bounded reader may honestly report partial pages while both ordinary
 * appends must return fresh, useful rows under the selected public filters. */
export function japanA4Power160ContinuationAcceptancePassed(report) {
  if (!japanSourceCountAcceptancePassed(report)) return false;
  const proof = report?.checks?.a4Power160Continuation;
  const checkedAt = Date.parse(report?.checkedAt);
  const hash64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const positivePageSize = value => Number.isSafeInteger(value) && value >= 1 && value <= 24;
  const pagePassed = (page, shown) => {
    const observedAt = Date.parse(page?.observedAt);
    return page?.status === 200 && page.shown === shown && positivePageSize(shown)
      && Number.isFinite(checkedAt) && Number.isFinite(observedAt) && observedAt <= checkedAt
      && checkedAt - observedAt < 30 * 60_000
      && page.stale === false && page.interrupted === false
      && ['partial', 'scanLimited', 'selectionIncomplete', 'hasMore'].every(key => typeof page[key] === 'boolean')
      && (!page.scanLimited || page.hasMore && page.shown < 24)
      && Number.isSafeInteger(page.sourcePages) && page.sourcePages >= 1 && page.sourcePages <= 8
      && hash64(page.receiptsSha256) && page.sourceReceiptsFresh === true
      && page.total === null && page.selectionCompletenessClaimed === false;
  };
  const renderedPagePassed = (page, shown, index) => {
    const observedAt = Date.parse(page?.observedAt);
    return page?.kind === 'rendered-ssr' && (page.status === 200 || index === 0 && page.status === null)
      && page.shown === shown && positivePageSize(shown) && page.page === 1
      && page.afterSha256 === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      && page.ssrBindingMatched === true
      && Number.isFinite(checkedAt) && Number.isFinite(observedAt) && observedAt <= checkedAt
      && checkedAt - observedAt < 30 * 60_000 && page.stale === false
      && ['partial', 'scanLimited', 'selectionIncomplete', 'interrupted'].every(key => page[key] === null)
      && Number.isSafeInteger(page.sourcePages) && page.sourcePages >= 1 && page.sourcePages <= 8
      && hash64(page.receiptsSha256) && page.sourceReceiptsFresh === true
      && page.total === null && page.hasMore === true && page.selectionCompletenessClaimed === false;
  };
  const names = ['after_power_toggle', 'after_first_page_navigation'];
  return report.japanA4Power160ContinuationRequired === true && report.japanA4Power160ContinuationPassed === true
    && proof?.contract === 'japan-a4-power160-continuation-browser-v1'
    && proof.selection?.market === 'japan' && proof.selection.make === 'Audi' && proof.selection.model === 'A4'
    && proof.selection.city === 'Новокузнецк' && proof.selection.powerTo === 160 && proof.toggledThroughUi === true
    && proof.firstPageNavigation?.status === 200 && proof.firstPageNavigation.sameFilter === true
    && proof.firstPageNavigation.powerChecked === true && proof.firstPageNavigation.cityPreserved === true
    && Array.isArray(proof.attempts) && proof.attempts.length === names.length
    && proof.attempts.every((attempt, index) => attempt?.name === names[index]
      && attempt.status === 200 && attempt.sameFilter === true
      && typeof attempt.cursor === 'string' && attempt.cursor.startsWith('j2.') && sourceCountCursor(attempt.cursor)
      && attempt.continuationCursor === attempt.cursor
      && positivePageSize(attempt.loadedBefore) && positivePageSize(attempt.added)
      && attempt.loadedAfter === attempt.loadedBefore + attempt.added && attempt.duplicateIds === 0
      && ['oldIdsPreserved', 'orderPreserved', 'knownBeforeUnknown'].every(key => attempt[key] === true)
      && renderedPagePassed(attempt.firstPage, attempt.loadedBefore, index)
      && pagePassed(attempt.nextPage, attempt.added)
      && ['beforeIdsSha256', 'addedIdsSha256', 'afterIdsSha256'].every(key => hash64(attempt[key])))
    && proof.explicitApiReads === 0 && proof.ordinaryAppendRequests === 2 && proof.firstPageNavigations === 1
    && proof.fullSelectionExhaustionClaimed === false && proof.liveExhaustiveScan === false && proof.pageErrors === 0;
}

/** Compatibility with the fixed pricing ancestor includes accepted B9 bytes,
 * while each new image's own runtime diff is only its reviewed delta. */
export function japanStabilityCompatibilityPaths(plan) {
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_compatibility_scope');
  const paths = japanStabilityCodePaths(plan);
  if (paths === JAPAN_STABILITY_MODEL_CURSOR_CODE_PATHS)
    return [...new Set([...JAPAN_STABILITY_METADATA_CODE_PATHS, ...JAPAN_STABILITY_PRICE_SORT_CODE_PATHS,
      ...JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS, ...JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS, ...paths])].sort();
  if (paths === JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS || paths === JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS)
    return [...new Set([...JAPAN_STABILITY_METADATA_CODE_PATHS, ...JAPAN_STABILITY_PRICE_SORT_CODE_PATHS,
      ...JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS, ...paths])].sort();
  return paths === JAPAN_STABILITY_PRICE_SORT_CODE_PATHS
    ? [...new Set([...JAPAN_STABILITY_METADATA_CODE_PATHS, ...paths])].sort() : paths;
}

export function japanSourceNamesRequired(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return false;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_source_names_scope');
  return japanStabilityCodePaths(plan) !== JAPAN_STABILITY_CODE_PATHS;
}

