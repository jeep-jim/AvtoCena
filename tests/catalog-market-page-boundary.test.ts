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
  'prepared-china-http-fixture':'export class PreparedChinaCutChanged extends Error{};export const hasPreparedChinaHttpFixture=()=>Boolean(globalThis.__independentMarketBoundary);export const hasIndependentChinaHttpFixture=hasPreparedChinaHttpFixture;export const readPreparedChinaCompatibility=(q,options)=>globalThis.__independentMarketBoundary(q,options);export const readPreparedChinaIndexedCity=async()=>null;export const assertIndependentChinaFallbackAllowed=()=>{throw Error("unexpected fixture fallback");};export const preparedChinaIndexedModelOnly=hasPreparedChinaHttpFixture;export const readPreparedChinaIndexedModel=async()=>null;export const readPreparedChinaFixtureList=()=>{throw Error("unexpected China fixture");};',
  'storage':'export const projectPreparedChinaFixtureSearch=()=>{throw Error("unexpected China fixture");};export const countCatalogOffers=()=>{};export const readCatalogFacets=()=>{};export const readCatalogNavigationFacets=()=>{};export const searchOffers=()=>{};',
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
  const bookmarked=await m.exports.GET(new Request('https://fixture.test/api/catalog/search?market=china&source=ajes&marketPage=1&page=1&powerTo=160'));
  assert.equal(bookmarked.status,200);assert.equal((await bookmarked.json()).items[0].id,'last-car');assert.equal(calls.at(-1).powerTo,160);
  assert.equal(calls.length,4);
  const independentCalls:any[]=[];
  (globalThis as any).__independentMarketBoundary=async(q:any,options:any)=>{
   independentCalls.push({q,options});if(options.unsupported)throw Error('prepared_china_unavailable');
   return {generationId:'gen_independent_fixture',page:q.page,total:120,items:[{id:'current-che168',market:'china'}]};
  };
  for(const source of ['ajes','existing']){
   const response=await m.exports.GET(new Request('https://fixture.test/api/catalog/search?market=china&source='+source+'&marketPage=1&includeFacets=1&page=2&powerTo=160&city='+encodeURIComponent('Новокузнецк')));
   assert.equal(response.status,200,source);const body=await response.json();
   assert.equal(body.generationId,'gen_independent_fixture');assert.equal(body.items[0].id,'current-che168');
   const {q,options}=independentCalls.at(-1);assert.equal(options.unsupported,false);assert.equal(options.marketPage,true);assert.equal(options.includeFacets,true);
   assert.equal(q.powerTo,160);assert.equal(q.page,2);assert.equal(q.city,'Новокузнецк');
  }
  assert.equal(independentCalls.length,2);assert.equal(calls.length,4,'independent China must not reach the old market reader');
  const unsupported=await m.exports.GET(new Request('https://fixture.test/api/catalog/search?market=china&source=unrecognized&marketPage=1'));
  assert.equal(unsupported.status,503,'only retired source selectors are normalized');
 }finally{delete (globalThis as any).__marketBoundary;delete (globalThis as any).__independentMarketBoundary;}
});
