import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesQuery,ajesSourceCacheSql,type AjesQuery} from '../apps/web/lib/catalog/ajes-query';
import {readAjesQueryCache,saveAjesQueryCache} from '../apps/web/lib/catalog/ajes-query-cache';
import {compileModelFacts,checksum,type CalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';

const ip='203.0.113.1';
const row={ID:'fresh001',MARKA_NAME:'TOYOTA',MODEL_NAME:'TEST',YEAR:'2023',AUCTION_TYPE:'2',STATUS:'Sold',FINISH:'100000',START:'100000'};
const base={password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{}};
const tick=()=>new Promise(r=>setTimeout(r,0));
const sqlOf=(url:unknown)=>new URL(String(url)).searchParams.get('sql')!;
const isCount=(sql:string)=>sql.startsWith('select count(*)');
const snapshot=(patch:any={})=>({schemaVersion:2,items:[{id:'retained',table:'stats'}],page:1,pageSize:24,received:24,rejected:0,stale:false,observedAt:new Date(Date.now()-3600000).toISOString(),...patch});
const countSnapshot=(patch:any={})=>({items:[],total:0,page:1,pageSize:1,received:1,rejected:0,stale:false,observedAt:new Date().toISOString(),...patch});
async function deadline<T>(pending:Promise<T>,message:string){let timer:ReturnType<typeof setTimeout>;return Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),2500);})]).finally(()=>clearTimeout(timer!));}
function store(){
 const objects=new Map<string,any>();
 const storage={readJson:async(key:string)=>objects.get(key)??null,writeJson:async(key:string,value:any)=>{objects.set(key,structuredClone(value));}};
 return {storage,readQuery:(sql:string)=>readAjesQueryCache(storage,sql),saveQuery:(sql:string,value:any)=>saveAjesQueryCache(storage,sql,value)};
}

test('an unconfirmed empty wire page preserves useful exact rows and never writes a fresh empty cache',async()=>{
 const stored=store(),input={table:'stats' as const},sql=ajesQuery(input).sql,saved=snapshot();
 await stored.saveQuery(sql,saved);
 let lists=0,counts=0;
 const client=createAjesClient({...base,...stored,fetcher:async url=>isCount(sqlOf(url))?(counts++,Response.json([{total:660813}])):(lists++,Response.json([]))});
 const result=await client.read(input,ip);
 assert.equal(result.stale,true);assert.equal(result.items[0].id,'retained');assert.equal(result.observedAt,saved.observedAt);
 await tick();assert.deepEqual(await stored.readQuery(sql),saved,'unverified [] must not overwrite the prior useful response');
 assert.equal((await client.read(input,ip)).stale,true);assert.equal(lists,1);assert.equal(counts,1,'visitor cooldown prevents a repeated list/count pair');
 const restarted=createAjesClient({...base,...stored,fetcher:async()=>new Response('bot fixture')});
 assert.equal((await restarted.read(input,'203.0.113.2')).items[0].id,'retained');
});

test('old fresh-looking empty cache without proof is refreshed and may recover legacy rows',async()=>{
 const empty=snapshot({items:[],received:0,observedAt:new Date().toISOString()}),saved=snapshot({partial:true});
 let requests=0,legacy=0;
 const client=createAjesClient({...base,readQuery:async()=>empty,readLegacyQuery:async()=>{legacy++;return saved;},fetcher:async()=>{requests++;return new Response('bot fixture');}});
 const result=await client.read({},ip);
 assert.equal(requests,1);assert.equal(legacy,1);assert.equal(result.stale,true);assert.equal(result.partial,true);assert.equal(result.items[0].id,'retained');
});

