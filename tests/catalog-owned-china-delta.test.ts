import test from 'node:test';
import assert from 'node:assert/strict';
import {collectChinaDelta} from '../scripts/lib/owned-china-delta.mjs';
test('the saved source cursor survives an interrupt and processes late events on the next run',async()=>{
 const db=new Map<string,any>();let version=0, interrupt=true, later=false;
 const storage={readJson:async(k:string,f:any)=>db.get(k)?.value??f,readJsonWithMeta:async(k:string,f:any)=>db.get(k)??{found:false,value:f},
  writeJson:async(k:string,value:any,cond:any)=>{
   if(k.endsWith('source.json')&&value.cursor===102&&interrupt){interrupt=false;throw Error('disconnected');}
   const old=db.get(k);assert(old?cond.ifMatch===old.etag:cond.ifNoneMatch==='*');
   db.set(k,{value:structuredClone(value),etag:''+(++version),found:true});
  }};
 const fetched:number[]=[],rates:string[]=[];
 const opts={storage,initialBase:async()=>({cursor:100,generationId:'accepted'}),bindRates:async(id:string)=>rates.push(id),
  request:async(at:number)=>{fetched.push(at);const end=at!==100&&!(at===102&&later);return {meta:{cur_change_id:at,next_change_id:end?null:at+2},result:end?[]:[{id:at+1,inner_id:'11',change_type:'added',additional:{supplier_field:true}}]};}};
 await assert.rejects(collectChinaDelta({...opts,runId:'1'}),/disconnected/);
 const resumed=await collectChinaDelta({...opts,runId:'2'});
 assert.equal(resumed.runId,'1');assert.equal(resumed.rows,1);assert.deepEqual(fetched,[100,102]);
 assert.equal(db.get('catalog/owned-feed/v1/china/runs/1/pages/100.json').value.payload.result[0].additional.supplier_field,true);
 later=true;const next=await collectChinaDelta({...opts,runId:'3'});assert.equal(next.previousRun,'1');assert.equal(next.cursor,104);
 assert.deepEqual(rates,['1','1','3']);
});
