import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPreparedMarketPrices} from '../scripts/lib/price-preparation-ready.mjs';
import {getJsonStorage} from '../apps/web/lib/data';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const generationId='price-readiness-fixture';
const ready=()=>({generationId,results:[{market:'korea',rows:1,ms:0}]});

test('readiness accepts an exact completed market result without changing it or requiring nonempty inventory',()=>{
 const result=ready();
 assert.strictEqual(assertPreparedMarketPrices(result,'korea',generationId),result);
 result.results[0].rows=0;
 result.results[0].ms=0.25;
 assert.strictEqual(assertPreparedMarketPrices(result,'korea',generationId),result);
});

test('readiness rejects a different generation and invalid expected context',()=>{
 for(const value of [undefined,null,'',`${generationId}-stale`]){
  assert.throws(()=>assertPreparedMarketPrices({...ready(),generationId:value},'korea',generationId),/price_preparation_generation_changed:korea/);
 }
 for(const market of ['japan','unknown','',undefined]){
  assert.throws(()=>assertPreparedMarketPrices(ready(),market,generationId),/price_preparation_context_invalid/);
 }
 for(const value of ['',undefined,null,1]){
  assert.throws(()=>assertPreparedMarketPrices(ready(),'korea',value),/price_preparation_context_invalid/);
 }
});

test('readiness rejects missing, duplicate and unrelated market results',()=>{
 const row=ready().results[0];
 for(const results of [undefined,null,{},[],[row,row],[{...row,market:'china'}],[row,{...row,market:'china'}],[null]]){
  assert.throws(()=>assertPreparedMarketPrices({...ready(),results},'korea',generationId),/price_preparation_market_not_ready:korea/);
 }
});

test('readiness requires nonnegative safe integer row counts and finite nonnegative timings',()=>{
 for(const rows of [undefined,null,-1,0.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,'1',true]){
  assert.throws(()=>assertPreparedMarketPrices({generationId,results:[{market:'korea',rows,ms:0}]},'korea',generationId),/price_preparation_result_invalid:korea/);
 }
 for(const ms of [undefined,null,-1,NaN,Infinity,-Infinity,'0',false]){
  assert.throws(()=>assertPreparedMarketPrices({generationId,results:[{market:'korea',rows:1,ms}]},'korea',generationId),/price_preparation_result_invalid:korea/);
 }
});

// Exercise the actual warmup and persistence path, while replacing only its
// storage boundary. These fixture IDs and values are not production evidence.
async function warmFixture(){
 const {warmBudgetPriceCaches,resetCatalogReadCachesForTests}=await import('../apps/web/lib/catalog/storage');
 const {resetCatalogRateCache}=await import('../apps/web/lib/catalog/rates');
 const {invalidateEffectiveMarketsCache}=await import('../apps/web/lib/effective-market-settings');
 const storage=getJsonStorage();
 const original={readJson:storage.readJson,readJsonWithMeta:storage.readJsonWithMeta,writeJson:storage.writeJson};
 const release=process.env.AVTOCENA_RELEASE_SHA,calculation=process.env.AVTOCENA_CALCULATION_VERSION;
 const index=buildBudgetCountIndex(generationId,[
  {id:'readiness-one',market:'korea',totalRub:1_500_000,make:'Kia',model:'K3',year:2024},
 ] as any[],new Map(),3);
 let storedIndex:unknown=index;
 let failure:''|'read'|'write'='';
 const objects=new Map<string,any>();
 const reset=()=>{resetCatalogReadCachesForTests();resetCatalogRateCache();invalidateEffectiveMarketsCache();};
 const runtime=(path:string)=>/^catalog\/runtime-(budget|sort)-prices-v3\//.test(path);
 storage.readJson=async<T>(path:string,fallback:T)=>(objects.get(path)??fallback) as T;
 storage.readJsonWithMeta=async<T>(path:string,fallback:T)=>{
  if(runtime(path)){
   if(failure==='read')throw Error('readiness-required-read-failed');
   return {found:objects.has(path),etag:objects.has(path)?'readiness-fixture-etag':undefined,value:(objects.get(path)??fallback) as T};
  }
  let value:unknown=fallback;
  if(path==='catalog/manifest.json')value={generationId,markets:{korea:{count:1}}};
  if(path.endsWith('/budget-count-v3.json'))value=storedIndex;
  if(path==='markets/markets.json')value=[{id:'korea',versions:[{id:'readiness-profile',status:'active',securityDepositRub:110000}]}];
  return {found:value!==null&&value!==undefined,value:value as T};
 };
 storage.writeJson=async(path,value)=>{
  assert.ok(runtime(path),'warmup may write only the two disposable price namespaces');
  if(failure==='write'&&path.includes('runtime-sort-prices-v3'))throw Error('readiness-required-sort-write-failed');
  objects.set(path,structuredClone(value));
 };
 delete process.env.AVTOCENA_CALCULATION_VERSION;
 process.env.AVTOCENA_RELEASE_SHA='readiness-preparation-context';
 reset();
 return {
  index,objects,
  setIndex(value:unknown){storedIndex=value;reset();},
  fail(mode:'read'|'write'){failure=mode;},
  warm:()=>warmBudgetPriceCaches(['korea']),
  async prepare(){return assertPreparedMarketPrices(await warmBudgetPriceCaches(['korea']),'korea',generationId);},
  restore(){
   Object.assign(storage,original);
   if(release===undefined)delete process.env.AVTOCENA_RELEASE_SHA;else process.env.AVTOCENA_RELEASE_SHA=release;
   if(calculation===undefined)delete process.env.AVTOCENA_CALCULATION_VERSION;else process.env.AVTOCENA_CALCULATION_VERSION=calculation;
   reset();
  },
 };
}

