import assert from 'node:assert/strict';
import test from 'node:test';
import {retainedRepairMarketCounts} from '../scripts/lib/catalog-repair-market-counts.mjs';
test('empty local aliases do not manufacture immutable Japan presence',()=>{
 assert.deepEqual(retainedRepairMarketCounts({markets:{korea:{count:3},china:{count:2}}},
  {korea:3,china:2,japan:0,georgia:0}),{korea:3,china:2});
});
test('manifest-present empty markets remain invalid even with an empty alias',()=>{
 assert.throws(()=>retainedRepairMarketCounts({markets:{japan:{count:0}}},{japan:0}),/count_mismatch/);
 assert.throws(()=>retainedRepairMarketCounts({markets:{georgia:{count:0}}},{georgia:0}),/count_mismatch/);
});
test('missing, changed or unexpected local inventory cannot use the external-source exception',()=>{
 const manifest={markets:{korea:{count:3}}};
 for(const actual of [{},{korea:2},{korea:4},{korea:3,japan:1}])
  assert.throws(()=>retainedRepairMarketCounts(manifest,actual),/count_mismatch|unexpected_local_market/);
});
