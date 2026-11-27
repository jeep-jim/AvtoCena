import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

async function route(){
 const stubs:Record<string,string>={
  'next/server':"export const NextResponse={json:(body,init)=>Response.json(body,init)};",
  '@/lib/catalog/ajes-client':"export class AjesUnavailable extends Error{constructor(reason){super(reason);this.reason=reason;}};",
  '@/lib/catalog/ajes-query':"export class AjesInputError extends Error{};",
  '@/lib/catalog/ajes-catalog':"import {AjesUnavailable} from '@/lib/catalog/ajes-client';export const readAjesDirectory=async()=>{const state=globalThis.__japanModelMetadata;state.reads++;if(state.failure)throw new AjesUnavailable(state.failure);return state.result;};",
 };
 const built=await build({entryPoints:['apps/web/app/api/catalog/source-models/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'model-metadata',setup(b){b.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path]}));}}]});
 const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);return mod.exports;
}

test('source model metadata removes explicit buses and zero counts while keeping saved light-van names',async()=>{
 const state={reads:0,result:{stale:true,models:[
  {make:'TOYOTA',model:'HIACE BUS',total:2},{make:'MAZDA',model:'TITAN',total:4},{make:'NISSAN',model:'CIVILIAN',total:1},
  {make:'MAZDA',model:'AXELA',total:0},{make:'MAZDA',model:'DEMIO',total:-1},
  {make:'TOYOTA',model:'HIACE VAN',total:3},{make:'MAZDA',model:'BONGO VAN',total:2},{make:'TOYOTA',model:'HIACE COACH EDITION',total:1},
 ]}};(globalThis as any).__japanModelMetadata=state;
 try{
  const api=await route(),response=await api.GET(new Request('https://avtocena.com/api/catalog/source-models?market=japan'));
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{version:1,brands:[],stale:true,models:[['TOYOTA','HIACE VAN',[],3],['MAZDA','BONGO VAN',[],2],['TOYOTA','HIACE COACH EDITION',[],1]]});
  assert.equal(state.reads,1,'metadata filtering adds no source read');
 }finally{delete (globalThis as any).__japanModelMetadata;}
});

test('unavailable source model metadata keeps its fixed failure reason and does not claim an empty result',async()=>{
 const state={reads:0,failure:'visitor_restricted'};(globalThis as any).__japanModelMetadata=state;
 try{
  const api=await route(),response=await api.GET(new Request('https://avtocena.com/api/catalog/source-models?market=japan&make=MAZDA'));
  assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{error:'directory_unavailable',reason:'visitor_restricted'});assert.equal(state.reads,1);
 }finally{delete (globalThis as any).__japanModelMetadata;}
});
