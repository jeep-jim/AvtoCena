import test from 'node:test';
import assert from 'node:assert/strict';
import {readFilteredAjesPage} from '../apps/web/lib/catalog/ajes-filtered-page';

test('fills 24 matching cars instead of four and resumes without omissions or repeats',async()=>{
 const calls:number[]=[];
 const read=async(page:number)=>{calls.push(page);return {items:Array.from({length:page===1?4:24},(_,i)=>`${page}/${i}`),received:24};};
 const first=await readFilteredAjesPage({page:1,pageSize:24,read});
 assert.equal(first.items.length,24);assert.equal(first.nextCursor,'2.20');assert.deepEqual(calls,[1,2]);
 const second=await readFilteredAjesPage({page:2,pageSize:24,after:first.nextCursor,read});
 assert.equal(second.items.length,24);assert.equal(second.items[0],'2/20');assert.equal(second.nextCursor,'3.20');
 assert.equal(new Set([...first.items,...second.items]).size,48);
});
test('empty intermediate source pages do not become empty visible pages',async()=>{
 const result=await readFilteredAjesPage({page:1,pageSize:24,read:async page=>({items:page===3?['match']:[],received:page===3?1:24})});
 assert.deepEqual(result.items,['match']);assert.equal(result.hasMore,false);assert.equal(result.nextCursor,null);
});
test('a sparse search stops after eight pages and preserves its continuation',async()=>{
 const result=await readFilteredAjesPage({page:1,pageSize:24,read:async()=>({items:[],received:24})});
 assert.equal(result.reads,8);assert.equal(result.scanLimited,true);assert.equal(result.nextCursor,'9.0');
});
test('time budget stops further reads without claiming exhaustion',async()=>{
 let clock=0;
 const result=await readFilteredAjesPage({page:1,pageSize:24,now:()=>clock,read:async()=>{clock+=9000;return {items:['one'],received:24};}});
 assert.equal(result.reads,1);assert.equal(result.nextCursor,'2.0');assert.equal(result.hasMore,true);
});
test('fresh source total stops an exact source boundary; stale pages cannot use it',async()=>{
 const read=async()=>({items:['match'],received:24});
 assert.equal((await readFilteredAjesPage({page:1,pageSize:24,sourceTotal:24,read})).hasMore,false);
 assert.equal((await readFilteredAjesPage({page:1,pageSize:24,sourceTotal:24,read:async()=>({...await read(),stale:true})})).hasMore,true);
});
test('partial fallback stays partial and never triggers a crawl',async()=>{
 const result=await readFilteredAjesPage({page:1,pageSize:24,read:async()=>({items:['saved'],received:24,partial:true,stale:true})});
 assert.equal(result.reads,1);assert.equal(result.partial,true);assert.equal(result.stale,true);assert.equal(result.hasMore,false);
});
test('rejects malformed continuation before reading the supplier',async()=>{
 for(const after of ['0.0','-1.0','1000001.0','1.24','1.999','NaN','1.0;select'])await assert.rejects(readFilteredAjesPage({page:1,pageSize:24,after,read:async()=>{throw Error('must not read');}}),/ajes_invalid_query/);
});
test('supplier refusal propagates without presenting an empty success',async()=>{
 await assert.rejects(readFilteredAjesPage({page:1,pageSize:24,read:async()=>{throw Error('disabled');}}),/disabled/);
});

 test('a later supplier outage preserves matches and resumes at the failed page',async()=>{
 const {AjesUnavailable}=await import('../apps/web/lib/catalog/ajes-client');
 const result=await readFilteredAjesPage({page:1,pageSize:24,read:async page=>{if(page===2)throw new AjesUnavailable('request_timeout');return {items:['saved'],received:24};}});
 assert.deepEqual(result.items,['saved']);assert.equal(result.interrupted,true);assert.equal(result.partial,true);assert.equal(result.stale,false);assert.equal(result.nextCursor,'2.0');assert.equal(result.hasMore,true);
 });