test('validated exact zero replaces prior rows and survives restart without another source read',async()=>{
 const stored=store(),input={table:'stats' as const,make:'TOYOTA'},sql=ajesSourceCacheSql(ajesQuery(input).sql);
 await stored.saveQuery(sql,snapshot());
 const requests:string[]=[];
 const client=createAjesClient({...base,...stored,fetcher:async url=>{const sql=sqlOf(url);requests.push(sql);return Response.json(isCount(sql)?[{total:0}]:[]);}});
 const result=await client.read(input,ip);assert.equal(result.stale,false);assert.deepEqual(result.items,[]);assert.equal(result.emptyPageEvidence.countTotal,0);
 await tick();assert.deepEqual((await stored.readQuery(sql)).items,[]);assert.equal(requests.length,2);
 const restarted=createAjesClient({...base,...stored,reserve:async()=>{throw Error('verified cache must not reserve a supplier request');}});
 const cached=await restarted.read(input,'203.0.113.2');assert.equal(cached.stale,false);assert.deepEqual(cached.items,[]);assert.equal(cached.observedAt,result.observedAt);
});

test('an expired persisted zero proof blocks older exact, legacy and partial recovery after restart',async()=>{
 const verified=await createAjesClient({...base,fetcher:async url=>Response.json(isCount(sqlOf(url))?[{total:0}]:[])}).read({},ip);
 const observedAt=new Date(Date.now()-31*60000).toISOString();
 const expired={...verified,observedAt,emptyPageEvidence:{...verified.emptyPageEvidence,sourceObservedAt:observedAt,countObservedAt:observedAt}};
 let legacy=0,partial=0,calls=0;
 const restarted=createAjesClient({...base,readQuery:async()=>expired,readLegacyQuery:async()=>{legacy++;return snapshot();},readSavedSearch:async()=>{partial++;return snapshot({partial:true});},fetcher:async()=>{calls++;return new Response('unavailable',{status:503});}});
 await assert.rejects(restarted.read({},ip),/http_503/);assert.equal(calls,1);assert.equal(legacy,0);assert.equal(partial,0);
});

test('a malformed historical proof cannot turn an unverified empty into a recovery barrier',async()=>{
 const verified=await createAjesClient({...base,fetcher:async url=>Response.json(isCount(sqlOf(url))?[{total:0}]:[])}).read({},ip);
 for(const countObservedAt of ['2000-01-01','not-a-date']){
  const corrupt={...verified,emptyPageEvidence:{...verified.emptyPageEvidence,countObservedAt}};
  const client=createAjesClient({...base,readQuery:async()=>corrupt,readLegacyQuery:async()=>snapshot({partial:true}),fetcher:async()=>new Response('unavailable',{status:503})});
  const recovered=await client.read({},ip);assert.equal(recovered.stale,true);assert.equal(recovered.items[0].id,'retained');
 }
});

test('a newly verified zero retires older visitor recovery even when the count deadline expires first',async t=>{
 const start=Date.now();let calls=0;
 t.mock.timers.enable({apis:['Date'],now:start});
 const sql=ajesQuery({}).sql,countSql=ajesQuery({aggregate:'count'}).sql;
 const values=new Map<string,any>([[sql,snapshot()],[countSql,countSnapshot({observedAt:new Date(start-30*60000+1000).toISOString()})]]);
 const client=createAjesClient({...base,readQuery:async key=>values.get(key)??null,saveQuery:async(key,value)=>{values.set(key,value);},fetcher:async url=>{
  calls++;assert.equal(isCount(sqlOf(url)),false,'the still-fresh exact count is already available');
  return new URL(String(url)).searchParams.get('ip')==='203.0.113.2'?Response.json([]):new Response('unavailable',{status:503});
 }});
 assert.equal((await client.read({},ip)).items[0].id,'retained');
 assert.deepEqual((await client.read({},'203.0.113.2')).items,[]);await tick();
 t.mock.timers.setTime(start+2000);
 await assert.rejects(client.read({},ip),/http_503/,'expired fresh zero must not expose pre-zero visitor-cached cars');
 assert.equal(calls,2,'the original visitor cooldown is not bypassed for another request');
});

