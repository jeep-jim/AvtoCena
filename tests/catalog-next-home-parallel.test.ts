import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

let fixtureId=0;
const root=fileURLToPath(new URL('../',import.meta.url));
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred<T=any>(){
 let resolve!:(value:T)=>void,reject!:(error:Error)=>void;
 const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
}
async function bundle(contents:string,mocks:Record<string,string>){
 const built=await build({stdin:{contents,resolveDir:root,sourcefile:'home-test-entry.ts'},
  bundle:true,platform:'node',format:'cjs',jsx:'automatic',write:false,plugins:[{
   name:'home-controlled-dependencies',setup(b){
    b.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path]}));
   },
  }]});
 const module={exports:{} as any};
 new Function('require','module','exports',built.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 return module.exports;
}
function clientProps(tree:any){
 const queue=[tree];
 while(queue.length){
  const node=queue.shift();if(!node||typeof node!=='object')continue;
  if(node.type==='HomePageClient')return node.props;
  const children=node.props?.children;queue.push(...(Array.isArray(children)?children:[children]));
 }
 assert.fail('the complete home render must contain HomePageClient');
}
function dataProps(props:any){
 const {japanAuctions,dealerGallerySlot,specialRailSlot,...data}=props;
 assert.equal(japanAuctions.type,'Suspense');assert.equal(japanAuctions.props.fallback,null);
 assert.equal(dealerGallerySlot.type,'Suspense');assert.equal(dealerGallerySlot.props.fallback.props['aria-busy'],'true');
 assert.equal(specialRailSlot.type,'Suspense');assert.equal(specialRailSlot.props.fallback,null);
 return data;
}
async function homeFixture(t:any){
 const key=`__homeParallel${++fixtureId}`;
 const china={id:'c'.repeat(24),market:'china',totalRub:1187500,
  preparedChinaSelection:{generationId:'gen_china_fixture'},calculationSnapshot:{city:'Москва',totalRub:1187500}};
 const europe={id:'e'.repeat(24),market:'europe',totalRub:2450000,calculationSnapshot:{rate:99.5}};
 const korea={id:'k'.repeat(24),market:'korea',totalRub:null,sourcePrice:123456,sourceCurrency:'KRW'};
 const retained={id:'g'.repeat(24),market:'georgia',totalRub:3456789};
 const snapshot={generationId:'gen_123_fixture',items:[europe,china,korea,retained],
  marketCounts:{europe:2,china:13,korea:3,georgia:1},total:19,countIncomplete:false,independentChina:true};
 const counted={...snapshot,total:169,marketCounts:{...snapshot.marketCounts,japan:150},
  marketCountInfo:{japan:{total:150,stale:false,upperBound:false,observedAt:'2026-11-24T00:00:00Z'}}};
 const green={items:Array.from({length:12},(_,i)=>({privateValue:'private-green-fixture',
  publicOffer:{id:`green-${i}`,market:'japan',totalRub:800000+i,calculationSnapshot:{rate:0.56}}}))};
 const pricedCatalog=[{...korea,totalRub:1350000},{...europe,totalRub:2550000}];
 const pricedGreen=green.items.slice(0,10).map(row=>({...row.publicOffer,totalRub:row.publicOffer.totalRub+1000}));
 const gates={snapshot:deferred(),counts:deferred(),green:deferred(),catalogPricing:deferred(),greenPricing:deferred()};
 const calls={snapshot:[] as number[],counts:[] as any[],green:0,pricing:[] as any[][],publicGreen:[] as any[]};
 const fixture={
  readSnapshot:(limit:number)=>{calls.snapshot.push(limit);return gates.snapshot.promise;},
  readCounts:(value:any)=>{calls.counts.push(value);return gates.counts.promise;},
  readGreen:()=>{calls.green++;return gates.green.promise;},
  publicGreen:(row:any)=>{calls.publicGreen.push(row);return row.publicOffer;},
  price:(rows:any[])=>{
   calls.pricing.push(rows);
   if(!rows.length)return Promise.resolve(rows);
   return rows[0].id.startsWith('green-')?gates.greenPricing.promise:gates.catalogPricing.promise;
  },
 };
 (globalThis as any)[key]=fixture;t.after(()=>{delete (globalThis as any)[key];});
 t.mock.method(console,'error',()=>{});
 const mocks:Record<string,string>={
  'react':'export const Suspense="Suspense";',
  'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="Fragment";',
  'next/headers':'export const cookies=async()=>({get:()=>({value:encodeURIComponent("Казань")})});',
  '@/components/home/BuyerGallery':'export const BuyerGallery="BuyerGallery";',
  '@/components/dealers/SpecialRail':'export const SpecialRail="SpecialRail";',
  '@/components/catalog/AjesRail':'export const AjesRail="AjesRail";export const readAjesRailData=async()=>{throw Error("unexpected eager Japan rail")};',
  '@/lib/catalog/search-metadata':'export const WEBSITE_SCHEMA={name:"АвтоЦена"};',
  '@/components/dealers/DealerCitySync':'export const DealerCitySync="DealerCitySync";',
  '@/lib/dealers/showcase-store':'export const readShowcase=async()=>null;',
  '@/lib/dealers/public-showcase':'export const homeSpecialRail=async()=>null;',
  '@/lib/catalog/storage':`export const readHomeCatalogSnapshot=limit=>globalThis.${key}.readSnapshot(limit);`,
  '@/lib/catalog/ajes-catalog':`export const withAjesCount=value=>globalThis.${key}.readCounts(value);`,
  '@/lib/catalog/green-corner':`export const readGreenCorner=()=>globalThis.${key}.readGreen();export const publicGreenOffer=row=>globalThis.${key}.publicGreen(row);`,
  '@/lib/catalog/live-business-pricing':`export const applyActiveBusinessPricingBatch=rows=>globalThis.${key}.price(rows);`,
  '@/components/home/HomePageClient':'export default "HomePageClient";',
  './home.module.css':'export default {scope:"home"};',
 };
 const page=await bundle('export {default} from "./apps/web/app/(public)/page.tsx";',mocks);
 let settled=false;
 const render=page.default({searchParams:Promise.resolve({city:[' <Москва> ','ignored']})});
 void render.then(()=>{settled=true;},()=>{settled=true;});
 const expected={initialGreen:{items:pricedGreen,total:12},initialCity:'Москва',
  initialOffers:[pricedCatalog[1],china,pricedCatalog[0],retained],initialMarketCounts:counted.marketCounts,
  initialCount:181,initialCountIncomplete:false,initialMarketCountInfo:counted.marketCountInfo};
 async function finish(){
  gates.snapshot.resolve(snapshot);gates.counts.resolve(counted);gates.green.resolve(green);
  gates.catalogPricing.resolve(pricedCatalog);gates.greenPricing.resolve(pricedGreen);
  return clientProps(await render);
 }
 return {gates,calls,render,finish,settled:()=>settled,snapshot,counted,green,china,pricedCatalog,pricedGreen,expected};
}

