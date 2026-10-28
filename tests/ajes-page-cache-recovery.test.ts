import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {ajesQueryCacheLocation,readAjesQueryCache,saveAjesQueryCache,retainedAjesQueryEntries} from '../apps/web/lib/catalog/ajes-query-cache';

function fixture(){
 const objects=new Map<string,any>();
 const storage={readJson:async(key:string)=>objects.get(key)??null,writeJson:async(key:string,value:any)=>{objects.set(key,structuredClone(value));}};
 const first=ajesQuery({table:'korea',page:3}).sql,location=ajesQueryCacheLocation(first).key;
 const queries=[first];
 for(let i=0;queries.length<6&&i<5000;i++){
  const sql=ajesQuery({table:'stats',lotNumber:String(i)}).sql;
  if(ajesQueryCacheLocation(sql).key===location)queries.push(sql);
 }
 assert.equal(queries.length,6);
 return {objects,storage,queries,location};
}

test('a previously viewed Korea page survives an unrelated colliding search and a subsequent source refusal',async()=>{
 const objects=new Map<string,any>();
 const storage={readJson:async(key:string)=>objects.get(key)??null,writeJson:async(key:string,value:any)=>{objects.set(key,structuredClone(value));}};
 const input={table:'korea' as const,page:3},sql=ajesQuery(input).sql;
 const location=ajesQueryCacheLocation(sql).key;
 const other=Array.from({length:2000},(_,i)=>ajesQuery({table:'stats',lotNumber:String(i)}).sql).find(key=>ajesQueryCacheLocation(key).key===location)!;
 assert.ok(other,'the current bounded cache has real cross-query collisions');
 const saved={schemaVersion:2,items:[{id:'korea-page-three',table:'korea'}],page:3,pageSize:24,received:24,observedAt:new Date(Date.now()-3600000).toISOString()};
 await saveAjesQueryCache(storage,sql,saved);
 await saveAjesQueryCache(storage,other,{items:[{id:'unrelated',table:'stats'}],page:1,pageSize:24,observedAt:saved.observedAt});
 let requests=0;
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readQuery:key=>readAjesQueryCache(storage,key),fetcher:async()=>{requests++;return new Response('bot fixture');}});
 const result=await client.read(input,'203.0.113.1');
 assert.deepEqual(result.items,saved.items);assert.equal(result.page,3);assert.equal(result.stale,true);
 assert.equal(requests,1,'a source refusal is not retried or rerouted');
 assert.deepEqual(await readAjesQueryCache(storage,other),objects.get(location).value);
 assert.equal(await readAjesQueryCache(storage,ajesQuery({...input,page:4}).sql),null,'never substitute page three for an unseen fourth page');
});

test('colliding concurrent page writes retain the newest four exact selections within the existing slot',async()=>{
 const {objects,storage,queries,location}=fixture();
 await Promise.all(queries.map((sql,page)=>saveAjesQueryCache(storage,sql,{items:[{id:String(page)}]})));
 assert.equal(objects.size,1,'no new unbounded query object keys');
 assert.equal(retainedAjesQueryEntries(objects.get(location)).length,4);
 for(let i=0;i<queries.length;i++)assert.deepEqual(await readAjesQueryCache(storage,queries[i]),i<2?null:{items:[{id:String(i)}]});
});

test('a newer empty response replaces old rows for the same query instead of resurrecting them',async()=>{
 const {objects,storage,queries,location}=fixture();
 await saveAjesQueryCache(storage,queries[0],{items:[{id:'old'}]});
 await saveAjesQueryCache(storage,queries[1],{items:[{id:'other'}]});
 await saveAjesQueryCache(storage,queries[0],{items:[],received:0});
 assert.deepEqual(await readAjesQueryCache(storage,queries[0]),{items:[],received:0});
 assert.equal(retainedAjesQueryEntries(objects.get(location)).filter(e=>e.hash===ajesQueryCacheLocation(queries[0]).hash).length,1);
 assert.equal(JSON.stringify(objects.get(location)).includes('"old"'),false);
});

test('bucket bytes stay below 256 KiB and an oversized incoming response cannot erase retained pages',async()=>{
 const {objects,storage,queries,location}=fixture();
 for(let i=0;i<5;i++)await saveAjesQueryCache(storage,queries[i],{items:[{id:String(i),text:'x'.repeat(100_000)}]});
 const before=structuredClone(objects.get(location));
 assert.ok(Buffer.byteLength(JSON.stringify(before))<=256*1024);
 assert.equal(retainedAjesQueryEntries(before).length,2);
 await saveAjesQueryCache(storage,queries[5],{items:[{text:'x'.repeat(256*1024)}]});
 assert.deepEqual(objects.get(location),before);
});

test('legacy single-response slots remain readable, with no mutation of retained entries',async()=>{
 const {objects,storage,queries,location}=fixture();
 const legacy={hash:ajesQueryCacheLocation(queries[0]).hash,value:{items:[{id:'legacy'}]}};
 objects.set(location,legacy);
 await saveAjesQueryCache(storage,queries[1],{items:[{id:'new'}]});
 assert.deepEqual(await readAjesQueryCache(storage,queries[0]),legacy.value);
 assert.deepEqual(Object.keys(legacy).sort(),['hash','value']);
 assert.deepEqual(retainedAjesQueryEntries({previous:[{hash:'invalid',value:{}}]}),[]);
});

test('expired saved third pages remain unavailable and failed writes do not poison later saves',async()=>{
 const {objects,storage,queries,location}=fixture();
 await saveAjesQueryCache(storage,queries[0],{items:[{id:'expired',table:'korea'}],page:3,pageSize:24,observedAt:'2000-01-01'});
 await saveAjesQueryCache(storage,queries[1],{items:[]});
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readQuery:key=>readAjesQueryCache(storage,key),fetcher:async()=>new Response('bot fixture')});
 await assert.rejects(client.read({table:'korea',page:3},'203.0.113.1'),/visitor_restricted/);
 let fail=true;
 const unreliable={...storage,writeJson:async(key:string,value:any)=>{if(fail){fail=false;throw Error('storage unavailable');}objects.set(key,value);}};
 await assert.rejects(saveAjesQueryCache(unreliable,queries[2],{items:[]}),/storage unavailable/);
 await saveAjesQueryCache(unreliable,queries[3],{items:[{id:'recovered'}]});
 assert.deepEqual(objects.get(location).value,{items:[{id:'recovered'}]});
});
