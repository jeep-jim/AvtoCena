import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
async function fixture(entry:string,enabled:boolean,paidSnapshot=false){
 const output=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'switch-fixture',setup(b){
  b.onResolve({filter:/.*/},a=>{
   if(a.path==='./storage' && a.importer.endsWith('ajes-market-selection.ts'))return {path:'manifest',namespace:'fixture'};
   if(a.path==='server-only')return {path:'empty',namespace:'fixture'};
   if(a.path.endsWith('collection-controls'))return {path:'controls',namespace:'fixture'};
   if(entry.endsWith('ajes-catalog.ts')&&a.importer.endsWith('ajes-catalog.ts')&&!a.path.endsWith('ajes-market-selection'))return {path:'empty',namespace:'fixture'};
  });
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='manifest'?`export async function hasPublishedPaidEncar(){return ${paidSnapshot};}`:a.path==='controls'?`export class CollectionDisabledError extends Error {} export async function assertCollectionEnabled(){if(!${enabled})throw Error('collection_disabled_by_owner');}`:`exports.cache=x=>x;exports.DetailReadCache=class {};`,loader:'js'}));
 }}]});
 const m={exports:{} as any};new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);return m.exports;
}
test('AJ remains Japan-only despite old source switches and saved URLs',async()=>{
 for(const enabled of [false,true]){
  const {usesAjesMarket}=await fixture('apps/web/lib/catalog/ajes-market-selection.ts',enabled);
  for(const source of [undefined,'existing','ajes'])assert.equal(await usesAjesMarket('china',source),false);
  assert.equal(await usesAjesMarket('japan'),true);
  assert.equal(await usesAjesMarket('europe'),false);
  assert.equal(await usesAjesMarket('korea','existing'),false);
  assert.equal(await usesAjesMarket('korea'),false);
 }
});
test('disabled AJES preserves Che168 home rows and exact local count',async()=>{
 const {withAjesCount}=await fixture('apps/web/lib/catalog/ajes-catalog.ts',false);
 const value={total:123,marketCounts:{china:123},items:[{id:'che168-example',market:'china'}]};
 const result=await withAjesCount(value,{market:'china'});
 assert.equal(result.total,123);assert.deepEqual(result.marketCounts,value.marketCounts);assert.deepEqual(result.items,value.items);assert.deepEqual(result.marketCountInfo,{});
});
test('AJ counts preserve the published Korea rows without substituting another source',async()=>{
 const {withAjesCount}=await fixture('apps/web/lib/catalog/ajes-catalog.ts',false);
 const result=await withAjesCount({total:50,marketCounts:{korea:50},items:[{id:'old-kcar',market:'korea'}]},{market:'korea'});
 assert.equal(result.total,50);assert.equal(result.marketCounts.korea,50);assert.deepEqual(result.items,[{id:'old-kcar',market:'korea'}]);assert.equal(result.countIncomplete,undefined);
});

test('missing or disabled paid Korea inventory never selects AJ',async()=>{
 for(const enabled of [false,true])for(const published of [false,true]){
  const {usesAjesMarket}=await fixture('apps/web/lib/catalog/ajes-market-selection.ts',enabled,published);
  for(const source of [undefined,'ajes','existing'])assert.equal(await usesAjesMarket('korea',source),false);
 }
 const {withAjesCount}=await fixture('apps/web/lib/catalog/ajes-catalog.ts',true,true);
 const value={total:15,marketCounts:{korea:15},items:[{id:'paid-offer',market:'korea'}]};
 const result=await withAjesCount(value,{market:'korea'});
 assert.deepEqual(result.items,value.items);assert.equal(result.total,15);
 assert.deepEqual(result.marketCounts,value.marketCounts);assert.deepEqual(result.marketCountInfo,{});
});


test('paid Korea manifest binding requires a nonempty AutoAPI partition and propagates read failures',async t=>{
 const [{getJsonStorage},{hasPublishedPaidEncar,resetCatalogReadCachesForTests}]=await Promise.all([
  import('../apps/web/lib/data'),import('../apps/web/lib/catalog/storage'),
 ]);
 let manifest:unknown,readFailure:Error|undefined;
 t.mock.method(getJsonStorage(),'readJsonWithMeta',async(path:string)=>{
  assert.equal(path,'catalog/manifest.json');
  if(readFailure)throw readFailure;
  return {found:true,value:manifest};
 });
 t.after(()=>{t.mock.restoreAll();resetCatalogReadCachesForTests();});
 for(const [korea,expected] of [
  [undefined,false],
  [{count:12},false],
  [{count:12,provider:'legacy'},false],
  [{count:0,provider:'auto_api_encar'},false],
  [{count:12,provider:'auto_api_encar'},true],
 ] as const){
  manifest={generationId:'manifest-fixture',markets:korea?{korea}:{}};
  resetCatalogReadCachesForTests();
  assert.equal(await hasPublishedPaidEncar(),expected);
 }
 readFailure=new Error('fixture_manifest_unavailable');resetCatalogReadCachesForTests();
 await assert.rejects(hasPublishedPaidEncar(),error=>error===readFailure);
});
