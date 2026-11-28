import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import * as scope from '../scripts/catalog-next/japan-stability-code-scope.mjs';
import {checkedCatalogCodeScope} from '../scripts/catalog-next/photo-code-scope.mjs';

const files = [
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
];
const retained = 'b9e9122b75f4e588088d0241476b18df7f047d96';
const plan = () => ({codeScope: scope.JAPAN_STABILITY_CODE_SCOPE, retainedRuntime: retained,
  runtimeFiles: [...files], acceptancePolicy: scope.JAPAN_OBSERVED_TIMING_POLICY});

test('price sorting is an exact successor of accepted B9 with all prior Japan functional obligations', () => {
  assert.deepEqual(scope.JAPAN_STABILITY_PRICE_SORT_CODE_PATHS, files);
  assert(Object.isFrozen(scope.JAPAN_STABILITY_PRICE_SORT_CODE_PATHS));
  assert.equal(scope.JAPAN_STABILITY_PRICE_SORT_RETAINED_RUNTIME, retained);
  assert.equal(checkedCatalogCodeScope(plan()), scope.JAPAN_STABILITY_CODE_SCOPE);
  for (const check of [scope.isExactJapanStabilityScope, scope.japanObservedTimingRequired,
    scope.japanPowerOrderRequired, scope.japanSourceNamesRequired, scope.japanBrandDirectoryRequired,
    scope.japanPriceSortRequired]) assert.equal(check(plan()), true);
  assert.deepEqual(scope.japanStabilityCompatibilityPaths(plan()),
    [...new Set([...scope.JAPAN_STABILITY_METADATA_CODE_PATHS, ...files])].sort());
});

test('a sort/count successor cannot use another predecessor, omit a delta or expand protected scope', () => {
  for (const bad of [
    {...plan(), retainedRuntime: scope.JAPAN_STABILITY_RETAINED_RUNTIME},
    ...files.map(file => ({...plan(), runtimeFiles: files.filter(name => name !== file)})),
    {...plan(), runtimeFiles: [...files, files[0]]},
    {...plan(), runtimeFiles: [...files, 'packages/engine/src/index.ts']},
    ...[undefined, null, 'observe'].map(acceptancePolicy => ({...plan(), acceptancePolicy})),
  ]) {
    assert.equal(scope.isExactJapanStabilityScope(bad), false);
    assert.throws(() => checkedCatalogCodeScope(bad));
  }
});

test('accepted historical profiles keep their original predecessor and do not claim new price-sort proof', () => {
  assert.equal(typeof scope.japanPriceSortRequired, 'function');
  for (const paths of [scope.JAPAN_STABILITY_CODE_PATHS, scope.JAPAN_STABILITY_UI_CODE_PATHS,
    scope.JAPAN_STABILITY_POWER_CODE_PATHS, scope.JAPAN_STABILITY_RAILS_CODE_PATHS,
    scope.JAPAN_STABILITY_HOME_CODE_PATHS, scope.JAPAN_STABILITY_METADATA_CODE_PATHS]) {
    const historic = {codeScope: scope.JAPAN_STABILITY_CODE_SCOPE,
      retainedRuntime: scope.JAPAN_STABILITY_RETAINED_RUNTIME, runtimeFiles: [...paths],
      ...([scope.JAPAN_STABILITY_HOME_CODE_PATHS, scope.JAPAN_STABILITY_METADATA_CODE_PATHS].includes(paths)
        ? {acceptancePolicy: scope.JAPAN_OBSERVED_TIMING_POLICY} : {})};
    assert.equal(checkedCatalogCodeScope(historic), scope.JAPAN_STABILITY_CODE_SCOPE);
    assert.equal(scope.japanPriceSortRequired(historic), false);
    assert.equal(scope.isExactJapanStabilityScope({...historic, retainedRuntime: retained}), false);
  }
});

test('the actual host binds the new image profile to B9 and rejects cross-paired historical profiles', () => {
  const program = String.raw`
import importlib.util,json
s=importlib.util.spec_from_file_location('host','scripts/catalog-next/release-host.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
new=m.JAPAN_STABILITY_PRICE_SORT_CODE_FILES
assert m.checked_japan_stability_image_files(sorted(new),True,m.JAPAN_STABILITY_PRICE_SORT_RETAINED)==new
for files,observed,retained in [(new,True,m.JAPAN_STABILITY_RETAINED),
 (new,False,m.JAPAN_STABILITY_PRICE_SORT_RETAINED),
 (m.JAPAN_STABILITY_METADATA_CODE_FILES,True,m.JAPAN_STABILITY_PRICE_SORT_RETAINED)]:
 try:m.checked_japan_stability_image_files(sorted(files),observed,retained)
 except m.ReleaseError:pass
 else:raise AssertionError('cross-paired image accepted')
print(json.dumps(sorted(new)))
`;
  const result = spawnSync('python3', ['-I', '-B', '-c', program], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), files);
});
