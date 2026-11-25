import {verifyChinaImageRuntime} from './build-release-image.mjs';
import {verifyServingCompatibility} from './serving-compatibility.mjs';

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
const need = (value, code) => { if (!value) throw Error('china_photo_scope_' + code); };

export function checkedCatalogCodeScope(plan) {
  const scope = plan?.codeScope ?? 'catalog-photo-recovery-v1';
  const paths = scope === 'catalog-photo-recovery-v1' ? CHINA_PHOTO_CODE_PATHS
    : scope === 'catalog-photo-japan-power-v1' ? CHINA_PHOTO_JAPAN_CODE_PATHS : null;
  need(paths && Array.isArray(plan.runtimeFiles) && plan.runtimeFiles.length === paths.length
    && paths.every(name => plan.runtimeFiles.includes(name)), 'files');
  return scope;
}

/** A frozen China HTTP oracle may be reused only for one reviewed fixed delta.
 * China query/index/pricing, generation, proxy and server configuration are
 * excluded. The combined profile changes only Japan branches in shared readers.
 * Both actual markets still pass their HTTP/browser acceptance before commit. */
export async function verifyChinaPhotoCodeRuntime({runtimeRoot, servingPlan, pricingPlan}) {
  const codeScope = checkedCatalogCodeScope(servingPlan);
  const source = await verifyChinaImageRuntime({runtimeRoot, plan: servingPlan});
  const compatibility = await verifyServingCompatibility({runtimeRoot, servingPlan, pricingPlan});
  return {...compatibility, retainedRuntime: source.retainedRuntime,
    runtimeDiffSha256: source.runtimeDiffSha256, codeScope, frozenHttpOracleReusable: true};
}
