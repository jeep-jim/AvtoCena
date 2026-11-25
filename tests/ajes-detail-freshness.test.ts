import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesLot} from '../apps/web/lib/catalog/ajes-query';
import {DetailReadCache} from '../apps/web/lib/catalog/detail-read-cache';

const START=Date.parse('2026-11-25T12:00:00Z'),MINUTE=60_000,DAY=24*60*MINUTE;
const row={ID:'freshness-fixture',MARKA_NAME:'TOYOTA',MODEL_NAME:'COROLLA',YEAR:'2023',AUCTION_TYPE:'2',STATUS:'Sold',FINISH:'935000',PW:'115',TIME:'P',ENG_V:'1497'};
const base={password:()=> 'offline-fixture',assertEnabled:async()=>{},reserve:async()=>{}};
const savedDetail=(age:number)=>({schemaVersion:2,items:[ajesLot(row,'stats',true)],page:1,pageSize:1,received:1,rejected:0,stale:false,observedAt:new Date(Date.now()-age).toISOString()});

test('restarting with a 29-minute-old saved detail does not grant thirty more minutes of freshness',async t=>{
 t.mock.timers.enable({apis:['Date'],now:START});
 let saved=savedDetail(29*MINUTE),calls=0,reservations=0;
 const client=createAjesClient({...base,reserve:async()=>{reservations++;},readDetail:async()=>saved,saveDetail:async(_table,_id,value)=>{saved=value;},
  fetcher:async input=>{assert.equal(new URL(String(input)).searchParams.get('ip'),'203.0.113.2');calls++;return Response.json([{...row,PW:'130'}]);}});
 const original=await client.read({id:row.ID},'203.0.113.1');
 assert.equal(calls,0);assert.equal(original.stale,false);
 t.mock.timers.tick(MINUTE-1);
 assert.equal((await client.read({id:row.ID},'203.0.113.2')).observedAt,original.observedAt);assert.equal(calls,0);
 t.mock.timers.tick(MINUTE+1);
 const fresh=await client.read({id:row.ID},'203.0.113.2');
 assert.equal(calls,1);assert.equal(reservations,1);assert.equal(fresh.stale,false);
 assert.equal(fresh.observedAt,new Date(START+2*MINUTE).toISOString());assert.equal(fresh.items[0].sourcePower,'130');
 assert.equal((await client.read({id:row.ID},'203.0.113.1')).observedAt,fresh.observedAt);assert.equal(calls,1);
});

test('failed refresh after the original observation deadline returns stale fallback without changing its date',async t=>{
 t.mock.timers.enable({apis:['Date'],now:START});
 const saved=savedDetail(29*MINUTE);let calls=0,available=false;
 const client=createAjesClient({...base,readDetail:async()=>saved,fetcher:async()=>{
  calls++;return available?Response.json([{...row,PW:'140'}]):new Response(null,{status:503});
 }});
 await client.read({id:row.ID},'203.0.113.1');assert.equal(calls,0);
 t.mock.timers.tick(2*MINUTE);
 const fallback=await client.read({id:row.ID},'203.0.113.1');
 assert.equal(calls,1);assert.equal(fallback.stale,true);assert.equal(fallback.observedAt,saved.observedAt);
 assert.equal((await client.read({id:row.ID},'203.0.113.1')).stale,true);assert.equal(calls,1);
 t.mock.timers.tick(30_001);available=true;
 const recovered=await client.read({id:row.ID},'203.0.113.1');
 assert.equal(calls,2);assert.equal(recovered.stale,false);assert.equal(recovered.items[0].sourcePower,'140');
 assert.equal(recovered.observedAt,new Date(Date.now()).toISOString());
});

test('detail failure fallback remains bounded strictly below seven days',async t=>{
 t.mock.timers.enable({apis:['Date'],now:START});
 const saved=savedDetail(7*DAY-1);
 const deps={...base,readDetail:async()=>saved,fetcher:async()=>new Response(null,{status:503})};
 const fallback=await createAjesClient(deps).read({id:row.ID},'203.0.113.1');
 assert.equal(fallback.stale,true);assert.equal(fallback.observedAt,saved.observedAt);
 t.mock.timers.tick(1);
 await assert.rejects(createAjesClient(deps).read({id:row.ID},'203.0.113.1'),/ajes_http_503/);
});

test('new source responses keep thirty-minute reuse and refresh at their own observation deadline',async t=>{
 t.mock.timers.enable({apis:['Date'],now:START});let calls=0;
 const client=createAjesClient({...base,fetcher:async()=>{calls++;return Response.json([row]);}});
 const first=await client.read({id:row.ID},'203.0.113.1');assert.equal(calls,1);
 t.mock.timers.tick(30*MINUTE-1);
 assert.equal((await client.read({id:row.ID},'203.0.113.2')).observedAt,first.observedAt);assert.equal(calls,1);
 t.mock.timers.tick(1);
 const refreshed=await client.read({id:row.ID},'203.0.113.2');assert.equal(calls,2);
 assert.equal(refreshed.observedAt,new Date(START+30*MINUTE).toISOString());
});

test('optional remaining lifetime can only shorten the normal cache lifetime; existing callers retain their TTL',async t=>{
 t.mock.timers.enable({apis:['Date'],now:START});
 let shortReads=0,defaultReads=0,cappedReads=0;
 const options={maxEntries:4,maxBytes:1024,ttlMs:1000,concurrency:1};
 const shortened=new DetailReadCache<number>({...options,remainingTtlMs:()=>100});
 const normal=new DetailReadCache<number>(options);
 const capped=new DetailReadCache<number>({...options,remainingTtlMs:()=>10_000});
 const loadShort=async()=>++shortReads,loadDefault=async()=>++defaultReads,loadCapped=async()=>++cappedReads;
 await shortened.get('x',loadShort);await normal.get('x',loadDefault);await capped.get('x',loadCapped);
 t.mock.timers.tick(100);
 assert.equal(await shortened.get('x',loadShort),2);assert.equal(await normal.get('x',loadDefault),1);assert.equal(await capped.get('x',loadCapped),1);
 t.mock.timers.tick(900);
 assert.equal(await normal.get('x',loadDefault),2);assert.equal(await capped.get('x',loadCapped),2);
});
