import test from 'node:test';
import assert from 'node:assert/strict';
import {AjesUnavailable,createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesErrorResponse} from '../apps/web/lib/catalog/ajes-error-response';

const ip='203.0.113.10';
const query={table:'stats' as const,powerTo:160};
const savedPage=(now:number)=>({schemaVersion:2,items:[{id:'saved001',table:'stats'}],page:1,pageSize:24,received:1,rejected:0,stale:false,observedAt:new Date(now-3600000).toISOString()});

test('an aborted power search reuses this visitor\'s saved page only until the original cooldown expires',async t=>{
 let now=Date.parse('2026-11-10T02:00:00Z'),requests=0,reads=0,disabled=false;
 t.mock.method(Date,'now',()=>now);
 t.mock.timers.enable({apis:['setTimeout']});
 const saved=savedPage(now);
 let started!:()=>void;
 const requestStarted=new Promise<void>(resolve=>{started=resolve;});
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{if(disabled)throw Error('owner_disabled');},reserve:async()=>{},readQuery:async()=>{reads++;return saved;},fetcher:async(_url,options)=>{
  requests++;
  if(requests>1)return Response.json([]);
  started();
  return new Promise<Response>((_resolve,reject)=>options!.signal!.addEventListener('abort',()=>reject(options!.signal!.reason),{once:true}));
 }});
 const first=client.read(query,ip);
 await requestStarted;now+=4500;t.mock.timers.tick(4500);
 const recovered=await first;
 assert.equal(recovered.stale,true);assert.equal(recovered.observedAt,saved.observedAt);
 const originalReads=reads;
 now+=29000;
 const repeated=await client.read(query,ip);
 assert.equal(repeated.stale,true);assert.equal(repeated.observedAt,saved.observedAt);
 assert.equal(requests,1,'the timeout cooldown avoids another source request');
 assert.equal(reads,originalReads,'recovery does not repeat stored inspection during cooldown');
 disabled=true;await assert.rejects(client.read(query,ip),/owner_disabled/);disabled=false;
 now+=1001;
 assert.equal((await client.read(query,ip)).stale,false);
 assert.equal(requests,2,'reading recovered data must not extend the original cooldown');
});

for(const kind of ['request_failed','connect_timeout'] as const)test(`${kind} normalization preserves private cooldown and a newer shared success wins`,async()=>{
 let requests=0,reads=0;
 const saved=savedPage(Date.now());
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async()=>{reads++;return saved;},fetcher:async()=>{
  requests++;
  if(requests===1)throw new TypeError('fetch failed',{cause:{code:kind==='connect_timeout'?'UND_ERR_CONNECT_TIMEOUT':'ECONNRESET'}});
  return Response.json([]);
 }});
 assert.equal((await client.read(query,ip)).stale,true);
 const originalReads=reads;
 assert.equal((await client.read(query,ip)).stale,true);
 assert.equal(requests,1);assert.equal(reads,originalReads);
 assert.equal((await client.read(query,'203.0.113.11')).stale,false);
 assert.equal(requests,2,'another visitor neither inherits the cooldown nor the stale response');
 const current=await client.read(query,ip);
 assert.equal(current.stale,false);assert.deepEqual(current.items,[]);
 assert.equal(requests,2,'new shared success takes precedence over private recovery');
});

test('public errors distinguish typed local pressure while concealing unknown and programming failures',()=>{
 const busy=ajesErrorResponse(new AjesUnavailable('local_busy'));
 assert.deepEqual(busy,{status:503,body:{ok:false,error:'japan_search_unavailable',reason:'local_busy'}});
 for(const error of [new Error('detail_cache_queue_timeout'),new TypeError('PRIVATE_TOKEN internal-path'),new AjesUnavailable('PRIVATE_TOKEN')]){
  const result=ajesErrorResponse(error);
  assert.equal(result.status,503);assert.equal(result.body.reason,'operation_failed');
  assert.equal('total' in result.body,false);assert.ok(!JSON.stringify(result).includes('PRIVATE_TOKEN'));
 }
});
