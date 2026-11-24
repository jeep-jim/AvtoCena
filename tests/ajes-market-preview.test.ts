import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

async function routeModule(entry:string,stubs:Record<string,string>){
 const built=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'retired-market-boundary',setup(b){
  b.onResolve({filter:/.*/},a=>{
   if(a.path in stubs)return {path:a.path,namespace:'stub'};
   if(a.path.startsWith('@/lib/'))throw Error(`Unexpected integration dependency: ${a.path}`);
  });
  b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}));
 }}]});
 const mod={exports:{} as any};new Function('module','exports','require',built.outputFiles[0].text)(mod,mod.exports,createRequire(import.meta.url));return mod.exports;
}
const authStubs={
 'next/server':'export const NextResponse={json:(v,o)=>Response.json(v,o)};',
 '@/lib/auth':'export const getCurrentUser=async()=>({});',
 '@/lib/platform-access':'export const isPlatformOwner=()=>globalThis.__ajesRetirementAuth.owner;',
 '@/lib/catalog/calculation-request-origin':'export const isCalculationOriginAllowed=()=>globalThis.__ajesRetirementAuth.origin;',
};

test('removed AJ China/Korea admin endpoints are owner-only tombstones without credential, storage or supplier dependencies',async()=>{
 const state={owner:false,origin:false};(globalThis as any).__ajesRetirementAuth=state;
 try{
  const route=await routeModule('apps/web/app/(crm)/api/crm/ajes/markets/[market]/route.ts',authStubs);
  const context=(market:string)=>({params:Promise.resolve({market})});
  const request=(market:string,method:string)=>new Request(`https://avtocena.com/api/crm/ajes/markets/${market}`,{method});
  for(const method of ['GET','POST'])assert.equal((await route[method](request('china',method),context('china'))).status,403);
  state.owner=true;
  assert.equal((await route.POST(request('china','POST'),context('china'))).status,403,'mutation still requires same-origin request');
  state.origin=true;
  for(const market of ['china','korea'])for(const method of ['GET','POST']){
   const response=await route[method](request(market,method),context(market));
   assert.equal(response.status,410);assert.equal(response.headers.get('cache-control'),'private, no-store');
   assert.deepEqual(await response.json(),{error:'AJ System используется только для Японии.',code:'ajes_market_retired'});
  }
  for(const market of ['japan','uae','china;drop'])assert.equal((await route.GET(request(market,'GET'),context(market))).status,404);
 }finally{delete (globalThis as any).__ajesRetirementAuth;}
});

test('generic AJ acceptance route reports retired markets as permanent removal and preserves Japanese requests',async()=>{
 const state={owner:true,origin:true,reads:[] as string[]};(globalThis as any).__ajesRetirementAuth=state;
 try{
  const route=await routeModule('apps/web/app/(crm)/api/crm/ajes/route.ts',{
   ...authStubs,
   '@/lib/catalog/ajes-query':'export class AjesInputError extends Error{};',
   '@/lib/catalog/ajes-client':'export class AjesUnavailable extends Error{constructor(reason){super(`ajes_${reason}`);this.reason=reason;}};',
   '@/lib/catalog/ajes-runtime':`import {AjesUnavailable} from '@/lib/catalog/ajes-client';export const ajesClient={read:async query=>{globalThis.__ajesRetirementAuth.reads.push(query.table);if(['china','korea'].includes(query.table))throw new AjesUnavailable('market_not_supported');return {items:[{table:query.table}]};}};`,
  });
  const request=(table:string)=>new Request('https://avtocena.com/api/crm/ajes',{method:'POST',headers:{'x-real-ip':'192.0.2.9'},body:JSON.stringify({table})});
  for(const table of ['china','korea']){
   const response=await route.POST(request(table));assert.equal(response.status,410);
   assert.equal((await response.json()).code,'ajes_market_retired');
  }
  for(const table of ['stats','main']){
   const response=await route.POST(request(table));assert.equal(response.status,200);
   assert.deepEqual(await response.json(),{ok:true,items:[{table}]});
  }
  assert.deepEqual(state.reads,['china','korea','stats','main']);
 }finally{delete (globalThis as any).__ajesRetirementAuth;}
});
