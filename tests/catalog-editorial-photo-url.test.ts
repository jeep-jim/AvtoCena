import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('editorial URL photos require staff and origin, use guarded downloader and store normalized bytes',async()=>{
 const state:any={actor:{id:'owner',role:'owner',companyId:'dealer_topavto'},downloads:[],writes:[],fail:false};
 (globalThis as any).__editorialPhoto=state;
 const sources:Record<string,string>={
  '@/lib/auth':'export const getCurrentUser=async()=>globalThis.__editorialPhoto.actor;',
  '@/lib/dealers/media':`export const downloadDealerImage=async url=>{globalThis.__editorialPhoto.downloads.push(url);if(globalThis.__editorialPhoto.fail)throw Error('blocked');return Buffer.from('downloaded');};export const prepareDealerImage=async bytes=>{if(bytes.toString()!=='downloaded')throw Error('bad bytes');return Buffer.from('normalized');};`,
  '@/lib/data':`export const getJsonStorage=()=>({putBinary:async(...args)=>globalThis.__editorialPhoto.writes.push(args)});`,
 };
 const result=await build({entryPoints:['apps/web/app/api/crm/catalog/photos/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},a=>sources[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:sources[a.path],loader:'ts'}));}}]});
 const module={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
 const send=(url:any='https://example.com/car.jpg',origin='https://avtocena.com')=>module.exports.POST(new Request('https://avtocena.com/api/crm/catalog/photos',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({url})}));
 try{
  assert.equal((await send(undefined,'https://other.example')).status,403);
  const owner=state.actor;state.actor=null;assert.equal((await send()).status,403);state.actor=owner;
  assert.equal(state.downloads.length,0);assert.equal((await send(7)).status,400);assert.equal((await send('a'.repeat(2049))).status,400);
  const response=await send();assert.equal(response.status,200);assert.match((await response.json()).url,/^\/api\/site-media\/[a-f0-9]{64}$/);
  assert.deepEqual(state.downloads,['https://example.com/car.jpg']);assert.equal(state.writes[0][1].toString(),'normalized');assert.equal(state.writes[0][2],'image/webp');
  state.fail=true;assert.equal((await send()).status,400);assert.equal(state.writes.length,1);
 }finally{delete (globalThis as any).__editorialPhoto;}
});
