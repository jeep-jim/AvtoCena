import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
async function action(){
 const built=await build({entryPoints:['apps/web/components/catalog/catalog-load-more-action.tsx'],bundle:true,platform:'node',format:'cjs',write:false,jsx:'automatic',external:['react/jsx-runtime'],plugins:[{name:'card',setup(b){
  b.onResolve({filter:/^\.\/CatalogCard$/},()=>({path:'card',namespace:'stub'}));
  b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const CatalogCard=()=>null;'}));
 }}]});
 const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);return mod.exports.loadMoreCatalog;
}
test('cold page can finish after 30 seconds; timeout remains bounded; errors never become empty success',async t=>{
 const load=await action(),fetchOriginal=globalThis.fetch,timeoutOriginal=AbortSignal.timeout;
 t.mock.timers.enable({apis:['setTimeout']});
 let signal:AbortSignal,url='',options:any,resolve!:(r:Response)=>void;
 AbortSignal.timeout=(ms:number)=>{const c=new AbortController();setTimeout(()=>c.abort(),ms);return c.signal;};
 globalThis.fetch=((input:any,init:any)=>{url=String(input);options=init;signal=init.signal;return new Promise<Response>((yes,no)=>{resolve=yes;signal.addEventListener('abort',()=>no(new Error('aborted')),{once:true});});}) as typeof fetch;
 try{
  let finished=false;const pending=load({market:'korea',city:'Новокузнецк'},5).then((v:any)=>{finished=true;return v;});
  t.mock.timers.tick(45_000);await Promise.resolve();assert.equal(finished,false);assert.equal(signal!.aborted,false);
  const params=new URL(url,'https://example.test').searchParams;
  assert.equal(params.get('page'),'5');assert.equal(params.get('city'),'Новокузнецк');assert.equal(params.get('after'),null);
  resolve(Response.json({page:5,total:null,items:[{id:'new-97'}],hasMore:true}));
  assert.deepEqual((await pending).ids,['new-97']);
  const timeout=assert.rejects(load({market:'korea'},6),(e:any)=>e.kind==='timeout');t.mock.timers.tick(90_000);await timeout;
  globalThis.fetch=(async()=>Response.json({ok:false,reason:'visitor_restricted'},{status:503})) as typeof fetch;
  await assert.rejects(load({market:'korea'},6),(e:any)=>e.kind==='unavailable');
  globalThis.fetch=(async()=>Response.json({page:1,total:null,items:[]})) as typeof fetch;
  await assert.rejects(load({market:'korea'},6),(e:any)=>e.kind==='invalid');
 }finally{globalThis.fetch=fetchOriginal;AbortSignal.timeout=timeoutOriginal;t.mock.timers.reset();}
});
