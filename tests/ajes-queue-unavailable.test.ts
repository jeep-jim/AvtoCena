import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesClient,AjesUnavailable} from '../apps/web/lib/catalog/ajes-client';
import {DetailReadCache} from '../apps/web/lib/catalog/detail-read-cache';
import {readFilteredAjesPage} from '../apps/web/lib/catalog/ajes-filtered-page';
test('local queue saturation is typed unavailability, not a hard page error or an empty success',async t=>{
 for(const message of ['detail_cache_queue_timeout','detail_cache_queue_full']){
  const mock=t.mock.method(DetailReadCache.prototype,'get',()=>Promise.reject(new Error(message)));
  let fetches=0;
  const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>{fetches++;throw Error('must not fetch');}});
  await assert.rejects(client.read({table:'korea',id:'fixture001'},'203.0.113.1'),e=>e instanceof AjesUnavailable&&e.reason==='local_busy');
  assert.equal(fetches,0);mock.mock.restore();
 }
});
test('unrelated cache failure retains its original identity',async t=>{
 const original=new Error('corrupt_data');t.mock.method(DetailReadCache.prototype,'get',()=>Promise.reject(original));
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{}});
 await assert.rejects(client.read({table:'korea'},'203.0.113.1'),e=>e===original);
});
test('queue pressure after successful pages retains cards and exact retry cursor',async()=>{
 const page=await readFilteredAjesPage({page:1,pageSize:24,read:async p=>{if(p===2)throw new AjesUnavailable('local_busy');return {items:['first'],received:24};}});
 assert.deepEqual(page.items,['first']);assert.equal(page.interrupted,true);assert.equal(page.hasMore,true);assert.equal(page.nextCursor,'2.0');
 await assert.rejects(readFilteredAjesPage({page:1,pageSize:24,read:async()=>{throw new AjesUnavailable('local_busy');}}),e=>e instanceof AjesUnavailable);
});
