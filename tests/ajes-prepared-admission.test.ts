import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {DetailReadCache} from '../apps/web/lib/catalog/detail-read-cache';
const tick=()=>new Promise(r=>setTimeout(r,0));
const snapshot=(overrides:any={})=>({schemaVersion:2,items:[{id:'saved001',table:'korea'}],page:3,pageSize:24,received:1,rejected:0,stale:false,observedAt:new Date().toISOString(),...overrides});
test('a fresh exact saved list is delivered while both supplier slots are occupied',async()=>{
  let release!:()=>void,started=0,reserves=0,done=false;
  const held=new Promise<void>(r=>release=r);
  const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{reserves++;},readQuery:async sql=>sql.endsWith('limit 48,24')?snapshot():null,fetcher:async()=>{started++;await held;return Response.json([]);}});
  const pending=[1,2].map(page=>client.read({table:'korea',page},'203.0.113.1'));
  try{
    for(let i=0;i<100&&started<2;i++)await tick();assert.equal(started,2);
    const ready=client.read({table:'korea',page:3},'203.0.113.2').then(value=>{done=true;return value;});
    for(let i=0;i<100&&!done;i++)await tick();
    assert.equal(done,true,'ready local inventory must not wait for supplier admission');
    const result=await ready;assert.equal(result.items[0].id,'saved001');assert.equal(result.stale,false);assert.equal(reserves,2);
  }finally{release();await Promise.allSettled(pending);}
});
test('slow storage read does not consume supplier slots; stored inspection coalesces and stays bounded',async()=>{
  let release!:()=>void,active=0,peak=0,reads=0,requests=0;
  const held=new Promise<void>(r=>release=r);
  const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async sql=>{reads++;active++;peak=Math.max(peak,active);if(sql.endsWith('limit 0,24'))await held;active--;return null;},fetcher:async()=>{requests++;return Response.json([]);}});
  const a=client.read({table:'korea',page:1},'203.0.113.1'),b=client.read({table:'korea',page:1},'203.0.113.1');
  try{
    for(let i=0;i<100&&active<1;i++)await tick();
    await client.read({table:'korea',page:2},'203.0.113.2');assert.equal(requests,1);assert.equal(reads,2);assert.ok(peak<=2);
  }finally{release();await Promise.all([a,b]);}
  assert.equal(requests,2,'duplicate requests retain supplier coalescing');
  const before=reads;await client.read({table:'korea',page:1},'203.0.113.3');assert.equal(reads,before,'fresh memory hit performs no storage read');
});
test('prepared pages still obey source switch, visitor IP and configuration',async()=>{
  let disabled=false,reads=0;const denied=Error('owner_disabled');
  const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{if(disabled)throw denied;},reserve:async()=>{throw Error('no source');},readQuery:async()=>{reads++;disabled=true;return snapshot();}});
  await assert.rejects(client.read({table:'korea',page:3},'203.0.113.1'),e=>e===denied);
  disabled=false;await assert.rejects(client.read({table:'korea',page:3},''),/client_ip_missing/);assert.equal(reads,1);
  const absent=createAjesClient({password:()=>undefined,assertEnabled:async()=>{},reserve:async()=>{},readQuery:async()=>{throw Error('should not read');}});
  await assert.rejects(absent.read({table:'korea',page:3},'203.0.113.1'),/not_configured/);
});
test('partial, stale, expired, future, wrong-schema and wrong-market saved pages are not promoted to fresh',async()=>{
  for(const overrides of [{partial:true},{stale:true},{schemaVersion:0},{observedAt:new Date(Date.now()-31*60000).toISOString()},{observedAt:new Date(Date.now()+60000).toISOString()},{items:[{id:'saved001',table:'china'}]}]){
    let requests=0;const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async()=>snapshot(overrides),fetcher:async()=>{requests++;return Response.json([]);}});
    const result=await client.read({table:'korea',page:3},'203.0.113.1');assert.equal(requests,1,JSON.stringify(overrides));assert.deepEqual(result.items,[]);
  }
});
test('peekFresh never starts work or prolongs the freshness deadline',async()=>{
  let now=0,loads=0;const cache=new DetailReadCache<number>({maxEntries:1,maxBytes:20,ttlMs:10,concurrency:1,now:()=>now});
  assert.equal(cache.peekFresh('a'),undefined);assert.equal(await cache.get('a',async()=>{loads++;return 7;}),7);
  now=9;assert.equal(cache.peekFresh('a'),7);now=10;assert.equal(cache.peekFresh('a'),undefined);assert.equal(loads,1);
});
