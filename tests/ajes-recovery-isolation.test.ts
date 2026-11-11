import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';

test('slow saved recovery for refused Korea and Japan reads does not occupy supplier admission',async()=>{
 let release!:()=>void,ready!:()=>void,started=0,active=0,peak=0;
 const held=new Promise<void>(r=>{release=r;});
 const recoveryStarted=new Promise<void>(r=>{ready=r;});
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},
  readLegacyQuery:async()=>{if(++started===2)ready();await held;return null;},
  fetcher:async url=>{active++;peak=Math.max(peak,active);try{
   const ip=new URL(String(url)).searchParams.get('ip');
   return ip==='203.0.113.3'?Response.json([]):new Response('bot fixture');
  }finally{active--;}}
 });
 const refused=[client.read({table:'korea',page:2},'203.0.113.1'),client.read({table:'stats',page:2},'203.0.113.2')];
 const rejected=Promise.all(refused.map(p=>assert.rejects(p,/visitor_restricted/)));
 await recoveryStarted;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  const fresh=client.read({table:'korea',page:4},'203.0.113.3');
  const result=await Promise.race([fresh,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('fresh supplier read blocked by saved recovery')),500);})]);
  assert.deepEqual(result.items,[]);assert.equal(result.stale,false);
  assert.ok(peak<=2,'supplier concurrency stays bounded');
 }finally{if(timer)clearTimeout(timer);release();await rejected;}
});

test('duplicate refused reads share stored recovery without retrying the source or poisoning another visitor',async()=>{
 let release!:()=>void,ready!:()=>void,reads=0,requests=0;
 const held=new Promise<void>(r=>{release=r;});
 const recoveryStarted=new Promise<void>(r=>{ready=r;});
 const saved={schemaVersion:2,items:[{id:'retained',table:'korea'}],page:2,pageSize:24,received:24,observedAt:new Date(Date.now()-3600000).toISOString()};
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},
  readLegacyQuery:async()=>{reads++;ready();await held;return saved;},
  fetcher:async url=>{requests++;return new URL(String(url)).searchParams.get('ip')==='203.0.113.2'?Response.json([]):new Response('bot fixture');}
 });
 const input={table:'korea' as const,page:2};
 const pending=[client.read(input,'203.0.113.1'),client.read(input,'203.0.113.1')];
 await recoveryStarted;release();
 assert.ok((await Promise.all(pending)).every(r=>r.stale&&r.items[0].id==='retained'));
 assert.equal(reads,1);assert.equal(requests,1);
 assert.equal((await client.read(input,'203.0.113.1')).stale,true);
 assert.equal(requests,1,'refusal cooldown is retained');assert.equal(reads,1,'stored recovery remains visitor-cached');
 const other=await client.read(input,'203.0.113.2');
 assert.equal(other.stale,false);assert.deepEqual(other.items,[]);assert.equal(requests,2);
});

test('independent requests still admit at most two supplier calls',async()=>{
 let release!:()=>void,ready!:()=>void,active=0,peak=0;
 const held=new Promise<void>(r=>{release=r;});const twoStarted=new Promise<void>(r=>{ready=r;});
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>{
  active++;peak=Math.max(peak,active);if(active===2)ready();await held;active--;return Response.json([]);
 }});
 const calls=[1,2,3,4].map(page=>client.read({table:'korea',page},'203.0.113.1'));
 await twoStarted;assert.equal(active,2);release();await Promise.all(calls);assert.equal(peak,2);
});
