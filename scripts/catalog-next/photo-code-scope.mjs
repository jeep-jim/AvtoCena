import {verifyChinaImageRuntime} from './build-release-image.mjs';
import {verifyServingCompatibility} from './serving-compatibility.mjs';
import {CRM_CHINA_CODE_SCOPE, CRM_CHINA_CODE_PATHS, CRM_CHINA_RETAINED_RUNTIME} from './crm-china-code-scope.mjs';
import {CRM_JAPAN_PHOTO_CODE_SCOPE, CRM_JAPAN_PHOTO_CODE_PATHS, CRM_JAPAN_PHOTO_RETAINED_RUNTIME} from './crm-japan-photo-code-scope.mjs';
import {JAPAN_PAGINATION_CODE_SCOPE, JAPAN_PAGINATION_CODE_PATHS, JAPAN_PAGINATION_RETAINED_RUNTIME} from './japan-pagination-code-scope.mjs';
import {JAPAN_STABILITY_CODE_SCOPE, japanStabilityCodePaths, isExactJapanStabilityScope,
  japanObservedTimingRequired} from './japan-stability-code-scope.mjs';

export const CHINA_PHOTO_CODE_PATHS = Object.freeze([
  'apps/web/components/catalog/CatalogCover.tsx',
  'apps/web/components/catalog/CatalogCard.tsx',
  'apps/web/components/catalog/protected-photo-retry.ts',
  'tests/catalog-photo-retry.test.ts',
  'tests/browser/catalog-photo-recovery-fixture.tsx',
  'tests/browser/catalog-photo-recovery.mjs',
]);
export const CHINA_PHOTO_JAPAN_CODE_PATHS = Object.freeze([...new Set([...CHINA_PHOTO_CODE_PATHS,
  'apps/web/app/(public)/api/catalog/search/route.ts',
  'apps/web/app/(public)/cars/offer/[id]/page.tsx',
  'apps/web/app/(public)/page.tsx',
  'apps/web/components/catalog/AjesCatalog.tsx',
  'apps/web/components/catalog/AjesRail.tsx',
  'apps/web/components/catalog/CatalogCard.tsx',
  'apps/web/components/catalog/CatalogContent.tsx',
  'apps/web/components/catalog/JapanSourcePowerNotice.tsx',
  'apps/web/lib/catalog/ajes-catalog.ts',
  'apps/web/lib/catalog/ajes-client.ts',
  'apps/web/lib/catalog/ajes-result-filter.ts',
  'apps/web/lib/catalog/detail-read-cache.ts',
  'apps/web/lib/catalog/japan-source-power.ts',
  'apps/web/lib/catalog/storage.ts',
  'tests/ajes-catalog-progressive.test.ts',
  'tests/catalog-japan-filter-rail.test.ts',
  'tests/ajes-detail-freshness.test.ts',
  'tests/ajes-count-display.test.ts',
  'tests/ajes-japan-only.test.ts',
  'tests/catalog-market-page-boundary.test.ts',
  'tests/japan-pw-first.test.ts',
  'tests/japan-pw-results.test.ts',
])]);
export const JAPAN_RECOVERY_RETAINED_RUNTIME = 'd536c1547c4d82a339ed68ced7d8503f09b6810b';
export const JAPAN_RECOVERY_CODE_PATHS = Object.freeze([
  'apps/web/app/(public)/cars/offer/[id]/page.tsx',
  'apps/web/app/(public)/page.tsx',
  'apps/web/components/catalog/AjesCatalog.tsx',
  'apps/web/components/catalog/AjesRail.tsx',
  'apps/web/components/catalog/CatalogCard.tsx',
  'apps/web/components/catalog/CatalogContent.tsx',
  'apps/web/components/catalog/JapanRailFrame.tsx',
  'apps/web/components/home/HomeJapanFilteredRail.tsx',
  'apps/web/components/home/HomePageClient.tsx',
  'apps/web/lib/catalog/ajes-catalog.ts',
  'apps/web/lib/catalog/ajes-client.ts',
  'apps/web/lib/catalog/ajes-error-response.ts',
  'apps/web/lib/catalog/ajes-query.ts',
  'apps/web/lib/catalog/ajes-result-filter.ts',
  'apps/web/lib/catalog/detail-read-cache.ts',
  'apps/web/lib/catalog/japan-source-power.ts',
  'apps/web/lib/catalog/storage.ts',
  'apps/web/lib/catalog/types.ts',
  'tests/ajes-catalog-progressive.test.ts',
  'tests/ajes-count-display.test.ts',
  'tests/ajes-disabled-response.test.ts',
  'tests/ajes-japan-feed.test.ts',
  'tests/ajes-japan-only.test.ts',
  'tests/ajes-rail-late-count.test.ts',
  'tests/catalog-current-read-model-empty-market-policy.test.ts',
  'tests/catalog-editable-power-scenario.test.ts',
  'tests/catalog-market-page-boundary.test.ts',
  'tests/catalog-market-page-city.test.ts',
  'tests/catalog-next-home-isolation.test.ts',
  'tests/catalog-next-home-parallel.test.ts',
  'tests/home-editorial-empty.test.ts',
  'tests/home-initial-catalog.test.ts',
  'tests/home-japan-preview.test.ts',
  'tests/japan-rail-visibility.test.ts',
  'tests/japan-source-power.test.ts',
  'tests/offer-navigation-performance.test.ts',
  'tests/public-page-recovery.test.ts',
]);
export const JAPAN_COMPLETION_RETAINED_RUNTIME = '36c7ea726e7f070d10dbc65afc6538f13c0c1a24';
// A separate exact successor of the accepted Japan recovery. Keep the earlier
// profile immutable: its receipts and rollback proof still bind that old delta.
export const JAPAN_COMPLETION_CODE_PATHS = Object.freeze([
  'apps/web/components/catalog/CatalogFilters.tsx',
  'apps/web/components/catalog/InlineOfferParameters.tsx',
  'apps/web/lib/catalog/ajes-power-estimate.ts',
  'apps/web/lib/catalog/japan-source-power.ts',
  'apps/web/lib/location/selected-city.ts',
  'tests/ajes-catalog-progressive.test.ts',
  'tests/browser/japan-catalog-city-fixture.tsx',
  'tests/browser/japan-catalog-city.mjs',
  'tests/japan-catalog-city.test.ts',
  'tests/japan-delivered-preview.test.ts',
  'tests/japan-preview-consistency.test.ts',
  'tests/japan-source-power.test.ts',
]);
// The rejected v1 candidate never became the retained runtime. Its successor
// keeps the complete completion delta from accepted 36c7 and adds only the
// reviewed empty-page proof and its native fixtures. Historical v1 stays exact.
export const JAPAN_COMPLETION_V2_RETAINED_RUNTIME = JAPAN_COMPLETION_RETAINED_RUNTIME;
export const JAPAN_COMPLETION_V2_CODE_PATHS = Object.freeze([...JAPAN_COMPLETION_CODE_PATHS,
  'apps/web/lib/catalog/ajes-client.ts',
  'apps/web/lib/catalog/ajes-public.ts',
  'apps/web/lib/catalog/detail-read-cache.ts',
  'tests/ajes-empty-page-validation.test.ts',
  'tests/ajes-prepared-admission.test.ts',
  'tests/ajes-recovery-isolation.test.ts',
  'tests/ajes-list-admission.test.ts',
]);
export const JAPAN_USABILITY_RETAINED_RUNTIME = '077cbb17626ab0c64e7f06db055fef9252ad21c0';
export const JAPAN_USABILITY_CODE_PATHS = Object.freeze([
  "apps/web/app/api/catalog/brand-counts/route.ts",
  "apps/web/components/catalog/AjesCatalog.tsx",
  "apps/web/components/catalog/AjesRail.tsx",
  "apps/web/components/catalog/BrandLogoRail.tsx",
  "apps/web/components/catalog/CatalogBrandMultiSelect.tsx",
  "apps/web/components/catalog/CatalogLoadMore.tsx",
  "apps/web/components/catalog/catalog-load-more-action.tsx",
  "apps/web/components/catalog/page-request-error.ts",
  "apps/web/components/home/HomeJapanFilteredRail.tsx",
  "apps/web/lib/catalog/ajes-catalog.ts",
  "apps/web/lib/catalog/ajes-client.ts",
  "apps/web/lib/catalog/ajes-error-response.ts",
  "apps/web/lib/catalog/ajes-offer.ts",
  "apps/web/lib/catalog/ajes-power-page.ts",
  "apps/web/lib/catalog/ajes-public.ts",
  "apps/web/lib/catalog/ajes-query-cache.ts",
  "apps/web/lib/catalog/ajes-query.ts",
  "apps/web/lib/catalog/ajes-read-evidence.ts",
  "apps/web/lib/catalog/ajes-runtime.ts",
  "apps/web/lib/catalog/ajes-saved-search.ts",
  "apps/web/lib/catalog/japan-brand-directory.ts",
  "apps/web/lib/catalog/japan-power-query.ts",
  "apps/web/lib/catalog/japan-source-power.ts",
  "apps/web/lib/catalog/japan-vehicle-policy.ts",
  "tests/ajes-catalog-progressive.test.ts",
  "tests/ajes-count-progressive.test.ts",
  "tests/ajes-empty-page-validation.test.ts",
  "tests/ajes-japan-feed.test.ts",
  "tests/ajes-model-recovery.test.ts",
  "tests/ajes-power-page.test.ts",
  "tests/ajes-prepared-admission.test.ts",
  "tests/ajes-queue-fallback.test.ts",
  "tests/ajes-read-evidence.test.ts",
  "tests/ajes-ready-metadata.test.ts",
  "tests/browser/japan-brand-directory-fixture.tsx",
  "tests/browser/japan-brand-directory.mjs",
  "tests/catalog-page-request.test.ts",
  "tests/japan-brand-directory.test.ts",
  "tests/japan-drive-sql-budget.test.ts",
  "tests/japan-power-query.test.ts",
  "tests/japan-rail-visibility.test.ts",
  "tests/japan-source-power.test.ts",
  "tests/japan-vehicle-admission.test.ts",
]);
const need = (value, code) => { if (!value) throw Error('china_photo_scope_' + code); };

