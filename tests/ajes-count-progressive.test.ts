import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {DetailReadCache} from '../apps/web/lib/catalog/detail-read-cache';
const require=createRequire(import.meta.url);
function sourcePage(q:any,observedAt:string,omitOne=false){
 const raw=Array.from({length:q.pageSize},(_,i)=>({id:q.table+'-'+(q.drive||'all')+'-'+q.page+'-'+i}));
 return {page:q.page,pageSize:q.pageSize,received:raw.length,items:omitOne&&q.page===1?raw.filter((_,i)=>i!==25):raw,observedAt,stale:false,
  sourceFingerprint:createHash('sha256').update(JSON.stringify([observedAt,raw.length,raw])).digest('hex')};
}
test('ready Japanese cards return while the independent count is still pending',async()=>{
 const observedAt=new Date().toISOString();let release!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;});
 const state={counts:0,lists:0,countSettled:false,sourcePages:[] as number[],count:async()=>{state.counts++;await held;state.countSettled=true;return {total:240,stale:false,observedAt};},list:async(q:any)=>{state.lists++;state.sourcePages.push(q.page);assert.equal(q.pageSize,48);return sourcePage(q,observedAt,true);}};(globalThis as any).__countFixture=state;
 const stubs:Record<string,string>={
  'server-only':'', 'next/headers':"export const headers=async()=>new Map([['x-real-ip','127.0.0.1']]);",
  './ajes-runtime':"export const ajesClient={read:()=>globalThis.__countFixture.count()};",
  './ajes-public':"export const cappedAjesQuery=async q=>q;export const readAjesPublic=q=>globalThis.__countFixture.list(q);",
  './ajes-query':"export const ajesCatalogQuery=p=>({table:'stats',page:Number(p.page||1),pageSize:24,drive:p.drive});export class AjesFilterUnavailable extends Error{};export class AjesInputError extends Error{};",
  './ajes-client':"export const readAjesModelDirectory=async()=>({models:[]});export const readAjesMakeDirectory=async()=>({makes:[]});export class AjesUnavailable extends Error{};",
  './ajes-result-filter':"export const ajesResultFilter=()=>({active:false,powerFilter:false,priceFilter:false,matches:()=>true});",
  './editorial':"export const readCatalogEditorial=async()=>({revision:'count-fixture',entries:{}});",
  '../encyclopedia/calculation-index':"export const readCalculationIndex=()=>null;",
  './storage':"export const publicOffer=x=>x;",'./market-page':"export const sortCatalogRows=x=>x;",
  './live-business-pricing':"export const applyActiveBusinessPricingBatch=async x=>x;",
  './collection-controls':"export const assertCollectionEnabled=async()=>{};",
  './japan-preview-parameters':"export const japanPreviewParameters=()=>{throw Error('not attested');};",
  '../encyclopedia/calculation-evidence':"export const hasEncyclopediaCalculationEvidence=()=>false;",
 };
 try{
  const built=await build({entryPoints:['apps/web/lib/catalog/ajes-catalog.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['react'],plugins:[{name:'count-fixture',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}));}}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)((id:string)=>id==='react'?{cache:(fn:any)=>fn}:require(id),mod,mod.exports);
  const params={market:'japan',drive:'awd',city:'Новокузнецк'};
  let timer:ReturnType<typeof setTimeout>;
  const page:any=await Promise.race([mod.exports.readAjesCatalogPage(params),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ready cards blocked by count')),2500);})]).finally(()=>clearTimeout(timer!));
  assert.equal(page.items.length,24);assert.equal(page.total,null);assert.equal(page.hasMore,true);assert.equal(page.items[0].id,'stats-awd-1-0');assert.match(page.nextCursor,/^jp1\.[a-f0-9]{32}\.2\.[a-f0-9]{16}$/);
  assert.equal(state.counts,1);assert.equal(state.countSettled,false,'the count remains unresolved after visible cards return');
  const second=await mod.exports.readAjesCatalogPage({...params,page:'2',after:page.nextCursor},undefined,{includeCount:false});
  const third=await mod.exports.readAjesCatalogPage({...params,page:'3',after:second.nextCursor},undefined,{includeCount:false});
  assert.equal(second.items.length,24,'the removed row is filled using the emitted source position');assert.equal(third.items.length,24);
  assert.equal(second.items.at(-1).id,'stats-awd-2-0');assert.equal(third.items[0].id,'stats-awd-2-1');
  assert.match(second.nextCursor,/^jp1\.[a-f0-9]{32}\.3\.[a-f0-9]{16}$/);assert.match(third.nextCursor,/^jp1\.[a-f0-9]{32}\.4\.[a-f0-9]{16}$/);
  assert.equal(new Set([...page.items,...second.items,...third.items].map(x=>x.id)).size,72);
  assert.equal(state.counts,1);assert.equal(state.countSettled,false);assert.deepEqual(state.sourcePages,[1,1,2,2],'only the requested source positions are revisited; no page scan or recount');
 }finally{release();delete (globalThis as any).__countFixture;}
});

for(const continuation of [false,true])test(`${continuation?'pagination':'overview'} Japanese lists do not compete with optional counts`,async()=>{
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 const queue=new DetailReadCache<any>({maxEntries:8,maxBytes:100000,ttlMs:0,concurrency:2,queueTimeoutMs:80});
 const observedAt=new Date().toISOString();
 const state={counts:0,lists:0,directories:0, count:()=>queue.get('count'+Math.random(),async()=>{state.counts++;await held;return {total:240,stale:false,observedAt};}),list:async(q:any)=>{await new Promise(r=>setTimeout(r,10));return queue.get('list'+q.table+q.drive+q.page,async()=>{state.lists++;assert.equal(q.pageSize,48);return sourcePage(q,observedAt);});}};(globalThis as any).__countFixture=state;
 const stubs:Record<string,string>={
  'server-only':'', 'next/headers':"export const headers=async()=>new Map([['x-real-ip','127.0.0.1']]);",
  './ajes-runtime':"export const ajesClient={read:async()=>{return globalThis.__countFixture.count();}};",
  './ajes-public':`export const cappedAjesQuery=async q=>q;export const readAjesPublic=q=>globalThis.__countFixture.list(q);`,
  './ajes-query':"export const ajesCatalogQuery=p=>({table:'stats',page:Number(p.page||1),pageSize:24,drive:p.drive});export class AjesFilterUnavailable extends Error{};export class AjesInputError extends Error{};",
  './ajes-client':"const forbidden=async()=>{globalThis.__countFixture.directories++;throw Error('optional directory must not run');};export const readAjesModelDirectory=forbidden;export const readAjesMakeDirectory=forbidden;export class AjesUnavailable extends Error{};",
  './ajes-result-filter':"export const ajesResultFilter=()=>({active:false,powerFilter:false,priceFilter:false,matches:()=>true});",
  './editorial':"export const readCatalogEditorial=async()=>({revision:'count-fixture',entries:{}});",
  '../encyclopedia/calculation-index':"export const readCalculationIndex=()=>null;",
  './storage':"export const publicOffer=x=>x;",'./market-page':"export const sortCatalogRows=x=>x;",
  './live-business-pricing':"export const applyActiveBusinessPricingBatch=async x=>x;",
  './collection-controls':"export const assertCollectionEnabled=async()=>{};",
  './japan-preview-parameters':"export const japanPreviewParameters=()=>{throw Error('not attested');};",
  '../encyclopedia/calculation-evidence':"export const hasEncyclopediaCalculationEvidence=()=>false;",
 };
 try{
  const built=await build({entryPoints:['apps/web/lib/catalog/ajes-catalog.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['react'],plugins:[{name:'count-fixture',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}));}}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)((id:string)=>id==='react'?{cache:(fn:any)=>fn}:require(id),mod,mod.exports);
  const pages=await Promise.all(['awd','fwd'].map(drive=>mod.exports.readAjesCatalogPage({market:'japan',drive,page:String(continuation?2:1)},undefined,continuation?{}:{includeCount:false})));
  assert.equal(pages.length,2);assert.ok(pages.every(page=>page.items.length===24&&page.hasMore));
  assert.equal(state.counts,0);assert.equal(state.directories,0);assert.equal(state.lists,2,'one source48 response fills each requested page without optional counts');
 }finally{release();delete (globalThis as any).__countFixture;}
});