test('home starts snapshot pricing while counts and Green Corner are still pending, then renders all data',async t=>{
 const f=await homeFixture(t);await turn();
 assert.deepEqual(f.calls.snapshot,[10]);assert.equal(f.calls.green,1);
 assert.equal(f.calls.counts.length,0);assert.equal(f.calls.pricing.length,0);
 f.gates.snapshot.resolve(f.snapshot);await turn();
 assert.equal(f.calls.counts.length,1);assert.equal(f.calls.counts[0],f.snapshot);
 assert.deepEqual(f.calls.pricing,[f.snapshot.items.filter(item=>item!==f.china)]);
 f.gates.catalogPricing.resolve(f.pricedCatalog);await turn();assert.equal(f.settled(),false);
 f.gates.green.resolve(f.green);await turn();
 assert.deepEqual(f.calls.pricing[1],f.green.items.slice(0,10).map(row=>row.publicOffer));
 f.gates.greenPricing.resolve(f.pricedGreen);await turn();assert.equal(f.settled(),false);
 f.gates.counts.resolve(f.counted);
 const props=clientProps(await f.render);
 assert.deepEqual(dataProps(props),f.expected);
 assert.equal(props.initialOffers[1],f.china,'prepared China row and its saved quote retain identity');
 assert.equal(props.initialOffers[3],f.snapshot.items[3],'missing repriced result retains its original quote');
 assert.equal(f.calls.publicGreen.length,10);assert(!JSON.stringify(props).includes('private-green-fixture'));
 assert.deepEqual(f.calls.snapshot,[10]);assert.equal(f.calls.green,1);
});

