import test from 'node:test';
import assert from 'node:assert/strict';
import {JAPAN_STABILITY_CODE_SCOPE, JAPAN_STABILITY_RETAINED_RUNTIME,
  JAPAN_STABILITY_CODE_PATHS, JAPAN_STABILITY_UI_CODE_PATHS,
  JAPAN_STABILITY_POWER_CODE_PATHS, JAPAN_STABILITY_RAILS_CODE_PATHS,
  JAPAN_STABILITY_HOME_CODE_PATHS, JAPAN_OBSERVED_TIMING_POLICY,
  isExactJapanStabilityScope, japanObservedTimingRequired, japanPowerOrderRequired,
  japanSourceNamesRequired, japanBrandDirectoryRequired} from '../scripts/catalog-next/japan-stability-code-scope.mjs';
import {checkedCatalogCodeScope} from '../scripts/catalog-next/photo-code-scope.mjs';

const plan = (paths = JAPAN_STABILITY_HOME_CODE_PATHS) => ({codeScope: JAPAN_STABILITY_CODE_SCOPE,
  retainedRuntime: JAPAN_STABILITY_RETAINED_RUNTIME, runtimeFiles: [...paths],
  ...(paths === JAPAN_STABILITY_HOME_CODE_PATHS ? {acceptancePolicy: JAPAN_OBSERVED_TIMING_POLICY} : {})});

test('independent observed timing is bound to the exact home successor and keeps every Japan functional gate', () => {
  assert.equal(JAPAN_STABILITY_HOME_CODE_PATHS.length, 58);
  assert(Object.isFrozen(JAPAN_STABILITY_HOME_CODE_PATHS));
  assert.deepEqual(JAPAN_STABILITY_HOME_CODE_PATHS.filter(file => !JAPAN_STABILITY_RAILS_CODE_PATHS.includes(file)),
    ['apps/web/lib/catalog/storage.ts', 'tests/catalog-next-home-isolation.test.ts']);
  const value = plan();
  assert.equal(checkedCatalogCodeScope(value), JAPAN_STABILITY_CODE_SCOPE);
  assert.equal(isExactJapanStabilityScope(value), true);
  for (const check of [japanObservedTimingRequired, japanPowerOrderRequired, japanSourceNamesRequired, japanBrandDirectoryRequired])
    assert.equal(check(value), true);
});

test('historical receipt profiles preserve their policy and cannot opt out of their recorded timing gate', () => {
  for (const paths of [JAPAN_STABILITY_CODE_PATHS, JAPAN_STABILITY_UI_CODE_PATHS,
    JAPAN_STABILITY_POWER_CODE_PATHS, JAPAN_STABILITY_RAILS_CODE_PATHS]) {
    assert.equal(checkedCatalogCodeScope(plan(paths)), JAPAN_STABILITY_CODE_SCOPE);
    assert.equal(japanObservedTimingRequired(plan(paths)), false);
    for (const acceptancePolicy of [JAPAN_OBSERVED_TIMING_POLICY, 'observe', null]) {
      const changed = {...plan(paths), acceptancePolicy};
      assert.equal(isExactJapanStabilityScope(changed), false);
      assert.throws(() => checkedCatalogCodeScope(changed));
    }
  }
});

test('new policy cannot authorize missing paths, additions, duplicate files, another predecessor or an unbound plan', () => {
  const original = plan();
  const invalid = [
    ...original.runtimeFiles.map(file => ({...original, runtimeFiles: original.runtimeFiles.filter(name => name !== file)})),
    {...original, runtimeFiles: [...original.runtimeFiles, 'packages/engine/src/index.ts']},
    {...original, runtimeFiles: [...original.runtimeFiles, original.runtimeFiles[0]]},
    {...original, retainedRuntime: '0'.repeat(40)},
    {...original, acceptancePolicy: undefined},
    {...original, acceptancePolicy: null},
    {...original, acceptancePolicy: 'observe'},
  ];
  for (const value of invalid) {
    assert.equal(isExactJapanStabilityScope(value), false);
    assert.throws(() => checkedCatalogCodeScope(value));
    assert.throws(() => japanObservedTimingRequired(value), /observed_timing_scope/);
  }
  assert.equal(japanObservedTimingRequired({codeScope: 'catalog-japan-pagination24-v1'}), false);
});