test('a late refused request cannot restore old rows after another visitor confirms zero',async()=>{
 let release!:()=>void,started!:()=>void,calls=0;
 const held=new Promise<void>(r=>release=r),recoveryStarted=new Promise<void>(r=>started=r);
 const client=createAjesClient({...base,readLegacyQuery:async()=>{started();await held;return snapshot();},fetcher:async url=>{
  calls++;if(new URL(String(url)).searchParams.get('ip')===ip)return new Response('unavailable',{status:503});
  return Response.json(isCount(sqlOf(url))?[{total:0}]:[]);
 }});
 const old=client.read({},ip);
 try{
  await deadline(recoveryStarted,'old recovery did not start');
  const current=await client.read({},'203.0.113.2');assert.deepEqual(current.items,[]);assert.equal(current.stale,false);
  release();const recovered=await old;assert.deepEqual(recovered.items,[]);assert.equal(recovered.stale,false);assert.equal(recovered.observedAt,current.observedAt);assert.equal(calls,3);
 }finally{release();await Promise.allSettled([old]);}
});

test('a concurrent earlier nonempty memory response cannot hide a later verified zero',async()=>{
 let releaseA!:()=>void,releaseB!:()=>void,started!:()=>void,lists=0;
 const heldA=new Promise<void>(r=>releaseA=r),heldB=new Promise<void>(r=>releaseB=r),bothStarted=new Promise<void>(r=>started=r),stored=store();
 const client=createAjesClient({...base,...stored,fetcher:async url=>{
  if(isCount(sqlOf(url)))return Response.json([{total:0}]);
  if(++lists===2)started();
  if(new URL(String(url)).searchParams.get('ip')===ip){await heldA;return Response.json([row]);}
  await heldB;return Response.json([]);
 }});
 const a=client.read({},ip),b=client.read({},'203.0.113.2');
 try{
  await deadline(bothStarted,'two visitor lists did not start');releaseA();assert.equal((await a).items[0].id,row.ID);
  releaseB();const zero=await b;assert.deepEqual(zero.items,[]);assert.equal(zero.emptyPageEvidence.countTotal,0);
  await tick();assert.deepEqual((await stored.readQuery(ajesSourceCacheSql(ajesQuery({}).sql))).items,[]);assert.deepEqual((await client.read({},ip)).items,[]);
 }finally{releaseA();releaseB();await Promise.allSettled([a,b]);}
});

test('a newer successful nonempty observation lifts the zero barrier and remains recoverable',async t=>{
 const start=Date.now();let phase=0;
 t.mock.timers.enable({apis:['Date'],now:start});
 const sql=ajesSourceCacheSql(ajesQuery({}).sql),countSql=ajesSourceCacheSql(ajesQuery({aggregate:'count'}).sql);
 const values=new Map<string,any>([[countSql,countSnapshot({observedAt:new Date(start-30*60000+1000).toISOString()})]]);
 const client=createAjesClient({...base,readQuery:async key=>values.get(key)??null,saveQuery:async(key,value)=>{values.set(key,value);},fetcher:async()=>phase===0?Response.json([]):phase===1?Response.json([row]):new Response('unavailable',{status:503})});
 assert.deepEqual((await client.read({},ip)).items,[]);await tick();t.mock.timers.setTime(start+2000);phase=1;
 const newer=await client.read({},ip);assert.equal(newer.items[0].id,row.ID);assert.equal(newer.stale,false);await tick();
 assert.equal((await client.read({},'203.0.113.2')).items[0].id,row.ID);
 t.mock.timers.setTime(start+32*60000);phase=2;
 const recovered=await client.read({},'203.0.113.3');assert.equal(recovered.items[0].id,row.ID);assert.equal(recovered.stale,true);assert.equal((await values.get(sql)).items[0].id,row.ID);
});

