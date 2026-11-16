import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

const scripts=['catalog-budget-shared-warmup.mjs','regcloud-prepare-prices.mjs'];
const context='a'.repeat(64),part='b'.repeat(64);
const generationId='gen_1790000000000_fixture',calculationVersion='c'.repeat(64),encyclopediaDigest='d'.repeat(64);
const hash=(value:any)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Execute each real script's write callback without running its collector,
 * public probes, calculation or storage setup. The guards stay self-contained
 * because current orchestration also runs against an older live checkout. */
async function writer(script:string){
 const source=await fs.readFile(new URL(`../scripts/${script}`,import.meta.url),'utf8');
 const body=source.match(/storage\.writeJson=async\(path,value,condition\)=>\{([\s\S]*?)\n\};/)?.[1];
 assert.ok(body,`actual write guard is present in ${script}`);
 const written:any[]=[];let generation=generationId,calculator=calculationVersion,index=encyclopediaDigest;
 const storage={readJson:async()=>({generationId:generation})};
 const write=async(...args:any[])=>{written.push(args);return 'saved';};
 const guard=new Function('storage','writes','write','manifest','createHash','calculationCacheVersion','readCalculationIndex',
  `return async(path,value,condition)=>{${body}}`)(storage,write,write,{generationId},createHash,()=>calculator,()=>({digest:index}));
 return {guard,written,changeGeneration:()=>{generation='gen_changed';},changeCalculator:()=>{calculator='e'.repeat(64);},changeIndex:()=>{index='f'.repeat(64);}};
}

