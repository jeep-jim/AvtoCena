import test from 'node:test';
import assert from 'node:assert/strict';
import {filterBudgetRows} from '../apps/web/lib/catalog/budget-selection-filter';

test('large compact selections let an unrelated callback run before completion and retain edited order',async()=>{
 const rows:any[]=Array.from({length:1025},(_,i)=>['china',i,null,null,false,{id:String(i),year:2024,block:0}]);
 let processed=0,observed=-1;
 const heartbeat=new Promise<void>(resolve=>setImmediate(()=>{observed=processed;resolve();}));
 const selected=await filterBudgetRows(rows,row=>{processed++;return [...row.slice(0,5),{...row[5],year:2025}] as any;},row=>Number(row[5].id)%3===0);
 await heartbeat;
 assert.ok(observed>0&&observed<rows.length,`other work must run during selection, observed ${observed}`);
 assert.equal(processed,rows.length);
 assert.deepEqual(selected.map(row=>row[5].id),rows.filter(row=>Number(row[5].id)%3===0).map(row=>row[5].id));
 assert.ok(selected.every(row=>row[5].year===2025));
 assert.ok(rows.every(row=>row[5].year===2024),'immutable selector is unchanged');
 assert.deepEqual(await filterBudgetRows([],row=>row,()=>true),[]);
});