test('actual missing, legacy and stale-generation indexes cannot turn a skipped warmup into readiness',async()=>{
 const f=await warmFixture();
 try{
  for(const [name,index] of [
   ['missing',null],['non-v3',{...f.index,version:2}],['stale-generation',{...f.index,generationId:'previous-fixture-generation'}],
  ] as const){
   f.setIndex(index);
   const result=await f.warm();
   assert.deepEqual(result,{generationId,results:[]},name);
   assert.throws(()=>assertPreparedMarketPrices(result,'korea',generationId),/price_preparation_market_not_ready:korea/,name);
   assert.equal(f.objects.size,0,'a skipped index must not claim persisted prices');
  }
 }finally{f.restore();}
});

test('actual successful warmup persists both price namespaces before passing readiness',async()=>{
 const f=await warmFixture();
 try{
  const result=await f.prepare();
  assert.equal(result.results.length,1);
  assert.equal(result.results[0].rows,1);
  assert.equal(f.objects.size,2);
  assert.equal([...f.objects.keys()].filter(path=>path.includes('runtime-budget-prices-v3')).length,1);
  assert.equal([...f.objects.keys()].filter(path=>path.includes('runtime-sort-prices-v3')).length,1);
  assert.strictEqual(assertPreparedMarketPrices(result,'korea',generationId),result);
 }finally{f.restore();}
});

test('actual required metadata and second-namespace PUT failures propagate instead of reporting readiness',async()=>{
 for(const mode of ['read','write'] as const){
  const f=await warmFixture();
  try{
   f.fail(mode);
   await assert.rejects(f.prepare(),mode==='read'?/readiness-required-read-failed/:/readiness-required-sort-write-failed/);
   assert.equal(f.objects.size,mode==='read'?0:1);
   if(mode==='write')assert.ok([...f.objects.keys()][0].includes('runtime-budget-prices-v3'),'one durable namespace is insufficient');
  }finally{f.restore();}
 }
});

test('the actual release CLI rejects skipped warmup even when fallback search and parity would pass',async()=>{
 const filename=path.resolve('scripts/regcloud-prepare-prices.mjs');
 const source=await readFile(filename,'utf8');
 const compiled=await build({stdin:{contents:source,resolveDir:path.dirname(filename),sourcefile:filename},
  bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',plugins:[{
   name:'price-cli-boundaries',setup(builder){
    builder.onResolve({filter:/^(?:node:fs|\.\.\/apps\/web\/lib\/(?:data|catalog\/storage)\.ts)$/},args=>({path:args.path,namespace:'price-cli-fixture'}));
    builder.onLoad({filter:/.*/,namespace:'price-cli-fixture'},args=>({loader:'js',contents:
     args.path==='node:fs'?`export const readFileSync=()=>{throw Error('unexpected fixture file read')};export const writeFileSync=(path,value)=>{globalThis.__priceCliFixture.report=JSON.parse(value)};`:
     args.path.endsWith('/data.ts')?`export const getJsonStorage=()=>globalThis.__priceCliFixture.storage;`:
     `export const backfillBudgetMarketSelectors=async()=>{};
      export const backfillBudgetSpecificationSelectors=async()=>({generationId:globalThis.__priceCliFixture.generationId,markets:{korea:true}});
      export const warmBudgetPriceCaches=async()=>globalThis.__priceCliFixture.warm;
      export const searchOffers=async()=>{globalThis.__priceCliFixture.searches++;return {total:1,items:[{id:'fixture'}],usedIndexShards:['budget-cards-v3/0.json']}};
      export const searchOffersWithoutBudgetIndexForTests=searchOffers;`}));
   },
  }]});
 const previous=(globalThis as any).__priceCliFixture,scope=process.env.RELEASE_PREPARATION_MARKETS;
 try{
  process.env.RELEASE_PREPARATION_MARKETS='korea';
  for(const completed of [false,true]){
   const fixture={generationId,warm:completed?ready():{generationId,results:[]},searches:0,report:null as any,
    storage:{driver:'object',async readJson(){return {generationId,markets:{korea:{count:1}}};},async writeJson(){}}};
   (globalThis as any).__priceCliFixture=fixture;
   const url='data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text+`\n// case ${completed}`).toString('base64');
   if(completed){await import(url);assert.equal(fixture.report.results[0].status,'success');assert.ok(fixture.searches>0);}
   else{await assert.rejects(import(url),/market_preparation_failed:korea/);
    assert.equal(fixture.searches,0,'missing durable readiness must fail before fallback search can mask it');
    assert.deepEqual(fixture.report.results,[{market:'korea',status:'failure',error:'price_preparation_market_not_ready:korea'}]);}
  }
 }finally{
  if(scope===undefined)delete process.env.RELEASE_PREPARATION_MARKETS;else process.env.RELEASE_PREPARATION_MARKETS=scope;
  if(previous===undefined)delete (globalThis as any).__priceCliFixture;else (globalThis as any).__priceCliFixture=previous;
 }
});
