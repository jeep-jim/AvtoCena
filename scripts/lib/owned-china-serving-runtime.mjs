import assert from 'node:assert/strict';

export const retainedChinaRelease = '22867cbcfaee27b2e8917b6bf880e44827f67b60';
export const chinaFilterRelease = '0509e76cb02523157c98804c52edd7eb784916ba';
export const chinaCountRelease = '18e81af30cb9187b139924217a777de1c9819bca';
export const koreaHistoryRelease = 'b4d226491bcfa03eca73d72480ff3bd867d3c6fb';
export const chinaServingCalculation = '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90';

export function checkedChinaServingRelease(health, {privateStage = false} = {}) {
  const release = health?.releaseSha;
  const supported = release === chinaFilterRelease || release === chinaCountRelease || release === koreaHistoryRelease
    || (privateStage && release === retainedChinaRelease);
  assert(health?.ok === true && health.service === 'avtocena-web' && supported
    && health.calculationVersion === chinaServingCalculation, 'serving released calculator changed');
  return release;
}
