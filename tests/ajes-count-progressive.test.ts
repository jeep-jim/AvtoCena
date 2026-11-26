import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {DetailReadCache} from '../apps/web/lib/catalog/detail-read-cache';
const require=createRequire(import.meta.url);
test('ready Japanese cards return while the independent count is still pending',async()=>{
 const state={counts:0,lists:0,queries:[] as any[]};(globalThis as any).__countFixture=state;
 const stubs:Record<string,string>={
  'server-only':'', 'next/headers':"export const headers=async()=>new Map([['x-real-ip','127.0.0.1']]);",
  './ajes-runtime':"export const ajesClient={read:async()=>{globalThis.__countFixture.counts++;return new Promise(()=>{});}};",
  './ajes-public':`export const cappedAjesQuery=async q=>q;export const readAjesPublic=async q=>{globalThis.__countFixture.lists++;globalThis.__countFixture.queries.push(q);return {page:q.page||1,pageSize:24,received:24,items:Array.from({length:q.page===2?23:24},(_,i)=>({id:q.table+'-'+(q.page||1)+'-'+i})),observedAt:'now'};};`,
  './ajes-query':"export const ajesCatalogQuery=p=>({table:'stats',page:Number(p.page||1),pageSize:24});export class AjesFilterUnavailable extends Error{};export class AjesInputError extends Error{};",
  './ajes-client':"export const readAjesModelDirectory=async()=>({models:[]});export const readAjesMakeDirectory=async()=>({makes:[]});export class AjesUnavailable extends Error{};",
  './ajes-result-filter':"export const ajesResultFilter=()=>({active:false,priceFilter:false,matches:()=>true});",
  './storage':"export const publicOffer=x=>x;",'./market-page':"export const sortCatalogRows=x=>x;",
  './live-business-pricing':"export const applyActiveBusinessPricingBatch=async x=>x;",
  './collection-controls':"export const assertCollectionEnabled=async()=>{};",
  './japan-preview-parameters':"export const japanPreviewParameters=()=>{throw Error('not attested');};",
  '../encyclopedia/calculation-evidence':"export const hasEncyclopediaCalculationEvidence=()=>false;",
 };
 try{
  const built=await build({entryPoints:['apps/web/lib/catalog/ajes-catalog.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['react'],plugins:[{name:'count-fixture',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}));}}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)((id:string)=>id==='react'?{cache:(fn:any)=>fn}:require(id),mod,mod.exports);
  for(const market of ['japan']){
   let timer:ReturnType<typeof setTimeout>;
   const page:any=await Promise.race([mod.exports.readAjesCatalogPage({market,drive:'awd',city:'Новокузнецк'}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ready cards blocked by count')),300);})]).finally(()=>clearTimeout(timer!));
   assert.equal(page.items.length,24);assert.equal(page.total,null);assert.equal(page.hasMore,true);assert.equal(page.items[0].id,'stats-1-0');assert.match(page.nextCursor,/^j1\.2\.0\.2\.[a-f0-9]{64}\.-$/,'ordinary pages expose their actual continuation');
  }
  for(const market of ['japan']){
   const second=await mod.exports.readAjesCatalogPage({market,page:'2'},undefined,{includeCount:false});
   const third=await mod.exports.readAjesCatalogPage({market,page:'3',after:second.nextCursor},undefined,{includeCount:false});
   assert.equal(second.items.length,24,'a locally removed row is replaced through the same 24-row source contract');
   assert.equal(third.items.length,24);
   assert.match(second.nextCursor,/^j1\.3\.1\.3\./);assert.match(third.nextCursor,/^j1\.4\.1\.4\./);
   assert.equal(second.items.at(-1).id,'stats-3-0');assert.equal(third.items[0].id,'stats-3-1');
   assert.equal(new Set([...second.items,...third.items].map(x=>x.id)).size,48);
  }
  assert.equal(state.counts,1);assert.equal(state.lists,5,'only explicitly consumed source pages are read');
  assert.deepEqual(state.queries.map(q=>q.page),[1,2,3,3,4]);
  assert.ok(state.queries.every(q=>q.pageSize===24));
  assert.ok(state.queries.every(q=>JSON.stringify({...q,page:1})===JSON.stringify({...state.queries[0],page:1})),'refill changes only the source page, never the supplier selection');
 }finally{delete (globalThis as any).__countFixture;}
});

for(const continuation of [false,true])test(`${continuation?'pagination':'overview'} Japanese lists do not compete with optional counts`,async()=>{
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 const queue=new DetailReadCache<any>({maxEntries:8,maxBytes:100000,ttlMs:0,concurrency:2,queueTimeoutMs:80});
 const state={counts:0,lists:0, count:()=>queue.get('count'+Math.random(),async()=>{state.counts++;await held;return {total:24};}),list:async(q:any)=>{await new Promise(r=>setTimeout(r,10));return queue.get('list'+q.table+q.page,async()=>{state.lists++;return {page:1,pageSize:24,received:24,items:Array.from({length:24},(_,i)=>({id:q.table+i})),observedAt:'now'};});}};(globalThis as any).__countFixture=state;
 const stubs:Record<string,string>={
  'server-only':'', 'next/headers':"export const headers=async()=>new Map([['x-real-ip','127.0.0.1']]);",
  './ajes-runtime':"export const ajesClient={read:async()=>{return globalThis.__countFixture.count();}};",
  './ajes-public':`export const cappedAjesQuery=async q=>q;export const readAjesPublic=q=>globalThis.__countFixture.list(q);`,
  './ajes-query':"export const ajesCatalogQuery=p=>({table:'stats',page:Number(p.page||1),pageSize:24});export class AjesFilterUnavailable extends Error{};export class AjesInputError extends Error{};",
  './ajes-client':"export const readAjesModelDirectory=async()=>({models:[]});export const readAjesMakeDirectory=async()=>({makes:[]});export class AjesUnavailable extends Error{};",
  './ajes-result-filter':"export const ajesResultFilter=()=>({active:false,priceFilter:false,matches:()=>true});",
  './storage':"export const publicOffer=x=>x;",'./market-page':"export const sortCatalogRows=x=>x;",
  './live-business-pricing':"export const applyActiveBusinessPricingBatch=async x=>x;",
  './collection-controls':"export const assertCollectionEnabled=async()=>{};",
  './japan-preview-parameters':"export const japanPreviewParameters=()=>{throw Error('not attested');};",
  '../encyclopedia/calculation-evidence':"export const hasEncyclopediaCalculationEvidence=()=>false;",
 };
 try{
  const built=await build({entryPoints:['apps/web/lib/catalog/ajes-catalog.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['react'],plugins:[{name:'count-fixture',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}));}}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)((id:string)=>id==='react'?{cache:(fn:any)=>fn}:require(id),mod,mod.exports);
  const pages=await Promise.all([0,1].map(i=>mod.exports.readAjesCatalogPage({market:'japan',page:String(i+(continuation?2:1))},undefined,continuation?{}:{includeCount:false})));
  assert.equal(pages.length,2);assert.ok(pages.every(page=>page.items.length===24&&page.hasMore));
  assert.equal(state.counts,0);assert.equal(state.lists,2);
 }finally{release();delete (globalThis as any).__countFixture;}
});
