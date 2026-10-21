import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openChe168ReplayJournal} from '../scripts/lib/che168-replay-journal.mjs';
import {recoverLegacyChe168Snapshot} from '../scripts/lib/auto-api-che168-recovery.mjs';
import {diagnoseChe168404} from '../scripts/lib/che168-diagnose-404.mjs';
import {normalizeAutoApiChe168,AUTO_API_CHE168_SOURCE as sourceId} from '../apps/web/lib/catalog/auto-api-che168';
import {observationShardWriter,publishedIntakeCheckpoint} from '../scripts/lib/catalog-intake-checkpoint.mjs';

class Store {
 data=new Map<string,{value:any,etag:string}>(); seq=0; failHead=false;
 async readJsonWithMeta(key:string,fallback:any){const v=this.data.get(key);return v?{found:true,...structuredClone(v)}:{found:false,value:fallback};}
 async readJson(key:string,fallback:any){return (await this.readJsonWithMeta(key,fallback)).value;}
 async writeJson(key:string,value:any,condition:any={}){
  if(this.failHead&&key.endsWith('/head.json'))throw Error('storage_unavailable');
  const old=this.data.get(key);
  if(condition.ifNoneMatch&&old||condition.ifMatch&&old?.etag!==condition.ifMatch)throw Error('storage_conflict');
  this.data.set(key,{value:structuredClone(value),etag:String(++this.seq)});
 }
}
const binding='a'.repeat(64),at='2026-10-09T00:00:00Z';
test('durable journal rejects missing/corrupt chunks, foreign snapshot and stale concurrent writers',async()=>{
 const storage=new Store();const options={storage,artifactRunId:'123',binding,initialCursor:20,apply:async()=>{}};
 const a=await openChe168ReplayJournal(options),b=await openChe168ReplayJournal(options);
 await a.commit({cursor:21,changes:1,events:[]});
 await assert.rejects(()=>b.commit({cursor:22,changes:2,events:[]}),/storage_conflict/);
 await assert.rejects(()=>openChe168ReplayJournal({...options,binding:'b'.repeat(64)}),/invalid_replay_checkpoint/);
 const chunkKey=[...storage.data.keys()].find(k=>!k.endsWith('/head.json'))!;
 const original=structuredClone(storage.data.get(chunkKey)!);
 storage.data.get(chunkKey)!.value.to=999;
 await assert.rejects(()=>openChe168ReplayJournal(options),/invalid_replay_checkpoint/);
 storage.data.delete(chunkKey);
 await assert.rejects(()=>openChe168ReplayJournal(options),/invalid_replay_checkpoint/);
 storage.data.set(chunkKey,original);
 assert.equal((await openChe168ReplayJournal(options)).cursor,21);
});
test('head write failure never advances a durable cursor beyond saved data',async()=>{
 const storage=new Store(),options={storage,artifactRunId:'123',binding,initialCursor:20,apply:async()=>{}};
 const a=await openChe168ReplayJournal(options);await a.commit({cursor:21,changes:1,events:[]});
 storage.failHead=true;await assert.rejects(()=>a.commit({cursor:22,changes:2,events:[]}),/storage_unavailable/);
 storage.failHead=false;assert.equal((await openChe168ReplayJournal(options)).cursor,21);
});

