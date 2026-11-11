import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

// Exercise the actual server page with held I/O, not a copy of its scheduling.
// The catalogue deliberately cannot resolve until the dealer rail has started.
test('home prepares dealer specials during catalogue I/O and preserves city, result and failure handling',async()=>{
 const slot='__avtocenaHomeSpecialsTest';
 const modules:Record<string,string>={
  react:'export const Suspense="Suspense";',
  'react/jsx-runtime':'export const Fragment="Fragment";export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
  '@/lib/catalog/home-phase-timing':'export const createHomePhaseTiming=()=>({measure:(_phase,work)=>work(),setGeneration(){}});',
  '@/components/home/BuyerGallery':'export const BuyerGallery="BuyerGallery";',
  '@/components/dealers/SpecialRail':'export const SpecialRail="SpecialRail";',
  '@/lib/catalog/ajes-catalog':'export const withAjesCount=async x=>x;',
  '@/components/catalog/AjesRail':'export const AjesRail="AjesRail";export const readAjesRailData=async()=>({items:[]});',
  '@/lib/catalog/search-metadata':'export const WEBSITE_SCHEMA={};',
  '@/components/dealers/DealerCitySync':'export const DealerCitySync="DealerCitySync";',
  '@/lib/dealers/showcase-store':`export const readShowcase=(...args)=>globalThis.${slot}.dealer(...args);`,
  '@/lib/dealers/public-showcase':`export const homeSpecialRail=(...args)=>globalThis.${slot}.rail(...args);`,
  '@/lib/catalog/green-corner':'export const readGreenCorner=async()=>({items:[]});export const publicGreenOffer=x=>x;',
  '@/lib/catalog/live-business-pricing':'export const applyActiveBusinessPricingBatch=async x=>x;',
  'next/headers':`export const cookies=async()=>({get:()=>({value:globalThis.${slot}.cookie})});`,
  '@/components/home/HomePageClient':'export default "HomePageClient";',
  '@/lib/catalog/storage':`export const readHomeCatalogSnapshot=(...args)=>globalThis.${slot}.catalog(...args);`,
  './home.module.css':'export default {scope:"home"};',
 };
 const bundle=await build({entryPoints:['apps/web/app/(public)/page.tsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'held-home-io',setup(b){
  b.onResolve({filter:/.*/},args=>args.kind==='entry-point'?undefined:({path:args.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>{assert.ok(args.path in modules,'unexpected dependency '+args.path);return{contents:modules[args.path],loader:'js'};});
 }}]});
 const {default:HomePage}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 const find=(node:any,type:string):any=>Array.isArray(node)?node.map(n=>find(n,type)).find(Boolean):node?.type===type?node:find(node?.props?.children||[],type);
 const original=console.error;const errors:any[]=[];console.error=(...args:any[])=>{errors.push(args);};
 try{
  for(const failure of [false,true]){
   let release!:()=>void;const held=new Promise<void>(r=>{release=r;});
   const dealer={dealerId:'dealer_topavto'},expected={heading:'Предложения',items:[{id:'car',totalRub:1450000}]};
   const calls:any[]=[];
   (globalThis as any)[slot]={cookie:encodeURIComponent('Москва'),dealer:async(id:string)=>{calls.push(['dealer',id]);return dealer;},catalog:async(limit:number)=>{calls.push(['catalog',limit]);await held;return{items:[],total:0,marketCounts:{}};},rail:async(city:string,value:any)=>{calls.push(['rail',city,value]);if(failure)throw Error('fixture failure');return expected;}};
   const page=HomePage({searchParams:Promise.resolve(failure?{}:{city:'Новокузнецк'})});
   await new Promise(resolve=>setImmediate(resolve));
   const startedBeforeCatalog=calls.filter(x=>x[0]==='rail').length;
   release();
   const rendered=await page;
   assert.equal(startedBeforeCatalog,1,'dealer rail must start before catalogue I/O resolves');
   const client=find(rendered,'HomePageClient');assert.ok(client);
   const deferred=client.props.specialRailSlot.props.children;
   const rail=await deferred.type(deferred.props);
   assert.deepEqual(calls.find(x=>x[0]==='rail'),['rail',failure?'Москва':'Новокузнецк',dealer]);
   assert.equal(calls.filter(x=>x[0]==='rail').length,1,'rendering must reuse prepared work');
   if(failure){assert.equal(rail,null);assert.equal(errors.length,1);assert.equal(errors[0][0],'home_specials_failed');}
   else{assert.equal(rail.type,'SpecialRail');assert.equal(rail.props.items,expected.items);assert.equal(rail.props.heading,expected.heading);assert.equal(rail.props.desktopSplit,true);}
  }
 }finally{console.error=original;delete (globalThis as any)[slot];}
});
