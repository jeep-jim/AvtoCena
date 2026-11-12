import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogStorageBudget} from '../scripts/lib/catalog-storage-budget.mjs';
test('storage reserve includes current bucket, projected copies and 20% headroom',()=>{
 assert.equal(catalogStorageBudget(28_000_000_000,100_000_000).ok,true);
 assert.equal(catalogStorageBudget(994_000_000_000,100_000_000).ok,false);
 assert.equal(catalogStorageBudget(968_000_000_000,4_000_000_000).ok,false);
 assert.throws(()=>catalogStorageBudget(NaN,0));
});

test('approved 1000 GB budget admits Europe recovery but still protects the reserve',()=>{
 const recovery=catalogStorageBudget(39_632_020_579,1_071_531_439);
 assert.equal(recovery.ok,true);assert.equal(recovery.headroomBytes,200_000_000_000);
 assert.equal(recovery.limitBytes,1_000_000_000_000);
 assert.equal(catalogStorageBudget(987_000_000_000,1_071_531_439).ok,false);
});

test('a staged refresh must fit without consuming the 20 percent free reserve',()=>{
 const allowed=catalogStorageBudget(760_000_000_000,4_000_000_000);
 assert.equal(allowed.estimatedAdditionalBytes,32_000_000_000);
 assert.equal(allowed.ok,true);
 assert.equal(catalogStorageBudget(768_000_000_000,4_000_000_000).ok,false);
 assert.equal(catalogStorageBudget(799_000_000_000,0).ok,false);
});
