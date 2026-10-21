import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
async function fixture(entry:string,enabled:boolean){
 const output=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'switch-fixture',setup(b){
  b.onResolve({filter:/.*/},a=>{
   if(a.path==='server-only')return {path:'empty',namespace:'fixture'};
   if(a.path.endsWith('collection-controls'))return {path:'controls',namespace:'fixture'};
   if(entry.endsWith('ajes-catalog.ts')&&a.importer.endsWith('ajes-catalog.ts')&&!a.path.endsWith('ajes-market-selection'))return {path:'empty',namespace:'fixture'};
  });
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='controls'?`export async function assertCollectionEnabled(){if(!${enabled})throw Error('collection_disabled_by_owner');}`:`exports.cache=x=>x;exports.DetailReadCache=class {};`,loader:'js'}));
 }}]});
 const m={exports:{} as any};new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);return m.exports;
}
test('China follows owner source switch, including saved URLs; other markets retain routing',async()=>{
 for(const enabled of [false,true]){
  const {usesAjesMarket}=await fixture('apps/web/lib/catalog/ajes-market-selection.ts',enabled);
  for(const source of [undefined,'existing','ajes'])assert.equal(await usesAjesMarket('china',source),enabled);
  assert.equal(await usesAjesMarket('japan'),true);
  assert.equal(await usesAjesMarket('europe'),false);
  assert.equal(await usesAjesMarket('korea','existing'),true);
  assert.equal(await usesAjesMarket('korea'),true);
 }
});
test('disabled AJES preserves Che168 home rows and exact local count',async()=>{
 const {withAjesCount}=await fixture('apps/web/lib/catalog/ajes-catalog.ts',false);
 const value={total:123,marketCounts:{china:123},items:[{id:'che168-example',market:'china'}]};
 const result=await withAjesCount(value,{market:'china'});
 assert.equal(result.total,123);assert.deepEqual(result.marketCounts,value.marketCounts);assert.deepEqual(result.items,value.items);assert.deepEqual(result.marketCountInfo,{});
});
test('disabled paid Korea never falls back to historical parser rows or counts',async()=>{
 const {withAjesCount}=await fixture('apps/web/lib/catalog/ajes-catalog.ts',false);
 const result=await withAjesCount({total:50,marketCounts:{korea:50},items:[{id:'old-kcar',market:'korea'}]},{market:'korea'});
 assert.equal(result.total,0);assert.equal(result.marketCounts.korea,0);assert.deepEqual(result.items,[]);assert.equal(result.countIncomplete,true);
});
