import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {ajesFailureSlot,saveAjesRequestFailure,type AjesRequestDiagnostic} from '../apps/web/lib/catalog/ajes-request-diagnostic';

test('private page slots preserve page six across later first-page writes and have fixed capacity',async()=>{
 const saved=new Map<string,unknown>();
 const storage={writeJson:async(key:string,value:unknown)=>{saved.set(key,value);}};
 const failure:AjesRequestDiagnostic={table:'korea',kind:'list',page:6,pageSize:24,startedAt:'2026-10-30T09:00:00Z',finishedAt:'2026-10-30T09:00:01Z',clientIp:'203.0.113.32',sql:'select * from korea limit 120,24',endpoint:'http://78.46.90.228/api/',httpStatus:200,providerCode:'bot7',outcome:'visitor_restricted'};
 await saveAjesRequestFailure(storage,failure);
 await saveAjesRequestFailure(storage,{...failure,page:1,sql:'select * from korea limit 0,24'});
 assert.deepEqual(saved.get('integrations/ajes/catalog-failure-pages/korea-list-6.json'),failure);
 assert.equal((saved.get('integrations/ajes/catalog-failure-korea.json') as any).page,1,'legacy owner view remains compatible');
 assert.equal(saved.size,3);
 const slots=new Set(Array.from({length:10000},(_,i)=>ajesFailureSlot({...failure,page:i+1})));
 assert.equal(slots.size,9,'large page numbers cannot create unlimited objects');
 await saveAjesRequestFailure(storage,{...failure,sql:'x'.repeat(65536)});
 assert.equal(saved.size,3,'oversized evidence is not persisted');
});

const row=(id:string)=>({ID:id,MARKA_NAME:'HYUNDAI',MODEL_NAME:'TUCSON',YEAR:'2024',MONTH:'10',FINISH:'17400000',ENG_V:'1598',PW:'',TIME:'D',MILEAGE:'30000',IMAGES:'https://7.tru.ru/imgs/fixtureABC'});
test('page six failure survives another visitor failing page one in the same minute',async()=>{
 const records:any[]=[];let requests=0;
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},saveRequestFailure:async v=>{records.push(v);},fetcher:async()=>{requests++;return new Response('bot7 fixture');}});
 await assert.rejects(client.read({table:'korea',page:1},'203.0.113.31'),/visitor_restricted/);
 await assert.rejects(client.read({table:'korea',page:6},'203.0.113.32'),/visitor_restricted/);
 assert.deepEqual(records.map(v=>v.page),[1,6]);
 await assert.rejects(client.read({table:'korea',page:7},'203.0.113.32'),/visitor_restricted/);
 assert.equal(requests,2,'cooldown does not send another request');
 assert.deepEqual(records.map(v=>v.page),[1,6],'cooldown must not invent page-seven evidence');
});
test('real Korea pagination keeps page offsets and visitor address; records exact refusal without secrets',async()=>{
 const requests:URL[]=[],records:any[]=[];
 const client=createAjesClient({password:()=> 'private-key-123',assertEnabled:async()=>{},reserve:async()=>{},endpoint:()=> 'http://78.46.90.228/api/',saveRequestFailure:async value=>{records.push(value);},fetcher:async input=>{
  const url=new URL(String(input));requests.push(url);
  if(requests.length===3)return new Response('bot7 private-key-123');
  return Response.json(Array.from({length:24},(_,i)=>row(`page${requests.length}-${i}`)));
 }});
 for(const page of [1,2]){const result=await client.read({table:'korea',page},'203.0.113.21');assert.equal(result.page,page);assert.equal(result.items.length,24);}
 await assert.rejects(client.read({table:'korea',page:3},'203.0.113.21'),/visitor_restricted/);
 assert.equal(requests.length,3);
 requests.forEach((url,i)=>{assert.equal(url.searchParams.get('ip'),'203.0.113.21');assert.equal(url.searchParams.get('sql'),ajesQuery({table:'korea',page:i+1}).sql);assert.match(url.searchParams.get('sql')!,new RegExp(`limit ${i*24},24$`));});
 assert.equal(records.length,1);assert.equal(records[0].page,3);assert.equal(records[0].providerCode,'bot7');assert.equal(records[0].httpStatus,200);assert.equal(records[0].clientIp,'203.0.113.21');assert.equal(records[0].endpoint,'http://78.46.90.228/api/');assert.equal(JSON.stringify(records).includes('private-key-123'),false);
 await assert.rejects(client.read({table:'korea',page:4},'203.0.113.21'),/visitor_restricted/);
 assert.equal(requests.length,3,'no retry or alternate route after refusal');assert.equal(records.length,1,'cooldown preserves actual page-three evidence');
});
test('diagnostic persistence cannot delay or replace the original page failure',async()=>{
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},saveRequestFailure:()=>new Promise(()=>{}),fetcher:async()=>new Response('ban2 fixture')});
 let timer:ReturnType<typeof setTimeout>;
 await assert.rejects(Promise.race([client.read({table:'korea',page:3},'203.0.113.22'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('diagnostic blocked response')),500);})]).finally(()=>clearTimeout(timer!)),/visitor_restricted/);
});

