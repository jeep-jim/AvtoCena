import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const need = (value, code) => assert(value, 'china_serving_' + code);
const hash = raw => createHash('sha256').update(raw).digest('hex');
const revision = value => /^[a-f0-9]{40}$/.test(value ?? '');
const allowedProduction = new Set(['apps/web/lib/catalog/storage.ts', 'apps/web/app/api/catalog/home/route.ts',
  'apps/web/app/(public)/page.tsx', 'apps/web/lib/catalog/china-local-reader.ts',
  'apps/web/lib/catalog/china-city-query.mjs', 'apps/web/components/catalog/CatalogFilters.tsx',
  'apps/web/components/catalog/CatalogPrice.tsx', 'apps/web/lib/location/selected-city.ts',
  'apps/web/lib/dealers/public-showcase.ts', 'apps/web/lib/catalog/home-phase-timing.ts',
  'apps/web/app/(public)/cars/offer/[id]/page.tsx',
  'apps/web/components/catalog/InlineOfferParameters.tsx',
  'apps/web/components/catalog/CatalogCover.tsx',
  'apps/web/components/catalog/CatalogCard.tsx',
  'apps/web/components/catalog/protected-photo-retry.ts',
  'apps/web/app/(public)/api/catalog/search/route.ts',
  'apps/web/components/catalog/AjesCatalog.tsx',
  'apps/web/components/catalog/AjesRail.tsx',
  'apps/web/components/catalog/CatalogContent.tsx',
  'apps/web/components/catalog/JapanSourcePowerNotice.tsx',
  'apps/web/lib/catalog/ajes-catalog.ts',
  'apps/web/lib/catalog/ajes-client.ts',
  'apps/web/lib/catalog/ajes-result-filter.ts',
  'apps/web/lib/catalog/detail-read-cache.ts',
  'apps/web/lib/catalog/japan-source-power.ts',
  'apps/web/lib/catalog/prepared-china-detail-city.ts']);
const allowedBrowserTests = new Set(['tests/browser/catalog-range-commit.mjs',
  'tests/browser/catalog-range-commit-fixture.tsx',
  'tests/browser/catalog-photo-recovery.mjs',
  'tests/browser/catalog-photo-recovery-fixture.tsx',
  'tests/catalog-photo-retry.test.ts',
  'tests/ajes-catalog-progressive.test.ts',
  'tests/catalog-japan-filter-rail.test.ts',
  'tests/ajes-detail-freshness.test.ts',
  'tests/ajes-count-display.test.ts',
  'tests/ajes-japan-only.test.ts',
  'tests/catalog-market-page-boundary.test.ts',
  'tests/japan-pw-first.test.ts',
  'tests/japan-pw-results.test.ts']);
