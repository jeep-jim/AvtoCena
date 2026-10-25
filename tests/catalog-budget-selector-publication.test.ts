import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {compressedBudgetSelectors,splitPackedBudgetSelectors,verifiedCompressedBudgetSelector} from '../apps/web/lib/catalog/budget-selector-codec';
import {inspectCompressedSelectors,publishCompressedSelectors,retainedSelectorMarkets,readCompressedSelector,MAX_PUBLISHED_SELECTOR_BYTES} from '../apps/web/lib/catalog/budget-selector-publication';
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
 for(const market of markets){const restored=await readCompressedSelector(directory,market,async n=>objects.get(n));assert.ok(restored);assert.equal(restored.sourceRows,1);assert.deepEqual(restored.rows.map(r=>r[5].id),source.rows.filter(r=>r[0]===market).map(r=>r[5].id));assert.equal(directory.markets[market].rows,expected.directory.markets[market].rows);}
});
test('readback failure never publishes ready',async()=>{
 const writes:string[]=[];await assert.rejects(publishCompressedSelectors(fixture(),async()=>null,async n=>{writes.push(n);}),/verification_failed/);
 assert.ok(!writes.includes('ready'));
});

const hash=(x:any)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
test('large selector splits by bytes as well as 1000 rows, preserving both orders and metadata',async()=>{
 const source=buildBudgetCountIndex('gen_test',Array.from({length:1800},(_,i)=>({id:String(i),market:'china',make:'X',model:randomBytes(5000).toString('base64'),totalRub:i%3?1:null})) as any[],new Map(),3);
 const objects=new Map<string,any>(),writes:string[]=[];
 const dir=await publishCompressedSelectors(source,async n=>objects.get(n),async(n,v)=>{assert.ok(Buffer.byteLength(JSON.stringify(v))<=MAX_PUBLISHED_SELECTOR_BYTES);writes.push(n);objects.set(n,json(v));});
 assert.equal(dir.version,4);assert.equal(writes.at(-1),'ready');assert.ok(dir.markets.china.chunks!.length>2);
 const restored=await readCompressedSelector(dir,'china',async n=>objects.get(n));assert.ok(restored);
 assert.deepEqual(restored.rows,json(source.rows));assert.deepEqual(restored.otherRows,json(source.otherRows));assert.equal(restored.sourceRows,source.sourceRows);
 assert.ok(dir.markets.china.chunks!.every(p=>p.rows+p.otherRows<=1000));
 for(const change of ['missing','checksum','generation','counts','duplicate','path','header','market','bytes']){
  const d=json(dir),o=new Map(objects),entry=d.markets.china,chunk=entry.chunks[0];
  if(change==='missing')o.delete(chunk.name);
  if(change==='checksum')o.set(chunk.name,{...o.get(chunk.name),payload:'broken'});
  if(change==='generation')d.generationId='other';
  if(change==='counts')entry.rows++;
  if(change==='duplicate')entry.chunks.push(entry.chunks[0]);
  if(change==='path')chunk.name='../other';
  if(change==='bytes')chunk.bytes++;
  if(change==='header'||change==='market'){
   const {decompressBudgetSelector,compressBudgetSelector}=await import('../apps/web/lib/catalog/budget-selector-codec');
   const packed=decompressBudgetSelector(o.get(chunk.name));
   if(change==='header')packed.index.bodyFilterVersion=99 as any;
   else packed.rows[0][0]='korea';
   const wire=compressBudgetSelector(packed);chunk.checksum=hash(wire);chunk.name=`parts/china/${chunk.checksum}`;chunk.bytes=Buffer.byteLength(JSON.stringify(wire));o.set(chunk.name,wire);
  }
  entry.checksum=hash(entry.chunks);
  assert.equal(await readCompressedSelector(d,'china',async n=>o.get(n)),null,change);
 }
});
test('an indivisible oversized row fails without publishing readiness or changing existing chunks',async()=>{
 const source=buildBudgetCountIndex('gen_test',[{id:'huge',market:'china',make:'X',model:randomBytes(5*1024*1024).toString('base64'),totalRub:1}] as any[],new Map(),3);
 const old={version:3,generationId:'old'},objects=new Map<string,any>([['ready',old]]),writes:string[]=[];
 await assert.rejects(publishCompressedSelectors(source,async n=>objects.get(n),async(n,v)=>{writes.push(n);objects.set(n,v);}),/requires_bounded_parts/);
 assert.deepEqual(writes,[]);assert.equal(objects.get('ready'),old);
});
