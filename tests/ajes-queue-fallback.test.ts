import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesClient,AjesUnavailable} from '../apps/web/lib/catalog/ajes-client';
import {DetailReadCache} from '../apps/web/lib/catalog/detail-read-cache';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {findSavedAjesStockSearch} from '../apps/web/lib/catalog/ajes-saved-search';
const input={table:'korea' as const,make:'KIA',model:'SELTOS'};
const snapshot=()=>({schemaVersion:2,items:[{id:'fixture001',table:'korea',make:'KIA',model:'SELTOS',year:2024,sourcePrice:17000000}],page:1,pageSize:24,received:1,rejected:0,observedAt:new Date(Date.now()-3600000).toISOString()});
const busy=(e:unknown)=>e instanceof AjesUnavailable&&e.reason==='local_busy';
for(const message of ['detail_cache_queue_timeout','detail_cache_queue_full'])test(`${message} recovers exact saved SQL without supplier work or shared fresh promotion`,async t=>{
 const queue=t.mock.method(DetailReadCache.prototype,'get',()=>Promise.reject(new Error(message)));
 const saved=snapshot(),before=structuredClone(saved);let reads=0,fetches=0,reserves=0;
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{reserves++;},fetcher:async()=>{fetches++;throw Error('unexpected');},readQuery:async sql=>{assert.equal(sql,ajesQuery(input).sql);reads++;return saved;}});
 const result=await client.read(input,'203.0.113.1');
 assert.deepEqual(result,{...saved,stale:true});assert.deepEqual(saved,before);assert.equal(reads,1);assert.equal(fetches,0);assert.equal(reserves,0);
 queue.mock.restore();
 let next=0;
 const noCache=t.mock.method(DetailReadCache.prototype,'get',(_key:any,load:any)=>{next++;return load();});
 await client.read(input,'203.0.113.2');assert.ok(next>0);assert.equal(reads,2);noCache.mock.restore();
});
test('queue recovery rejects expired, future, wrong-market, wrong-page and empty snapshots',async t=>{
 t.mock.method(DetailReadCache.prototype,'get',()=>Promise.reject(new Error('detail_cache_queue_full')));
 for(const saved of [null,{...snapshot(),observedAt:new Date(Date.now()-7*86400000).toISOString()},{...snapshot(),observedAt:new Date(Date.now()+60000).toISOString()},{...snapshot(),items:[{id:'x',table:'china'}]},{...snapshot(),page:2},{...snapshot(),pageSize:12},{...snapshot(),items:[]}]){
  const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{throw Error('no supplier');},readQuery:async()=>saved});
  await assert.rejects(client.read(input,'203.0.113.1'),busy);
 }
});
test('saved first-page recovery preserves exact stock filters, exclusions and partial status',async t=>{
 t.mock.method(DetailReadCache.prototype,'get',()=>Promise.reject(new Error('detail_cache_queue_timeout')));
 const saved=snapshot(),wrong={...saved,items:[{...saved.items[0],id:'wrong',model:'SPORTAGE'}]},withdrawn={...saved,items:[{...saved.items[0],id:'sold',status:'sold'}]};
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{throw Error('no supplier');},readSavedSearch:async q=>findSavedAjesStockSearch(q,{saved,wrong,withdrawn})});
 const value=await client.read(input,'203.0.113.1');assert.deepEqual(value.items,saved.items);assert.equal(value.partial,true);assert.equal(value.stale,true);assert.equal(value.total,undefined);
 await assert.rejects(client.read({...input,page:2},'203.0.113.1'),busy);
});
test('owner switch is checked after stored I/O and storage errors stay local_busy',async t=>{
 t.mock.method(DetailReadCache.prototype,'get',()=>Promise.reject(new Error('detail_cache_queue_full')));
 let disabled=false;const denied=new Error('disabled');
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{if(disabled)throw denied;},reserve:async()=>{},readQuery:async()=>{disabled=true;return snapshot();}});
 await assert.rejects(client.read(input,'203.0.113.1'),e=>e===denied);
 const broken=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async()=>{throw Error('storage');}});
 await assert.rejects(broken.read(input,'203.0.113.1'),busy);
});
test('legacy saved list remains stale and supplier refusal retains its cooldown',async()=>{
 let requests=0;const saved=snapshot();
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readLegacyQuery:async()=>saved,fetcher:async()=>{requests++;return new Response('bot fixture');}});
 assert.equal((await client.read(input,'203.0.113.1')).stale,true);
 assert.equal((await client.read(input,'203.0.113.1')).stale,true);assert.equal(requests,1);
});
