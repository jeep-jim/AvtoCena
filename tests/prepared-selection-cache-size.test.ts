import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DetailReadCache} from '../apps/web/lib/catalog/detail-read-cache';
import {budgetIndexBytes} from '../apps/web/lib/catalog/budget-row-size';
import type {BudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';

// Use the actual production options, not a copied test cap/size function.
const source=readFileSync(new URL('../apps/web/lib/catalog/shared-budget-prices.ts',import.meta.url),'utf8');
const expression=source.match(/const preparedSelectionCache=new DetailReadCache<BudgetCountIndex>\((\{[^;]+\})\);/)?.[1];
assert.ok(expression);
const options=Function('budgetIndexBytes',`return (${expression});`)(budgetIndexBytes);
assert.equal(options.maxBytes,192*1024*1024);
assert.equal(options.ttlMs,86400_000);
assert.equal(options.maxEntries,10);
assert.equal(options.concurrency,2);
assert.equal(options.sizeOf,budgetIndexBytes);
assert.equal(options.staleWhileRevalidateMs,undefined);
function large(generationId='g'):BudgetCountIndex{
 const metadata='x'.repeat(54000);
 return {version:3,generationId,sourceRows:2048,rows:Array.from({length:2048},(_,i)=>['china',100,null,null,false,{id:String(i),make:'M',model:metadata,year:2024,block:0}]),otherRows:[]} as BudgetCountIndex;
}

test('complete >64MiB index yields while sizing; repeated read does no loader I/O',async()=>{
 const index=large(),bytes=await budgetIndexBytes(index);
 assert.ok(bytes>110_000_000&&bytes<128*1024*1024);
 const cache=new DetailReadCache<BudgetCountIndex>(options);let reads=0,yielded=false;
 setImmediate(()=>{yielded=true});
 const loader=async()=>{reads++;return index};
 assert.equal(await cache.get('g:china:fp',loader),index);assert.equal(yielded,true);
 assert.equal(await cache.get('g:china:fp',loader),index);assert.equal(reads,1);
});

test('combined byte budget evicts old generation; one oversized entry is not retained',async()=>{
 const cache=new DetailReadCache<BudgetCountIndex>(options),a=large('a'),b=large('b');let reads=0;
 const load=(v:BudgetCountIndex)=>async()=>{reads++;return v};
 await cache.get('a:china:fp',load(a));await cache.get('b:china:fp',load(b));
 assert.equal(cache.peekFresh('a:china:fp'),undefined);assert.equal(cache.peekFresh('b:china:fp'),b);
 await cache.get('a:china:fp',load(a));assert.equal(reads,3);assert.equal(cache.peekFresh('b:china:fp'),undefined);
 const oversized={...a,rows:[...a.rows,...b.rows]};
 await cache.get('oversized',load(oversized));assert.equal(cache.peekFresh('oversized'),undefined);
 await cache.get('oversized',load(oversized));assert.equal(reads,5);
});

test('unchanged TTL expires without stale reuse, and clear discards entries',async()=>{
 let now=0,reads=0;const cache=new DetailReadCache<BudgetCountIndex>({...options,now:()=>now});
 const index=large(),load=async()=>{reads++;return index};
 await cache.get('g:china:fp',load);now=86400_000-1;await cache.get('g:china:fp',load);assert.equal(reads,1);
 now=86400_000;await cache.get('g:china:fp',load);assert.equal(reads,2);
 cache.clear();await cache.get('g:china:fp',load);assert.equal(reads,3);
});

test('authority key and receipt freshness guards remain present',()=>{
 assert.ok(source.includes('hash([generationId,market,fingerprint])'));
 assert.ok(source.includes('Date.now()-receipt.createdAt>86400_000'));
 assert.ok(source.includes("receipt.fingerprint!==fingerprint"));
 assert.ok(source.includes("checksum!==hash(body)"));
});


test('measured all-five working set survives two complete cycles with zero repeated I/O',async()=>{
 const measured={china:110036514,korea:189179,uae:9364,europe:22593755,georgia:4114};
 assert.equal(Object.values(measured).reduce((a,b)=>a+b,0),132832926);
 const cache=new DetailReadCache<BudgetCountIndex>(options),indexes=new Map<string,BudgetCountIndex>();
 // Synthetic immutable metadata reproduces each measured serialized byte size.
 // Batch-sized rows avoid constructing one giant measurement string.
 for(const [market,target] of Object.entries(measured)){
  const rows=Array.from({length:Math.max(1,Math.floor(target/54000))},(_,i)=>[market,100,null,null,false,{id:String(i),make:'M',model:'',year:2024,block:0}]);
  const index={version:3,generationId:'measured-generation',sourceRows:rows.length,rows,otherRows:[]} as BudgetCountIndex;
  const base=await budgetIndexBytes(index),remaining=target-base;
  assert.ok(remaining>=0);
  const per=Math.floor(remaining/rows.length),extra=remaining%rows.length;
  // Replace row identities after baseline sizing because row byte memoization is weak.
  index.rows=index.rows.map((row,i)=>[...row.slice(0,5),{...row[5],model:'x'.repeat(per+(i<extra?1:0))}] as any);
  assert.equal(await budgetIndexBytes(index),target);indexes.set(market,index);
 }
 let reads=0;
 for(let cycle=0;cycle<2;cycle++)for(const [market,index] of indexes){
  const result=await cache.get(`measured-generation:${market}:fixed-fingerprint`,async()=>{reads++;return index});
  assert.equal(result,index);
 }
 assert.equal(reads,5);
 for(const [market,index] of indexes)assert.equal(cache.peekFresh(`measured-generation:${market}:fixed-fingerprint`),index);
});
