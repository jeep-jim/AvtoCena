import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const scripts=['catalog-budget-shared-warmup.mjs','regcloud-prepare-prices.mjs'];
const context='a'.repeat(64),part='b'.repeat(64);

/** Execute each real script's write callback without running its collector,
 * public probes, calculation or storage setup. The guards stay self-contained
 * because current orchestration also runs against an older live checkout. */
async function writer(script:string){
 const source=await fs.readFile(new URL(`../scripts/${script}`,import.meta.url),'utf8');
 const body=source.match(/storage\.writeJson=async\(path,value,condition\)=>\{([\s\S]*?)\n\};/)?.[1];
 assert.ok(body,`actual write guard is present in ${script}`);
 const written:any[]=[];let generation='gen_fixture';
 const storage={readJson:async()=>({generationId:generation})};
 const write=async(...args:any[])=>{written.push(args);return 'saved';};
 const guard=new Function('storage','writes','write','manifest',`return async(path,value,condition)=>{${body}}`)(storage,write,write,{generationId:'gen_fixture'});
 return {guard,written,changeGeneration:()=>{generation='gen_changed';}};
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
}

test('release price preparation still rejects a changed generation before an otherwise permitted write',async()=>{
 const w=await writer('regcloud-prepare-prices.mjs');w.changeGeneration();
 await assert.rejects(w.guard(`catalog/runtime-budget-selections-v1/korea/${context}/ready.json`,{}),/publication_changed/);
 await assert.rejects(w.guard(`catalog/runtime-budget-prices-v3/korea/${context}.json`,{}),/publication_changed/);
 assert.equal(w.written.length,0);
});
