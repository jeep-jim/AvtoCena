import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import * as scope from '../scripts/catalog-next/japan-stability-code-scope.mjs';
import {checkedCatalogCodeScope} from '../scripts/catalog-next/photo-code-scope.mjs';

const plan=()=>({codeScope:scope.JAPAN_STABILITY_CODE_SCOPE,
  retainedRuntime:scope.JAPAN_STABILITY_EXACT_COUNT_RETAINED_RUNTIME,
  runtimeFiles:[...scope.JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS],
  acceptancePolicy:scope.JAPAN_OBSERVED_TIMING_POLICY});

test('exact total successor retains accepted20fd and requires every preceding Japan functional gate',()=>{
  assert.equal(plan().retainedRuntime,'20fd18d12b3f5c7aabef860e1b53da0d505dfd64');
  assert.equal(checkedCatalogCodeScope(plan()),scope.JAPAN_STABILITY_CODE_SCOPE);
  for(const check of [scope.isExactJapanStabilityScope,scope.japanExactCountRequired,scope.japanPriceSortRequired,
    scope.japanPowerOrderRequired,scope.japanSourceNamesRequired,scope.japanBrandDirectoryRequired,scope.japanObservedTimingRequired])
    assert.equal(check(plan()),true);
  assert.deepEqual(scope.japanStabilityCompatibilityPaths(plan()),[...new Set([
    ...scope.JAPAN_STABILITY_METADATA_CODE_PATHS,...scope.JAPAN_STABILITY_PRICE_SORT_CODE_PATHS,...plan().runtimeFiles])].sort());
});

test('a missing source, protected addition, foreign retained image or latency policy cannot enter the exact-count profile',()=>{
  for(const bad of [
    ...plan().runtimeFiles.map(file=>({...plan(),runtimeFiles:plan().runtimeFiles.filter(name=>name!==file)})),
    {...plan(),runtimeFiles:[...plan().runtimeFiles,'packages/engine/src/calculation/russiaCustomsV2.ts']},
    {...plan(),runtimeFiles:[...plan().runtimeFiles,plan().runtimeFiles[0]]},
    {...plan(),retainedRuntime:scope.JAPAN_STABILITY_PRICE_SORT_RETAINED_RUNTIME},
    {...plan(),retainedRuntime:scope.JAPAN_STABILITY_RETAINED_RUNTIME},
    {...plan(),acceptancePolicy:undefined},
  ])assert.throws(()=>checkedCatalogCodeScope(bad));
});

test('historical loaded-count proof cannot acquire exact-count acceptance by changing its label',()=>{
  const old={...plan(),runtimeFiles:[...scope.JAPAN_STABILITY_PRICE_SORT_CODE_PATHS],
    retainedRuntime:scope.JAPAN_STABILITY_PRICE_SORT_RETAINED_RUNTIME};
  assert.equal(scope.japanExactCountRequired(old),false);
  assert.equal(scope.japanPriceSortRequired(old),true);
  assert.throws(()=>checkedCatalogCodeScope({...old,retainedRuntime:plan().retainedRuntime}));
  assert.equal(scope.japanExactCountRequired({codeScope:'other'}),false);
});

test('host admission binds the identical exact delta to20fd and rejects historical cross-pairing',()=>{
  const result=spawnSync('python3',['-I','-B','-c',String.raw`
import importlib.util,json
s=importlib.util.spec_from_file_location('host','scripts/catalog-next/release-host.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
new=m.JAPAN_STABILITY_EXACT_COUNT_CODE_FILES
assert m.checked_japan_stability_image_files(sorted(new),True,m.JAPAN_STABILITY_EXACT_COUNT_RETAINED)==new
for files,observed,retained in [(new,True,m.JAPAN_STABILITY_PRICE_SORT_RETAINED),
 (new,False,m.JAPAN_STABILITY_EXACT_COUNT_RETAINED),
 (m.JAPAN_STABILITY_PRICE_SORT_CODE_FILES,True,m.JAPAN_STABILITY_EXACT_COUNT_RETAINED)]:
 try:m.checked_japan_stability_image_files(sorted(files),observed,retained)
 except m.ReleaseError:pass
 else:raise AssertionError('cross-paired image accepted')
print(json.dumps(sorted(new)))
`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),[...plan().runtimeFiles].sort());
});

test('mandatory workflows bind exact fixture reports to candidate bytes',()=>{
  for(const file of ['verify-china-photo-code.yml','catalog-next-china-photo-release.yml','verify-japan-exact-count-candidate.yml']){
    const text=readFileSync('.github/workflows/'+file,'utf8');
    assert.match(text,/exact_count_required=' \+ japanExactCountRequired\(plan\)/);
    assert.match(text,/price_sort_required == 'true' && steps\.photo_scope\.outputs\.exact_count_required != 'true'/);
    assert.match(text,/model_coverage_required=' \+ japanSourceBoundedIncrementalRequired\(plan\)/);
    assert.match(text,/if: steps\.photo_scope\.outputs\.exact_count_required == 'true' \|\| steps\.photo_scope\.outputs\.model_coverage_required == 'true'/);
    assert.match(text,/requireLiteralFamily: japanLiteralFamilyRequired\(plan\)/);
    assert.match(text,/node --import tsx \"\$GITHUB_WORKSPACE\/tests\/browser\/ajes-pagination\.mjs\"/);
    assert.match(text,/@opentelemetry\/api@1\.9\.1/);
    assert.match(text,/node tests\/browser\/japan-exact-count\.mjs/);
    assert.match(text,/checkedJapanExactCountBrowserFixture\(/);
    assert.match(text,/checkedJapanModelCoverageBrowserFixture\(report,expected\)/);
    assert.match(text,/runtimeSha:plan\.runtimeSha,runtimeTree:plan\.runtimeTree,helperSha256/);
  }
});

test('isolated review workflow requires the new profile and cannot build or activate the app',()=>{
  const text=readFileSync('.github/workflows/verify-japan-exact-count-candidate.yml','utf8');
  assert.match(text,/branches: \[fix\/japan-exact-count-controller-20261128\]/);
  assert.match(text,/japanExactCountRequired\(plan\) !== true && japanSourceBoundedIncrementalRequired\(plan\) !== true\) throw Error\('japan_exact_candidate_scope_required'\)/);
  assert.match(text,/permissions:\n  contents: read/);
  assert.doesNotMatch(text,/\$\{\{\s*secrets\.|environment: regcloud|code-entry\.mjs --(?:build|run)\b/);
});
