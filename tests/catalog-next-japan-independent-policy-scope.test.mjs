import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {JAPAN_STABILITY_CODE_SCOPE, JAPAN_STABILITY_RETAINED_RUNTIME,
  JAPAN_STABILITY_CODE_PATHS, JAPAN_STABILITY_UI_CODE_PATHS,
  JAPAN_STABILITY_POWER_CODE_PATHS, JAPAN_STABILITY_RAILS_CODE_PATHS,
  JAPAN_STABILITY_HOME_CODE_PATHS, JAPAN_STABILITY_METADATA_CODE_PATHS, JAPAN_OBSERVED_TIMING_POLICY,
  isExactJapanStabilityScope, japanObservedTimingRequired, japanPowerOrderRequired,
  japanSourceNamesRequired, japanBrandDirectoryRequired} from '../scripts/catalog-next/japan-stability-code-scope.mjs';
import {checkedCatalogCodeScope} from '../scripts/catalog-next/photo-code-scope.mjs';
import {verifyChinaImageRuntime} from '../scripts/catalog-next/build-release-image.mjs';

const plan = (paths = JAPAN_STABILITY_HOME_CODE_PATHS) => ({codeScope: JAPAN_STABILITY_CODE_SCOPE,
  retainedRuntime: JAPAN_STABILITY_RETAINED_RUNTIME, runtimeFiles: [...paths],
  ...([JAPAN_STABILITY_HOME_CODE_PATHS, JAPAN_STABILITY_METADATA_CODE_PATHS].includes(paths)
    ? {acceptancePolicy: JAPAN_OBSERVED_TIMING_POLICY} : {})});

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

test('metadata recovery admits only the exact 59-file successor and retains the original 58-file policy', () => {
  assert.equal(JAPAN_STABILITY_METADATA_CODE_PATHS.length, 59);
  assert(Object.isFrozen(JAPAN_STABILITY_METADATA_CODE_PATHS));
  assert.deepEqual(JAPAN_STABILITY_METADATA_CODE_PATHS.filter(file => !JAPAN_STABILITY_HOME_CODE_PATHS.includes(file)),
    ['tests/ajes-ready-metadata.test.ts']);
  for (const paths of [JAPAN_STABILITY_HOME_CODE_PATHS, JAPAN_STABILITY_METADATA_CODE_PATHS]) {
    assert.equal(checkedCatalogCodeScope(plan(paths)), JAPAN_STABILITY_CODE_SCOPE);
    for (const check of [isExactJapanStabilityScope, japanObservedTimingRequired, japanPowerOrderRequired,
      japanSourceNamesRequired, japanBrandDirectoryRequired]) assert.equal(check(plan(paths)), true);
  }
  const original = plan(JAPAN_STABILITY_METADATA_CODE_PATHS);
  const invalid = [
    ...JAPAN_STABILITY_HOME_CODE_PATHS.map(file => ({...original, runtimeFiles: original.runtimeFiles.filter(name => name !== file)})),
    {...original, runtimeFiles: [...original.runtimeFiles, 'tests/unreviewed.test.ts']},
    {...original, runtimeFiles: [...original.runtimeFiles, original.runtimeFiles[0]]},
    ...[undefined, null, 'observe', false].map(acceptancePolicy => ({...original, acceptancePolicy})),
    {...original, retainedRuntime: '0'.repeat(40)},
  ];
  for (const value of invalid) {
    assert.equal(isExactJapanStabilityScope(value), false);
    assert.throws(() => checkedCatalogCodeScope(value));
    assert.throws(() => japanObservedTimingRequired(value), /observed_timing_scope/);
  }
});

