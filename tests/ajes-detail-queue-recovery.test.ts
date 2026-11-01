import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesClient,AjesUnavailable} from '../apps/web/lib/catalog/ajes-client';
import {DetailReadCache} from '../apps/web/lib/catalog/detail-read-cache';
const snapshot=(table:string)=>({schemaVersion:2,fullInformation:true,items:[{id:'fixture001',table,sourcePrice:12345}],page:1,pageSize:1,observedAt:new Date(Date.now()-3600000).toISOString()});
const busy=(e:unknown)=>e instanceof AjesUnavailable&&e.reason==='local_busy';
function blockSupplier(t:any,message:string){
 const original=DetailReadCache.prototype.get;
 t.mock.method(DetailReadCache.prototype,'get',function(this:any,...args:any[]){return args[3]==='detail'?Promise.reject(Error(message)):original.apply(this,args as any);});
}
for(const table of ['korea','china','stats'] as const)for(const message of ['detail_cache_queue_timeout','detail_cache_queue_full'])test(`${table} ${message} recovers exact stored detail without supplier or fresh promotion`,async t=>{
 blockSupplier(t,message);const saved=snapshot(table),before=structuredClone(saved);let reads=0;
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{throw Error('supplier reserve forbidden');},fetcher:async()=>{throw Error('supplier fetch forbidden');},readDetail:async(m,id)=>{assert.equal(m,table);assert.equal(id,'fixture001');reads++;return saved;}});
 const result=await client.read({table,id:'fixture001'},'203.0.113.1');
 assert.deepEqual(result,{...saved,stale:true});assert.deepEqual(saved,before);
 await client.read({table,id:'fixture001'},'203.0.113.1');assert.equal(reads,1);
 await client.read({table,id:'fixture001'},'203.0.113.2');assert.equal(reads,2);
});
test('invalid full detail falls through to exact listed record; partial remains explicit',async t=>{
 blockSupplier(t,'detail_cache_queue_full');const saved=snapshot('korea');
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{throw Error('no supplier');},readDetail:async()=>({...saved,items:[{id:'wrong',table:'korea'}]}),readListedDetail:async()=>saved});
 assert.deepEqual(await client.read({table:'korea',id:'fixture001'},'203.0.113.1'),{...saved,stale:true,partial:true});
});
test('recovery rejects wrong identity, market, page, shape, future and expired snapshots',async t=>{
 blockSupplier(t,'detail_cache_queue_timeout');const s=snapshot('korea');
 for(const bad of [null,{...s,items:[]},{...s,items:[{id:'wrong',table:'korea'}]},{...s,items:[{id:'fixture001',table:'china'}]},{...s,page:2},{...s,pageSize:24},{...s,observedAt:'invalid'},{...s,observedAt:new Date(Date.now()+60000).toISOString()},{...s,observedAt:new Date(Date.now()-7*86400000).toISOString()}]){
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readDetail:async()=>bad,readListedDetail:async()=>bad});
 await assert.rejects(client.read({table:'korea',id:'fixture001'},'203.0.113.1'),busy);
 }
});
test('owner disable during recovery is respected and storage errors stay unavailable',async t=>{
 blockSupplier(t,'detail_cache_queue_full');let disabled=false;const denied=Error('owner disabled');
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{if(disabled)throw denied;},reserve:async()=>{},readDetail:async()=>{disabled=true;return snapshot('korea');}});
 await assert.rejects(client.read({table:'korea',id:'fixture001'},'203.0.113.1'),e=>e===denied);
 const broken=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readDetail:async()=>{throw Error('storage');},readListedDetail:async()=>{throw Error('storage');}});
 await assert.rejects(broken.read({table:'korea',id:'fixture001'},'203.0.113.1'),busy);
});
test('saved recovery stays bounded under concurrent callers and never escapes to supplier',async t=>{
 blockSupplier(t,'detail_cache_queue_full');let active=0,maxActive=0;const release:Array<()=>void>=[];
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{throw Error('no supplier');},readDetail:async()=>{active++;maxActive=Math.max(active,maxActive);await new Promise<void>(resolve=>release.push(resolve));active--;return snapshot('korea');}});
 const a=client.read({table:'korea',id:'fixture001'},'203.0.113.1');
 const b=client.read({table:'korea',id:'fixture001'},'203.0.113.2');
 const c=client.read({table:'korea',id:'fixture001'},'203.0.113.3');
 await assert.rejects(c,busy);assert.equal(maxActive,2);assert.equal(release.length,2);
 release.forEach(resolve=>resolve());await Promise.all([a,b]);
});
