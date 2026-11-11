import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

test('budget rail finds later accepted rows in one source read, has no competing count, and resumes without repeats',async()=>{
 const state={queries:[] as any[],counts:0,priced:0,edits:{} as any};
 (globalThis as any).__budgetPipeline=state;
 const mocks:Record<string,string>={
  'server-only':'',
  'react':'export const cache=f=>f;',
  'next/headers':`export const headers=async()=>({get:()=> '192.0.2.1'});`,
  'ajes-runtime':`export const ajesClient={read:async()=>{globalThis.__budgetPipeline.counts++;throw Error('unexpected aggregate');}};`,
  'ajes-client':`export class AjesUnavailable extends Error{};export const readAjesModelDirectory=async()=>{throw Error('no model requested')};export const readAjesMakeDirectory=async()=>{throw Error('no make requested')};`,
  'collection-controls':'export const assertCollectionEnabled=async()=>{};',
  'saved-calculation-previews':'export const hasSavedPreviewEntriesForMarket=async()=>Boolean(globalThis.__budgetPipeline.savedPrices);',
  'editorial':`export const readCatalogEditorial=async()=>({revision:'one',entries:globalThis.__budgetPipeline.edits});export const matchingEditorial=()=>undefined;`,
  'rates':`export const convertToRub=async(n,currency)=>({currency,effectiveRate:.5,rateSource:'cbr',rateDate:new Date().toISOString()});`,
  'ajes-public':`export const cappedAjesQuery=q=>q;export const readAjesPublic=async q=>{globalThis.__budgetPipeline.queries.push({...q});const items=q.page===1?Array.from({length:24},(_,i)=>({id:'car'+i,market:q.table==='korea'?'korea':'japan',powerHp:150,catalogPricingMode:'seller',totalRub:null,...(i>=8?{savedCalculationPreview:{version:'current',totalRub:1400000,parameters:{},deliveryCity:''}}:{})})):[];return {items,received:items.length,page:q.page,pageSize:q.pageSize,observedAt:'2026-11-11T00:00:00Z',partial:false,stale:false};};`,
  'live-business-pricing':`export const applyActiveBusinessPricingBatch=async rows=>{globalThis.__budgetPipeline.priced+=rows.length;return rows;};`,
  'storage':`export const publicOffer=x=>x;`,
  'market-page':`export const sortCatalogRows=x=>x;`,
 };
 try{
  const built=await build({entryPoints:['apps/web/lib/catalog/ajes-catalog.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'bounded-budget',setup(b){
   b.onResolve({filter:/.*/},a=>{const key=a.path in mocks?a.path:a.path.split('/').at(-1)!;return key in mocks?{path:key,namespace:'stub'}:undefined;});
   b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:mocks[a.path]}));
  }}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
  for(const market of ['japan','korea']){
   state.queries=[];state.counts=0;state.priced=0;
   const rail=await mod.exports.readAjesCatalogPage({market,budgetTo:'1500000',pageSize:'6'});
   assert.deepEqual(rail.items.map((r:any)=>r.id),['car8','car9','car10','car11','car12','car13']);
   assert.equal(state.queries.length,1);assert.equal(state.queries[0].pageSize,24);assert.equal(state.queries[0].sourcePriceTo,3000002);
   assert.equal(rail.pageSize,6);assert.equal(rail.nextCursor,'1.6');assert.equal(state.counts,0);assert.equal(rail.total,null);
   const next=await mod.exports.readAjesCatalogPage({market,budgetTo:'1500000',pageSize:'24',after:rail.nextCursor});
   assert.equal(next.items[0].id,'car14');assert.equal(next.items.length,10);assert.equal(next.hasMore,false);
   assert.equal(new Set([...rail.items,...next.items].map((r:any)=>r.id)).size,16);
  }
  state.edits={edited:{market:'korea',status:'visible',sellerPrice:{amount:1,currency:'KRW'}}};state.queries=[];
  await mod.exports.readAjesCatalogPage({market:'korea',budgetTo:'1500000',pageSize:'6'});
  assert.equal(state.queries[0].sourcePriceTo,undefined,'manual seller prices must never be dropped by the supplier cap');
  state.edits={};(state as any).savedPrices=true;state.queries=[];
  await mod.exports.readAjesCatalogPage({market:'japan',budgetTo:'1500000',pageSize:'6'});
  assert.equal(state.queries[0].sourcePriceTo,undefined,'saved delivered quotes must never be dropped by the supplier cap');
 }finally{delete (globalThis as any).__budgetPipeline;}
});
