import test from 'node:test';
import assert from 'node:assert/strict';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {readUncappedBudgetRows} from '../apps/web/lib/catalog/ajes-query-cache';
test('new delivered budget can recover only its exact previously viewed supplier page',async()=>{
 for(const table of ['stats','korea'] as const){
  const old=ajesQuery({table,make:'BMW',page:3,pageSize:24}).sql;
  const capped=ajesQuery({table,make:'BMW',page:3,pageSize:24,sourcePriceTo:1000000}).sql;
  const value={items:[{table,id:'saved'}],page:3,pageSize:24,observedAt:new Date().toISOString()};let reads=0;
  const read=async(sql:string)=>{reads++;return sql===old?value:null;};
  const result=await readUncappedBudgetRows(capped,read);assert.equal(reads,1);assert.equal(result.partial,true);assert.equal(result.schemaVersion,0);assert.deepEqual(result.items,value.items);
  assert.equal(await readUncappedBudgetRows(ajesQuery({table,aggregate:'count',sourcePriceTo:1000000}).sql,read),null);
  assert.equal(await readUncappedBudgetRows(ajesQuery({table,make:'TOYOTA',page:3,sourcePriceTo:1000000}).sql,read),null);
  assert.equal(await readUncappedBudgetRows(old,read),null);
 }
});
