import test from 'node:test';
import assert from 'node:assert/strict';
import {createChe168MissingDetails} from '../scripts/lib/che168-missing-details.mjs';
import {collectAutoApiChe168} from '../scripts/lib/auto-api-che168-client.mjs';
import {openChe168ReplayJournal} from '../scripts/lib/che168-replay-journal.mjs';
const at='2026-10-21T00:00:00Z';
const missing={kind:'missing_detail',innerId:'42',at,event:10};
test('404 remains unresolved across private checkpoint/restart and needs exact later evidence',async()=>{
 const data=new Map<string,any>();let seq=0;
 const storage={readJsonWithMeta:async(k:string,f:any)=>data.has(k)?{found:true,...data.get(k)}:{found:false,value:f},readJson:async(k:string,f:any)=>data.get(k)?.value??f,writeJson:async(k:string,v:any)=>{data.set(k,{value:structuredClone(v),etag:String(++seq)});}};
 const first=createChe168MissingDetails();const options={storage,artifactRunId:'99',binding:'a'.repeat(64),initialCursor:10};
 const journal=await openChe168ReplayJournal({...options,apply:async(e:any)=>first.apply(e)});
 first.apply(missing);await journal.commit({cursor:11,changes:1,events:[missing]});
 const restored=createChe168MissingDetails();await openChe168ReplayJournal({...options,apply:async(e:any)=>restored.apply(e)});
 assert.throws(()=>restored.assertResolved(),/404_unresolved/);
 for(const e of [{...missing,kind:'removed',innerId:'99',event:12},{...missing,kind:'removed',event:9},{...missing,kind:'removed',event:12,at:'2026-10-20T00:00:00Z'},{...missing,kind:'price',event:12}])restored.apply(e);
 assert.throws(()=>restored.assertResolved(),/404_unresolved/);
 restored.apply({...missing,kind:'removed',event:1012});restored.assertResolved();
});
test('bulk ordered replay resolves beyond 1000 pages without speculative requests and fails if never resolved',async()=>{
 for(const resolve of [true,false]){
  const pending=createChe168MissingDetails();let reads=0,removals=0;
  const run=()=>collectAutoApiChe168({yearFrom:2014,resume:{cursor:10,snapshotStartedAt:at},useChangeData:true,now:()=>at,
   missingDetails:{record:async(c:any)=>pending.apply({kind:'missing_detail',innerId:c.inner_id,at:c.created_at,event:c.id}),assertResolved:()=>pending.assertResolved()},
   request:async(endpoint:string,p:any)=>{if(endpoint==='offer')throw Error('auto_api_http_404');reads++;const c=p.change_id;return {result:c<=1012?[{id:c,inner_id:c===10||resolve&&c===1012?'42':'99',change_type:c===10?'changed':'removed',created_at:at}]:[],meta:{cur_change_id:c,next_change_id:c+1}};},
   onOffer:async()=>assert.fail(),onRemoval:async(c:any)=>{removals++;pending.apply({kind:'removed',innerId:c.inner_id,at:c.created_at,event:c.id});}});
  if(resolve){assert.equal((await run()).cursor,1013);assert.equal(pending.size,0);}else await assert.rejects(run,/404_unresolved/);
  assert.equal(reads,1004);assert.equal(removals,1002);
 }
});
