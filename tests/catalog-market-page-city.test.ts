import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('category city uses the same compact diversity window; real price filters keep city',async()=>{
 const calls:any[]=[];
 const mockSearch=async(query:any,limit:number)=>{calls.push({query,limit});return {generationId:'g',total:250,items:Array.from({length:192},(_,i)=>({id:String(i),make:'Kia',model:'Model '+i,year:2024,totalRub:3000000+i,sourcePrice:100000})),page:query.page,pageSize:query.pageSize};};
 const mocks:Record<string,string>={storage:'export const searchOffers=(...args)=>globalThis.__cityPageSearch(...args);',editorial:"export const readCatalogEditorial=async()=>({revision:'r'});",'live-business-pricing':'export const applyActiveBusinessPricingBatch=async rows=>rows;','offer-quality':'export const isRenderablePublicCatalogOffer=()=>true;'};
 const output=await build({entryPoints:['apps/web/lib/catalog/market-page.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},a=>{const name=a.path.split('/').at(-1)!;if(mocks[name])return {path:name,namespace:'fixture'};});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
 const m={exports:{} as any};(globalThis as any).__cityPageSearch=mockSearch;
 try {
  new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);
  const normal=await m.exports.readCatalogMarketPage({market:'china',sort:'updatedAt',page:1});
  const city=await m.exports.readCatalogMarketPage({market:'china',sort:'updatedAt',page:1,city:'Новокузнецк'});
  assert.deepEqual(city.items,normal.items);assert.equal(city.items.length,24);
  assert.deepEqual(calls[1],calls[0]);assert.equal(calls[1].query.city,undefined);assert.equal(calls[1].limit,192);
  await m.exports.readCatalogMarketPage({market:'china',city:'Новокузнецк',budgetTo:4000000});
  assert.equal(calls.at(-1).query.city,'Новокузнецк');assert.equal(calls.at(-1).query.budgetTo,4000000);
  await m.exports.readCatalogMarketPage({market:'china',city:'Новокузнецк',sort:'totalRub'});
  assert.equal(calls.at(-1).query.city,'Новокузнецк');assert.equal(calls.at(-1).query.sort,'totalRub');
 }finally{delete (globalThis as any).__cityPageSearch;}
});
