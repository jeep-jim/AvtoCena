import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {DetailReadCache} from '../apps/web/lib/catalog/detail-read-cache';
import * as census from '../apps/web/lib/catalog/ajes-census';
import * as query from '../apps/web/lib/catalog/ajes-query';
const require=createRequire(import.meta.url);
const counterStubs:Record<string,string>={
 './ajes-query':'export const {ajesCatalogQuery,ajesQuery,AjesFilterUnavailable,AjesInputError,AjesCursorRefreshRequired}=globalThis.__countFixture.query;',
 './ajes-census':'export const {readAjesCensusCount,ajesRequestedCountQuery,ajesRequestedCountQueryHash,ajesSourceScopeSupportsExactCount,AJES_CENSUS_PREDICATE_VERSION}=globalThis.__countFixture.census;',
 './ajes-count-pricing-context':'export const captureAjesCountPricingContext=async()=>{throw Error("unexpected price-filter context");};',
 '../data':'export const getJsonStorage=()=>({readJson:async()=>null,writeJson:async()=>{}});',
};
test('ready Japanese cards return while the independent count is still pending',async()=>{
 let finishCount!:(value:any)=>void;
 const held=new Promise<any>(resolve=>{finishCount=resolve;});
 const state={counts:0,lists:0,queries:[] as any[],countResult:held as any,census,query};(globalThis as any).__countFixture=state;
 const stubs:Record<string,string>={
  'server-only':'', 'next/headers':"export const headers=async()=>new Map([['x-real-ip','127.0.0.1']]);",
  './ajes-runtime':"export const ajesClient={read:async q=>{if(q.aggregate!=='count'||q.countIdentity!==undefined)throw Error('unexpected source query');const state=globalThis.__countFixture;state.counts++;return state.countResult;}};",
  './ajes-public':`export const readAjesPublicEvidenceSnapshot=()=>({editorial:{revision:'fixture',entries:{}},calculationIndex:null});export const cappedAjesQuery=async q=>q;export const readAjesPublic=async q=>{globalThis.__countFixture.lists++;globalThis.__countFixture.queries.push(q);return {page:q.page||1,pageSize:24,received:24,items:Array.from({length:q.page===2?23:24},(_,i)=>({id:q.table+'-'+(q.page||1)+'-'+i})),observedAt:new Date().toISOString()};};`,
  './ajes-client':"export const readAjesModelDirectory=async()=>({models:[]});export const readAjesMakeDirectory=async()=>({makes:[]});export class AjesUnavailable extends Error{};",
  './ajes-result-filter':"export const ajesResultFilter=()=>({active:false,priceFilter:false,matches:()=>true});",
  './storage':"export const publicOffer=x=>x;",'./market-page':"export const sortCatalogRows=x=>x;",
  './live-business-pricing':"export const applyActiveBusinessPricingBatch=async x=>x;",
  './collection-controls':"export const assertCollectionEnabled=async()=>{};",
  './japan-preview-parameters':"export const japanPreviewParameters=()=>{throw Error('not attested');};",
  '../encyclopedia/calculation-evidence':"export const hasEncyclopediaCalculationEvidence=()=>false;",
  ...counterStubs,
 };
 try{
  const built=await build({entryPoints:['apps/web/lib/catalog/ajes-catalog.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',define:{'process.env.AVTOCENA_RELEASE_SHA':JSON.stringify('a'.repeat(40))},plugins:[{name:'count-fixture',setup(b){b.onResolve({filter:/.*/},a=>a.path==='../data'&&!a.importer.endsWith('/catalog/ajes-catalog.ts')?undefined:a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}));}}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)((id:string)=>id==='react'?{cache:(fn:any)=>fn}:require(id),mod,mod.exports);
  const params={market:'japan',yearFrom:'2020',city:'Новокузнецк'};
  const independentCount=mod.exports.readAjesCountSummary(JSON.stringify(params));void independentCount.catch(()=>{});
  for(const market of ['japan']){
   let timer:ReturnType<typeof setTimeout>;
   const page:any=await Promise.race([mod.exports.readAjesCatalogPage({...params,market},undefined,{includeCount:false}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ready cards blocked by count')),300);})]).finally(()=>clearTimeout(timer!));
   assert.equal(page.items.length,24);assert.equal(page.total,null);assert.equal(page.hasMore,true);assert.equal(page.items[0].id,'stats-1-0');assert.match(page.nextCursor,/^j1\.2\.0\.2\.[a-f0-9]{64}\.-$/,'ordinary pages expose their actual continuation');
  }
  for(const market of ['japan']){
   const second=await mod.exports.readAjesCatalogPage({...params,market,page:'2'},undefined,{includeCount:false});
   const third=await mod.exports.readAjesCatalogPage({...params,market,page:'3',after:second.nextCursor},undefined,{includeCount:false});
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
  finishCount({total:42,stale:false,observedAt:new Date().toISOString()});
  await assert.rejects(independentCount,/census_source_snapshot_unavailable/,'positive source weights do not prove a coherent admitted total');
  state.countResult={total:0,stale:false,observedAt:new Date().toISOString()};
  const zero=await mod.exports.readAjesCountSummary(JSON.stringify(params));
  assert.equal(zero.total,0);assert.equal(zero.upperBound,false);assert.equal(zero.countProof.sourceTotal,0);
  assert.equal(state.counts,2,'only the two explicitly requested scalar counters ran');
 }finally{finishCount({total:0,stale:false,observedAt:new Date().toISOString()});delete (globalThis as any).__countFixture;}
});

for(const continuation of [false,true])test(`explicitly count-free ${continuation?'pagination':'overview'} Japanese lists do not compete with optional counts`,async()=>{
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 const queue=new DetailReadCache<any>({maxEntries:8,maxBytes:100000,ttlMs:0,concurrency:2,queueTimeoutMs:80});
 const state={counts:0,lists:0,census,query,count:()=>queue.get('count'+Math.random(),async()=>{state.counts++;await held;return {total:24};}),list:async(q:any)=>{await new Promise(r=>setTimeout(r,10));return queue.get('list'+q.table+q.page,async()=>{state.lists++;return {page:1,pageSize:24,received:24,items:Array.from({length:24},(_,i)=>({id:q.table+i})),observedAt:new Date().toISOString()};});}};(globalThis as any).__countFixture=state;
 const stubs:Record<string,string>={
  'server-only':'', 'next/headers':"export const headers=async()=>new Map([['x-real-ip','127.0.0.1']]);",
  './ajes-runtime':"export const ajesClient={read:async()=>{return globalThis.__countFixture.count();}};",
  './ajes-public':`export const readAjesPublicEvidenceSnapshot=()=>({editorial:{revision:'fixture',entries:{}},calculationIndex:null});export const cappedAjesQuery=async q=>q;export const readAjesPublic=q=>globalThis.__countFixture.list(q);`,
  './ajes-client':"export const readAjesModelDirectory=async()=>({models:[]});export const readAjesMakeDirectory=async()=>({makes:[]});export class AjesUnavailable extends Error{};",
  './ajes-result-filter':"export const ajesResultFilter=()=>({active:false,priceFilter:false,matches:()=>true});",
  './storage':"export const publicOffer=x=>x;",'./market-page':"export const sortCatalogRows=x=>x;",
  './live-business-pricing':"export const applyActiveBusinessPricingBatch=async x=>x;",
  './collection-controls':"export const assertCollectionEnabled=async()=>{};",
  './japan-preview-parameters':"export const japanPreviewParameters=()=>{throw Error('not attested');};",
  '../encyclopedia/calculation-evidence':"export const hasEncyclopediaCalculationEvidence=()=>false;",
  ...counterStubs,
 };
 try{
  const built=await build({entryPoints:['apps/web/lib/catalog/ajes-catalog.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',define:{'process.env.AVTOCENA_RELEASE_SHA':JSON.stringify('a'.repeat(40))},plugins:[{name:'count-fixture',setup(b){b.onResolve({filter:/.*/},a=>a.path==='../data'&&!a.importer.endsWith('/catalog/ajes-catalog.ts')?undefined:a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}));}}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)((id:string)=>id==='react'?{cache:(fn:any)=>fn}:require(id),mod,mod.exports);
  const pages=await Promise.all([0,1].map(i=>mod.exports.readAjesCatalogPage({market:'japan',page:String(i+(continuation?2:1))},undefined,{includeCount:false})));
  assert.equal(pages.length,2);assert.ok(pages.every(page=>page.items.length===24&&page.hasMore));
  assert.equal(state.counts,0);assert.equal(state.lists,2);
 }finally{release();delete (globalThis as any).__countFixture;}
});
