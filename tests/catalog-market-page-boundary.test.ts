import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('last China page beyond 10000 reaches search; invalid offsets never do',async()=>{
 const calls:any[]=[];
 (globalThis as any).__marketBoundary=async(q:any)=>{calls.push(q);return {page:q.page,total:244471,items:[{id:'last-car'}]};};
 const mocks:Record<string,string>={
  'market-selection':'export const selectedCatalogMarkets=x=>[x];export const marketSelectionUrl=()=>"";',
  'green-corner':'export const readGreenCorner=()=>{};export const readGreenCornerPage=()=>{};',
  'route':'export const GET=()=>{};',
  'ajes-count-display':'export const exactAjesCount=()=>{};',
  'ajes-market-selection':'export const usesAjesMarket=async()=>false;',
  'ajes-error-response':'export const ajesErrorResponse=()=>{};',
  'ajes-catalog':'export const readAjesCatalogPage=()=>{};export const readAjesCountSummary=()=>{};export const withAjesCount=x=>x;',
  'market-page':'export const readCatalogMarketPage=q=>globalThis.__marketBoundary(q);',
  'runtime-config':"export const PUBLIC_CATALOG_MARKET_SET=new Set(['china']);",
  'engine-input':'export const parseEngineCc=()=>undefined;',
  'live-business-pricing':'export const applyActiveBusinessPricingBatch=x=>x;',
  'server':'export const NextResponse={json:(body,init)=>Response.json(body,init)};',
  'public-rates':'export const loadPublicRateExtras=()=>{};',
  'storage':'export const countCatalogOffers=()=>{};export const readCatalogFacets=()=>{};export const searchOffers=()=>{};',
 };
 try{
  const output=await build({entryPoints:['apps/web/app/(public)/api/catalog/search/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'fixture',setup(b){
   b.onResolve({filter:/.*/},a=>{if(a.kind==='entry-point')return;const name=a.path.split('/').at(-1)!;if(mocks[name])return {path:name,namespace:'fixture'};});
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]}));
  }}]});
  const m={exports:{} as any};new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);
  for(const page of ['10000','10001','10187']){
   const response=await m.exports.GET(new Request(`https://fixture.test/api/catalog/search?market=china&marketPage=1&page=${page}`));
   assert.equal(response.status,200);assert.equal((await response.json()).items[0].id,'last-car');assert.equal(calls.at(-1).page,Number(page));
  }
  for(const page of ['0','-1','1.5','NaN','Infinity','9007199254740991','']){
   const response=await m.exports.GET(new Request(`https://fixture.test/api/catalog/search?market=china&marketPage=1&page=${page}`));
   assert.equal(response.status,400,page);
  }
  assert.equal(calls.length,3);
 }finally{delete (globalThis as any).__marketBoundary;}
});
