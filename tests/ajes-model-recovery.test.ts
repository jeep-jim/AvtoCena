import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesClient,AjesUnavailable,readAjesModelDirectory} from '../apps/web/lib/catalog/ajes-client';
import {DetailReadCache} from '../apps/web/lib/catalog/detail-read-cache';
import {resolveAjesQueryModels} from '../apps/web/lib/catalog/ajes-model-resolution';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';

test('model directory queue failures recover exact saved names without contacting the supplier',async t=>{
 t.mock.method(DetailReadCache.prototype,'get',()=>Promise.reject(Error('detail_cache_queue_full')));
 let calls=0;const saved={items:[],models:[{make:'HYUNDAI',model:'TUCSON',total:7}],page:1,pageSize:500,received:1,observedAt:new Date().toISOString()};
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{throw Error('provider forbidden');},readQuery:async sql=>{calls++;assert.equal(sql,ajesQuery({table:'korea',make:'HYUNDAI',aggregate:'models',page:1}).sql);return saved;}});
 const result=await readAjesModelDirectory(client,{table:'korea',make:'HYUNDAI'},'203.0.113.1');
 assert.deepEqual(result.models,saved.models);assert.equal(result.stale,true);assert.equal(calls,1);assert.equal('stale' in saved,false);
});
test('retained model directory cannot cross expiry, page or source switch',async t=>{
 t.mock.method(DetailReadCache.prototype,'get',()=>Promise.reject(Error('detail_cache_queue_timeout')));
 const base={items:[],models:[{make:'HYUNDAI',model:'TUCSON',total:7}],page:1,pageSize:500,received:1,observedAt:new Date().toISOString()};
 for(const saved of [{...base,page:2},{...base,pageSize:24},{...base,observedAt:'2000-01-01'},{...base,models:undefined}]){
  const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async()=>saved});
  await assert.rejects(readAjesModelDirectory(client,{table:'korea',make:'HYUNDAI'},'203.0.113.1'),/local_busy/);
 }
 let disabled=false;const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{if(disabled)throw Error('source_disabled');},reserve:async()=>{},readQuery:async()=>{disabled=true;return base;}});
 await assert.rejects(readAjesModelDirectory(client,{table:'korea'},'203.0.113.1'),/source_disabled/);
});
test('directory failure permits an exact list query but marks unresolved families incomplete',async()=>{
 const input={table:'korea',make:'HYUNDAI',model:'TUCSON',page:1};
 for(const error of [new AjesUnavailable('visitor_restricted'),new AjesUnavailable('local_busy'),Error('detail_cache_queue_timeout')]){
  const result=await resolveAjesQueryModels(input,async()=>{throw error;});
  assert.deepEqual(result,{query:input,modelDirectoryUnavailable:true});assert.equal(input.model,'TUCSON');
 }
 const result=await resolveAjesQueryModels(input,async()=>({models:[{model:'TUCSON'},{model:'TUCSON NX4'},{model:'SANTA FE'}]}));
 assert.equal(result.query.model,'TUCSON|TUCSON NX4');assert.equal(result.modelDirectoryUnavailable,false);
 for(const error of [new Error('source_disabled'),new Error('programming failure'),new AjesUnavailable('not_configured')])await assert.rejects(resolveAjesQueryModels(input,async()=>{throw error;}),e=>e===error);
});

test('Korean ix35 discovery resolves only actual Tucson ix directory rows',async()=>{
 const query={table:'korea',make:'HYUNDAI',model:'ix 35'};
 const rows=[{model:'TUCSON IX'},{model:'TUCSON IX LM'},{model:'TUCSON'},{model:'TUCSON NX4'}];
 assert.equal((await resolveAjesQueryModels(query,async()=>({models:rows}))).query.model,'TUCSON IX|TUCSON IX LM');
 for(const input of [{...query,table:'china'},{...query,make:'OTHER'}])assert.equal((await resolveAjesQueryModels(input,async()=>({models:rows}))).query.model,'ix 35');
 assert.equal((await resolveAjesQueryModels(query,async()=>({models:rows.slice(2)}))).query.model,'ix 35');
});

test('actual catalog wrapper keeps exact model cards on directory failure and never publishes a false zero',async()=>{
 const {build}=await import('esbuild');const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
 const state={empty:false,lists:0,counts:0,queries:[] as any[]};(globalThis as any).__modelRecovery=state;
 const stubs:Record<string,string>={
  'server-only':'','next/headers':"export const headers=async()=>new Map([['x-real-ip','127.0.0.1']]);",
  './ajes-runtime':"export const ajesClient={read:async()=>{globalThis.__modelRecovery.counts++;throw Error('count must not run');}};",
  './ajes-public':`export const cappedAjesQuery=async q=>q;export const readAjesPublic=async q=>{const s=globalThis.__modelRecovery;s.lists++;s.queries.push(q);return {page:q.page||1,pageSize:24,received:s.empty?0:24,items:s.empty?[]:[{id:'hyundai-exact'}],observedAt:'now'};};`,
  './ajes-query':"export const ajesCatalogQuery=p=>({table:'korea',make:p.make,model:p.model,page:1,pageSize:24});export class AjesFilterUnavailable extends Error{};export class AjesInputError extends Error{};",
  './ajes-client':"export class AjesUnavailable extends Error{constructor(reason){super(reason);this.reason=reason;}};export const readAjesModelDirectory=async()=>{throw new AjesUnavailable('local_busy');};export const readAjesMakeDirectory=async()=>({makes:[]});",
  './ajes-result-filter':"export const ajesResultFilter=()=>({active:false,priceFilter:false,matches:()=>true});",
  './storage':"export const publicOffer=x=>x;",'./market-page':"export const sortCatalogRows=x=>x;",
  './live-business-pricing':"export const applyActiveBusinessPricingBatch=async x=>x;",
  './collection-controls':"export const assertCollectionEnabled=async()=>{};",'./ajes-price-policy':"export const ajesChinaPriceAllowed=()=>true;",
  './japan-preview-parameters':"export const japanPreviewParameters=()=>{throw Error('not attested');};",'../encyclopedia/calculation-evidence':"export const hasEncyclopediaCalculationEvidence=()=>false;",
 };
 try{
  const built=await build({entryPoints:['apps/web/lib/catalog/ajes-catalog.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['react'],plugins:[{name:'model-recovery-fixture',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}));}}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)((id:string)=>id==='react'?{cache:(fn:any)=>fn}:require(id),mod,mod.exports);
  const params={market:'korea',make:'HYUNDAI',model:'TUCSON',city:'Новокузнецк'};
  const result=await mod.exports.readAjesCatalogPage(params);
  assert.equal(result.items[0].id,'hyundai-exact');assert.equal(result.partial,true);assert.equal(result.total,null);assert.equal(result.countSummary,null);
  assert.equal(state.queries[0].make,'HYUNDAI');assert.equal(state.queries[0].model,'TUCSON');assert.equal(state.counts,0);
  state.empty=true;await assert.rejects(mod.exports.readAjesCatalogPage(params),/directory_unavailable/);
  await assert.rejects(mod.exports.readAjesCountSummary(JSON.stringify(params)),/directory_unavailable/);
  assert.equal(state.lists,2);assert.equal(state.counts,0);
 }finally{delete (globalThis as any).__modelRecovery;}
});
