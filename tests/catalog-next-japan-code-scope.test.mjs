import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {checkedCatalogCodeScope, CHINA_PHOTO_CODE_PATHS, CHINA_PHOTO_JAPAN_CODE_PATHS,
  JAPAN_RECOVERY_CODE_PATHS, JAPAN_RECOVERY_RETAINED_RUNTIME} from '../scripts/catalog-next/photo-code-scope.mjs';

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