test('Green Corner pricing starts before the catalog snapshot is available',async t=>{
 const f=await homeFixture(t);await turn();f.gates.green.resolve(f.green);await turn();
 assert.equal(f.calls.counts.length,0);assert.deepEqual(f.calls.pricing,[f.green.items.slice(0,10).map(row=>row.publicOffer)]);
 f.gates.greenPricing.resolve(f.pricedGreen);await turn();assert.equal(f.settled(),false);
 assert.deepEqual(dataProps(await f.finish()),f.expected);
});

test('home awaits both pricing results even after both reads and counts finish',async t=>{
 const f=await homeFixture(t);f.gates.snapshot.resolve(f.snapshot);f.gates.green.resolve(f.green);f.gates.counts.resolve(f.counted);
 await turn();assert.equal(f.settled(),false);
 f.gates.catalogPricing.resolve(f.pricedCatalog);await turn();assert.equal(f.settled(),false);
 f.gates.greenPricing.resolve(f.pricedGreen);
 assert.deepEqual(dataProps(clientProps(await f.render)),f.expected);
});

test('failed snapshot skips counts and catalog pricing and preserves the complete green fallback',async t=>{
 const f=await homeFixture(t);await turn();f.gates.snapshot.reject(Error('snapshot unavailable'));await turn();
 assert.equal(f.calls.counts.length,0);assert.equal(f.calls.pricing.length,0);assert.equal(f.settled(),false);
 const props=await f.finish();
 assert.deepEqual(dataProps(props),{...f.expected,initialOffers:[],initialMarketCounts:{},initialCount:12,
  initialCountIncomplete:true,initialMarketCountInfo:{}});
 assert.equal(f.calls.counts.length,0);assert.deepEqual(f.calls.pricing,[f.green.items.slice(0,10).map(row=>row.publicOffer)]);
});

for(const priceFails of [false,true])test(`count rejection discards speculative rows when pricing ${priceFails?'rejects':'succeeds'}`,async t=>{
 const f=await homeFixture(t);f.gates.snapshot.resolve(f.snapshot);await turn();
 assert.equal(f.calls.pricing.length,1);f.gates.counts.reject(Error('counts unavailable'));await turn();
 assert.equal(f.settled(),false);
 if(priceFails)f.gates.catalogPricing.reject(Error('pricing unavailable'));
 else f.gates.catalogPricing.resolve(f.pricedCatalog);
 await turn();
 assert.deepEqual(dataProps(await f.finish()),{...f.expected,initialOffers:[],initialMarketCounts:{},initialCount:12,
  initialCountIncomplete:true,initialMarketCountInfo:{}});
});