test('only exact count zero or a count at or below the requested page offset confirms exhaustion',async()=>{
 for(const [page,total,valid] of [[1,0,true],[1,1,false],[3,48,true],[3,49,false]] as const){
  const requests:string[]=[];const input={table:'stats' as const,page,pageSize:24,fuel:'petrol',powerTo:160};
  const client=createAjesClient({...base,fetcher:async url=>{const sql=sqlOf(url);requests.push(sql);return Response.json(isCount(sql)?[{total}]:[]);}});
  if(valid){const result=await client.read(input,ip);assert.deepEqual(result.items,[]);assert.equal(result.stale,false);assert.equal(result.emptyPageEvidence.countTotal,total);}
  else await assert.rejects(client.read(input,ip),/empty_response/);
  assert.deepEqual(requests,[ajesQuery(input).sql,ajesQuery({...input,aggregate:'count'}).sql]);
  assert.doesNotMatch(requests[1],/pw\s*[<>]/i,'raw source COUNT is not a local horsepower upper-bound placeholder');
 }
});

test('a saved exact count is reused, but stale, partial, future and upper-bound zero never certify an empty page',async()=>{
 const input={table:'stats' as const,fuel:'petrol',powerTo:160};
 const countSql=ajesSourceCacheSql(ajesQuery({...input,aggregate:'count'}).sql);
 for(const patch of [{},{stale:true},{partial:true},{upperBound:true},{observedAt:new Date(Date.now()-31*60000).toISOString()},{observedAt:new Date(Date.now()+60000).toISOString()}]){
  let listCalls=0,countCalls=0;
  const client=createAjesClient({...base,readQuery:async sql=>sql===countSql?countSnapshot(patch):null,fetcher:async url=>{
   if(isCount(sqlOf(url))){countCalls++;return new Response('bot fixture');}listCalls++;return Response.json([]);
  }});
  if(!Object.keys(patch).length){const result=await client.read(input,ip);assert.equal(result.stale,false);assert.deepEqual(result.items,[]);assert.equal(countCalls,0);}
  else await assert.rejects(client.read(input,ip),/^Error: ajes_(?:empty_response|visitor_restricted)$/);
  assert.equal(listCalls,1);
 }
});

test('a refusal during verification remains visitor-local and the original IP is used for list and count',async()=>{
 const requests:Array<{sql:string;ip:string}>=[],saved=snapshot();
 const client=createAjesClient({...base,readQuery:async sql=>isCount(sql)?null:saved,fetcher:async url=>{
  const parsed=new URL(String(url)),sql=sqlOf(url),sourceIp=parsed.searchParams.get('ip')!;requests.push({sql,ip:sourceIp});
  if(sourceIp==='203.0.113.2')return Response.json([row]);
  return isCount(sql)?new Response('bot fixture'):Response.json([]);
 }});
 assert.equal((await client.read({},ip)).stale,true);
 assert.equal((await client.read({},ip)).stale,true);assert.equal(requests.length,2);
 assert.ok(requests.every(request=>request.ip===ip));
 const other=await client.read({},'203.0.113.2');assert.equal(other.stale,false);assert.equal(other.items[0].id,row.ID);assert.equal(requests.length,3);
});

test('two different empty lists release both supplier slots before their count checks',async()=>{
 let releaseLists!:()=>void,releaseCounts!:()=>void,listsReady!:()=>void,countsReady!:()=>void,active=0,peak=0,lists=0,counts=0;
 const heldLists=new Promise<void>(r=>releaseLists=r),heldCounts=new Promise<void>(r=>releaseCounts=r),twoLists=new Promise<void>(r=>listsReady=r),twoCounts=new Promise<void>(r=>countsReady=r);
 const client=createAjesClient({...base,fetcher:async url=>{
  active++;peak=Math.max(peak,active);
  try{if(isCount(sqlOf(url))){if(++counts===2)countsReady();await heldCounts;return Response.json([{total:0}]);}
   if(++lists===2)listsReady();await heldLists;return Response.json([]);
  }finally{active--;}
 }});
 const pending=['TOYOTA','HONDA'].map(make=>client.read({make},ip));
 try{
  await deadline(twoLists,'two source lists did not start');assert.equal(active,2);releaseLists();
  await deadline(twoCounts,'empty lists retained supplier admission during COUNT');assert.equal(active,2);assert.equal(peak,2);releaseCounts();
  const results=await Promise.all(pending);assert.ok(results.every(result=>!result.stale&&result.items.length===0));assert.equal(lists,2);assert.equal(counts,2);
 }finally{releaseLists();releaseCounts();await Promise.allSettled(pending);}
});

