import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetSelectionFilterKey} from '../apps/web/lib/catalog/budget-selection-key';
import {budgetSourceRows,resetBudgetSourceIndexes} from '../apps/web/lib/catalog/budget-source-index';

test('count and paginated cards share non-price membership while city-dependent budget membership stays isolated',()=>{
 const filters={market:'china',bodyType:'suv',fuel:'petrol'} as const;
 const key=budgetSelectionFilterKey(filters);
 assert.deepEqual(budgetSelectionFilterKey({...filters,city:'Новокузнецк',page:2,pageSize:24,sort:'year'}),key);
 assert.deepEqual(budgetSelectionFilterKey({...filters,city:'Москва',page:3}),key);
 assert.notDeepEqual(budgetSelectionFilterKey({...filters,city:'Москва',budgetTo:2000000}),budgetSelectionFilterKey({...filters,city:'Новокузнецк',budgetTo:2000000}));
 assert.notDeepEqual(budgetSelectionFilterKey({...filters,city:'Москва',budgetFrom:1}),budgetSelectionFilterKey({...filters,city:'Новокузнецк',budgetFrom:1}));
 assert.notDeepEqual(budgetSelectionFilterKey({...filters,drive:'awd'}),key);
});

test('multiple make selections narrow a large prepared index and retain exact source order including otherRows',async()=>{
 const rows=Array.from({length:20000},(_,i)=>['china',i,null,null,false,{id:String(i),make:i%100===0?'Toyota':i%100===1?'Honda':'Other',block:0}] as any);
 const index:any={generationId:'g',rows:rows.slice(0,15000),otherRows:rows.slice(15000)};
 const selected=await budgetSourceRows(index,new Set(['honda','toyota']),v=>v.toLowerCase());
 assert.equal(selected.length,400);
 assert.deepEqual(selected,rows.filter(row=>row[5].make!=='Other'));
 const again=await budgetSourceRows(index,new Set(['toyota','honda']),()=>{throw Error('must reuse prepared make offsets');});
 assert.deepEqual(again,selected);
 assert.equal((await budgetSourceRows(index,new Set(['missing','unknown']),v=>v)).length,0);
 assert.deepEqual(await budgetSourceRows(index,null,v=>v),rows);
 assert.deepEqual(await budgetSourceRows(index,new Set(['toyota','other']),v=>v),rows,'broad selection retains the original linear matcher instead of sorting almost all rows');
 const next:any={...index,generationId:'new',rows:[rows[2]],otherRows:[]};
 assert.deepEqual(await budgetSourceRows(next,new Set(['toyota','honda']),v=>v.toLowerCase()),[]);
 resetBudgetSourceIndexes();
});