test('real CRM GET keeps page evidence owner-only and never makes a supplier request',async()=>{
 const {build}=await import('esbuild');
 const state={owner:false,reads:0};(globalThis as any).__ajesDiagnosticAuth=state;
 const stubs:Record<string,string>={
  'next/server':'export const NextResponse={json:(v,o)=>Response.json(v,o)};',
  '@/lib/auth':'export const getCurrentUser=async()=>({});',
  '@/lib/platform-access':'export const isPlatformOwner=()=>globalThis.__ajesDiagnosticAuth.owner;',
  '@/lib/data':'export const getJsonStorage=()=>({readJson:async()=>{globalThis.__ajesDiagnosticAuth.reads++;return {providerCode:"bot7",page:3};}});',
  '@/lib/catalog/calculation-request-origin':'export const isCalculationOriginAllowed=()=>false;',
  '@/lib/catalog/ajes-settings':'export const ajesPassword=async()=>"configured";',
  '@/lib/catalog/ajes-market-preview':'export const ajesPreviewMarket=m=>{if(m!=="korea"&&m!=="china")throw Error();return m;};export class AjesPreviewError extends Error{};',
  '@/lib/catalog/ajes-market-preview-runtime':'export const readAjesPreviewDiagnostic=async()=>null;export const previewAjesMarket=()=>{throw Error("unexpected supplier request");};',
 };
 try{
 const built=await build({entryPoints:['apps/web/app/(crm)/api/crm/ajes/markets/[market]/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'owner-boundary',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}));}}]});
 const mod={exports:{} as any};new Function('module','exports',built.outputFiles[0].text)(mod,mod.exports);
 const context={params:Promise.resolve({market:'korea'})},request=new Request('https://avtocena.com/api/crm/ajes/markets/korea');
 const denied=await mod.exports.GET(request,context);assert.equal(denied.status,403);assert.equal(state.reads,0);
 state.owner=true;const allowed=await mod.exports.GET(request,context);assert.equal(allowed.status,200);assert.equal(allowed.headers.get('cache-control'),'private, no-store');assert.equal((await allowed.json()).catalogDiagnostic.page,3);assert.equal(state.reads,1);
 }finally{delete (globalThis as any).__ajesDiagnosticAuth;}
});

test('a refused count keeps its true origin when it subsequently pauses a page request',async()=>{
 const records:any[]=[];let requests=0;
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},saveRequestFailure:async v=>{records.push(v);},fetcher:async()=>{requests++;return new Response('bot2 fixture');}});
 await assert.rejects(client.read({table:'korea',aggregate:'count'},'203.0.113.23'),/visitor_restricted/);
 await assert.rejects(client.read({table:'korea',page:3},'203.0.113.23'),/visitor_restricted/);
 assert.equal(requests,1);assert.equal(records.length,1);assert.equal(records[0].kind,'count');assert.equal(records[0].providerCode,'bot2');assert.match(records[0].sql,/^select count\(\*\)/);
});