test('Japan opts into one refill after a slow first read without changing the generic time bound',async()=>{
 let clock=0;const calls:number[]=[];
 const result=await readFilteredAjesPage({page:1,pageSize:24,minimumReads:2,now:()=>clock,read:async page=>{
  calls.push(page);clock+=9000;return {items:Array.from({length:page===1?23:24},(_,i)=>page+'/'+i),received:24};
 }});
 assert.deepEqual(calls,[1,2]);assert.equal(result.items.length,24);assert.equal(result.nextCursor,'2.1');
 clock=0;
 const sparse=await readFilteredAjesPage({page:1,pageSize:24,minimumReads:2,now:()=>clock,read:async()=>{clock+=9000;return {items:[],received:24};}});
 assert.equal(sparse.reads,2);assert.equal(sparse.scanLimited,true);assert.equal(sparse.nextCursor,'3.0');
});
test('bound 24-row cursors fill 23 candidates and partition a finite source with no duplicate or skipped ID',async()=>{
 const calls:number[]=[],all=[...Array.from({length:23},(_,i)=>'1/'+i),...Array.from({length:24},(_,i)=>'2/'+i),'3/0','3/1'];
 const read=async(page:number)=>{calls.push(page);return {items:page===1?all.slice(0,23):page===2?all.slice(23,47):all.slice(47),received:page<3?24:2};};
 const options={pageSize:24,cursorKey:'japan|petrol|160|city',itemKey:(id:string)=>id,read};
 const first=await readFilteredAjesPage({...options,page:1});
 assert.equal(first.items.length,24);assert.match(first.nextCursor!,/^j1\.2\.1\.2\.[a-f0-9]{64}\.[a-f0-9]{64}$/);
 const second=await readFilteredAjesPage({...options,page:2,after:first.nextCursor});
 assert.equal(second.items.length,24);assert.match(second.nextCursor!,/^j1\.3\.1\.3\./);
 const third=await readFilteredAjesPage({...options,page:3,after:second.nextCursor});
 assert.deepEqual([...first.items,...second.items,...third.items],all);
 assert.equal(new Set([...first.items,...second.items,...third.items]).size,49);
 assert.equal(third.items.length,1);assert.equal(third.hasMore,false);assert.equal(third.nextCursor,null);
 assert.deepEqual(calls,[1,2,2,3,3],'only the explicitly requested 24-row source pages are read');
});
test('bound cursors reject another query, city or visible page before reading and reject changed accepted membership before skipping',async()=>{
 let calls=0,changed=false;
 const options={pageSize:24,cursorKey:'japan|petrol|160|Новокузнецк',itemKey:(row:{id:string;price:number})=>row.id,
  read:async(page:number)=>{calls++;return {received:24,items:Array.from({length:page===1?23:24},(_,i)=>({id:page+'/'+(changed&&page===2?23-i:i),price:100+calls}))};}};
 const first=await readFilteredAjesPage({...options,page:1});const before=calls;
 for(const patch of [{page:2,cursorKey:'japan|petrol|160|Казань'},{page:2,cursorKey:'japan|petrol|100|Новокузнецк'},{page:3}])
  await assert.rejects(readFilteredAjesPage({...options,page:2,after:first.nextCursor,...patch}),/ajes_invalid_query/);
 assert.equal(calls,before);
 const second=await readFilteredAjesPage({...options,page:2,after:first.nextCursor});
 assert.equal(second.items[0].id,'2/1','price/timestamp changes do not change the membership fingerprint');
 changed=true;const beforeChanged=calls;
 await assert.rejects(readFilteredAjesPage({...options,page:2,after:first.nextCursor}),/ajes_invalid_query/);
 assert.equal(calls,beforeChanged+1,'changed IDs are refused on the exact partly consumed page before any next page is read');
});
test('a mixed page retains the oldest source observation and every stale/partial flag',async()=>{
 const result=await readFilteredAjesPage({page:1,pageSize:24,read:async page=>({
  items:Array.from({length:page===1?23:24},(_,i)=>page+'/'+i),received:24,
  observedAt:page===1?'2026-11-26T12:00:00.000Z':'2026-11-26T11:00:00.000Z',stale:page===2,partial:page===2,
 })});
 assert.equal(result.observedAt,'2026-11-26T11:00:00.000Z');
 assert.equal(result.stale,true);assert.equal(result.partial,true);assert.equal(result.hasMore,false);
 assert.equal(result.items.length,24);assert.equal(result.nextCursor,null);
});