export function checkedCatalogCodeScope(plan) {
  const scope = plan?.codeScope ?? 'catalog-photo-recovery-v1';
  const paths = scope === 'catalog-photo-recovery-v1' ? CHINA_PHOTO_CODE_PATHS
    : scope === 'catalog-photo-japan-power-v1' ? CHINA_PHOTO_JAPAN_CODE_PATHS
    : scope === 'catalog-japan-recovery-v1' ? JAPAN_RECOVERY_CODE_PATHS
    : scope === 'catalog-japan-completion-v1' ? JAPAN_COMPLETION_CODE_PATHS
    : scope === 'catalog-japan-completion-v2' ? JAPAN_COMPLETION_V2_CODE_PATHS
    : scope === 'catalog-japan-usability-v1' ? JAPAN_USABILITY_CODE_PATHS
    : scope === CRM_CHINA_CODE_SCOPE ? CRM_CHINA_CODE_PATHS
    : scope === CRM_JAPAN_PHOTO_CODE_SCOPE ? CRM_JAPAN_PHOTO_CODE_PATHS
    : scope === JAPAN_PAGINATION_CODE_SCOPE ? JAPAN_PAGINATION_CODE_PATHS
    : scope === JAPAN_STABILITY_CODE_SCOPE ? japanStabilityCodePaths(plan) : null;
  need(paths && Array.isArray(plan.runtimeFiles) && plan.runtimeFiles.length === paths.length
    && paths.every(name => plan.runtimeFiles.includes(name)), 'files');
  need(scope !== 'catalog-japan-recovery-v1' || plan.retainedRuntime === JAPAN_RECOVERY_RETAINED_RUNTIME, 'retained_runtime');
  need(scope !== 'catalog-japan-completion-v1' || plan.retainedRuntime === JAPAN_COMPLETION_RETAINED_RUNTIME, 'retained_runtime');
  need(scope !== 'catalog-japan-completion-v2' || plan.retainedRuntime === JAPAN_COMPLETION_V2_RETAINED_RUNTIME, 'retained_runtime');
  need(scope !== 'catalog-japan-usability-v1' || plan.retainedRuntime === JAPAN_USABILITY_RETAINED_RUNTIME, 'retained_runtime');
  need(scope !== CRM_CHINA_CODE_SCOPE || plan.retainedRuntime === CRM_CHINA_RETAINED_RUNTIME, 'retained_runtime');
  need(scope !== CRM_JAPAN_PHOTO_CODE_SCOPE || plan.retainedRuntime === CRM_JAPAN_PHOTO_RETAINED_RUNTIME, 'retained_runtime');
  need(scope !== JAPAN_PAGINATION_CODE_SCOPE || plan.retainedRuntime === JAPAN_PAGINATION_RETAINED_RUNTIME, 'retained_runtime');
  need(scope !== JAPAN_STABILITY_CODE_SCOPE || isExactJapanStabilityScope(plan), 'stability_scope');
  need(plan.acceptancePolicy === undefined || (scope === JAPAN_STABILITY_CODE_SCOPE
    && japanObservedTimingRequired(plan)), 'acceptance_policy');
  return scope;
}

/** A frozen China HTTP oracle may be reused only for one reviewed fixed delta.
 * China query/index/pricing, generation, proxy and server configuration are
 * excluded. Japan profiles change only Japan branches in shared readers; the
 * recovery profile starts from the accepted d536 runtime and is built afresh.
 * Preserved China bytes retain their frozen HTTP oracle. The explicit Japan
 * successor uses its own functional browser acceptance and observed timing. */
export async function verifyChinaPhotoCodeRuntime({runtimeRoot, servingPlan, pricingPlan}) {
  const codeScope = checkedCatalogCodeScope(servingPlan);
  const source = await verifyChinaImageRuntime({runtimeRoot, plan: servingPlan});
  const compatibility = await verifyServingCompatibility({runtimeRoot, servingPlan, pricingPlan});
  return {...compatibility, retainedRuntime: source.retainedRuntime,
    runtimeDiffSha256: source.runtimeDiffSha256, codeScope, frozenHttpOracleReusable: true};
}
