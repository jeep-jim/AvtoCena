import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('editorial API rejects unauthorized writes, foreign origins, missing photos and restoration of withdrawn inventory',async()=>{
 const state:any={actor:{id:'owner',role:'owner',companyId:'dealer_topavto',displayName:'Owner'},offer:{id:'one',market:'korea',sourceId:'s',sourceOfferId:'1',make:'Hyundai',model:'Avante',images:[{url:'https://example.com/car-a.jpg'},{url:'https://example.com/car-b.jpg'}]},index:{revision:'0',entries:{}},writes:0};
 (globalThis as any).__catalogEditorialRoute=state;
 const sources:Record<string,string>={
  '@/lib/auth':`export const getCurrentUser=async()=>globalThis.__catalogEditorialRoute.actor;`,
  '@/lib/catalog/storage':`export const getOfferFromCurrentShard=async()=>globalThis.__catalogEditorialRoute.offer;`,
  '@/lib/catalog/presentation':`export const catalogOfferTitle=()=>"Hyundai Avante";`,
  data:`export const readDataJson=async()=>globalThis.__catalogEditorialRoute.index;export const mutateDataJson=async(p,f,fn)=>{const s=globalThis.__catalogEditorialRoute;s.index=await fn(s.index);s.writes++;return s.index;};export const getJsonStorage=()=>({binaryExists:async()=>false});`,
 };
 const result=await build({entryPoints:['apps/web/app/api/catalog/offer/[id]/editorial/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},a=>{const key=a.path==='../data'||a.path==='@/lib/data'?'data':a.path;return sources[key]?{path:key,namespace:'fixture'}:undefined;});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:sources[a.path],loader:'ts',resolveDir:process.cwd()}));}}]});
 const module={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
 async function save(values:any={},origin='https://avtocena.com'){return module.exports.POST(new Request('https://avtocena.com/api/catalog/offer/one/editorial',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({title:'',photos:null,status:'hidden',reason:'Фото неверное',version:null,...values})}),{params:Promise.resolve({id:'one'})});}
 try{
  assert.equal((await save({},'https://evil.example')).status,403);
  const owner=state.actor;
  for(const actor of [null,{...owner,companyId:'other'},{...owner,role:'manager',permissions:{catalog:true}},{...owner,status:'disabled'}]){state.actor=actor;assert.equal((await save()).status,403);}
  state.actor=owner;assert.equal(state.writes,0);
  assert.equal((await save({photos:['/api/site-media/'+'a'.repeat(64)]})).status,400);assert.equal(state.writes,0);
  assert.equal((await save({photos:['https://evil.example/foreign.jpg']})).status,400);
  const response=await save({photos:['https://example.com/car-b.jpg','https://example.com/car-a.jpg']});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const saved=(await response.json()).entry;assert.equal(state.index.entries.one.status,'hidden');assert.deepEqual(saved.photos,['https://example.com/car-b.jpg','https://example.com/car-a.jpg']);
  assert.equal((await save()).status,409,'stale editor cannot overwrite');
  state.offer=null;
  assert.equal((await save({version:saved.version,status:'visible'})).status,409,'withdrawn source is not resurrected');
  assert.equal((await save({version:saved.version,status:'archived',photos:saved.photos})).status,200,'withdrawn record remains manageable in archive');
 }finally{delete (globalThis as any).__catalogEditorialRoute;}
});
