import {JAPAN_PAGINATION_CODE_PATHS} from './japan-pagination-code-scope.mjs';

/** Exact Japan-only delta from accepted a5ca to the reviewed source plan.
 * The source plan separately pins the complete SHA, tree and binary diff hash.
 * Every retained pagination file remains mandatory; unrelated paths cannot be
 * authorized through this scope.
 */
export const JAPAN_STABILITY_CODE_SCOPE = 'catalog-japan-stability-v1';
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
  'apps/web/lib/catalog/ajes-runtime.ts',
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

export function isExactJapanStabilityScope(plan) {
  return JAPAN_STABILITY_CODE_PATHS.length > 0
    && JAPAN_PAGINATION_CODE_PATHS.every(name => JAPAN_STABILITY_CODE_PATHS.includes(name))
    && plan?.codeScope === JAPAN_STABILITY_CODE_SCOPE
    && plan.retainedRuntime === JAPAN_STABILITY_RETAINED_RUNTIME
    && Array.isArray(plan.runtimeFiles) && plan.runtimeFiles.length === JAPAN_STABILITY_CODE_PATHS.length
    && new Set(plan.runtimeFiles).size === plan.runtimeFiles.length
    && JAPAN_STABILITY_CODE_PATHS.every(name => plan.runtimeFiles.includes(name));
}