for(const failed of ['catalog','green','both'])test(`early ${failed} pricing failure preserves audited rows and the incomplete flag`,async t=>{
 const f=await homeFixture(t);f.gates.snapshot.resolve(f.snapshot);f.gates.green.resolve(f.green);await turn();
 if(failed!=='green')f.gates.catalogPricing.reject(Error('catalog price unavailable'));
 if(failed!=='catalog')f.gates.greenPricing.reject(Error('green price unavailable'));
 await turn();assert.equal(f.settled(),false,'pending counts still belong to the complete render');
 const props=await f.finish();
 assert.deepEqual(dataProps(props),{...f.expected,initialCountIncomplete:true,
  initialOffers:failed==='green'?f.expected.initialOffers:f.snapshot.items,
  initialGreen:{items:failed==='catalog'?f.pricedGreen:f.green.items.slice(0,10).map(row=>row.publicOffer),total:12}});
 assert.equal(props.initialOffers[1],f.china);assert(f.calls.pricing.every(rows=>!rows.includes(f.china)));
});

test('unavailable Green Corner keeps its empty fallback without removing catalog or count metadata',async t=>{
 const f=await homeFixture(t);await turn();f.gates.green.reject(Error('green unavailable'));await turn();
 assert.deepEqual(f.calls.pricing,[[]]);
 assert.deepEqual(dataProps(await f.finish()),{...f.expected,initialGreen:{items:[],total:0},
  initialCount:169,initialCountIncomplete:true});
});

test('count incompleteness and exact count metadata survive otherwise successful pricing',async t=>{
 const f=await homeFixture(t);
 const counted={...f.counted,countIncomplete:true,marketCountInfo:{japan:{...f.counted.marketCountInfo.japan,stale:true,upperBound:true}}};
 f.gates.counts.resolve(counted);
 assert.deepEqual(dataProps(await f.finish()),{...f.expected,initialCountIncomplete:true,initialMarketCountInfo:counted.marketCountInfo});
});

test('a snapshot without prepared China rows retains the pricing batch output unchanged',async t=>{
 const f=await homeFixture(t);
 const snapshot={...f.snapshot,items:f.snapshot.items.filter(row=>row!==f.china)};
 const counted={...f.counted,items:snapshot.items};
 const prices=[...snapshot.items].reverse().map((row,i)=>({...row,totalRub:2000000+i}));
 f.gates.snapshot.resolve(snapshot);f.gates.counts.resolve(counted);f.gates.catalogPricing.resolve(prices);
 const props=await f.finish();
 assert.equal(f.calls.pricing.find(rows=>rows.includes(snapshot.items[0])),snapshot.items);
 assert.equal(props.initialOffers,prices);assert.deepEqual(dataProps(props),{...f.expected,initialOffers:prices});
});

async function dealerFixture(t:any,rows:any[]){
 const key=`__homeDealers${++fixtureId}`;
 const state={request:{},reads:[] as string[],rows,showcases:{} as Record<string,any>,available:[] as string[],rated:[] as string[]};
 (globalThis as any)[key]=state;t.after(()=>{delete (globalThis as any)[key];});
 const mocks:Record<string,string>={
  'server-only':'',
  'react':`export const cache=fn=>{const requests=new WeakMap();return (...args)=>{
   const request=globalThis.${key}.request;let values=requests.get(request);
   if(!values){values=new Map();requests.set(request,values);}const key=JSON.stringify(args);
   if(!values.has(key))values.set(key,fn(...args));return values.get(key);
  }};`,
  '../data':`export const readDataJson=async(key,fallback)=>{const s=globalThis.${key};s.reads.push(key);
   if(key==='dealers/dealers.json')return s.rows;
   if(key.startsWith('dealers/showcases/'))return s.showcases[key]??fallback;
   throw Error('unexpected data read: '+key);
  };export const mutateDataJson=()=>{throw Error('unexpected write')};`,
  './market-offer-server':'export const withMarketQuotes=()=>{throw Error("unexpected quote")};',
  './program-store':`export const availableShowcase=async s=>{globalThis.${key}.available.push(s.dealerId);return s;};`,
  './exchange-rate':`export const withDealerRate=async s=>{globalThis.${key}.rated.push(s.dealerId);return s;};`,
 };
 const lib=await bundle('export {readDealers,readShowcase} from "./apps/web/lib/dealers/showcase-store";export {homeSpecialRail,publicRail} from "./apps/web/lib/dealers/public-showcase";export {defaultShowcase} from "./apps/web/lib/dealers/showcase-model";',mocks);
 function showcase(id:string,city:string,price:number,enabled=true){
  const s={...lib.defaultShowcase(id,id),profileEnabled:enabled,stockEnabled:true,specialHeading:`Heading ${id}`,
   offices:[{id:'office',city,address:`Address ${id}`,phone:'',hours:'',lat:null,lon:null,photos:[]}],
   offers:[{id:`offer-${id}`,availability:'stock',status:'published',condition:'used',year:2021,
    make:'Toyota',model:'Corolla',trim:'',priceRub:price,priceUsd:0,officeId:'office',photos:[],updatedAt:'2026-11-24T00:00:00Z'}]};
  state.showcases[`dealers/showcases/${id}.json`]=s;return s;
 }
 return {state,lib,showcase};
}

