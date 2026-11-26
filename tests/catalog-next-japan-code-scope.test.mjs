import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {checkedCatalogCodeScope, CHINA_PHOTO_CODE_PATHS, CHINA_PHOTO_JAPAN_CODE_PATHS,
  JAPAN_RECOVERY_CODE_PATHS, JAPAN_RECOVERY_RETAINED_RUNTIME,
  JAPAN_COMPLETION_CODE_PATHS, JAPAN_COMPLETION_RETAINED_RUNTIME,
  JAPAN_COMPLETION_V2_CODE_PATHS, JAPAN_COMPLETION_V2_RETAINED_RUNTIME,
  JAPAN_USABILITY_CODE_PATHS, JAPAN_USABILITY_RETAINED_RUNTIME} from '../scripts/catalog-next/photo-code-scope.mjs';

const digest = files => createHash('sha256').update(JSON.stringify(files)).digest('hex');
const japanPlan = () => ({codeScope: 'catalog-japan-recovery-v1',
  retainedRuntime: 'd536c1547c4d82a339ed68ced7d8503f09b6810b', runtimeFiles: [...JAPAN_RECOVERY_CODE_PATHS]});

test('both older photo scopes retain their exact reviewed file lists', () => {
  for (const [scope, files, length, hash] of [
    ['catalog-photo-recovery-v1', CHINA_PHOTO_CODE_PATHS, 6, '5b85f8950325e254566907c0681d1235a2ce43c9a24228223a16a89b69b6dd06'],
    ['catalog-photo-japan-power-v1', CHINA_PHOTO_JAPAN_CODE_PATHS, 27, '20cfa2393d5a9c9aa529cffc13ab9efc343873cdb43e57a4c15f960bb5772d04'],
  ]) {
    assert.equal(files.length, length); assert.equal(digest(files), hash); assert.ok(Object.isFrozen(files));
    assert.equal(checkedCatalogCodeScope({codeScope: scope, runtimeFiles: [...files]}), scope);
  }
  assert.equal(checkedCatalogCodeScope({runtimeFiles: [...CHINA_PHOTO_CODE_PATHS]}), 'catalog-photo-recovery-v1');
});

test('Japan recovery is exactly the reviewed 37-file delta from accepted d536', () => {
  assert.equal(JAPAN_RECOVERY_RETAINED_RUNTIME, 'd536c1547c4d82a339ed68ced7d8503f09b6810b');
  assert.equal(JAPAN_RECOVERY_CODE_PATHS.length, 37); assert.ok(Object.isFrozen(JAPAN_RECOVERY_CODE_PATHS));
  assert.equal(new Set(JAPAN_RECOVERY_CODE_PATHS).size, 37);
  assert.equal(JAPAN_RECOVERY_CODE_PATHS.filter(name => name.startsWith('apps/web/')).length, 18);
  assert.equal(JAPAN_RECOVERY_CODE_PATHS.filter(name => name.startsWith('tests/')).length, 19);
  assert.equal(digest(JAPAN_RECOVERY_CODE_PATHS), 'bd05b9baf6280a5c84ec52c91aa2d6c1a21dbbdf21ad9642b8c6cce55fe17fb0');
  assert.equal(checkedCatalogCodeScope(japanPlan()), 'catalog-japan-recovery-v1');
  assert.equal(checkedCatalogCodeScope({...japanPlan(), runtimeFiles: [...JAPAN_RECOVERY_CODE_PATHS].reverse()}), 'catalog-japan-recovery-v1');
});

test('Japan cannot relabel an older delta, omit a path, repeat a path or add another change', () => {
  const original = japanPlan();
  const variants = [CHINA_PHOTO_CODE_PATHS, CHINA_PHOTO_JAPAN_CODE_PATHS,
    original.runtimeFiles.slice(1), [...original.runtimeFiles, 'apps/web/lib/catalog/rates.ts'],
    [...original.runtimeFiles.slice(1), original.runtimeFiles[1]],
    [...original.runtimeFiles.slice(1), 'apps/web/components/catalog/CatalogCover.tsx']];
  for (const runtimeFiles of variants) assert.throws(() => checkedCatalogCodeScope({...original, runtimeFiles}), /china_photo_scope_files/);
  for (const codeScope of ['catalog-japan-recovery-v2', 'catalog-photo-recovery-v1', 'catalog-photo-japan-power-v1']) {
    assert.throws(() => checkedCatalogCodeScope({...original, codeScope}), /china_photo_scope_files/);
  }
});

