import assert from 'node:assert/strict';
import test from 'node:test';
import {catalogProjectionBatches,writeCatalogProjectionBatches} from '../apps/web/lib/catalog-projection-parts';
import {validateOverviewSourceBatches as validate} from '../scripts/lib/catalog-overview-source-validation.mjs';
const key='catalog/generations/g1/indexes/projection/korea.json';
async function fixture(rows:any[]) {
 const values=new Map<string,any>();let reads=0;
 const storage:any={writeJson:async(k:string,v:any)=>values.set(k,structuredClone(v)),readJson:async(k:string)=>{reads++;return values.get(k);}};
 await writeCatalogProjectionBatches(storage,key,'g1',[rows]);
 const directory=values.get(key);
 return {values,directory,storage,get reads(){return reads;},batches:()=>catalogProjectionBatches(storage,key,directory)};
}
test('validates scoped parts sequentially and legacy source with the same counts',async()=>{
 const rows=Array.from({length:2001},(_,i)=>({id:String(i),market:'korea'}));
 const f=await fixture(rows);
 assert.equal(await validate(f.batches(),'g1','korea',2001),2001);assert.equal(f.reads,3);
 assert.equal(await validate([{generationId:'g1',items:rows}],'g1','korea',2001),2001);
});
test('rejects cross-part duplicates, wrong markets, generation, totals and corrupt bytes',async()=>{
 const rows=Array.from({length:1001},(_,i)=>({id:String(i),market:'korea'}));
 for(const replacement of [{id:'0',market:'korea'},{id:'1000',market:'china'},{id:'',market:'korea'}]){
  const f=await fixture([...rows.slice(0,1000),replacement]);
  await assert.rejects(validate(f.batches(),'g1','korea',1001),/count_mismatch/);
 }
 const f=await fixture(rows);
 await assert.rejects(validate(f.batches(),'old','korea',1001),/generation_mismatch/);
 await assert.rejects(validate(f.batches(),'g1','korea',1002),/count_mismatch/);
 f.values.get(f.directory.parts[1].path).items[0].id='tampered';
 await assert.rejects(validate(f.batches(),'g1','korea',1001),/integrity_failed/);
});
