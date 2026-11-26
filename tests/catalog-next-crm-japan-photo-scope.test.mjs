import test from 'node:test';
import assert from 'node:assert/strict';
import {CRM_CHINA_CODE_SCOPE, CRM_CHINA_CODE_PATHS, isExactCrmChinaScope}
  from '../scripts/catalog-next/crm-china-code-scope.mjs';
import {CRM_JAPAN_PHOTO_CODE_SCOPE, CRM_JAPAN_PHOTO_CODE_PATHS, CRM_JAPAN_PHOTO_RETAINED_RUNTIME,
  isExactCrmJapanPhotoScope} from '../scripts/catalog-next/crm-japan-photo-code-scope.mjs';

const plan = () => ({codeScope: CRM_JAPAN_PHOTO_CODE_SCOPE, retainedRuntime: CRM_JAPAN_PHOTO_RETAINED_RUNTIME,
  runtimeFiles: [...CRM_JAPAN_PHOTO_CODE_PATHS]});
const photo = ['apps/web/components/catalog/protected-photo-retry.ts', 'tests/catalog-photo-retry.test.ts',
  'tests/browser/catalog-photo-retry-fixture.tsx', 'tests/browser/catalog-photo-retry.mjs'];

test('combined CRM and photo retry profile is the exact reviewed ten-file successor of 077', () => {
  assert.equal(CRM_JAPAN_PHOTO_CODE_SCOPE, 'catalog-crm-japan-photo-retry-v1');
  assert.equal(CRM_JAPAN_PHOTO_RETAINED_RUNTIME, '077cbb17626ab0c64e7f06db055fef9252ad21c0');
  assert.equal(CRM_CHINA_CODE_PATHS.length, 6);
  assert.equal(CRM_JAPAN_PHOTO_CODE_PATHS.length, 10);
  assert(Object.isFrozen(CRM_JAPAN_PHOTO_CODE_PATHS));
  assert.deepEqual([...CRM_JAPAN_PHOTO_CODE_PATHS].sort(), [...CRM_CHINA_CODE_PATHS, ...photo].sort());
  assert(isExactCrmJapanPhotoScope(plan()));
  assert(isExactCrmJapanPhotoScope({...plan(), runtimeFiles: plan().runtimeFiles.reverse()}));
});

test('every required photo or CRM path is mandatory and duplicates cannot replace one', () => {
  for (const missing of CRM_JAPAN_PHOTO_CODE_PATHS) {
    const runtimeFiles = plan().runtimeFiles.filter(name => name !== missing);
    assert.equal(isExactCrmJapanPhotoScope({...plan(), runtimeFiles}), false, missing);
    assert.equal(isExactCrmJapanPhotoScope({...plan(), runtimeFiles: [...runtimeFiles, runtimeFiles[0]]}), false, missing);
  }
  assert.equal(isExactCrmJapanPhotoScope({...plan(), runtimeFiles: [...plan().runtimeFiles, photo[0]]}), false);
});

test('old CRM profile remains six-only and cannot label the combined delta', () => {
  const old = {codeScope: CRM_CHINA_CODE_SCOPE, retainedRuntime: CRM_JAPAN_PHOTO_RETAINED_RUNTIME,
    runtimeFiles: [...CRM_CHINA_CODE_PATHS]};
  assert(isExactCrmChinaScope(old));
  assert.equal(isExactCrmChinaScope({...old, runtimeFiles: [...CRM_JAPAN_PHOTO_CODE_PATHS]}), false);
  assert.equal(isExactCrmJapanPhotoScope({...plan(), codeScope: CRM_CHINA_CODE_SCOPE}), false);
  assert.equal(isExactCrmJapanPhotoScope(old), false);
});

test('wrong predecessors, missing profiles and malformed file lists fail closed', () => {
  for (const retainedRuntime of [undefined, '', '36c7ea726e7f070d10dbc65afc6538f13c0c1a24',
    '1e289ae2cbf148af1167f51022084bb39c3c639a', 'b25a95122199378afc5166ed7ac8882a84ed9fe3']) {
    assert.equal(isExactCrmJapanPhotoScope({...plan(), retainedRuntime}), false);
  }
  for (const value of [undefined, null, {}, {...plan(), codeScope: undefined}, {...plan(), runtimeFiles: null},
    {...plan(), runtimeFiles: {length: 10}}, {...plan(), runtimeFiles: 'ten files'}]) {
    assert.equal(isExactCrmJapanPhotoScope(value), false);
  }
});

test('unaccepted Japan query, cursor, source and pricing changes are not added or substituted', () => {
  for (const extra of ['apps/web/lib/catalog/ajes-query.ts', 'apps/web/lib/catalog/ajes-client.ts',
    'apps/web/lib/catalog/ajes-power-page.ts', 'apps/web/lib/catalog/japan-power-query.ts',
    'apps/web/lib/catalog/live-business-pricing.ts', 'packages/engine/src/index.ts']) {
    assert(!CRM_JAPAN_PHOTO_CODE_PATHS.includes(extra));
    assert.equal(isExactCrmJapanPhotoScope({...plan(), runtimeFiles: [...plan().runtimeFiles, extra]}), false);
    assert.equal(isExactCrmJapanPhotoScope({...plan(), runtimeFiles: [...plan().runtimeFiles.slice(1), extra]}), false);
  }
});
