import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage,StorageConflictError} from '../apps/web/lib/data';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {sharedBudgetPrices,resetSharedBudgetPriceCache} from '../apps/web/lib/catalog/shared-budget-prices';

const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};
function fixture(){
 const storage=getJsonStorage(),original={readJson:storage.readJson,readJsonWithMeta:storage.readJsonWithMeta,writeJson:storage.writeJson};
 const objects=new Map<string,any>(),conditions:any[]=[];
 let writes=0,reads=0,loads=0;
 const index=buildBudgetCountIndex('persistence-generation',[
  {id:'one',market:'korea',totalRub:1_500_000,make:'Kia',model:'K3',year:2024},
 ] as any[],new Map(),3);
 const rows=index.rows.map(row=>row.slice(0,7) as typeof row);
 storage.readJson=async<T>(path:string,fallback:T)=>(objects.get(path)??fallback) as T;
 storage.readJsonWithMeta=async<T>(path:string,fallback:T)=>{
  reads++;return {found:objects.has(path),etag:objects.has(path)?'existing-etag':undefined,value:(objects.get(path)??fallback) as T};
 };
 storage.writeJson=async(path,value,condition)=>{writes++;conditions.push(condition);objects.set(path,structuredClone(value));};
 const request=(version='stable',required=false,fingerprintNow=async()=>version)=>sharedBudgetPrices(index,'korea',version,async()=>{loads++;return rows;},fingerprintNow,false,required?{persistence:'required'}:{});
 resetSharedBudgetPriceCache();
 return {storage,objects,conditions,index,rows,request,counts:()=>({writes,reads,loads}),restore(){Object.assign(storage,original);resetSharedBudgetPriceCache();}};
}

test('interactive calculation returns exact rows without writing a disposable snapshot',async()=>{
 const f=fixture();try{
  assert.deepEqual(await f.request(),f.rows);
  assert.deepEqual(await f.request(),f.rows);
  assert.deepEqual(f.counts(),{writes:0,reads:0,loads:1});
 }finally{f.restore();}
});

test('required persistence coalesces deferred PUTs without blocking interactive cached rows',async()=>{
 const f=fixture(),put=deferred(),entered=deferred(),write=f.storage.writeJson;
 let settled=0;
 f.storage.writeJson=async(...args)=>{entered.resolve();await put.promise;await write(...args);};
 const pending=Array.from({length:20},()=>f.request('stable',true).then(rows=>{settled++;return rows;}));
 try{
  await entered.promise;
  let interactiveDone=false;
  const interactive=f.request().then(rows=>{interactiveDone=true;return rows;});
  await tick();
  assert.equal(interactiveDone,true,'a visitor must not wait for the preparation PUT');
  assert.deepEqual(await interactive,f.rows);assert.equal(settled,0);
  put.resolve();assert.deepEqual((await Promise.all(pending))[0],f.rows);
  assert.deepEqual(f.counts(),{writes:1,reads:2,loads:1});
  assert.deepEqual(f.conditions,[{ifNoneMatch:'*'}]);
 }finally{put.resolve();await Promise.allSettled(pending);f.restore();}
});

test('required mode persists an interactive memory hit and revalidates completed readiness without renewing TTL',async()=>{
 const f=fixture();try{
  await f.request();assert.equal(f.counts().writes,0);
  await f.request('stable',true);assert.equal(f.counts().loads,1);
  const saved=[...f.objects.values()][0],createdAt=saved.createdAt;
  await f.request('stable',true);
  assert.equal(f.counts().writes,1);assert.equal(f.counts().reads,3);
  assert.equal(saved.createdAt,createdAt);
  f.objects.clear();await f.request('stable',true);
  assert.equal(f.counts().writes,2,'a completed persistence marker cannot hide a missing object');
  assert.equal(f.counts().loads,1);
 }finally{f.restore();}
});

