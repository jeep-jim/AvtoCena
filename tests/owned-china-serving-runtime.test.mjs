import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkedChinaServingRelease, chinaCountRelease, chinaFilterRelease, koreaHistoryRelease, koreaCatalogPageRelease,
  chinaServingCalculation, retainedChinaRelease,
} from '../scripts/lib/owned-china-serving-runtime.mjs';

const health = releaseSha => ({ok:true,service:'avtocena-web',calculationVersion:chinaServingCalculation,releaseSha});

test('the public cut uses only a reviewed runtime that implements the verified power filter', () => {
  for (const release of [chinaFilterRelease,chinaCountRelease,koreaHistoryRelease,koreaCatalogPageRelease]) {
    assert.equal(checkedChinaServingRelease(health(release)),release);
    assert.equal(checkedChinaServingRelease(health(release),{privateStage:true}),release);
  }
  assert.throws(() => checkedChinaServingRelease(health(retainedChinaRelease)));
  assert.equal(checkedChinaServingRelease(health(retainedChinaRelease),{privateStage:true}),retainedChinaRelease);
});

test('a different release, service or calculator cannot prepare or publish a generation', () => {
  const candidate = health(chinaCountRelease);
  for (const invalid of [null, {...candidate,ok:false}, {...candidate,service:'other'},
    {...candidate,releaseSha:'a'.repeat(40)}, {...candidate,calculationVersion:'0'.repeat(64)}]) {
    for (const privateStage of [true,false]) assert.throws(() => checkedChinaServingRelease(invalid,{privateStage}));
  }
});