// This profile includes the accepted China reader changes between the frozen
// pricing ancestor and d536, then the reviewed Japan delta. No path glob grants
// permission to add another application file or test to that compatibility proof.
const allowedJapanRecovery = new Set([
  'apps/web/app/(public)/cars/offer/[id]/page.tsx',
  'apps/web/app/(public)/page.tsx',
  'apps/web/app/api/catalog/home/route.ts',
  'apps/web/components/catalog/AjesCatalog.tsx',
  'apps/web/components/catalog/AjesRail.tsx',
  'apps/web/components/catalog/CatalogCard.tsx',
  'apps/web/components/catalog/CatalogContent.tsx',
  'apps/web/components/catalog/CatalogFilters.tsx',
  'apps/web/components/catalog/CatalogPrice.tsx',
  'apps/web/components/catalog/InlineOfferParameters.tsx',
  'apps/web/components/catalog/JapanRailFrame.tsx',
  'apps/web/components/home/HomeJapanFilteredRail.tsx',
  'apps/web/components/home/HomePageClient.tsx',
  'apps/web/lib/catalog/ajes-catalog.ts',
  'apps/web/lib/catalog/ajes-client.ts',
  'apps/web/lib/catalog/ajes-error-response.ts',
  'apps/web/lib/catalog/ajes-query.ts',
  'apps/web/lib/catalog/ajes-result-filter.ts',
  'apps/web/lib/catalog/china-city-query.mjs',
  'apps/web/lib/catalog/china-local-reader.ts',
  'apps/web/lib/catalog/detail-read-cache.ts',
  'apps/web/lib/catalog/home-phase-timing.ts',
  'apps/web/lib/catalog/japan-source-power.ts',
  'apps/web/lib/catalog/offer-page-data.ts',
  'apps/web/lib/catalog/prepared-china-detail-city.ts',
  'apps/web/lib/catalog/storage.ts',
  'apps/web/lib/catalog/types.ts',
  'apps/web/lib/dealers/public-showcase.ts',
  'apps/web/lib/location/selected-city.ts',
  'tests/ajes-catalog-progressive.test.ts',
  'tests/ajes-count-display.test.ts',
  'tests/ajes-disabled-response.test.ts',
  'tests/ajes-japan-feed.test.ts',
  'tests/ajes-japan-only.test.ts',
  'tests/ajes-rail-late-count.test.ts',
  'tests/browser/catalog-range-commit-fixture.tsx',
  'tests/browser/catalog-range-commit.mjs',
  'tests/catalog-current-read-model-empty-market-policy.test.ts',
  'tests/catalog-editable-power-scenario.test.ts',
  'tests/catalog-market-page-boundary.test.ts',
  'tests/catalog-market-page-city.test.ts',
  'tests/catalog-next-home-isolation.test.ts',
  'tests/catalog-next-home-parallel.test.ts',
  'tests/catalog-next-home-phase-timing.test.ts',
  'tests/catalog-next-local-reader.test.ts',
  'tests/catalog-next-query-index.test.ts',
  'tests/home-editorial-empty.test.ts',
  'tests/home-initial-catalog.test.ts',
  'tests/home-japan-preview.test.ts',
  'tests/japan-rail-visibility.test.ts',
  'tests/japan-source-power.test.ts',
  'tests/offer-navigation-performance.test.ts',
  'tests/public-page-recovery.test.ts',
]);
// Exact additional paths reviewed for the successor of 36c7. The old profile
// and protected China pricing bytes keep their existing contract.
const allowedJapanCompletion = new Set([...allowedJapanRecovery,
  'apps/web/lib/catalog/ajes-power-estimate.ts',
  'tests/browser/japan-catalog-city-fixture.tsx',
  'tests/browser/japan-catalog-city.mjs',
  'tests/japan-catalog-city.test.ts',
  'tests/japan-delivered-preview.test.ts',
  'tests/japan-preview-consistency.test.ts',
]);
const allowedJapanCompletionV2 = new Set([...allowedJapanCompletion,
  'apps/web/lib/catalog/ajes-public.ts',
  'tests/ajes-empty-page-validation.test.ts',
  'tests/ajes-prepared-admission.test.ts',
  'tests/ajes-recovery-isolation.test.ts',
  'tests/ajes-list-admission.test.ts',
]);
const allowedJapanUsability = new Set([...allowedJapanCompletionV2,
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
  "apps/web/lib/catalog/ajes-runtime.ts",
  "apps/web/lib/catalog/ajes-saved-search.ts",
  "apps/web/lib/catalog/japan-brand-directory.ts",
  "apps/web/lib/catalog/japan-power-query.ts",
  "apps/web/lib/catalog/japan-source-power.ts",
  "apps/web/lib/catalog/japan-vehicle-policy.ts",
  "tests/ajes-catalog-progressive.test.ts",
  "tests/ajes-count-progressive.test.ts",
  "tests/ajes-model-recovery.test.ts",
  "tests/ajes-power-page.test.ts",
  "tests/ajes-ready-metadata.test.ts",
  "tests/browser/japan-brand-directory-fixture.tsx",
  "tests/browser/japan-brand-directory.mjs",
  "tests/catalog-page-request.test.ts",
  "tests/japan-brand-directory.test.ts",
  "tests/japan-power-query.test.ts",
  "tests/japan-rail-visibility.test.ts",
  "tests/japan-source-power.test.ts",
  "tests/japan-vehicle-admission.test.ts",
]);
const typeOnlyPath = 'apps/web/lib/catalog/offer-page-data.ts';
export const CHINA_PROTECTED_PRICING_PATHS = Object.freeze([
  'packages', 'data', 'scripts/catalog-next', 'apps/web/lib/encyclopedia',
  'apps/web/lib/data.ts', 'apps/web/lib/business-settings.ts', 'apps/web/lib/effective-market-settings.ts',
  'apps/web/lib/catalog/rates.ts', 'apps/web/lib/catalog/customs-pricing.ts',
  'apps/web/lib/catalog/live-business-pricing.ts', 'apps/web/lib/catalog/market-logistics.ts',
  'apps/web/lib/catalog/city-delivery.ts', 'apps/web/lib/catalog/estimated-market-config.ts',
  'apps/web/lib/catalog/editorial.ts', 'apps/web/lib/catalog/editorial-specifications.ts',
  'apps/web/lib/catalog/china-cny-price.ts', 'apps/web/lib/encyclopedia/calculation-index.ts',
]);

/** A serving-only reader correction may use a generation priced by its exact
 * ancestor. Both plans are reviewed fixed files; no runtime SHA is inferred
 * from a mutable pointer, Docker label, environment override or a newer branch. */
