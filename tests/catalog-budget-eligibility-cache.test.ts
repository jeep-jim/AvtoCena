import test from 'node:test';
import assert from 'node:assert/strict';
import {BudgetEligibilityCache} from '../apps/web/lib/catalog/budget-eligibility-cache';
import {catalogInventoryAgeDecision} from '../apps/web/lib/catalog/inventory-admission';

test('immutable eligibility expires on day/editorial changes and never crosses index identity',async()=>{
 const row:any=['korea',1,null,null,false,{id:'car',year:2020,inventorySourceDate:'2020-10-12',block:0}];
 const index:any={generationId:'g',rows:[row],otherRows:[]};
 const cache=new BudgetEligibilityCache();let calls=0;
 const predicate=(day:string,hidden=false)=>(r:any)=>{calls++;return !hidden&&catalogInventoryAgeDecision({...r[5],market:r[0]},new Date(day+'T00:00:00Z')).eligible;};
 assert.equal((await cache.get(index,'r1:2026-10-12',predicate('2026-10-12'))).has('car'),true);
 await cache.get(index,'r1:2026-10-12',predicate('2026-10-12'));assert.equal(calls,1);
 assert.equal((await cache.get(index,'r1:2026-10-13',predicate('2026-10-13'))).has('car'),false);
 assert.equal((await cache.get(index,'r2:2026-10-12',predicate('2026-10-12',true))).has('car'),false);
 assert.equal((await cache.get({...index},'r2:2026-10-12',predicate('2026-10-12'))).has('car'),true);
 cache.clear();await cache.get(index,'r2:2026-10-12',predicate('2026-10-12'));assert.equal(calls,5);
});
