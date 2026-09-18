import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planJapanDromRetirement,assertExactRetirementPreservation,hashRetirementRows} from '../scripts/lib/japan-drom-retirement.mjs';
import {assertNoDeliveredPriceRegression} from '../apps/web/lib/catalog/publication-price-preservation';
const old:any={id:'old',market:'japan',sourceId:'drom_japan_stat'};
const fresh:any={id:'new',market:'japan',sourceId:'proauctions_japan_stat',sourcePrice:1200000,images:[{url:'a'},{url:'b'}]};
test('retirement removes only Drom, requires ProAuctions, and records each permitted removal',()=>{
 const input=[old,fresh],before=JSON.stringify(input),p=planJapanDromRetirement(input);
 assert.deepEqual(p.kept,[fresh]);assert.deepEqual(p.removed,[old]);assert.equal(JSON.stringify(input),before);
 assert.doesNotThrow(()=>assertNoDeliveredPriceRegression(input,p.kept,{auditedRemovals:p.removals}));
 assert.throws(()=>planJapanDromRetirement([old]),/replacement_required/);
 assert.throws(()=>planJapanDromRetirement([{...old,market:'korea'},fresh]),/japan_only/);
});
test('retirement refuses any unrelated deletion, price or photo change and Drom resurrection',()=>{
 const other:any={id:'korea',market:'korea',sourceId:'encar_direct',sourcePrice:200};const expected=[fresh,other];
 assert.doesNotThrow(()=>assertExactRetirementPreservation(expected,[other,fresh]));
 for(const actual of [[fresh],[{...fresh,sourcePrice:1},other],[{...fresh,images:[]},other],[fresh,other,old]])assert.throws(()=>assertExactRetirementPreservation(expected,actual));
});
test('retirement hash preserves the canonical array digest without one giant JSON string',()=>{
 const rows=Array.from({length:1000},(_,index)=>({id:String(999-index).padStart(4,'0'),market:'japan',sourceId:'proauctions_japan_stat',raw:'x'.repeat(4096)}));
 const canonical=JSON.stringify([...rows].sort((a,b)=>a.id.localeCompare(b.id)));
 assert.equal(hashRetirementRows(rows),createHash('sha256').update(canonical).digest('hex'));
});