test('a real 59-file source diff cannot be labelled as the otherwise valid historical 58-file receipt', async () => {
  const runtimeRoot = await fs.realpath(os.tmpdir()), difference = Buffer.from('bound metadata recovery fixture');
  const original = {...plan(JAPAN_STABILITY_METADATA_CODE_PATHS), version: 1, market: 'china',
    runtimeSha: '1'.repeat(40), runtimeTree: '2'.repeat(40),
    runtimeDiffSha256: createHash('sha256').update(difference).digest('hex')};
  const execute = async (file, args) => {
    assert.equal(file, '/usr/bin/git');
    if (args.includes('--show-toplevel')) return runtimeRoot;
    if (args.includes('HEAD^{tree}')) return original.runtimeTree;
    if (args[1] === 'rev-parse' && args[2] === 'HEAD') return original.runtimeSha;
    if (args.includes('--name-only')) return original.runtimeFiles.join('\0') + '\0';
    if (args.includes('--binary')) return difference;
    assert(args.includes('--quiet') || args.includes('--is-ancestor')); return Buffer.alloc(0);
  };
  const proof = await verifyChinaImageRuntime({runtimeRoot, plan: original, execute});
  assert.equal(proof.runtimeFiles.length, 59); assert.equal(proof.acceptancePolicy, JAPAN_OBSERVED_TIMING_POLICY);
  const historical = {...original, runtimeFiles: [...JAPAN_STABILITY_HOME_CODE_PATHS]};
  assert(isExactJapanStabilityScope(historical));
  await assert.rejects(verifyChinaImageRuntime({runtimeRoot, plan: historical, execute}), /china_image_runtime_scope/);
  for (const patch of [{runtimeTree: '3'.repeat(40)}, {runtimeDiffSha256: '4'.repeat(64)},
    {acceptancePolicy: 'observe'}, {runtimeFiles: [...original.runtimeFiles, original.runtimeFiles[0]]}])
    await assert.rejects(verifyChinaImageRuntime({runtimeRoot, plan: {...original, ...patch}, execute}));
});

test('the real host image selector matches both exact successor sets and preserves truthful timing policy', () => {
  const program = String.raw`
import importlib.util,json
s=importlib.util.spec_from_file_location('host','scripts/catalog-next/release-host.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
profiles=[m.JAPAN_STABILITY_HOME_CODE_FILES,m.JAPAN_STABILITY_METADATA_CODE_FILES]
for profile in profiles:
 assert m.checked_japan_stability_image_files(sorted(profile),True)==profile
new=sorted(m.JAPAN_STABILITY_METADATA_CODE_FILES)
invalid=[[name for name in new if name!=missing] for missing in m.JAPAN_STABILITY_HOME_CODE_FILES]
invalid += [new+['tests/unreviewed.test.ts'],new+[new[0]],[],None,new[:-1]+[None]]
for files in invalid:
 try:m.checked_japan_stability_image_files(files,True)
 except m.ReleaseError as e:assert str(e)=='china_host_code_image_receipt',str(e)
 else:raise AssertionError('invalid image profile accepted')
for profile in profiles:
 for policy in (None,'observe',False):
  plan={'mode':'code-update','codeScope':m.JAPAN_STABILITY_CODE_SCOPE,'acceptancePolicy':policy}
  try:m.checked_japan_stability_image_files(sorted(profile),m.japan_observed_timing(plan))
  except m.ReleaseError as e:assert str(e)=='china_host_timing_policy_image_scope',str(e)
  else:raise AssertionError('wrong timing policy accepted')
for profile in (m.JAPAN_STABILITY_CODE_FILES,m.JAPAN_STABILITY_UI_CODE_FILES,m.JAPAN_STABILITY_POWER_CODE_FILES,m.JAPAN_STABILITY_RAILS_CODE_FILES):
 assert m.checked_japan_stability_image_files(sorted(profile),False)==profile
 try:m.checked_japan_stability_image_files(sorted(profile),True)
 except m.ReleaseError as e:assert str(e)=='china_host_timing_policy_image_scope',str(e)
 else:raise AssertionError('historical policy weakened')
timing={'timingPolicy':m.JAPAN_OBSERVED_TIMING_POLICY,'speedGateRequired':False,'speedPassed':None,'timingObserved':True}
assert m.observed_timing_fields(timing)
assert not m.observed_timing_fields({**timing,'speedPassed':True})
assert not m.observed_timing_fields({**timing,'speedGateRequired':True})
print(json.dumps({'home':sorted(profiles[0]),'metadata':sorted(profiles[1]),'policy':m.JAPAN_OBSERVED_TIMING_POLICY}))
`;
  const result = spawnSync('python3', ['-I', '-B', '-c', program], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {home: [...JAPAN_STABILITY_HOME_CODE_PATHS],
    metadata: [...JAPAN_STABILITY_METADATA_CODE_PATHS], policy: JAPAN_OBSERVED_TIMING_POLICY});
});
