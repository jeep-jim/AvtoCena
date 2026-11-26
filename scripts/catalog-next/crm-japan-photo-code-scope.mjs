import {CRM_CHINA_CODE_PATHS, CRM_CHINA_RETAINED_RUNTIME} from './crm-china-code-scope.mjs';

// A separate successor of accepted 077. The immutable six-file CRM profile
// retains its own boundary; no unaccepted Japan query or pricing path is added.
export const CRM_JAPAN_PHOTO_CODE_SCOPE = 'catalog-crm-japan-photo-retry-v1';
export const CRM_JAPAN_PHOTO_RETAINED_RUNTIME = CRM_CHINA_RETAINED_RUNTIME;
export const CRM_JAPAN_PHOTO_CODE_PATHS = Object.freeze([
  ...CRM_CHINA_CODE_PATHS,
  'apps/web/components/catalog/protected-photo-retry.ts',
  'tests/catalog-photo-retry.test.ts',
  'tests/browser/catalog-photo-retry-fixture.tsx',
  'tests/browser/catalog-photo-retry.mjs',
]);

export function isExactCrmJapanPhotoScope(plan) {
  return plan?.codeScope === CRM_JAPAN_PHOTO_CODE_SCOPE
    && plan.retainedRuntime === CRM_JAPAN_PHOTO_RETAINED_RUNTIME
    && Array.isArray(plan.runtimeFiles) && plan.runtimeFiles.length === CRM_JAPAN_PHOTO_CODE_PATHS.length
    && new Set(plan.runtimeFiles).size === plan.runtimeFiles.length
    && CRM_JAPAN_PHOTO_CODE_PATHS.every(name => plan.runtimeFiles.includes(name));
}
