import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogSearchProjectionSort,catalogSearchProjectionSortAsync} from '../apps/web/lib/catalog/storage';

test('cooperative ordering preserves every row, explicit sorts, policy groups and stable ties',async()=>{
 const rows=Array.from({length:8193},(_,i)=>({id:String(i%11),market:'korea',year:2020+i%6,
  totalRub:i%9?1000000+(i%7)*4000000:null,powerHp:i%2?120:200,
  sourcePublishedAt:new Date(Date.UTC(2026,8,1+i%28)).toISOString(),updatedAt:'2026-10-01'}));
 for(const sort of ['updatedAt','totalRub','totalRubDesc','year','yearAsc']){
  const expected=catalogSearchProjectionSort([...rows] as any[],sort);
  const actual=[...rows];
  assert.equal(await catalogSearchProjectionSortAsync(actual as any[],sort),actual);
  assert.deepEqual(actual,expected,sort);
  actual.forEach((row,i)=>assert.equal(row,expected[i],'original row identity and stable ties'));
 }
});

test('a large cold sort permits queued I/O to run before completing',async()=>{
 const rows=Array.from({length:70000},(_,i)=>({id:String(i),market:'korea',totalRub:1000000,
  powerHp:120,sourcePublishedAt:new Date(Date.UTC(2026,8,1+i%28,0,i)).toISOString()}));
 let progressed=false;
 const io=new Promise<void>(resolve=>setImmediate(()=>{progressed=true;resolve();}));
 await catalogSearchProjectionSortAsync(rows as any[]);
 assert.equal(progressed,true,'unrelated I/O must progress while sorting');
 await io;
 assert.equal(rows.length,70000);
});
