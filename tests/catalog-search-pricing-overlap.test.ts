import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
async function fixture(){
 const mocks:Record<string,string>={
  'effective-market-settings':'export const getEffectiveMarketsWithDefaults=()=>globalThis.__searchPricing.settings();',
  'market-selection':'export const selectedCatalogMarkets=x=>[x];export const marketSelectionUrl=()=>"";',
  'green-corner':'export const readGreenCorner=()=>{};export const readGreenCornerPage=()=>{};',
  'route':'export const GET=()=>{};',
  'ajes-count-display':'export const exactAjesCount=()=>{};',
  'ajes-market-selection':'export const usesAjesMarket=async()=>false;',
  'ajes-error-response':'export const ajesErrorResponse=()=>{};',
  'ajes-catalog':'export const readAjesCatalogPage=()=>{};export const readAjesCountSummary=()=>{};export const withAjesCount=x=>x;',
  'market-page':'export const readCatalogMarketPage=async()=>({items:[]});',
  'runtime-config':"export const PUBLIC_CATALOG_MARKET_SET=new Set(['europe']);",
  'engine-input':'export const parseEngineCc=()=>undefined;',
  'live-business-pricing':'export const applyActiveBusinessPricingBatch=x=>globalThis.__searchPricing.price(x);',
  'server':'export const NextResponse={json:(body,init)=>Response.json(body,init)};',
  'public-rates':'export const loadPublicRateExtras=()=>{};',
  'storage':'export const countCatalogOffers=async()=>({total:0});export const readCatalogFacets=()=>{};export const searchOffers=q=>globalThis.__searchPricing.search(q);',
 };
 const output=await build({entryPoints:['apps/web/app/(public)/api/catalog/search/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'fixture',setup(b){
  b.onResolve({filter:/.*/},a=>{if(a.kind==='entry-point')return;const name=a.path.split('/').at(-1)!;if(mocks[name])return {path:name,namespace:'fixture'};});
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]}));
 }}]});
 const m={exports:{} as any};new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);return m.exports.GET;
}
test('catalog and settings I/O overlap while pricing still uses the returned exact cards',async()=>{
 const GET=await fixture(),events:string[]=[];
 let searchReady!:()=>void,settingsReady!:()=>void;
 const search=new Promise<void>(r=>searchReady=r),settings=new Promise<void>(r=>settingsReady=r);
 const original={id:'bmw',market:'europe',totalRub:3000000};
 (globalThis as any).__searchPricing={settings:async()=>{events.push('settings');await settings;},search:async()=>{events.push('search');await search;return {items:[original],total:1,generationId:'one'};},price:async(items:any[])=>{assert.deepEqual(items,[original]);events.push('price');return items;}};
 try{
  const request=GET(new Request('https://fixture.test/api/catalog/search?market=europe&make=BMW&page=2'));
  await new Promise<void>(r=>setImmediate(r));
  assert.deepEqual(events,['settings','search'],'both reads start before either completes');
  searchReady();await new Promise<void>(r=>setImmediate(r));assert.equal(events.includes('price'),false);
  settingsReady();const response=await request;
  assert.equal(response.status,200);assert.deepEqual((await response.json()).items,[original]);assert.deepEqual(events,['settings','search','price']);
 }finally{delete (globalThis as any).__searchPricing;}
});
test('preparation errors do not fail empty results or mask authoritative pricing errors',async()=>{
 const GET=await fixture();let populated=false;
 (globalThis as any).__searchPricing={settings:async()=>{throw Error('preparation_failure');},search:async()=>({items:populated?[{id:'bmw',market:'europe'}]:[],total:populated?1:0}),price:async(items:any[])=>{if(items.length)throw Error('current_settings_unavailable');return items;}};
 try{
  const empty=await GET(new Request('https://fixture.test/api/catalog/search?market=europe'));assert.equal(empty.status,200);assert.deepEqual((await empty.json()).items,[]);
  populated=true;await assert.rejects(GET(new Request('https://fixture.test/api/catalog/search?market=europe')),/current_settings_unavailable/);
 }finally{delete (globalThis as any).__searchPricing;}
});
test('count-only, market-page and invalid market-page requests do not start unused pricing reads',async()=>{
 const GET=await fixture();let settings=0;
 (globalThis as any).__searchPricing={settings:async()=>{settings++;},price:async(x:any)=>x};
 try{
  for(const suffix of ['countOnly=1','marketPage=1','marketPage=1&page=-1'])await GET(new Request('https://fixture.test/api/catalog/search?market=europe&'+suffix));
  assert.equal(settings,0);
 }finally{delete (globalThis as any).__searchPricing;}
});
