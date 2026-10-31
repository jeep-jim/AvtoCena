import test from 'node:test';
import assert from 'node:assert/strict';
import {BudgetSortOrderCache,type BudgetSortContext} from '../apps/web/lib/catalog/budget-sort-order-cache';
import {budgetRowsBytes,budgetSelectionBytes,budgetIndexBytes,resetBudgetRowSizes} from '../apps/web/lib/catalog/budget-row-size';
import {DetailReadCache} from '../apps/web/lib/catalog/detail-read-cache';
const row=(id:string):any=>['china',123,null,null,false,{id,make:'Example',block:0}];
test('reuses positions after short selection TTL only with identical membership and every current context input',async()=>{
 let now=0,calls=0;const c=new BudgetSortOrderCache(()=>now),index={};
 const context:BudgetSortContext={generation:'g',index:c.indexKey(index),revision:'r',day:'2026-10-26',city:'A',mode:'totalRub',pricing:['rates-1','settings-1']};
 const load=async()=>{calls++;return Uint32Array.from([1,0]);};
 const first=await c.get(context,[row('one'),row('two')],load);now=35000;
 assert.equal(await c.get(context,[row('one'),row('two')],load),first);assert.equal(calls,1);
 for(const change of [{generation:'g2'},{index:c.indexKey({})},{revision:'r2'},{day:'2026-10-27'},{city:'B'},{mode:'totalRubDesc'},{pricing:['rates-2','settings-1']},{pricing:['rates-1','settings-2']}])await c.get({...context,...change},[row('one'),row('two')],load);
 assert.equal(calls,9);
 await c.get(context,[row('two'),row('one')],load);await c.get(context,[row('one')],load);assert.equal(calls,11);
 c.clear();await c.get(context,[row('one'),row('two')],load);assert.equal(calls,12);
});
test('incomplete price orders are never cached as an empty successful result',async()=>{
 const c=new BudgetSortOrderCache();let calls=0;const ctx:BudgetSortContext={generation:'g',index:1,revision:'r',day:'d',city:'',mode:'totalRub',pricing:[]};
 for(let i=0;i<2;i++)assert.equal(await c.get(ctx,[row('a')],async()=>{calls++;return null;}),null);assert.equal(calls,2);
});
test('immutable tuple byte counts are exact, reused across selections and measured in yielding batches',async()=>{
 resetBudgetRowSizes();let reads=0,yielded=false;const a=row('one');Object.defineProperty(a[5],'label',{enumerable:true,get(){reads++;return 'Кавычки " и 🚗';}});
 const expected=Buffer.byteLength(JSON.stringify([a]));reads=0;
 assert.equal(await budgetRowsBytes([a]),expected);assert.equal(await budgetRowsBytes([a]),expected);assert.equal(reads,1);
 const value={generationId:'g',cardVersion:3,indexKey:1,rows:[a]};assert.equal(await budgetSelectionBytes(value),Buffer.byteLength(JSON.stringify(value)));
 for(const index of [value,{...value,otherRows:[]},{...value,otherRows:[row('unpriced')]}])assert.equal(await budgetIndexBytes(index),Buffer.byteLength(JSON.stringify(index)));
 const rows=Array.from({length:2000},(_,i)=>row(String(i)));setImmediate(()=>{yielded=true;});await budgetRowsBytes(rows);assert.equal(yielded,true);
});
test('clearing a cache during async byte measurement cannot repopulate the cleared epoch',async()=>{
 let release!:(n:number)=>void,measures=0,calls=0;
 const c=new DetailReadCache<string>({maxEntries:2,maxBytes:100,ttlMs:1000,concurrency:1,sizeOf:()=>++measures===1?new Promise(r=>release=r):1});
 const first=c.get('a',async()=>{calls++;return 'old';});await new Promise(r=>setImmediate(r));c.clear();release(1);assert.equal(await first,'old');
 assert.equal(await c.get('a',async()=>{calls++;return 'new';}),'new');assert.equal(calls,2);
});

test('membership hashing preserves exact IDs and order across batch boundaries',async()=>{
 const c=new BudgetSortOrderCache();let calls=0;
 const ctx:BudgetSortContext={generation:'g',index:1,revision:'r',day:'d',city:'',mode:'year',pricing:[]};
 const rows=Array.from({length:600},(_,i)=>row(`id-${i}\n"🚗`));
 const load=async()=>{calls++;return Uint32Array.from([0]);};
 await c.get(ctx,rows,load);await c.get(ctx,rows.map(r=>row(r[5].id)),load);assert.equal(calls,1);
 const changed=rows.map(r=>row(r[5].id));changed[257]=row('different');await c.get(ctx,changed,load);assert.equal(calls,2);
 const reordered=[...rows];[reordered[255],reordered[256]]=[reordered[256],reordered[255]];await c.get(ctx,reordered,load);assert.equal(calls,3);
});