test('required persistence replaces invalid snapshots conditionally and fails without an ETag',async()=>{
 const f=fixture();try{
  await f.request('stable',true);
  const [path,saved]=[...f.objects.entries()][0];saved.checksum='damaged';
  await f.request('stable',true);
  assert.deepEqual(f.conditions.at(-1),{ifMatch:'existing-etag'});
  f.objects.get(path).checksum='damaged-again';
  const read=f.storage.readJsonWithMeta;
  f.storage.readJsonWithMeta=async(...args)=>({...await read(...args),etag:undefined});
  await assert.rejects(f.request('stable',true),/catalog_budget_snapshot_etag_missing/);
  assert.equal(f.counts().writes,2);
  assert.deepEqual(await f.request(),f.rows,'persistence failure leaves calculated rows available');
 }finally{f.restore();}
});

test('required persistence reads back a valid CAS winner once and never overwrites an invalid winner',async()=>{
 const f=fixture();try{
  const write=f.storage.writeJson;
  f.storage.writeJson=async(...args)=>{await write(...args);throw new StorageConflictError();};
  assert.deepEqual(await f.request('stable',true),f.rows);
  assert.deepEqual(f.counts(),{writes:1,reads:2,loads:1});
  f.objects.clear();
  f.storage.writeJson=async(...args)=>{await write(...args);f.objects.get(args[0]).checksum='bad-winner';throw new StorageConflictError();};
  await assert.rejects(f.request('stable',true),/catalog_budget_snapshot_not_persisted/);
  assert.deepEqual(f.counts(),{writes:2,reads:4,loads:1});
 }finally{f.restore();}
});

test('read, PUT and invalid readback failures propagate only to required preparation',async()=>{
 const f=fixture();try{
  await f.request();const read=f.storage.readJsonWithMeta,write=f.storage.writeJson;
  f.storage.readJsonWithMeta=async()=>{throw Error('metadata-unavailable');};
  await assert.rejects(f.request('stable',true),/metadata-unavailable/);
  f.storage.readJsonWithMeta=read;f.storage.writeJson=async()=>{throw Error('put-unavailable');};
  await assert.rejects(f.request('stable',true),/put-unavailable/);
  f.storage.writeJson=async()=>{};
  await assert.rejects(f.request('stable',true),/catalog_budget_snapshot_not_persisted/);
  assert.deepEqual(await f.request(),f.rows);assert.equal(f.counts().loads,1);
  f.storage.writeJson=write;await f.request('stable',true);
  assert.equal(f.counts().writes,1,'failed tasks release their persistence slot');
 }finally{f.restore();}
});

test('required persistence rejects a fingerprint changed before admission or during the PUT',async()=>{
 const f=fixture(),put=deferred(),entered=deferred();let current='stable';
 try{
  await f.request();
  await assert.rejects(f.request('stable',true,async()=>'changed'),/catalog_budget_context_changed/);
  assert.equal(f.counts().writes,0);
  const write=f.storage.writeJson;
  f.storage.writeJson=async(...args)=>{entered.resolve();await put.promise;await write(...args);};
  const pending=assert.rejects(f.request('stable',true,async()=>current),/catalog_budget_context_changed/);
  await entered.promise;current='changed';put.resolve();await pending;
  assert.equal(f.counts().writes,1,'old-key data may exist, but changing context cannot report ready');
 }finally{put.resolve();f.restore();}
});

test('persistence admits at most two writes and two queued keys while interactive rows stay usable',async()=>{
 const f=fixture(),put=deferred(),write=f.storage.writeJson;let active=0,peak=0,entered=0;
 const versions=['one','two','three','four','five'];
 const pending:Promise<unknown>[]=[];
 try{
  for(const version of versions)await f.request(version);
  f.storage.writeJson=async(...args)=>{entered++;active++;peak=Math.max(peak,active);await put.promise;try{await write(...args);}finally{active--;}};
  pending.push(...versions.slice(0,4).map(version=>f.request(version,true)));
  await tick();assert.equal(entered,2);assert.equal(peak,2);
  await assert.rejects(f.request('five',true),/detail_cache_queue_full/);
  assert.deepEqual(await f.request('five'),f.rows);
  put.resolve();await Promise.all(pending);
  assert.equal(entered,4);assert.equal(peak,2);
  await f.request('five',true);assert.equal(entered,5);
 }finally{put.resolve();await Promise.allSettled(pending);f.restore();}
});

