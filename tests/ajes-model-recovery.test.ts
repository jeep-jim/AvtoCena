import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesClient,AjesUnavailable,readAjesModelDirectory} from '../apps/web/lib/catalog/ajes-client';
import {DetailReadCache} from '../apps/web/lib/catalog/detail-read-cache';
import {resolveAjesQueryModels} from '../apps/web/lib/catalog/ajes-model-resolution';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {createHash} from 'node:crypto';

function rejectSupplierQueue(t:any,message:string){
 const original=DetailReadCache.prototype.get;
 t.mock.method(DetailReadCache.prototype,'get',function(this:DetailReadCache<any>,...args:Parameters<typeof original>){
  return args[3]==='prepared'?original.apply(this,args):Promise.reject(Error(message));
 });
}

test('model directory queue failures recover exact saved names without contacting the supplier',async t=>{
 rejectSupplierQueue(t,'detail_cache_queue_full');
 let calls=0;const saved={items:[],models:[{make:'TOYOTA',model:'COROLLA',total:7}],page:1,pageSize:500,received:1,observedAt:new Date(Date.now()-3600000).toISOString()};
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{throw Error('provider forbidden');},readQuery:async sql=>{calls++;assert.equal(sql,ajesQuery({table:'stats',make:'TOYOTA',aggregate:'models',page:1}).sql);return saved;}});
 const result=await readAjesModelDirectory(client,{table:'stats',make:'TOYOTA'},'203.0.113.1');
 assert.deepEqual(result.models,saved.models);assert.equal(result.stale,true);assert.equal(calls,1);assert.equal('stale' in saved,false);
});
test('retained model directory cannot cross expiry, page or source switch',async t=>{
 rejectSupplierQueue(t,'detail_cache_queue_timeout');
 const base={items:[],models:[{make:'TOYOTA',model:'COROLLA',total:7}],page:1,pageSize:500,received:1,observedAt:new Date().toISOString()};
 for(const saved of [{...base,page:2},{...base,pageSize:24},{...base,observedAt:'2000-01-01'},{...base,models:undefined}]){
  const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async()=>saved});
  await assert.rejects(readAjesModelDirectory(client,{table:'stats',make:'TOYOTA'},'203.0.113.1'),/local_busy/);
 }
 let disabled=false;const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{if(disabled)throw Error('source_disabled');},reserve:async()=>{},readQuery:async()=>{disabled=true;return base;}});
 await assert.rejects(readAjesModelDirectory(client,{table:'stats'},'203.0.113.1'),/source_disabled/);
});
test('directory failure permits an exact list query but marks unresolved families incomplete',async()=>{
 const input={table:'stats',make:'TOYOTA',model:'COROLLA',page:1};
 for(const error of [new AjesUnavailable('visitor_restricted'),new AjesUnavailable('local_busy'),Error('detail_cache_queue_timeout')]){
  const result=await resolveAjesQueryModels(input,async()=>{throw error;});
  assert.deepEqual(result,{query:input,modelDirectoryUnavailable:true});assert.equal(input.model,'COROLLA');
 }
 const result=await resolveAjesQueryModels(input,async()=>({models:[{model:'COROLLA'},{model:'COROLLA CROSS'},{model:'CAMRY'}]}));
 assert.equal(result.query.model,'COROLLA|COROLLA CROSS');assert.equal(result.modelDirectoryUnavailable,false);
 for(const error of [new Error('source_disabled'),new Error('programming failure'),new AjesUnavailable('not_configured')])await assert.rejects(resolveAjesQueryModels(input,async()=>{throw error;}),e=>e===error);
});


test('actual catalog wrapper keeps exact model cards on directory failure and never publishes a false zero',async()=>{
 const {build}=await import('esbuild');const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
 const observedAt=new Date().toISOString();
 const state={empty:false,lists:0,counts:0,queries:[] as any[],list:(q:any)=>{state.lists++;state.queries.push(q);const items=state.empty?[]:[{id:'toyota-exact'}],received=state.empty?0:q.pageSize;return {page:q.page||1,pageSize:q.pageSize,received,items,observedAt,stale:false,sourceFingerprint:createHash('sha256').update(JSON.stringify([observedAt,received,items])).digest('hex')};}};(globalThis as any).__modelRecovery=state;
 const stubs:Record<string,string>={
  'server-only':'','next/headers':"export const headers=async()=>new Map([['x-real-ip','127.0.0.1']]);",
  './ajes-runtime':"export const ajesClient={read:async()=>{globalThis.__modelRecovery.counts++;throw Error('count must not run');}};",
  './ajes-public':"export const cappedAjesQuery=async q=>q;export const readAjesPublic=async q=>globalThis.__modelRecovery.list(q);",
  './ajes-query':"export const ajesCatalogQuery=p=>({table:'stats',make:p.make,model:p.model,page:1,pageSize:24});export class AjesFilterUnavailable extends Error{};export class AjesInputError extends Error{};",
  './ajes-client':"export class AjesUnavailable extends Error{constructor(reason){super(reason);this.reason=reason;}};export const readAjesModelDirectory=async()=>{throw new AjesUnavailable('local_busy');};export const readAjesMakeDirectory=async()=>({makes:[]});",
  './ajes-result-filter':"export const ajesResultFilter=()=>({active:false,powerFilter:false,priceFilter:false,matches:()=>true});",
  './editorial':"export const readCatalogEditorial=async()=>({revision:'model-recovery-fixture',entries:{}});",
  '../encyclopedia/calculation-index':"export const readCalculationIndex=()=>null;",
  './storage':"export const publicOffer=x=>x;",'./market-page':"export const sortCatalogRows=x=>x;",
  './live-business-pricing':"export const applyActiveBusinessPricingBatch=async x=>x;",
  './collection-controls':"export const assertCollectionEnabled=async()=>{};",
  './japan-preview-parameters':"export const japanPreviewParameters=()=>{throw Error('not attested');};",'../encyclopedia/calculation-evidence':"export const hasEncyclopediaCalculationEvidence=()=>false;",
 };
 try{
  const built=await build({entryPoints:['apps/web/lib/catalog/ajes-catalog.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['react'],plugins:[{name:'model-recovery-fixture',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}));}}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)((id:string)=>id==='react'?{cache:(fn:any)=>fn}:require(id),mod,mod.exports);
  const params={market:'japan',make:'TOYOTA',model:'COROLLA',city:'Новокузнецк'};
  const result=await mod.exports.readAjesCatalogPage(params);
  assert.equal(result.items[0].id,'toyota-exact');assert.equal(result.partial,true);assert.equal(result.total,null);assert.equal(result.countSummary,null);
  assert.equal(result.hasMore,false);assert.match(result.retryCursor,/^jp1\.[a-f0-9]{32}\.1\.[a-f0-9]{16}$/);assert.equal(state.queries[0].pageSize,48);
  assert.equal(state.queries[0].make,'TOYOTA');assert.equal(state.queries[0].model,'COROLLA');assert.equal(state.counts,0);
  state.empty=true;await assert.rejects(mod.exports.readAjesCatalogPage(params),/directory_unavailable/);
  await assert.rejects(mod.exports.readAjesCountSummary(JSON.stringify(params)),/directory_unavailable/);
  assert.equal(state.lists,2);assert.equal(state.counts,0);
 }finally{delete (globalThis as any).__modelRecovery;}
});
