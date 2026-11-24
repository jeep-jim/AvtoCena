import './helpers/server-only-hook.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {fixture, row, editorialEntry} from './helpers/china-pricing-worker-fixture.mjs';
import {buildChinaPricingGeneration} from '../scripts/catalog-next/pricing-generation.mjs';
import {initializeLocalChinaReader, resetLocalChinaReaderForTests} from '../apps/web/lib/catalog/china-local-reader';
import {readHomeCatalogSnapshot, resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
import {buildCatalogOverviewPayload} from '../apps/web/lib/catalog/overview';
import {getJsonStorage} from '../apps/web/lib/data';

const keys=['CATALOG_CHINA_LOCAL_GENERATION_DIR','CATALOG_CHINA_LOCAL_MANIFEST_SHA256','CATALOG_CHINA_LOCAL_RUNTIME_SHA'];
const markets=['korea','china','japan','uae','europe','georgia'];
async function setup(t:any){
 const f=await fixture(t,{offers:Array.from({length:13},(_,i)=>row(String(i+1)))});
 const built=await buildChinaPricingGeneration(f.options), before=keys.map(key=>process.env[key]);
 resetCatalogReadCachesForTests();await resetLocalChinaReaderForTests();
 process.env.CATALOG_CHINA_LOCAL_GENERATION_DIR=f.options.outputDirectory;
 process.env.CATALOG_CHINA_LOCAL_MANIFEST_SHA256=built.manifestSha256;
 process.env.CATALOG_CHINA_LOCAL_RUNTIME_SHA=built.manifest.runtimeSha;
 await initializeLocalChinaReader();
 t.after(async()=>{resetCatalogReadCachesForTests();await resetLocalChinaReaderForTests();
  keys.forEach((key,i)=>{if(before[i]===undefined)delete process.env[key];else process.env[key]=before[i];});});
 return {...f,built,storage:getJsonStorage()};
}
function retainedFixture(offers:any[]){
 const generationId='gen_retained_home_fixture';
 const summaries=Object.fromEntries(markets.map(market=>{
  const items=offers.filter(row=>row.market===market);return [market,{total:items.length,sourceTotal:items.length,items}];
 }));
 // The obsolete source reports inventory, but supplies no old China summary.
 // A native homepage must neither require nor recover that summary.
 delete summaries.china;
 const manifest={version:2,generationId,markets:Object.fromEntries(markets.map(market=>[market,{count:market==='china'?999:summaries[market].total}]))};
 const overview=buildCatalogOverviewPayload(generationId,{generationId} as any,summaries as any);
 return {manifest,overview,values:{'catalog/manifest.json':manifest,
  [`catalog/generations/${generationId}/indexes/overview.json`]:overview,
  'catalog-editorial/current.json':{revision:'retained',entries:{}}} as Record<string,any>};
}
function mockReads(t:any,storage:any,values:Record<string,any>){
 const reads:string[]=[];
 t.mock.method(storage,'readJsonWithMeta',async(key:string)=>{
  reads.push(key);if(!Object.hasOwn(values,key))throw Error('retained_input_unavailable');
  return {found:true,value:values[key]};
 });
 t.mock.method(storage,'readJson',async(key:string)=>{
  reads.push(key);if(!Object.hasOwn(values,key))throw Error('retained_input_unavailable');return values[key];
 });
 return reads;
}

for(const unavailable of ['manifest','editorial'])test(`native home survives unavailable shared ${unavailable} without inventing foreign zero counts`,async t=>{
 const f=await setup(t);
  resetCatalogReadCachesForTests();
  const values=unavailable==='manifest'?{'catalog-editorial/current.json':{revision:'ok',entries:{}}}:{};
  mockReads(t,f.storage,values);
  const result=await readHomeCatalogSnapshot(10);
  assert.equal(result.independentChina,true);assert.equal(result.countIncomplete,true);
  assert.deepEqual(result.marketCounts,{china:13});assert.equal(result.total,13);
  assert.equal(result.items.length,10);assert(result.items.every(item=>item.market==='china'));
  assert(result.items.every(item=>(item as any).preparedChinaSelection?.generationId===f.built.manifest.generationId));
  assert.deepEqual([...result.unavailableMarkets].sort(),markets.filter(m=>m!=='china').sort());
 assert.equal(f.reads().networkCalls,0);assert.equal(f.reads().storageWrites,0);
});

test('native home does not require old China overview and retains confirmed foreign prices',async t=>{
 const f=await setup(t), europe={...row('eur'),id:'e'.repeat(24),market:'europe',totalRub:1234567};
 const retained=retainedFixture([europe]), reads=mockReads(t,f.storage,retained.values);
 const result=await readHomeCatalogSnapshot(10);
 assert.equal(result.countIncomplete,false);assert.deepEqual(result.unavailableMarkets,[]);
 assert.equal(result.marketCounts.china,13);assert.equal(result.marketCounts.europe,1);
 assert.equal(result.items.find(item=>item.id===europe.id)?.totalRub,1234567);
 assert.equal(result.items.filter(item=>item.market==='china').length,10);
 assert.equal(result.total,14);
 assert.deepEqual(reads.sort(),Object.keys(retained.values).sort());
 assert.equal(f.reads().networkCalls,0);
});

test('failed hidden-market refresh preserves other confirmed markets and never exposes hidden cards',async t=>{
 const f=await setup(t), hidden={...row('eur-hidden'),id:'e'.repeat(24),market:'europe',totalRub:1234567};
 const korea={...row('kor'),id:'c'.repeat(24),market:'korea',totalRub:2345678};
 const retained=retainedFixture([hidden,korea]);
 retained.values['catalog-editorial/current.json']={revision:'hidden',entries:{
  [hidden.id]:editorialEntry(hidden,{market:'europe',status:'hidden'}),
 }};
 mockReads(t,f.storage,retained.values);
 const result=await readHomeCatalogSnapshot(10);
 assert.equal(result.countIncomplete,true);assert(result.unavailableMarkets.includes('europe'));
 assert.equal(Object.hasOwn(result.marketCounts,'europe'),false);
 assert.equal(result.marketCounts.korea,1);assert.equal(result.marketCounts.china,13);
 assert.equal(result.items.find(item=>item.id===korea.id)?.totalRub,2345678);
 assert(!result.items.some(item=>item.id===hidden.id));assert.equal(result.total,14);
 assert.equal(f.reads().networkCalls,0);assert.equal(f.reads().storageWrites,0);
});

test('home API keeps native and accepted foreign records if only retained repricing fails',async t=>{
 const key='__chinaHomeApiIsolationFixture';
 const china={id:'1'.repeat(24),market:'china',totalRub:1234567,preparedChinaSelection:{generationId:'gen_native_fixture'}};
 const saved={id:'2'.repeat(24),market:'europe',totalRub:2345678,calculationSnapshot:{rate:12.5}};
 const pending={id:'3'.repeat(24),market:'korea',totalRub:null,sourcePrice:99,sourceCurrency:'KRW',editorialPriceKey:'manual'};
 const snapshot={generationId:'retained',items:[china,saved,pending],marketCounts:{china:13,europe:1,korea:1},
  total:15,independentChina:true,countIncomplete:false,unavailableMarkets:[]};
 const value={snapshot,repricing:[] as any[]};(globalThis as any)[key]=value;
 const mocks:Record<string,string>={
  'next/server':'export const NextResponse={json:(value,options={})=>new Response(JSON.stringify(value),options)};',
  '@/lib/catalog/storage':`export const readHomeCatalogSnapshot=async()=>globalThis.${key}.snapshot;export const searchOffers=async()=>{throw Error('unexpected recovery')};`,
  '@/lib/catalog/live-business-pricing':`export const applyActiveBusinessPricingBatch=async rows=>{globalThis.${key}.repricing=rows;throw Error('foreign settings unavailable')};`,
  '@/lib/catalog/ajes-catalog':'export const withAjesCount=async value=>({...value,marketCountInfo:{}});',
  '@/lib/catalog/green-corner':'export const readGreenCorner=async()=>({items:[]});',
 };
 t.mock.method(console,'error',()=>{});
 try{
  const bundled=await build({entryPoints:[fileURLToPath(new URL('../apps/web/app/api/catalog/home/route.ts',import.meta.url))],
   bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'home-route-fixture',setup(b){
    b.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path]}));
   }}]});
  const module={exports:{} as any};new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const response=await module.exports.GET(),actual=await response.json();
  assert.equal(response.status,200);assert.equal(actual.independentChina,true);assert.equal(actual.countIncomplete,true);
  assert.deepEqual(actual.items,snapshot.items);assert.deepEqual(actual.marketCounts,snapshot.marketCounts);
  assert.deepEqual(value.repricing,[saved,pending]);assert.deepEqual(actual.pricingUnavailableMarkets,['europe','korea']);
  assert.equal(actual.items[2].totalRub,null);assert.equal(actual.items[2].sourcePrice,99);
  value.snapshot={...snapshot,independentChina:false};
  const legacy=await module.exports.GET();assert.equal(legacy.status,500,'unrelated legacy failures are not globally masked');
 }finally{delete (globalThis as any)[key];}
});