for(const script of scripts){
 test(`${script} permits only exact prepared selections and preserves existing derived writes`,async()=>{
  const w=await writer(script),value={fixture:true},condition={ifNoneMatch:'*'};
  for(const market of ['china','korea','europe','uae','georgia']){
   for(const suffix of ['ready',`parts/${market}/${part}`]){
    const path=`catalog/runtime-budget-selections-v1/${market}/${context}/${suffix}.json`;
    assert.equal(await w.guard(path,value,condition),'saved');
    assert.deepEqual(w.written.at(-1),[path,value,condition],'conditional writes must pass through unchanged');
   }
  }
  for(const path of [
   `catalog/runtime-budget-prices-v3/korea/${context}.json`,
   `catalog/runtime-sort-prices-v3/china/${context}.json`,
   'catalog/runtime-budget-prices-v1/europe.json',
   'catalog/runtime-sort-prices-v2/georgia.json',
   'catalog/generations/gen_fixture/indexes/budget-markets-v1/ready.json',
   'catalog/generations/gen_fixture/indexes/budget-markets-v3/japan.json',
   `catalog/generations/gen_fixture/indexes/budget-markets-v3/parts/korea/${part}.json`,
   `catalog/generations/gen_fixture/indexes/budget-markets-v7/${context}/ready.json`,
   `catalog/generations/gen_fixture/indexes/budget-markets-v7/${context}/parts/china/${part}.json`,
  ])assert.equal(await w.guard(path,value),'saved',path);
 });

 test(`${script} rejects Japan, cross-market parts, traversal and authoritative records`,async()=>{
  const w=await writer(script);
  for(const path of [
   `catalog/runtime-budget-selections-v1/japan/${context}/ready.json`,
   `catalog/runtime-budget-selections-v1/korea/${context}/parts/china/${part}.json`,
   `catalog/runtime-budget-selections-v1/korea/${context}/parts/japan/${part}.json`,
   `catalog/runtime-budget-selections-v1/korea/${context.slice(1)}/ready.json`,
   `catalog/runtime-budget-selections-v1/korea/${context.toUpperCase()}/ready.json`,
   `catalog/runtime-budget-selections-v1/korea/${context}/parts/korea/not-a-hash.json`,
   `catalog/runtime-budget-selections-v1/korea/${context}/../ready.json`,
   `catalog/runtime-budget-selections-v1/korea/${context}/%2e%2e/ready.json`,
   `catalog/runtime-budget-selections-v1/korea/${context}/ready.json/extra`,
   `catalog/runtime-budget-selections-v1/korea/${context}/ready.json?replace=1`,
   ...["\n","\r","\u2028","\u2029"].map(ending=>`catalog/runtime-budget-selections-v1/korea/${context}/ready.json${ending}`),
   `catalog/runtime-budget-selections-v2/korea/${context}/ready.json`,
   'catalog/manifest.json','catalog/previous-manifest.json','catalog/internal/manifest.json',
   'fees/exchange-rates.json','markets/markets.json','catalog/import-lock.json',
   'catalog/generations/gen_fixture/korea/chunk-0001.json','catalog/china-cny-prices/current.json',
  ])await assert.rejects(w.guard(path,{fixture:true}),/unexpected_(?:derived_)?write/,path);
  assert.equal(w.written.length,0);
 });

 test(`${script} permits immutable supplement cards and replay only in the current exact context`,async()=>{
  const make=(kind:string):any=>kind==='cards'?{generationId,market:'uae',block:0,items:[{id:'added-car',market:'uae'}]}:
   {generationId,market:'uae',entries:[['added-car',{sourcePrice:1000,sourceCurrency:'AED'}]]};
  const key=(kind:string,value:any)=>`catalog/generations/${generationId}/indexes/budget-source-supplements-v1/${hash([encyclopediaDigest,calculationVersion])}/${kind}/uae/${hash(value)}.json`;
  const w=await writer(script),condition={ifNoneMatch:'*'};
  for(const kind of ['cards','replay']){
   const value=make(kind),p=key(kind,value);assert.equal(await w.guard(p,value,condition),'saved');
   for(const wrong of [p.replace('/uae/','/japan/'),p.replace('/uae/','/korea/'),p.replace(generationId,'gen_1790000000001_other'),
    p.replace(hash([encyclopediaDigest,calculationVersion]),'f'.repeat(64)),p+'\n',p+'?overwrite=1'])await assert.rejects(w.guard(wrong,value,condition),/unexpected|publication/);
   await assert.rejects(w.guard(p,value),/unexpected/);await assert.rejects(w.guard(p,{...value,extra:true},condition),/unexpected/);
   const duplicate=kind==='cards'?{...value,items:[value.items[0],value.items[0]]}:{...value,entries:[value.entries[0],value.entries[0]]};
   await assert.rejects(w.guard(key(kind,duplicate),duplicate,condition),/unexpected/);
   const wrongShape={...value,privateField:true};await assert.rejects(w.guard(key(kind,wrongShape),wrongShape,condition),/unexpected/);
   const wide=kind==='cards'?{...value,items:Array.from({length:257},(_,i)=>({id:'added-'+i,market:'uae'}))}:
    {...value,entries:Array.from({length:501},(_,i)=>['added-'+i,{sourcePrice:1000}])};
   await assert.rejects(w.guard(key(kind,wide),wide,condition),/unexpected/);
  }
  assert.equal(w.written.length,2);
  for(const change of ['changeGeneration','changeCalculator','changeIndex'] as const){
   const changed=await writer(script);changed[change]();await assert.rejects(changed.guard(key('cards',make('cards')),make('cards'),condition),/unexpected|publication/);
   assert.equal(changed.written.length,0);
  }
 });
}

test('release price preparation still rejects a changed generation before an otherwise permitted write',async()=>{
 const w=await writer('regcloud-prepare-prices.mjs');w.changeGeneration();
 await assert.rejects(w.guard(`catalog/runtime-budget-selections-v1/korea/${context}/ready.json`,{}),/publication_changed/);
 await assert.rejects(w.guard(`catalog/runtime-budget-prices-v3/korea/${context}.json`,{}),/publication_changed/);
 assert.equal(w.written.length,0);
});
