import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogStorageBudget} from '../scripts/lib/catalog-storage-budget.mjs';
test('storage reserve includes current bucket, projected copies and 5 GB headroom',()=>{
 assert.equal(catalogStorageBudget(28_000_000_000,100_000_000).ok,true);
 assert.equal(catalogStorageBudget(44_000_000_000,100_000_000).ok,false);
 assert.equal(catalogStorageBudget(28_000_000_000,3_000_000_000).ok,false);
 assert.throws(()=>catalogStorageBudget(NaN,0));
});