function row(id:number,year='2022'){return {inner_id:String(id),data:{inner_id:String(id),url:`https://www.che168.com/dealer/1/${id}.html`,mark:'Toyota',model:'Corolla',year,price:'90000'}};}
test('fresh runner resumes completed pages, preserves quarantine/removals and retries the partial 404 page only',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'durable-che168-'));const base=path.join(root,'base'),first=path.join(root,'first'),second=path.join(root,'second');
 const storage=new Store();
 try{
  await fs.mkdir(base);const write=observationShardWriter(base,sourceId);
  for(let id=1000;id<1500;id++)await write({observedAt:at,offer:normalizeAutoApiChe168(row(id),at)});
  const report={version:1,provider:'auto_api_che168',market:'china',completed:false,startedAt:at,failure:'auto_api_detail_identity_mismatch',confirmedWithdrawals:[],sources:[{sourceId,pages:25,rows:501,observations:500,uniqueOffers:500,changes:0,cursor:20,phase:'snapshot',rejectedIdentity:0,quarantined:1,rejectionReasons:{missing_model:1}}]};
  await fs.writeFile(path.join(base,'report.json'),JSON.stringify(report));
  await fs.writeFile(path.join(base,'quarantine.ndjson'),JSON.stringify({innerId:'999',reason:'missing_model',observedAt:at})+'\n');
  const event=(id:number,inner:number,type='changed')=>({id,inner_id:String(inner),change_type:type,created_at:at});
  let broken=true;const pages:number[]=[],details:string[]=[];
  const request=async(endpoint:string,params:any)=>{
   assert.ok(['changes','offer'].includes(endpoint),'never /offers or change_id');
   if(endpoint==='offer'){details.push(params.inner_id);if(params.inner_id==='1003'&&broken)throw Error('auto_api_http_404');return row(Number(params.inner_id),params.inner_id==='1001'?'0':'2022');}
   pages.push(params.change_id);
   return {result:params.change_id===20?[event(20,1000),event(21,1001),event(22,1004,'removed')]:params.change_id===23?[event(23,1002),event(24,1003)]:[],meta:{cur_change_id:params.change_id,next_change_id:params.change_id===20?23:25}};
  };
  const options={request,now:()=>at,journalStorage:storage,artifactRunId:'123',checkpointEvery:10};
  await fs.cp(base,first,{recursive:true});
  await assert.rejects(()=>recoverLegacyChe168Snapshot({...options,directory:first}),/auto_api_detail_404_unresolved/);
  assert.equal(JSON.parse(await fs.readFile(path.join(first,'report.json'),'utf8')).completed,false);
  const head=[...storage.data.values()].find(v=>v.value.chunks)?.value;assert.equal(head.cursor,23);
  assert.throws(()=>publishedIntakeCheckpoint(report,{market:'china',published:true,generationId:'test'}),/incomplete/);
  await fs.rm(first,{recursive:true}); // runner and every local temporary byte are gone
  await fs.cp(base,second,{recursive:true});broken=false;pages.length=0;details.length=0;
  const result=await recoverLegacyChe168Snapshot({...options,directory:second});
  assert.deepEqual(pages,[23,25]);assert.deepEqual(details,['1002','1003']);
  assert.equal(result.sources[0].observations,503);assert.equal(result.sources[0].quarantined,2);
  assert.equal(result.sources[0].changes,5);assert.equal(result.sources[0].cursor,25);assert.equal(result.sources[0].initialCursor,20);
  assert.equal(result.confirmedWithdrawals.length,1);assert.equal(result.confirmedWithdrawals[0].sourceOfferId,'1004');
  assert.deepEqual(result.sources[0].rejectionReasons,{legacy_unclassified:0,missing_model:1,invalid_year:1});
  assert.ok([...storage.data.keys()].every(k=>k.startsWith('catalog/intake-working/')),'published cursor untouched');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('404 diagnosis reports explicit later removal separately from an unexplained 404',async()=>{
 for(const removed of [true,false]){
  const calls:string[]=[];
  const result=await diagnoseChe168404({cursor:20,request:async(endpoint:string,params:any)=>{
   calls.push(endpoint);if(endpoint==='offer')throw Error('auto_api_http_404');
   return {result:params.change_id===20?[{id:20,inner_id:'42',change_type:'changed',created_at:at}]:params.change_id===21&&removed?[{id:21,inner_id:'42',change_type:'removed',created_at:at}]:[],meta:{cur_change_id:params.change_id,next_change_id:params.change_id+1}};
  }});
  assert.equal(result.observed404,true);assert.equal(result.reachedEnd,true);
  assert.equal(result.latestEventType,removed?'removed':'changed');assert.equal(result.productionWrites,false);
  assert.ok(calls.every(x=>['changes','offer'].includes(x)));
 }
});
