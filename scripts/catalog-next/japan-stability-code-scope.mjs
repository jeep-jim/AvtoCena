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
const reviewedProfiles = Object.freeze([JAPAN_STABILITY_CODE_PATHS, JAPAN_STABILITY_UI_CODE_PATHS,
  JAPAN_STABILITY_POWER_CODE_PATHS]);

export function japanStabilityCodePaths(plan) {
  const files = plan?.runtimeFiles;
  if (!Array.isArray(files) || new Set(files).size !== files.length) return null;
  return reviewedProfiles.find(paths => files.length === paths.length && paths.every(name => files.includes(name))) ?? null;
}

export function isExactJapanStabilityScope(plan) {
  return JAPAN_STABILITY_CODE_PATHS.length > 0
    && JAPAN_PAGINATION_CODE_PATHS.every(name => JAPAN_STABILITY_CODE_PATHS.includes(name))
    && plan?.codeScope === JAPAN_STABILITY_CODE_SCOPE
    && plan.retainedRuntime === JAPAN_STABILITY_RETAINED_RUNTIME
    && japanStabilityCodePaths(plan) !== null;
}

export function japanPowerOrderRequired(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return false;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_power_order_scope');
  return japanStabilityCodePaths(plan) === JAPAN_STABILITY_POWER_CODE_PATHS;
}

export function japanSourceNamesRequired(plan) {
  if (plan?.codeScope !== JAPAN_STABILITY_CODE_SCOPE) return false;
  if (!isExactJapanStabilityScope(plan)) throw Error('japan_stability_source_names_scope');
  return japanStabilityCodePaths(plan) !== JAPAN_STABILITY_CODE_PATHS;
}