test('two failed count checks can recover saved rows without holding visitor recovery admission',async()=>{
 let active=0,peak=0;
 const client=createAjesClient({...base,readQuery:async sql=>isCount(sql)?null:snapshot(),fetcher:async url=>{
  active++;peak=Math.max(peak,active);try{await tick();return isCount(sqlOf(url))?new Response('bot fixture'):Response.json([]);}finally{active--;}
 }});
 const pending=['TOYOTA','HONDA'].map((make,i)=>client.read({make},'203.0.113.'+(i+1)));
 const results=await deadline(Promise.all(pending),'count failure recovery deadlocked behind empty validation');
 assert.ok(results.every(result=>result.stale&&result.items[0].id==='retained'));assert.ok(peak<=2);
});

test('verification reuses the original query index and cannot silently change its drive WHERE',async()=>{
 const makeIndex=(drive:string):CalculationIndex=>{const models={alto:compileModelFacts({id:'alto',make:'Suzuki',model:'Alto',revision:drive,variants:[{id:drive,year:2023,trim:'L',status:'observed',markets:['china'],chassisCode:'HA37S',drive}]})};return {version:1,digest:checksum(models),manifestDigest:drive,createdAt:'now',models};};
 const original=makeIndex('fwd'),changed=makeIndex('awd');let current=original,indexReads=0;
 const input:AjesQuery={table:'stats',drive:'fwd'},requests:string[]=[];
 assert.notEqual(ajesQuery({...input,aggregate:'count'},original).sql,ajesQuery({...input,aggregate:'count'},changed).sql);
 const client=createAjesClient({...base,calculationIndex:()=>{indexReads++;return current;},fetcher:async url=>{const sql=sqlOf(url);requests.push(sql);current=changed;return Response.json(isCount(sql)?[{total:0}]:[]);}});
 assert.deepEqual((await client.read(input,ip)).items,[]);assert.equal(indexReads,1);
 assert.deepEqual(requests,[ajesQuery(input,original).sql,ajesQuery({...input,aggregate:'count'},original).sql]);
});

test('proof is bound to the query, page and both source observations',async()=>{
 const input={table:'stats' as const,make:'TOYOTA'},verified=await createAjesClient({...base,fetcher:async url=>Response.json(isCount(sqlOf(url))?[{total:0}]:[])}).read(input,ip);
 for(const patch of [{sourceQueryHash:'0'.repeat(64)},{countQueryHash:'0'.repeat(64)},{page:2},{pageSize:48},{countTotal:1},{sourceObservedAt:'2000-01-01'},{countObservedAt:'2000-01-01'}]){
  let calls=0;const client=createAjesClient({...base,readQuery:async()=>({...verified,emptyPageEvidence:{...verified.emptyPageEvidence,...patch}}),fetcher:async()=>{calls++;return Response.json([row]);}});
  assert.equal((await client.read(input,ip)).items[0].id,row.ID);assert.equal(calls,1,JSON.stringify(patch));
 }
});

test('a new empty page cannot extend an older count observation beyond its source deadline',async t=>{
 const start=Date.now();let phase=0,lists=0,counts=0;
 t.mock.timers.enable({apis:['Date'],now:start});
 const oldCount=countSnapshot({observedAt:new Date(start-29*60000).toISOString()});
 const client=createAjesClient({...base,readQuery:async sql=>isCount(sql)?oldCount:null,fetcher:async url=>{
  if(isCount(sqlOf(url))){counts++;return new Response('bot fixture');}lists++;return Response.json(phase?[row]:[]);
 }});
 const first=await client.read({},ip);assert.deepEqual(first.items,[]);assert.equal(lists,1);assert.equal(counts,0);
 t.mock.timers.setTime(start+2*60000);phase=1;
 const later=await client.read({},ip);assert.equal(later.items[0].id,row.ID);assert.equal(lists,2,'the older count deadline must expire the verified empty memory entry');
});

