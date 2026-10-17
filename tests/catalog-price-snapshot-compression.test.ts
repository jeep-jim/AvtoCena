import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {sharedBudgetPrices,resetSharedBudgetPriceCache,restoreBudgetPrices} from '../apps/web/lib/catalog/shared-budget-prices';

test('large shared snapshots reduce transferred JSON and retain exact prices, identities, rollback isolation and corruption fallback',async()=>{
 const rows=Array.from({length:8000},(_,i)=>({id:`fixture-${i}`,market:'korea',totalRub:1000000+i*123,make:'Hyundai',model:'Avante',year:2024}));
 const index=buildBudgetCountIndex('fixture-generation',rows as any[],new Map(),3);
 const storage=getJsonStorage(),read=storage.readJson,write=storage.writeJson;
 let saved:any=null,writtenPath='',calls=0;
 storage.readJson=async()=>saved;
 storage.writeJson=async(path,value)=>{writtenPath=path;saved=structuredClone(value);};
 const compact=index.rows.map(row=>row.slice(0,7) as typeof row);
 const load=async()=>{calls++;return compact;};
 try{
  resetSharedBudgetPriceCache();const result=await sharedBudgetPrices(index,'korea','stable',load,async()=>'stable');
  assert.equal(saved.encoding,'gzip-base64');assert.equal(writtenPath,'catalog/runtime-budget-prices-v2/korea.json');
  const wireBytes=Buffer.byteLength(JSON.stringify(saved));
  const referenceBytes=Buffer.byteLength(JSON.stringify(index.rows.map(row=>[row[5].id,row[1],row[2],row[4],row[6]??null])));
  assert.ok(wireBytes<referenceBytes*0.6,`${wireBytes}/${referenceBytes}`);
  resetSharedBudgetPriceCache();assert.deepEqual(await sharedBudgetPrices(index,'korea','stable',load,async()=>'stable'),result);assert.equal(calls,1);
  saved.payload='corrupt';resetSharedBudgetPriceCache();
  assert.deepEqual(await sharedBudgetPrices(index,'korea','stable',load,async()=>'stable'),result);assert.equal(calls,2);
  assert.equal(restoreBudgetPrices({encoding:'gzip-base64',payload:'bad'},'stable',index.rows),null);
  console.log(JSON.stringify({fixture:'8000-price-rows',wireBytes,referenceBytes,reductionPercent:Math.round((1-wireBytes/referenceBytes)*100)}));
 }finally{storage.readJson=read;storage.writeJson=write;resetSharedBudgetPriceCache();}
});
