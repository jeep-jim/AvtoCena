import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogStorageBudget} from '../scripts/lib/catalog-storage-budget.mjs';
test('storage reserve includes current bucket, projected copies and 5 GB headroom',()=>{
 assert.equal(catalogStorageBudget(28_000_000_000,100_000_000).ok,true);
 assert.equal(catalogStorageBudget(54_000_000_000,100_000_000).ok,false);
 assert.equal(catalogStorageBudget(28_000_000_000,4_000_000_000).ok,false);
 assert.throws(()=>catalogStorageBudget(NaN,0));
});

test('approved 60 GB budget admits Europe recovery but still protects the reserve',()=>{
 const recovery=catalogStorageBudget(39_632_020_579,1_071_531_439);
 assert.equal(recovery.ok,true);assert.equal(recovery.headroomBytes,5_000_000_000);
 assert.equal(recovery.limitBytes,60_000_000_000);
 assert.equal(catalogStorageBudget(47_000_000_000,1_071_531_439).ok,false);
});