test('nonempty wire rows and known disjoint years do not add a count request',async()=>{
 for(const sourceRows of [[row],[{...row,YEAR:'2007'}]]){
  let calls=0;const client=createAjesClient({...base,fetcher:async url=>{calls++;assert.equal(isCount(sqlOf(url)),false);return Response.json(sourceRows);}});
  const result=await client.read({},ip);assert.equal(result.received,1);assert.equal(calls,1);assert.equal(result.emptyPageEvidence,undefined);
 }
 let touches=0;const client=createAjesClient({...base,readQuery:async()=>{touches++;return null;},fetcher:async()=>{touches++;throw Error('source forbidden');}});
 const empty=await client.read({yearTo:2007},ip);assert.deepEqual(empty.items,[]);assert.equal(empty.total,0);assert.equal(touches,0);
});

test('verified empty cache still requires the real visitor, configured source and current owner switch',async()=>{
 const verified=await createAjesClient({...base,fetcher:async url=>Response.json(isCount(sqlOf(url))?[{total:0}]:[])}).read({},ip);
 let disabled=false,reads=0;const client=createAjesClient({...base,assertEnabled:async()=>{if(disabled)throw Error('owner_disabled');},readQuery:async()=>{reads++;return verified;},reserve:async()=>{throw Error('must not reserve');}});
 assert.deepEqual((await client.read({},ip)).items,[]);disabled=true;
 await assert.rejects(client.read({},ip),/owner_disabled/);disabled=false;
 await assert.rejects(client.read({},''),/client_ip_missing/);assert.equal(reads,1);
 await assert.rejects(createAjesClient({...base,password:()=>undefined,readQuery:async()=>verified}).read({},ip),/not_configured/);
});

test('public empty responses omit internal verification and source evidence',async()=>{
 const require=createRequire(import.meta.url),source=await createAjesClient({...base,fetcher:async url=>Response.json(isCount(sqlOf(url))?[{total:0}]:[])}).read({},ip);
 (globalThis as any).__emptyPageFixture={...source,sourceEvidence:{private:true},sourceEvidenceById:{private:true}};
 const stubs:Record<string,string>={
  'server-only':'','next/headers':`export const headers=async()=>new Map([['x-real-ip','${ip}']]);`,
  './ajes-runtime':'export const ajesClient={read:async()=>globalThis.__emptyPageFixture};',
  './editorial':'export const readCatalogEditorial=async()=>({});export const editorialHidden=()=>false;export const applyCatalogEditorial=x=>x;',
  './japan-owner-specifications':'export const applyJapanOwnerSpecifications=x=>x;',
  './japan-drive':'export const enrichJapanDrive=x=>x;export const japanDriveSql=()=>"";',
  '../encyclopedia/japan-fuel-reference':'export const applyJapanFactoryFuel=x=>x;',
  '../encyclopedia/calculation-index':'export const applyEncyclopediaCalculation=x=>x;export const readCalculationIndex=()=>null;',
  './rates':'export const convertToRub=()=>{throw Error("empty response must not request currency");};',
 };
 try{
  const built=await build({entryPoints:['apps/web/lib/catalog/ajes-public.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['react'],plugins:[{name:'empty-public-fixture',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}));}}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
  const result=await mod.exports.readAjesPublic({});assert.deepEqual(result.items,[]);assert.equal(result.received,0);assert.equal(result.stale,false);
  for(const field of ['emptyPageEvidence','sourceEvidence','sourceEvidenceById'])assert.equal(field in result,false);
  assert.doesNotMatch(JSON.stringify(result),/sourceQueryHash|countQueryHash|select \*|203\.0\.113/);
 }finally{delete (globalThis as any).__emptyPageFixture;}
});