test('Japan recovery refuses a missing or different retained runtime', () => {
  for (const retainedRuntime of [undefined, '', '0'.repeat(40), 'D536c1547c4d82a339ed68ced7d8503f09b6810b']) {
    assert.throws(() => checkedCatalogCodeScope({...japanPlan(), retainedRuntime}), /china_photo_scope_retained_runtime/);
  }
});

const completionPlan=()=>({codeScope:'catalog-japan-completion-v1',retainedRuntime:JAPAN_COMPLETION_RETAINED_RUNTIME,
  runtimeFiles:[...JAPAN_COMPLETION_CODE_PATHS]});
test('Japan completion is exactly the twelve reviewed files from accepted 36c7',()=>{
  assert.equal(JAPAN_COMPLETION_RETAINED_RUNTIME,'36c7ea726e7f070d10dbc65afc6538f13c0c1a24');
  assert.ok(Object.isFrozen(JAPAN_COMPLETION_CODE_PATHS));
  assert.deepEqual([...JAPAN_COMPLETION_CODE_PATHS],[
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
  assert.equal(checkedCatalogCodeScope(completionPlan()),'catalog-japan-completion-v1');
  assert.equal(checkedCatalogCodeScope({...completionPlan(),runtimeFiles:[...JAPAN_COMPLETION_CODE_PATHS].reverse()}),'catalog-japan-completion-v1');
});

test('the completion profile rejects another predecessor, a relabelled scope and any unreviewed file',()=>{
  for(const retainedRuntime of [undefined,'',JAPAN_RECOVERY_RETAINED_RUNTIME,'0'.repeat(40)])
    assert.throws(()=>checkedCatalogCodeScope({...completionPlan(),retainedRuntime}),/china_photo_scope_retained_runtime/);
  for(const runtimeFiles of [JAPAN_RECOVERY_CODE_PATHS,CHINA_PHOTO_CODE_PATHS,
    JAPAN_COMPLETION_CODE_PATHS.slice(1),[...JAPAN_COMPLETION_CODE_PATHS,'apps/web/lib/catalog/customs-pricing.ts'],
    [...JAPAN_COMPLETION_CODE_PATHS.slice(1),JAPAN_COMPLETION_CODE_PATHS[1]]])
    assert.throws(()=>checkedCatalogCodeScope({...completionPlan(),runtimeFiles}),/china_photo_scope_files/);
  for(const codeScope of ['catalog-japan-recovery-v1','catalog-photo-recovery-v1','catalog-photo-japan-power-v1','catalog-japan-completion-v2'])
    assert.throws(()=>checkedCatalogCodeScope({...completionPlan(),codeScope}),/china_photo_scope_files/);
});

const completionV2Plan=()=>({codeScope:'catalog-japan-completion-v2',retainedRuntime:JAPAN_COMPLETION_V2_RETAINED_RUNTIME,
  runtimeFiles:[...JAPAN_COMPLETION_V2_CODE_PATHS]});
test('completion v2 adds only the reviewed empty-page proof to the same accepted 36c7 base',()=>{
  assert.equal(JAPAN_COMPLETION_V2_RETAINED_RUNTIME,'36c7ea726e7f070d10dbc65afc6538f13c0c1a24');
  assert.ok(Object.isFrozen(JAPAN_COMPLETION_V2_CODE_PATHS));
  assert.equal(JAPAN_COMPLETION_V2_CODE_PATHS.length,19);
  assert.equal(new Set(JAPAN_COMPLETION_V2_CODE_PATHS).size,19);
  assert.deepEqual([...JAPAN_COMPLETION_V2_CODE_PATHS],[...JAPAN_COMPLETION_CODE_PATHS,
    'apps/web/lib/catalog/ajes-client.ts',
    'apps/web/lib/catalog/ajes-public.ts',
    'apps/web/lib/catalog/detail-read-cache.ts',
    'tests/ajes-empty-page-validation.test.ts',
    'tests/ajes-prepared-admission.test.ts',
    'tests/ajes-recovery-isolation.test.ts',
    'tests/ajes-list-admission.test.ts',
  ]);
  assert.equal(checkedCatalogCodeScope(completionV2Plan()),'catalog-japan-completion-v2');
  assert.equal(checkedCatalogCodeScope({...completionV2Plan(),runtimeFiles:[...JAPAN_COMPLETION_V2_CODE_PATHS].reverse()}),
    'catalog-japan-completion-v2');
});

test('completion v2 cannot adopt the rejected runtime or relabel either exact completion delta',()=>{
  for(const retainedRuntime of [undefined,'',JAPAN_RECOVERY_RETAINED_RUNTIME,'8cc5f755f0792c0dcd5517ec2df3295d5c0b2b1a','0'.repeat(40)])
    assert.throws(()=>checkedCatalogCodeScope({...completionV2Plan(),retainedRuntime}),/china_photo_scope_retained_runtime/);
  for(const runtimeFiles of [JAPAN_COMPLETION_CODE_PATHS,JAPAN_RECOVERY_CODE_PATHS,
    JAPAN_COMPLETION_V2_CODE_PATHS.slice(1),[...JAPAN_COMPLETION_V2_CODE_PATHS,'apps/web/lib/catalog/ajes-query-cache.ts'],
    [...JAPAN_COMPLETION_V2_CODE_PATHS.slice(1),JAPAN_COMPLETION_V2_CODE_PATHS[1]]])
    assert.throws(()=>checkedCatalogCodeScope({...completionV2Plan(),runtimeFiles}),/china_photo_scope_files/);
  for(const codeScope of ['catalog-japan-completion-v1','catalog-japan-recovery-v1','catalog-photo-recovery-v1',
    'catalog-photo-japan-power-v1','catalog-japan-completion-v3'])
    assert.throws(()=>checkedCatalogCodeScope({...completionV2Plan(),codeScope}),/china_photo_scope_files/);
});


const usabilityPlan=()=>({codeScope:'catalog-japan-usability-v1',retainedRuntime:JAPAN_USABILITY_RETAINED_RUNTIME,
 runtimeFiles:[...JAPAN_USABILITY_CODE_PATHS]});
test('Japan usability starts from accepted077 and requires its complete frozen file set',()=>{
 assert.equal(JAPAN_USABILITY_RETAINED_RUNTIME,'077cbb17626ab0c64e7f06db055fef9252ad21c0');
 assert.ok(Object.isFrozen(JAPAN_USABILITY_CODE_PATHS));
 assert.equal(JAPAN_USABILITY_CODE_PATHS.length,36);
 assert.equal(digest(JAPAN_USABILITY_CODE_PATHS),'061929d08155ac4cf49b209d117ba34be44e8723fe9d80b2be80e80bf3bb9ede');
 assert.equal(new Set(JAPAN_USABILITY_CODE_PATHS).size,JAPAN_USABILITY_CODE_PATHS.length);
 assert.equal(checkedCatalogCodeScope(usabilityPlan()),'catalog-japan-usability-v1');
 assert.equal(checkedCatalogCodeScope({...usabilityPlan(),runtimeFiles:[...JAPAN_USABILITY_CODE_PATHS].reverse()}),'catalog-japan-usability-v1');
});

test('usability cannot reuse rejected or older predecessors, partial paths or an unrelated modification',()=>{
 for(const retainedRuntime of [undefined,'',JAPAN_COMPLETION_V2_RETAINED_RUNTIME,JAPAN_RECOVERY_RETAINED_RUNTIME,
  '8cc5f755f0792c0dcd5517ec2df3295d5c0b2b1a','0'.repeat(40)])
  assert.throws(()=>checkedCatalogCodeScope({...usabilityPlan(),retainedRuntime}),/china_photo_scope_retained_runtime/);
 for(const runtimeFiles of [JAPAN_COMPLETION_V2_CODE_PATHS,JAPAN_RECOVERY_CODE_PATHS,
  JAPAN_USABILITY_CODE_PATHS.slice(1),[...JAPAN_USABILITY_CODE_PATHS,'apps/web/lib/catalog/customs-pricing.ts'],
  [...JAPAN_USABILITY_CODE_PATHS.slice(1),JAPAN_USABILITY_CODE_PATHS[1]]])
  assert.throws(()=>checkedCatalogCodeScope({...usabilityPlan(),runtimeFiles}),/china_photo_scope_files/);
 for(const codeScope of ['catalog-japan-completion-v2','catalog-japan-completion-v1','catalog-japan-recovery-v1',
  'catalog-photo-recovery-v1','catalog-photo-japan-power-v1','catalog-japan-usability-v2'])
  assert.throws(()=>checkedCatalogCodeScope({...usabilityPlan(),codeScope}),/china_photo_scope_files/);
});
