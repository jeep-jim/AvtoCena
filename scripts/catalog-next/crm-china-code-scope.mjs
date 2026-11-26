// A distinct app-only successor of accepted 077. This profile grants no path
// from the unaccepted Japan usability candidate and no general CRM exception.
export const CRM_CHINA_CODE_SCOPE = 'catalog-crm-china-operations-v1';
export const CRM_CHINA_RETAINED_RUNTIME = '077cbb17626ab0c64e7f06db055fef9252ad21c0';
export const CRM_CHINA_CODE_PATHS = Object.freeze([
  'apps/web/app/(crm)/api/crm/china-catalog-status/route.ts',
  'apps/web/components/site/CollectionControls.tsx',
  'apps/web/lib/catalog/china-catalog-status.ts',
  'apps/web/lib/catalog/collection-controls-schema.ts',
  'tests/browser/collection-controls.mjs',
  'tests/china-catalog-status.test.ts',
]);
export const CRM_CHINA_PROTECTED_EXCEPTIONS = Object.freeze([
  'apps/web/app/(crm)/api/crm/china-catalog-status/route.ts',
  'apps/web/components/site/CollectionControls.tsx',
]);

export function isExactCrmChinaScope(plan) {
  return plan?.codeScope === CRM_CHINA_CODE_SCOPE && plan.retainedRuntime === CRM_CHINA_RETAINED_RUNTIME
    && Array.isArray(plan.runtimeFiles) && plan.runtimeFiles.length === CRM_CHINA_CODE_PATHS.length
    && new Set(plan.runtimeFiles).size === plan.runtimeFiles.length
    && CRM_CHINA_CODE_PATHS.every(name => plan.runtimeFiles.includes(name));
}
