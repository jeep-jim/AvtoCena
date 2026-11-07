import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
const ip='203.0.113.10';
const snapshot=(aggregate:string,at=Date.now())=>({items:[],page:1,pageSize:aggregate==='count'?1:500,received:1,rejected:0,observedAt:new Date(at).toISOString(),stale:false,
 ...(aggregate==='makes'?{makes:[{make:'KIA',total:24}]}:aggregate==='models'?{models:[{make:'KIA',model:'SELTOS',total:24}]}:aggregate==='colors'?{colors:[{color:'WHITE',total:24}]}:{total:24})});
for(const aggregate of ['makes','models','colors','count'] as const)test(`ready ${aggregate} never waits for the occupied supplier queue`,async()=>{
 let release!:()=>void,started=0,reads=0,done=false;const held=new Promise<void>(r=>release=r);
 const sql=ajesQuery({table:'korea',aggregate}).sql;
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async key=>{reads++;return key===sql?snapshot(aggregate):null;},fetcher:async()=>{started++;await held;return Response.json([]);}});
 const busy=[1,2].map(page=>client.read({table:'korea',page},ip));
 try{
  for(let i=0;i<100&&started<2;i++)await tick();assert.equal(started,2);
  const ready=client.read({table:'korea',aggregate},'203.0.113.11').then(v=>{done=true;return v;});
  for(let i=0;i<100&&!done;i++)await tick();
  assert.equal(done,true,'stored metadata must be independent of external supplier admission');
  assert.equal((await ready).stale,false);assert.equal(started,2);
  const before=reads;await client.read({table:'korea',aggregate},'203.0.113.12');assert.equal(reads,before,'reuse must not read storage again');
 }finally{release();await Promise.allSettled(busy);}
});
for(const aggregate of ['makes','models','colors','count'] as const)test(`${aggregate} preparation retains the observation deadline and source checks`,async t=>{
 let now=Date.parse('2026-11-07T12:00:00Z'),requests=0,disabled=false; t.mock.method(Date,'now',()=>now);
 const saved=snapshot(aggregate,now-29*60000);
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{if(disabled)throw Error('owner_disabled');},reserve:async()=>{},readQuery:async()=>saved,fetcher:async()=>{requests++;return Response.json(aggregate==='count'?[{total:25}]:[]);}});
 assert.equal((await client.read({table:'korea',aggregate},ip)).observedAt,saved.observedAt);assert.equal(requests,0);
 disabled=true;await assert.rejects(client.read({table:'korea',aggregate},ip),/owner_disabled/);disabled=false;
 now+=2*60000;await client.read({table:'korea',aggregate},ip);assert.equal(requests,1,'memoization must not renew the 30-minute observation window');
});
test('same-visitor recovery during cooldown does no new storage or supplier work and remains stale',async t=>{
 let now=Date.parse('2026-11-07T12:00:00Z'),reads=0,requests=0,disabled=false,password='fixture';t.mock.method(Date,'now',()=>now);
 const saved=snapshot('makes',now-3600000);
 const client=createAjesClient({password:()=>password,assertEnabled:async()=>{if(disabled)throw Error('owner_disabled');},reserve:async()=>{},readQuery:async()=>{reads++;return saved;},fetcher:async()=>{requests++;return new Response('ban2 fixture');}});
 const query={table:'korea' as const,aggregate:'makes' as const};
 const first=await client.read(query,ip);assert.equal(first.stale,true);const initialReads=reads;
 for(let i=0;i<3;i++){now+=5000;const value=await client.read(query,ip);assert.equal(value.stale,true);assert.equal(value.observedAt,saved.observedAt);}
 assert.equal(reads,initialReads);assert.equal(requests,1);
 disabled=true;await assert.rejects(client.read(query,ip),/owner_disabled/);disabled=false;
 password='';await assert.rejects(client.read(query,ip),/not_configured/);password='fixture';
 await assert.rejects(client.read(query,''),/client_ip_missing/);
 await client.read(query,'203.0.113.99');assert.equal(requests,2,'another visitor must not inherit refusal or recovered data');
 const before=reads;now+=16000;await client.read(query,ip);assert.ok(reads>before,'reads never slide the existing 30-second recovery deadline');assert.equal(requests,2,'active visitor cooldown still prohibits source retries');
});
test('new shared success wins over an older visitor-specific recovery',async()=>{
 const saved=snapshot('makes',Date.now()-3600000);let calls=0;
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async()=>saved,fetcher:async()=>++calls===1?new Response('ban2 fixture'):Response.json([{MARKA_NAME:'HYUNDAI',TAG1:'10'}])});
 const q={table:'korea' as const,aggregate:'makes' as const};
 assert.equal((await client.read(q,ip)).stale,true);
 assert.equal((await client.read(q,'203.0.113.99')).stale,false);
 const next=await client.read(q,ip);assert.equal(next.stale,false);assert.equal(next.makes[0].make,'HYUNDAI');assert.equal(calls,2);
});
test('prepared metadata never promotes partial, stale, future, wrong-page or malformed data',async()=>{
 for(const patch of [{partial:true},{stale:true},{observedAt:new Date(Date.now()+60000).toISOString()},{page:2},{pageSize:1},{makes:null}]){
  let calls=0;const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async()=>({...snapshot('makes'),...patch}),fetcher:async()=>{calls++;return Response.json([{MARKA_NAME:'KIA',TAG1:'24'}]);}});
  const value=await client.read({table:'korea',aggregate:'makes'},ip);assert.equal(calls,1,JSON.stringify(patch));assert.equal(value.stale,false);
 }
});