export async function verifyServingCompatibility({runtimeRoot, servingPlan, pricingPlan}) {
  need(pricingPlan?.version === 1 && pricingPlan.market === 'china' && pricingPlan.minimumYear === 2014
    && revision(pricingPlan.runtimeSha) && revision(pricingPlan.runtimeTree), 'pricing_plan');
  need(servingPlan?.version === 1 && servingPlan.market === 'china'
    && revision(servingPlan.runtimeSha) && revision(servingPlan.runtimeTree)
    && servingPlan.pricingRuntimeSha === pricingPlan.runtimeSha
    && servingPlan.pricingRuntimeTree === pricingPlan.runtimeTree
    && /^[a-f0-9]{64}$/.test(servingPlan.pricingToServingDiffSha256 ?? ''), 'plan_binding');
  const files = servingPlan.pricingToServingFiles;
  need(Array.isArray(files) && new Set(files).size === files.length && files.every(name =>
    typeof name === 'string' && (servingPlan.codeScope === 'catalog-japan-usability-v1' ? allowedJapanUsability.has(name)
      : servingPlan.codeScope === 'catalog-japan-completion-v2' ? allowedJapanCompletionV2.has(name)
      : servingPlan.codeScope === 'catalog-japan-completion-v1' ? allowedJapanCompletion.has(name)
      : servingPlan.codeScope === 'catalog-japan-recovery-v1' ? allowedJapanRecovery.has(name)
      : allowedProduction.has(name) || allowedBrowserTests.has(name) || name === typeOnlyPath
        || /^tests\/catalog-next-[a-z0-9-]+\.test\.ts$/.test(name))), 'change_scope');
  runtimeRoot = await fs.realpath(runtimeRoot);
  const git = args => {
    try {
      return execFileSync('/usr/bin/git', ['--no-optional-locks', '--no-replace-objects', ...args], {cwd: runtimeRoot,
        env: {PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'},
        maxBuffer: 32 * 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe']});
    } catch { throw Error('china_serving_git_failed'); }
  };
  need(String(git(['rev-parse', '--show-toplevel'])).trim() === runtimeRoot
    && String(git(['rev-parse', 'HEAD'])).trim() === servingPlan.runtimeSha
    && String(git(['rev-parse', 'HEAD^{tree}'])).trim() === servingPlan.runtimeTree, 'runtime_identity');
  git(['diff', '--quiet', '--no-ext-diff', 'HEAD', '--']);
  need(String(git(['rev-parse', pricingPlan.runtimeSha + '^{tree}'])).trim() === pricingPlan.runtimeTree, 'pricing_tree');
  git(['merge-base', '--is-ancestor', pricingPlan.runtimeSha, servingPlan.runtimeSha]);
  const changed = String(git(['diff', '--name-only', '-z', '--no-renames', pricingPlan.runtimeSha, servingPlan.runtimeSha]))
    .split('\0').filter(Boolean).sort();
  need(JSON.stringify(changed) === JSON.stringify([...files].sort()), 'changed_files');
  const difference = git(['diff', '--binary', '--full-index', '--no-ext-diff', '--no-renames', pricingPlan.runtimeSha, servingPlan.runtimeSha]);
  need(hash(difference) === servingPlan.pricingToServingDiffSha256, 'changed_bytes');
  git(['diff', '--quiet', '--no-ext-diff', pricingPlan.runtimeSha, servingPlan.runtimeSha, '--', ...CHINA_PROTECTED_PRICING_PATHS]);
  const typeOnlyChecks = [];
  if (changed.includes(typeOnlyPath)) {
    // This one reader annotation fixes a union inference error. It may change
    // TypeScript declarations, but the emitted executable code must be byte
    // identical. Formula, request or fallback changes cannot use this exception.
    const ts = await import('typescript');
    const compiler = ts.default ?? ts;
    const emit = revision => {
      const source = String(git(['show', revision + ':' + typeOnlyPath]));
      const result = compiler.transpileModule(source, {fileName: typeOnlyPath, reportDiagnostics: true,
        compilerOptions: {target: compiler.ScriptTarget.ESNext, module: compiler.ModuleKind.ESNext,
          removeComments: true, sourceMap: false, inlineSourceMap: false, newLine: compiler.NewLineKind.LineFeed}});
      need(!(result.diagnostics ?? []).some(row => row.category === compiler.DiagnosticCategory.Error), 'type_only_syntax');
      return result.outputText;
    };
    const before = emit(pricingPlan.runtimeSha), after = emit(servingPlan.runtimeSha);
    need(before === after, 'type_only_runtime_changed');
    typeOnlyChecks.push(Object.freeze({file: typeOnlyPath, emittedJavaScriptSha256: hash(before), compilerVersion: compiler.version}));
  }
  return Object.freeze({version: 1, kind: 'china-serving-pricing-compatibility-v1',
    runtimeSha: servingPlan.runtimeSha, runtimeTree: servingPlan.runtimeTree,
    pricingRuntimeSha: pricingPlan.runtimeSha, pricingRuntimeTree: pricingPlan.runtimeTree,
    pricingToServingDiffSha256: servingPlan.pricingToServingDiffSha256, pricingToServingFiles: Object.freeze(changed),
    protectedPricingPathsUnchanged: true, typeOnlyChecks: Object.freeze(typeOnlyChecks)});
}
