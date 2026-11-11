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
 assert.deepEqual(result.items,['saved']);assert.equal(result.interrupted,true);assert.equal(result.nextCursor,'2.0');assert.equal(result.hasMore,true);
 });
