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

test('materialization selects the first unprocessed saved cut and replays only its pages',async()=>{
 const {selectChinaCut,ownedChinaRequests}=await import('../scripts/lib/owned-china-prepare.mjs');
 const prefix='catalog/owned-feed/v1/china',db=new Map<string,any>();
 const write=(key:string,value:any)=>db.set(prefix+'/'+key,value);
 const state=(runId:string,previousRun:string|null,startCursor:number,cursor:number)=>({version:1,market:'china',status:'complete',runId,previousRun,startCursor,cursor,base:{cursor:100}});
 const first=state('501',null,100,101),latest=state('502','501',101,103);
 write('source.json',latest);write('runs/501/complete.json',first);write('runs/502/complete.json',latest);
 const storage={readJsonWithMeta:async(k:string)=>({found:db.has(k),value:db.get(k)??null}),readJson:async(k:string)=>db.get(k)??null,writeJson:async(k:string,v:unknown)=>db.set(k,v)};
 assert.equal((await selectChinaCut(storage)).cut.runId,'501');
 write('prepared.json',{runId:'501',cursor:101});
 assert.equal((await selectChinaCut(storage)).cut.runId,'502');
 const page={result:[{id:101,inner_id:88,change_type:'added',data:{custom:'complete upstream field'}}],meta:{cur_change_id:101,next_change_id:103}};
 write('runs/502/pages/101.json',{version:1,cursor:101,payload:page});
 write('runs/502/pages/103.json',{version:1,cursor:103,payload:{result:[],meta:{cur_change_id:103}}});
 let calls=0;const request=ownedChinaRequests(storage,latest,async()=>{calls++;return {result:{penultimate:true}};});
 assert.deepEqual(await request('changes',{change_id:101}),page);
 assert.deepEqual(await request('offer',{inner_id:88}),await request('offer',{inner_id:88}));
 await request('changes',{change_id:103});assert.equal(calls,1);
 await assert.rejects(request('changes',{change_id:104}),/china_cut_cursor/);
 write('prepared.json',{runId:'501',cursor:99});await assert.rejects(selectChinaCut(storage),/china_materialization_gap/);
});
