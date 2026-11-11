import test from 'node:test';
import assert from 'node:assert/strict';
import {DetailReadCache} from '../apps/web/lib/catalog/detail-read-cache';
import {BudgetEligibilityCache} from '../apps/web/lib/catalog/budget-eligibility-cache';
import {budgetSourceRows,resetBudgetSourceIndexes} from '../apps/web/lib/catalog/budget-source-index';
import {getJsonStorage} from '../apps/web/lib/data';
import {sharedBudgetPrices,resetSharedBudgetPriceCache} from '../apps/web/lib/catalog/shared-budget-prices';
import {stalePriceSnapshotObjects} from '../scripts/lib/catalog-runtime-cleanup.mjs';

test('queued overload is bounded, expires without running, and does not leak an active slot',async()=>{
 const c=new DetailReadCache<string>({maxEntries:8,maxBytes:1000,ttlMs:1000,concurrency:1,maxQueued:1,queueTimeoutMs:20});
 let release!:(s:string)=>void,queuedCalls=0;
 const active=c.get('a',()=>new Promise(r=>release=r));
 const waiting=c.get('b',async()=>{queuedCalls++;return 'b';});
 await assert.rejects(c.get('c',async()=>'c'),/queue_full/);
 await assert.rejects(waiting,/queue_timeout/);assert.equal(queuedCalls,0);
 release('a');await active;assert.equal(await c.get('b',async()=>'new'),'new');
});

test('only explicitly opted-in display cache returns bounded stale data and coalesces refresh',async()=>{
 let now=0,calls=0;let release!:(s:string)=>void;
 const c=new DetailReadCache<string>({maxEntries:1,maxBytes:100,ttlMs:10,staleWhileRevalidateMs:20,concurrency:1,now:()=>now});
 await c.get('x',async()=>'old');now=11;
 const load=()=>{calls++;return new Promise<string>(r=>release=r);};
 assert.equal(await c.get('x',load),'old');assert.equal(await c.get('x',load),'old');assert.equal(calls,1);
 now=31;let settled=false;const strict=c.get('x',load).then(x=>{settled=true;return x;});
 await Promise.resolve();assert.equal(settled,false,'stale data cannot outlive its deadline');
 release('new');assert.equal(await strict,'new');
 c.clear();assert.equal(await c.get('x',async()=>'saved'),'saved');
});

test('large eligibility and make indexes yield; repeat brand selection skips other makes without altering order',async()=>{
 const rows=Array.from({length:20000},(_,i)=>['china',1,null,null,false,{id:String(i),make:i%100===0?'BMW':'Other',block:0}] as any);
 const index:any={rows,otherRows:[],generationId:'g'};let ran=false,calls=0;
 setImmediate(()=>{ran=true;});const cache=new BudgetEligibilityCache();
 await cache.get(index,'day1',()=>{calls++;return true;});assert.equal(ran,true);assert.equal(calls,20000);
 await cache.get(index,'day1',()=>{throw Error('must reuse');});
 const make=(v:string)=>v.toLowerCase();let normalized=0;
 const selected=await budgetSourceRows(index,new Set(['bmw']),v=>{normalized++;return make(v);});
 assert.equal(selected.length,200);assert.deepEqual(selected,rows.filter(r=>r[5].make==='BMW'));
 assert.equal(await budgetSourceRows(index,new Set(['bmw']),make),selected);assert.equal(normalized,20000);
 assert.deepEqual(await budgetSourceRows(index,new Set(['bmw','other']),make),rows);
 resetBudgetSourceIndexes();
});

test('blue-green calculation contexts cannot evict one another from persistent storage',async()=>{
 const s=getJsonStorage(),read=s.readJson,write=s.writeJson,objects=new Map<string,any>();
 s.readJson=async<T>(p:string,f:T)=>(objects.get(p)??f) as T;s.writeJson=async(p,v)=>{objects.set(p,structuredClone(v));};
 const row:any=['korea',100,null,null,false,{id:'one',make:'Kia',block:0}];const index:any={generationId:'g',rows:[row],otherRows:[]};let loads=0;
 try{
  for(const version of ['old','new','old','new']){
   resetSharedBudgetPriceCache();await sharedBudgetPrices(index,'korea',version,async()=>{loads++;return [row];},async()=>version);
  }
  assert.equal(loads,2);assert.equal(objects.size,2);
  assert.ok([...objects.keys()].every(k=>/^catalog\/runtime-budget-prices-v3\/korea\/[a-f0-9]{64}\.json$/.test(k)));
 }finally{s.readJson=read;s.writeJson=write;resetSharedBudgetPriceCache();}
});

test('retention selects only expired disposable price snapshots, never source/knowledge data',()=>{
 const now=Date.now(),old=new Date(now-8*86400000).toISOString(),key=`catalog/runtime-sort-prices-v3/china/${'a'.repeat(64)}.json`;
 const rows=[{key,lastModified:old},{key:key.replace('china','japan'),lastModified:old},{key:'catalog/manifest.json',lastModified:old},{key:'knowledge/encyclopedia/records.json',lastModified:old},{key,lastModified:new Date(now).toISOString()}];
 assert.deepEqual(stalePriceSnapshotObjects(rows,now),[rows[0]]);
});

test('interactive storage deadline aborts a stalled body without six retries',async()=>{
 const {ObjectJsonStorage}=await import('../apps/web/lib/data');
 const names=['YC_OBJECT_STORAGE_ENDPOINT','YC_OBJECT_STORAGE_REGION','YC_OBJECT_STORAGE_BUCKET','YC_OBJECT_STORAGE_ACCESS_KEY_ID','YC_OBJECT_STORAGE_SECRET_ACCESS_KEY','AVTOCENA_INTERACTIVE_READ_BUDGET_MS'];
 const env=Object.fromEntries(names.map(n=>[n,process.env[n]])),original=globalThis.fetch;let cancelled=false,calls=0;
 try{
  Object.assign(process.env,{YC_OBJECT_STORAGE_ENDPOINT:'https://storage.example.invalid',YC_OBJECT_STORAGE_REGION:'test',YC_OBJECT_STORAGE_BUCKET:'test',YC_OBJECT_STORAGE_ACCESS_KEY_ID:'test',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'test',AVTOCENA_INTERACTIVE_READ_BUDGET_MS:'30'});
  globalThis.fetch=async()=>{calls++;return new Response(new ReadableStream({cancel(){cancelled=true;}}));};
  await assert.rejects(new ObjectJsonStorage().readJson('test.json',null),/object_storage_GET_unreachable/);
  assert.equal(cancelled,true);assert.ok(calls<=2);
 }finally{globalThis.fetch=original;for(const n of names)if(env[n]===undefined)delete process.env[n];else process.env[n]=env[n];}
});
