import test from 'node:test';
import assert from 'node:assert/strict';
import {recentHealthyStorageMaintenance} from '../scripts/lib/catalog-storage-budget.mjs';
test('post-publication housekeeping does not repeatedly take the shared writer lease',()=>{
 const now=Date.parse('2026-09-22T06:00:00Z'),interval=6*3600000;
 const healthy={ok:true,checkedAt:'2026-09-22T05:00:00Z',afterBytes:30_000_000_000};
 assert.equal(recentHealthyStorageMaintenance(healthy,now,interval),true);
 for(const report of [null,{...healthy,ok:false},{...healthy,afterBytes:35_000_000_000},{...healthy,checkedAt:'2026-09-21T00:00:00Z'},{...healthy,checkedAt:'2026-09-23T00:00:00Z'},{...healthy,checkedAt:'invalid'}])assert.equal(recentHealthyStorageMaintenance(report,now,interval),false);
 assert.equal(recentHealthyStorageMaintenance(healthy,now,0),false,'scheduled and explicitly requested maintenance always runs');
});