test('home dealer rail reuses the showcase request read and preserves verified city, order and prices',async t=>{
 const pilotId='dealer_topavto';
 const rows=[{id:pilotId,status:'verified'},{id:'verified-a',status:'verified'},{id:'paused',status:'paused'},
  {id:'hidden',status:'verified'},{id:'verified-b',status:'verified'}];
 const f=await dealerFixture(t,rows);
 f.showcase(pilotId,'Казань',1100000);f.showcase('verified-a','Москва',2200000);
 f.showcase('paused','Москва',3300000);f.showcase('hidden','Москва',4400000,false);f.showcase('verified-b','Москва',5500000);
 const pilot=await f.lib.readShowcase(pilotId),all=await f.lib.homeSpecialRail('',pilot);
 assert.deepEqual(all.items.map((item:any)=>[item.dealer.id,item.id,item.price]),[
  [pilotId,`offer-${pilotId}`,1100000],['verified-a','offer-verified-a',2200000],['verified-b','offer-verified-b',5500000]]);
 assert.equal(all.heading,'Предложения дилеров');
 const city=await f.lib.homeSpecialRail('г. Москва',pilot);
 assert.deepEqual(city.items,all.items.filter((item:any)=>item.dealer.id!==pilotId));
 assert.equal(f.state.reads.filter(key=>key==='dealers/dealers.json').length,1);
 assert(!f.state.reads.some(key=>key.includes('/paused.json')));assert.deepEqual(f.state.rated,[],'stock prices need no exchange-rate read');
 assert.deepEqual([...new Set(f.state.available)],['verified-a','hidden','verified-b']);
 f.state.request={};await f.lib.homeSpecialRail('',null);
 assert.equal(f.state.reads.filter(key=>key==='dealers/dealers.json').length,2,'a new request gets a fresh dealer read');
});

for(const empty of [true,false])test(`home dealer rail preserves ${empty?'empty-directory fallback':'pilot-only directory'} semantics`,async t=>{
 const pilotId='dealer_topavto',f=await dealerFixture(t,empty?[]:[{id:pilotId,status:'verified'}]);
 f.showcase(pilotId,'Казань',1100000);
 const pilot=await f.lib.readShowcase(pilotId),rail=await f.lib.homeSpecialRail('Москва',pilot);
 assert.deepEqual(rail,{heading:`Heading ${pilotId}`,items:f.lib.publicRail(pilot,'Москва','home')});
 assert.equal(rail.items.length,1);assert.equal(rail.items[0].price,1100000);
 assert.deepEqual(await f.lib.homeSpecialRail('Москва',null),{heading:'Предложения дилеров',items:[]});
 assert.deepEqual(f.state.available,[]);assert.deepEqual(f.state.rated,[]);
 assert.equal(f.state.reads.filter(key=>key==='dealers/dealers.json').length,1);
});
