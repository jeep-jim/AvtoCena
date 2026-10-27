import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('ready Korea/Japan cards return while the independent count is still pending',async()=>{
 const state={counts:0,lists:0};(globalThis as any).__countFixture=state;
 const stubs:Record<string,string>={
  'server-only':'', 'next/headers':"export const headers=async()=>new Map([['x-real-ip','127.0.0.1']]);",
  './ajes-runtime':"export const ajesClient={read:async()=>{globalThis.__countFixture.counts++;return new Promise(()=>{});}};",
  './ajes-public':`export const cappedAjesQuery=async q=>q;export const readAjesPublic=async q=>{globalThis.__countFixture.lists++;return {page:q.page||1,pageSize:24,received:24,items:Array.from({length:24},(_,i)=>({id:'car'+i})),observedAt:'now'};};`,
  './ajes-query':"export const ajesCatalogQuery=p=>({table:p.market==='japan'?'stats':'korea',page:1,pageSize:24});export class AjesFilterUnavailable extends Error{};export class AjesInputError extends Error{};",
  './ajes-client':"export const readAjesModelDirectory=async()=>({models:[]});export const readAjesMakeDirectory=async()=>({makes:[]});export class AjesUnavailable extends Error{};",
  './ajes-result-filter':"export const ajesResultFilter=()=>({active:false,priceFilter:false,matches:()=>true});",
  './storage':"export const publicOffer=x=>x;",'./market-page':"export const sortCatalogRows=x=>x;",
  './live-business-pricing':"export const applyActiveBusinessPricingBatch=async x=>x;",
  './collection-controls':"export const assertCollectionEnabled=async()=>{};",
  './ajes-price-policy':"export const ajesChinaPriceAllowed=()=>true;",
  './japan-preview-parameters':"export const japanPreviewParameters=()=>{throw Error('not attested');};",
  '../encyclopedia/calculation-evidence':"export const hasEncyclopediaCalculationEvidence=()=>false;",
 };
 try{
  const built=await build({entryPoints:['apps/web/lib/catalog/ajes-catalog.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['react'],plugins:[{name:'count-fixture',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}));}}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)((id:string)=>id==='react'?{cache:(fn:any)=>fn}:require(id),mod,mod.exports);
  for(const market of ['korea','japan']){
   let timer:ReturnType<typeof setTimeout>;
   const page:any=await Promise.race([mod.exports.readAjesCatalogPage({market,drive:market==='japan'?'awd':undefined,city:'Новокузнецк'}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ready cards blocked by count')),300);})]).finally(()=>clearTimeout(timer!));
   assert.equal(page.items.length,24);assert.equal(page.total,null);assert.equal(page.hasMore,true);assert.equal(page.items[0].id,'car0');
  }
  assert.equal(state.counts,2);assert.equal(state.lists,2);
 }finally{delete (globalThis as any).__countFixture;}
});
