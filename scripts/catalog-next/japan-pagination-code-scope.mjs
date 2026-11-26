/** A new bounded page-fill delta, pinned to the already accepted CRM/photo runtime.
 * Source SQL/client/transport and pricing are outside this exact profile.
 * This profile does not contain the rejected usability runtime or claim its global ordering/count.
 */
export const JAPAN_PAGINATION_CODE_SCOPE = 'catalog-japan-pagination24-v1';
export const JAPAN_PAGINATION_RETAINED_RUNTIME = 'a5ca426eec2663eb17c2df69fe2bfed46e2b8740';
export const JAPAN_PAGINATION_CODE_PATHS = Object.freeze([
  "apps/web/components/catalog/AjesCatalog.tsx",
  "apps/web/components/catalog/CatalogLoadMore.tsx",
  "apps/web/components/catalog/catalog-load-more-action.tsx",
  "apps/web/lib/catalog/ajes-catalog.ts",
  "apps/web/lib/catalog/ajes-filtered-page.ts",
  "tests/ajes-catalog-progressive.test.ts",
  "tests/ajes-count-progressive.test.ts",
  "tests/ajes-filtered-page.test.ts",
  "tests/browser/ajes-pagination-fixture.tsx",
  "tests/browser/ajes-pagination.mjs",
  "tests/japan-source-power.test.ts"
]);
export function isExactJapanPaginationScope(plan) {
  return plan?.codeScope === JAPAN_PAGINATION_CODE_SCOPE
    && plan.retainedRuntime === JAPAN_PAGINATION_RETAINED_RUNTIME
    && Array.isArray(plan.runtimeFiles) && plan.runtimeFiles.length === JAPAN_PAGINATION_CODE_PATHS.length
    && new Set(plan.runtimeFiles).size === plan.runtimeFiles.length
    && JAPAN_PAGINATION_CODE_PATHS.every(name => plan.runtimeFiles.includes(name));
}
