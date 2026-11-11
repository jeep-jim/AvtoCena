import test from 'node:test';
import assert from 'node:assert/strict';
import {resetJsonStorageForTests} from '../apps/web/lib/data';
import {readEncyclopedia,readModel,MANIFEST,ROOT} from '../apps/web/lib/encyclopedia/records';

const id='1234567890abcdef12345678';
const manifest=(revision='r1',model='Camry'):any=>({
 generationId:'fixture',directoryCapturedAt:'2026-11-11T00:00:00Z',
 models:[{id,make:'Toyota',model,revision,key:ROOT+'/revisions/'+id+'/'+revision+'.json',years:[2022],fuels:['petrol'],markets:['china'],compact:{years:[2022]}}],
});
const envKeys=['JSON_STORAGE_DRIVER','YC_OBJECT_STORAGE_ENDPOINT','YC_OBJECT_STORAGE_REGION','YC_OBJECT_STORAGE_BUCKET','YC_OBJECT_STORAGE_PREFIX','YC_OBJECT_STORAGE_ACCESS_KEY_ID','YC_OBJECT_STORAGE_SECRET_ACCESS_KEY'];
async function withObjectStore(run:(state:any)=>Promise<void>){
 const saved=Object.fromEntries(envKeys.map(k=>[k,process.env[k]])),originalFetch=globalThis.fetch;
 const state:any={value:manifest(),etag:'"r1"',status:200,raw:undefined,includeEtag:true,requests:[],bodies:new Map(),hold:null};
 Object.assign(process.env,{JSON_STORAGE_DRIVER:'object',YC_OBJECT_STORAGE_ENDPOINT:'https://objects.test',YC_OBJECT_STORAGE_REGION:'test',YC_OBJECT_STORAGE_BUCKET:'fixture',YC_OBJECT_STORAGE_PREFIX:'one',YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'fixture'});
 resetJsonStorageForTests();
 globalThis.fetch=(async(input:any,init:any)=>{
  const url=new URL(String(input)),headers=new Headers(init?.headers),condition=headers.get('if-none-match');
  assert.equal(init?.method,'GET','reader must not write');
  state.requests.push({path:url.pathname,condition});
  state.entered?.();
  if(state.hold)await state.hold;
  if(!url.pathname.endsWith('/'+MANIFEST)){
   const value=state.bodies.get(url.pathname);
   return value?new Response(JSON.stringify(value),{status:200,headers:{etag:'"detail"'}}):new Response(null,{status:404});
  }
  if(state.status!==200)return new Response(state.status===403?'<Error><Code>AccessDenied</Code></Error>':null,{status:state.status});
  if(state.includeEtag&&condition===state.etag)return new Response(null,{status:304});
  return new Response(state.raw??JSON.stringify(state.value),{status:200,headers:state.includeEtag?{etag:state.etag}:{}});
 }) as typeof fetch;
 try{await run(state);}finally{
  globalThis.fetch=originalFetch;
  for(const k of envKeys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
  resetJsonStorageForTests();
 }
}
test('sequential encyclopedia reads revalidate every time and preserve the complete current value',async()=>{
 await withObjectStore(async s=>{
  const first=await readEncyclopedia(),second=await readEncyclopedia(),third=await readEncyclopedia();
  assert.deepEqual(first,s.value);assert.deepEqual(second,first);assert.deepEqual(third,first);
  assert.notStrictEqual(second,first,'sequential callers retain fresh-object behavior');
  assert.equal(s.requests.length,3,'no TTL-based request omission');
  assert.deepEqual(s.requests.map((r:any)=>r.condition),[null,'"r1"','"r1"']);
 });
});
test('caller mutation cannot poison the retained raw manifest or the next conditional read',async()=>{
 await withObjectStore(async s=>{
  const first=(await readEncyclopedia())!;first.models[0].model='changed only by caller';first.models[0].years.push(1900);first.models.push({...first.models[0],id:'another'});
  const second=(await readEncyclopedia())!;assert.deepEqual(second,s.value);
  second.models[0].model='second caller change';assert.deepEqual(await readEncyclopedia(),s.value);
 });
});
test('a changed ETag immediately replaces models and keeps passenger-scope filtering',async()=>{
 await withObjectStore(async s=>{
  await readEncyclopedia();s.etag='"r2"';s.value=manifest('r2','Corolla');
  s.value.models.push({id:'excluded',make:'Yamaha',model:'YZF-R1'});
  const next=(await readEncyclopedia())!;assert.equal(next.models.length,1);assert.equal(next.models[0].model,'Corolla');assert.equal(next.models[0].revision,'r2');
  assert.equal(s.requests[1].condition,'"r1"');
  await readEncyclopedia();assert.equal(s.requests[2].condition,'"r2"');
 });
});
test('deletion is immediately visible and clears conditional reuse',async()=>{
 await withObjectStore(async s=>{
  await readEncyclopedia();s.status=404;assert.equal(await readEncyclopedia(),null);
  s.status=200;s.value=manifest('r3','Prius');s.etag='"r3"';
  assert.equal((await readEncyclopedia())!.models[0].model,'Prius');assert.equal(s.requests[2].condition,null);
 });
});
test('permission failure and invalid JSON cannot return a stale successful manifest',async()=>{
 await withObjectStore(async s=>{
  await readEncyclopedia();s.status=403;await assert.rejects(readEncyclopedia(),/object_storage_GET_403/);
  s.status=200;s.raw='invalid JSON';await assert.rejects(readEncyclopedia());
  assert.equal(s.requests.at(-1).condition,null);
  s.raw=undefined;s.etag='"r2"';s.value=manifest('r2','Corolla');
  assert.deepEqual(await readEncyclopedia(),s.value);assert.equal(s.requests.at(-1).condition,null);
 });
});
test('absence of an ETag does not enable body reuse',async()=>{
 await withObjectStore(async s=>{
  s.includeEtag=false;await readEncyclopedia();s.value=manifest('r2','Corolla');
  assert.deepEqual(await readEncyclopedia(),s.value);
  assert.deepEqual(s.requests.map((r:any)=>r.condition),[null,null]);
 });
});
test('a manifest above the measured 16 MiB retention bound is served but never retained',async()=>{
 await withObjectStore(async s=>{
  s.value.padding='x'.repeat(16*1024*1024);
  assert.ok((await readEncyclopedia())!.models.length);
  s.value=manifest('r2','Corolla');s.etag='"r2"';assert.deepEqual(await readEncyclopedia(),s.value);
  assert.deepEqual(s.requests.map((r:any)=>r.condition),[null,null]);
 });
});
test('concurrent reads coalesce but a later call revalidates again',async()=>{
 await withObjectStore(async s=>{
  let release!:()=>void,entered!:()=>void;s.hold=new Promise<void>(r=>{release=r;});const started=new Promise<void>(r=>{entered=r;});s.entered=entered;
  const pending=[readEncyclopedia(),readEncyclopedia(),readEncyclopedia()];
  await started;assert.equal(s.requests.length,1);release();await Promise.all(pending);s.hold=null;
  await readEncyclopedia();assert.equal(s.requests.length,2);assert.equal(s.requests[1].condition,'"r1"');
 });
});
test('storage namespace and instance changes cannot reuse another source body',async()=>{
 await withObjectStore(async s=>{
  await readEncyclopedia();process.env.YC_OBJECT_STORAGE_PREFIX='two';s.value=manifest('r2','Corolla');
  assert.equal((await readEncyclopedia())!.models[0].model,'Corolla');assert.equal(s.requests[1].condition,null);
  resetJsonStorageForTests();s.value=manifest('r3','Prius');
  assert.equal((await readEncyclopedia())!.models[0].model,'Prius');assert.equal(s.requests[2].condition,null);
 });
});
test('immutable model details follow the newly validated manifest revision immediately',async()=>{
 await withObjectStore(async s=>{
  const record=(revision:string,powerHp:number)=>({id,make:'Toyota',model:'Camry',revision,variants:[{id:'v',powerHp}]});
  s.bodies.set('/fixture/one/'+ROOT+'/revisions/'+id+'/r1.json',record('r1',100));
  assert.equal((await readModel(id))!.variants[0].powerHp,100);
  s.etag='"r2"';s.value=manifest('r2');s.bodies.set('/fixture/one/'+ROOT+'/revisions/'+id+'/r2.json',record('r2',110));
  assert.equal((await readModel(id))!.variants[0].powerHp,110);
  assert.ok(s.requests.some((r:any)=>r.path.endsWith('/r2.json')));
  assert.equal(s.requests.filter((r:any)=>r.path.endsWith('/'+MANIFEST)).length,2);
 });
});
