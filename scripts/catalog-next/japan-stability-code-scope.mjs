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
const reviewedProfiles = Object.freeze([JAPAN_STABILITY_CODE_PATHS, JAPAN_STABILITY_UI_CODE_PATHS,
  JAPAN_STABILITY_POWER_CODE_PATHS, JAPAN_STABILITY_RAILS_CODE_PATHS, JAPAN_STABILITY_HOME_CODE_PATHS,
  JAPAN_STABILITY_METADATA_CODE_PATHS, JAPAN_STABILITY_PRICE_SORT_CODE_PATHS, JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS]);

export function japanStabilityCodePaths(plan) {
  const files = plan?.runtimeFiles;
  if (!Array.isArray(files) || new Set(files).size !== files.length) return null;
  return reviewedProfiles.find(paths => files.length === paths.length && paths.every(name => files.includes(name))) ?? null;
}

export function isExactJapanStabilityScope(plan) {
  const paths = japanStabilityCodePaths(plan);
  return JAPAN_STABILITY_CODE_PATHS.length > 0
    && JAPAN_PAGINATION_CODE_PATHS.every(name => JAPAN_STABILITY_CODE_PATHS.includes(name))
    && plan?.codeScope === JAPAN_STABILITY_CODE_SCOPE
    && plan.retainedRuntime === (paths === JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS
      ? JAPAN_STABILITY_EXACT_COUNT_RETAINED_RUNTIME : paths === JAPAN_STABILITY_PRICE_SORT_CODE_PATHS
        ? JAPAN_STABILITY_PRICE_SORT_RETAINED_RUNTIME : JAPAN_STABILITY_RETAINED_RUNTIME)
    && paths !== null
    && ([JAPAN_STABILITY_HOME_CODE_PATHS, JAPAN_STABILITY_METADATA_CODE_PATHS, JAPAN_STABILITY_PRICE_SORT_CODE_PATHS, JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS].includes(paths)
      ? plan.acceptancePolicy === JAPAN_OBSERVED_TIMING_POLICY
      : plan.acceptancePolicy === undefined)
    && (plan.countAcceptance === undefined || (paths === JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS
      && plan.countAcceptance === JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY));
}

export function japanObservedTimingRequired(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return false;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_observed_timing_scope');
  return [JAPAN_STABILITY_HOME_CODE_PATHS, JAPAN_STABILITY_METADATA_CODE_PATHS,
    JAPAN_STABILITY_PRICE_SORT_CODE_PATHS, JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS].includes(japanStabilityCodePaths(plan));
}

export function japanPowerOrderRequired(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return false;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_power_order_scope');
  return [JAPAN_STABILITY_POWER_CODE_PATHS, JAPAN_STABILITY_RAILS_CODE_PATHS,
    JAPAN_STABILITY_HOME_CODE_PATHS, JAPAN_STABILITY_METADATA_CODE_PATHS,
    JAPAN_STABILITY_PRICE_SORT_CODE_PATHS, JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS].includes(japanStabilityCodePaths(plan));
}

export function japanBrandDirectoryRequired(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return false;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_brand_directory_scope');
  return [JAPAN_STABILITY_RAILS_CODE_PATHS, JAPAN_STABILITY_HOME_CODE_PATHS,
    JAPAN_STABILITY_METADATA_CODE_PATHS, JAPAN_STABILITY_PRICE_SORT_CODE_PATHS, JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS].includes(japanStabilityCodePaths(plan));
}

export function japanPriceSortRequired(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return false;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_price_sort_scope');
  return [JAPAN_STABILITY_PRICE_SORT_CODE_PATHS, JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS].includes(japanStabilityCodePaths(plan));
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
  return japanStabilityCodePaths(plan) === JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS;
}

export function japanSourceBoundedAcceptancePassed(report) {
  const proof = report?.checks?.modelCoverage;
  return report?.countAcceptance === JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY
    && report.japanModelCoverageRequired === true && report.japanModelCoveragePassed === true
    && report.japanExactCountRequired === false && report.japanExactCountPassed === null
    && Number.isSafeInteger(proof?.sourcePairs) && proof.sourcePairs > 0
    && proof.accessiblePairs === proof.sourcePairs
    && ['allSourceModelsAccessible', 'noForeignModels', 'sourceMatchesUi', 'typedFamilyNotNarrowed', 'countHonest', 'fullPage']
      .every(key => proof[key] === true)
    && ['AUDI', 'Audi'].includes(proof.make) && proof.typedBase === 'A4'
    && /^[a-f0-9]{64}$/.test(proof.pairsSha256 ?? '')
    && Number.isSafeInteger(proof.modelExpansions) && proof.modelExpansions >= 0
    && (proof.modelExpansions > 0) === (proof.sourcePairs > 60)
    && proof.modelExpansions <= Math.ceil(proof.sourcePairs / 60) - 1
    && Number.isSafeInteger(proof.sourceFamilyModels) && proof.sourceFamilyModels > 0
    && proof.sourceFamilyModels <= proof.sourcePairs
    && proof.directory?.status === 200 && proof.directory.stale === false
    && proof.directory.sourcePairs === proof.sourcePairs && proof.directory.pairsSha256 === proof.pairsSha256
    && Number.isSafeInteger(proof.selection?.shown) && proof.selection.shown >= 1 && proof.selection.shown <= 24
    && proof.selection.observedSourceNamesOnly === true
    && proof.explicitApiReads === 3 && proof.liveExhaustiveScan === false && proof.pageErrors === 0;
}

/** Compatibility with the fixed pricing ancestor includes accepted B9 bytes,
 * while the new image's own runtime diff is only its reviewed eleven-file delta. */
export function japanStabilityCompatibilityPaths(plan) {
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_compatibility_scope');
  const paths = japanStabilityCodePaths(plan);
  if (paths === JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS)
    return [...new Set([...JAPAN_STABILITY_METADATA_CODE_PATHS, ...JAPAN_STABILITY_PRICE_SORT_CODE_PATHS, ...paths])].sort();
  return paths === JAPAN_STABILITY_PRICE_SORT_CODE_PATHS
    ? [...new Set([...JAPAN_STABILITY_METADATA_CODE_PATHS, ...paths])].sort() : paths;
}

export function japanSourceNamesRequired(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return false;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_source_names_scope');
  return japanStabilityCodePaths(plan) !== JAPAN_STABILITY_CODE_PATHS;
}

