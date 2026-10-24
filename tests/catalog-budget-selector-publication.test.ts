import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {compressedBudgetSelectors,splitPackedBudgetSelectors,verifiedCompressedBudgetSelector} from '../apps/web/lib/catalog/budget-selector-codec';
import {inspectCompressedSelectors,publishCompressedSelectors,retainedSelectorMarkets} from '../apps/web/lib/catalog/budget-selector-publication';
const markets=['china','korea','uae','europe','georgia'];
const fixture=()=>buildBudgetCountIndex('gen_test',markets.map(market=>({id:market,market,make:'X',model:'Y',year:2024,totalRub:market==='uae'?null:2000000,bodyType:'sedan'})) as any[],new Map(),3);
const manifest=()=>({generationId:'gen_test',markets:Object.fromEntries(markets.map(m=>[m,{count:1}]))});
const json=(v:any)=>JSON.parse(JSON.stringify(v));
test('five retained markets reuse all verified v3 parts without requiring local AJES Japan',async()=>{
 const compressed=compressedBudgetSelectors(splitPackedBudgetSelectors(fixture())),reads:string[]=[];
 const objects=new Map<string,any>(compressed.parts);objects.set('ready',compressed.directory);
 const result=await inspectCompressedSelectors(manifest(),async name=>{reads.push(name);return json(objects.get(name));});
 assert.equal(result.valid,true);assert.deepEqual(reads,['ready',...markets.slice().sort()]);
 assert.equal(Object.keys(result.markets).length,5);
 assert.equal((await inspectCompressedSelectors({...manifest(),markets:{...manifest().markets,japan:{count:1}}},async n=>objects.get(n))).valid,false);
});
test('missing owned market, wrong generation, truncated part and changed checksum prevent reuse',async()=>{
 for(const mutate of [
  (o:Map<string,any>)=>delete o.get('ready').markets.china,
  (o:Map<string,any>)=>o.get('ready').generationId='gen_other',
  (o:Map<string,any>)=>o.get('china').payload=o.get('china').payload.slice(0,-4),
  (o:Map<string,any>)=>o.get('ready').markets.china.rows++,
 ]){
  const c=compressedBudgetSelectors(splitPackedBudgetSelectors(fixture()));const o=new Map<string,any>(c.parts);o.set('ready',c.directory);mutate(o);
  assert.equal((await inspectCompressedSelectors(manifest(),async n=>o.get(n)||null)).valid,false);
 }
 assert.throws(()=>retainedSelectorMarkets({generationId:'g',markets:{china:{count:-1}}}));
 assert.throws(()=>retainedSelectorMarkets({generationId:'g',markets:{china:{count:0}}}));
});
test('publication round trips values/order/counts, exposes readiness last and leaves legacy roots untouched',async()=>{
 const source=fixture(),objects=new Map<string,any>(),writes:string[]=[];
 const directory=await publishCompressedSelectors(source,async n=>objects.get(n),async(n,v)=>{writes.push(n);objects.set(n,json(v));});
 assert.equal(writes.at(-1),'ready');assert.equal(writes.length,6);
 const expected=splitPackedBudgetSelectors(source);
 for(const market of markets){const restored=verifiedCompressedBudgetSelector(directory,market,objects.get(market));assert.ok(restored);assert.equal(restored.sourceRows,1);assert.deepEqual(restored.rows.map(r=>r[5].id),source.rows.filter(r=>r[0]===market).map(r=>r[5].id));assert.equal(directory.markets[market].rows,expected.directory.markets[market].rows);}
});
test('readback failure never publishes ready',async()=>{
 const writes:string[]=[];await assert.rejects(publishCompressedSelectors(fixture(),async()=>null,async n=>{writes.push(n);}),/verification_failed/);
 assert.ok(!writes.includes('ready'));
});
test('oversized compressed part fails before any write, never falls back to monolithic legacy JSON',async()=>{
 const source=buildBudgetCountIndex('gen_test',Array.from({length:1800},(_,i)=>({id:String(i),market:'china',make:'X',model:randomBytes(3000).toString('base64'),totalRub:1})) as any[],new Map(),3);
 let writes=0;await assert.rejects(publishCompressedSelectors(source,async()=>null,async()=>{writes++;}),/requires_bounded_parts/);assert.equal(writes,0);
});
