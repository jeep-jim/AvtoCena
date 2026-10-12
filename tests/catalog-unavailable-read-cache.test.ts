import test from 'node:test';
import assert from 'node:assert/strict';
import {UnavailableReadCache} from '../apps/web/lib/catalog/unavailable-read-cache';
const now=Date.now();
const row:any={id:'a',market:'korea',make:'Kia',model:'K5',reason:'unavailable',removedAt:new Date(now).toISOString()};
test('simultaneous missing cards share one immutable metadata read',async()=>{
 const cache=new UnavailableReadCache();let reads=0;
 const load=async()=>{reads++;await new Promise(r=>setTimeout(r,5));return [row,{...row,id:'b'}];};
 const results=await Promise.all(['a','b','missing','a'].map(id=>cache.get('g1',id,load,now)));
 assert.equal(reads,1);assert.deepEqual(results.map(r=>r?.id||null),['a','b',null,'a']);
 assert.equal(await cache.get('g1','a',load,now+15*86400000),null,'cached metadata must still expire');
 assert.equal(reads,1);
 assert.equal((await cache.get('g2','a',async()=>{reads++;return [{...row,reason:'sold' as const}];},now))?.reason,'sold');
 assert.equal(reads,2);
});
test('failed reads are retryable and do not become sold or missing evidence',async()=>{
 const cache=new UnavailableReadCache();
 await assert.rejects(cache.get('g','a',async()=>{throw Error('storage unavailable');}),/storage unavailable/);
 assert.equal((await cache.get('g','a',async()=>[row],now))?.reason,'unavailable');
 cache.clear();assert.equal(await cache.get('g','a',async()=>[],now),null);
});