test('queued preparation rechecks its fingerprint when admitted and cache reset does not duplicate pending PUTs',async()=>{
 const f=fixture(),put=deferred(),write=f.storage.writeJson;let current='queued',entered=0;
 const pending:Promise<unknown>[]=[];
 try{
  for(const version of ['one','two','queued'])await f.request(version);
  f.storage.writeJson=async(...args)=>{entered++;await put.promise;await write(...args);};
  pending.push(f.request('one',true),f.request('two',true));await tick();assert.equal(entered,2);
  const queued=assert.rejects(f.request('queued',true,async()=>current),/catalog_budget_context_changed/);
  await tick();current='changed';
  resetSharedBudgetPriceCache();pending.push(f.request('one',true));await tick();
  assert.equal(entered,2,'resetting calculated rows must preserve in-flight persistence coalescing');
  put.resolve();await Promise.all(pending);await queued;
  assert.equal(entered,2);assert.equal(f.counts().writes,2);
 }finally{put.resolve();await Promise.allSettled(pending);f.restore();}
});

test('actual warmup requires both durable namespaces and propagates storage and changing-context failures',async()=>{
 const {warmBudgetPriceCaches,resetCatalogReadCachesForTests}=await import('../apps/web/lib/catalog/storage');
 const {resetCatalogRateCache}=await import('../apps/web/lib/catalog/rates');
 const {invalidateEffectiveMarketsCache}=await import('../apps/web/lib/effective-market-settings');
 const f=fixture(),meta=f.storage.readJsonWithMeta,write=f.storage.writeJson;
 const release=process.env.AVTOCENA_RELEASE_SHA,calculation=process.env.AVTOCENA_CALCULATION_VERSION;
 let failure='';
 f.storage.readJsonWithMeta=async<T>(path:string,fallback:T)=>{
  if(/^catalog\/runtime-(budget|sort)-prices-v3\//.test(path)){
   if(failure==='read')throw Error('required-read-failed');
   return meta(path,fallback);
  }
  let value:unknown=fallback;
  if(path==='catalog/manifest.json')value={generationId:f.index.generationId,markets:{korea:{count:1}}};
  if(path.endsWith('/budget-count-v3.json'))value=f.index;
  if(path==='markets/markets.json')value=[{id:'korea',versions:[{id:'fixture',status:'active',securityDepositRub:110000}]}];
  return {found:true,value:value as T};
 };
 f.storage.writeJson=async(...args)=>{
  if(failure==='write')throw Error('required-write-failed');
  await write(...args);
  if(failure==='context')process.env.AVTOCENA_RELEASE_SHA='changed-during-preparation';
 };
 try{
  delete process.env.AVTOCENA_CALCULATION_VERSION;process.env.AVTOCENA_RELEASE_SHA='preparation-context';
  resetCatalogReadCachesForTests();resetCatalogRateCache();invalidateEffectiveMarketsCache();
  const result=await warmBudgetPriceCaches(['korea']);
  assert.equal(result.results.length,1);assert.equal(result.results[0].rows,1);
  assert.equal(f.objects.size,2);
  assert.ok([...f.objects.keys()].some(path=>path.includes('runtime-budget-prices-v3')));
  assert.ok([...f.objects.keys()].some(path=>path.includes('runtime-sort-prices-v3')));
  for(const [mode,error] of [['read',/required-read-failed/],['write',/required-write-failed/],['context',/catalog_budget_context_changed/]] as const){
   failure=mode;f.objects.clear();resetCatalogReadCachesForTests();process.env.AVTOCENA_RELEASE_SHA='preparation-context';
   await assert.rejects(warmBudgetPriceCaches(['korea']),error,'offline preparation cannot fall back to unpersisted success');
  }
 }finally{
  if(release===undefined)delete process.env.AVTOCENA_RELEASE_SHA;else process.env.AVTOCENA_RELEASE_SHA=release;
  if(calculation===undefined)delete process.env.AVTOCENA_CALCULATION_VERSION;else process.env.AVTOCENA_CALCULATION_VERSION=calculation;
  f.restore();resetCatalogReadCachesForTests();resetCatalogRateCache();invalidateEffectiveMarketsCache();
 }
});