test('homepage SSR survives the Green Corner pricing rejection in its shared Promise.all',async t=>{
 const key='__chinaHomeSsrIsolationFixture';
 const china={id:'1'.repeat(24),market:'china',totalRub:1234567,preparedChinaSelection:{generationId:'gen_native_fixture'}};
 const savedGreen={id:'green-ready',market:'japan',totalRub:2345678,calculationSnapshot:{rate:0.56}};
 const value={china,savedGreen,priced:[] as any[]};(globalThis as any)[key]=value;
 const mocks:Record<string,string>={
  'react':'export const Suspense="Suspense";',
  'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="Fragment";',
  'next/headers':'export const cookies=async()=>({get:()=>undefined});',
  '@/lib/catalog/home-phase-timing':'export const createHomePhaseTiming=()=>({measure:(_name,work)=>work(),setGeneration:()=>{}});',
  '@/components/home/BuyerGallery':'export const BuyerGallery="BuyerGallery";',
  '@/components/dealers/SpecialRail':'export const SpecialRail="SpecialRail";',
  '@/components/catalog/AjesRail':'export const AjesRail="AjesRail";export const readAjesRailData=async()=>{throw Error("rail must not be queried by this render")};',
  '@/lib/catalog/search-metadata':'export const WEBSITE_SCHEMA={};',
  '@/components/dealers/DealerCitySync':'export const DealerCitySync="DealerCitySync";',
  '@/lib/dealers/showcase-store':'export const readShowcase=async()=>null;',
  '@/lib/dealers/public-showcase':'export const homeSpecialRail=async()=>null;',
  '@/lib/catalog/green-corner':`export const readGreenCorner=async()=>({items:[{id:'green-ready',privateValue:'must not enter public props'}]});export const publicGreenOffer=()=>globalThis.${key}.savedGreen;`,
  '@/lib/catalog/live-business-pricing':`export const applyActiveBusinessPricingBatch=async rows=>{globalThis.${key}.priced.push(rows);if(rows.some(row=>row.id==='green-ready'))throw Error('retained settings failed');return rows};`,
  '@/lib/catalog/ajes-catalog':'export const withAjesCount=async value=>({...value,marketCountInfo:{}});',
  '@/lib/catalog/storage':`export const readHomeCatalogSnapshot=async()=>({generationId:'retained',items:[globalThis.${key}.china],marketCounts:{china:13},total:13,countIncomplete:false,independentChina:true});`,
  '@/components/home/HomePageClient':'export default "HomePageClient";',
  './home.module.css':'export default {scope:"home"};',
 };
 t.mock.method(console,'error',()=>{});
 try{
  const bundled=await build({entryPoints:[fileURLToPath(new URL('../apps/web/app/(public)/page.tsx',import.meta.url))],
   bundle:true,platform:'node',format:'cjs',jsx:'automatic',write:false,plugins:[{name:'home-ssr-fixture',setup(b){
    b.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path]}));
   }}]});
  const module={exports:{} as any};new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const tree=await module.exports.default({}), queue=[tree];let props:any;
  while(queue.length){const node=queue.shift();if(!node||typeof node!=='object')continue;
   if(node.type==='HomePageClient'){props=node.props;break;}
   const children=node.props?.children;queue.push(...(Array.isArray(children)?children:[children]));
  }
  assert(props,'homepage resolves its complete props despite the sibling rejection');
  assert.deepEqual(props.initialOffers,[china]);assert.equal(props.initialMarketCounts.china,13);
  assert.deepEqual(props.initialGreen,{items:[savedGreen],total:1});assert.equal(props.initialCount,14);
  assert.equal(props.initialCountIncomplete,true);assert(!JSON.stringify(props).includes('privateValue'));
  assert(value.priced.some(rows=>rows[0]===savedGreen));assert(value.priced.every(rows=>!rows.includes(china)));
 }finally{delete (globalThis as any)[key];}
});
