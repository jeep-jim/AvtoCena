import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('category cities share one compact window; revisions, pages and price-dependent queries remain separate',async()=>{
 const calls:any[]=[];
 let revision='r';
 const mockSearch=async(query:any,limit:number)=>{calls.push({query,limit});return {generationId:'g',total:250,items:Array.from({length:192},(_,i)=>({id:String(i),make:'Kia',model:'Model '+i,year:2024,totalRub:3000000+i,sourcePrice:100000})),page:query.page,pageSize:query.pageSize};};
 const mocks:Record<string,string>={storage:'export const searchOffers=(...args)=>globalThis.__cityPageSearch(...args);',editorial:"export const readCatalogEditorial=async()=>({revision:globalThis.__cityPageRevision()});",'live-business-pricing':'export const applyActiveBusinessPricingBatch=async rows=>rows;','offer-quality':'export const isRenderablePublicCatalogOffer=()=>true;'};
 const output=await build({entryPoints:['apps/web/lib/catalog/market-page.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},a=>{const name=a.path.split('/').at(-1)!;if(mocks[name])return {path:name,namespace:'fixture'};});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
 const m={exports:{} as any};(globalThis as any).__cityPageSearch=mockSearch;
 (globalThis as any).__cityPageRevision=()=>revision;
 try {
  new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);
  const [normal,city,otherCity]=await Promise.all([
   m.exports.readCatalogMarketPage({market:'china',sort:'updatedAt',page:1}),
   m.exports.readCatalogMarketPage({market:'china',sort:'updatedAt',page:1,city:'Новокузнецк'}),
   m.exports.readCatalogMarketPage({market:'china',page:1,city:'Москва',make:'',budgetTo:undefined}),
  ]);
  assert.deepEqual(city.items,normal.items);assert.equal(city.items.length,24);
  assert.deepEqual(otherCity.items,normal.items);
  assert.equal(calls.length,1,'simultaneous default-city pages must not repeat source/pricing work');
  assert.equal(calls[0].query.city,undefined);assert.equal(calls[0].limit,192);
  await m.exports.readCatalogMarketPage({market:'china',page:2,city:'Новокузнецк'});
  assert.equal(calls.length,2,'a different visible page is not the same page cache entry');
  revision='changed';
  await m.exports.readCatalogMarketPage({market:'china',page:1,city:'Новокузнецк'});
  assert.equal(calls.length,3,'an editorial revision invalidates the shared category');
  await m.exports.readCatalogMarketPage({market:'china',city:'Новокузнецк',budgetTo:4000000});
  assert.equal(calls.at(-1).query.city,'Новокузнецк');assert.equal(calls.at(-1).query.budgetTo,4000000);
  await m.exports.readCatalogMarketPage({market:'china',city:'Москва',budgetTo:4000000});
  assert.equal(calls.length,5,'delivered-budget queries remain city-specific');
  assert.equal(calls.at(-1).query.city,'Москва');
  await m.exports.readCatalogMarketPage({market:'china',city:'Новокузнецк',sort:'totalRub'});
  assert.equal(calls.at(-1).query.city,'Новокузнецк');assert.equal(calls.at(-1).query.sort,'totalRub');
  await m.exports.readCatalogMarketPage({market:'china',city:'Москва',sort:'totalRub'});
  assert.equal(calls.length,7,'delivered-price ordering remains city-specific');
  assert.equal(calls.at(-1).query.city,'Москва');
 }finally{delete (globalThis as any).__cityPageSearch;delete (globalThis as any).__cityPageRevision;}
});
