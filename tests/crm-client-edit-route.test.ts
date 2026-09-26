import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
test('client editing enforces visibility, concurrency and field allowlist',async()=>{
 const state:any={user:null,client:{id:'c',assignedManagerId:'m',fio:'Before',phone:'',telegram:'',city:'',comment:'',updatedAt:'v1'},writes:0};
 (globalThis as any).__clientEdit=state;
 const sources:Record<string,string>={
 "@/lib/crm-activity":`export const recordCrmActivity=async()=>{};export const activityPerson=u=>({id:u.id,name:u.displayName});export const activityChanges=()=>[];`,
 '@/lib/auth':`export const getCurrentUser=async()=>globalThis.__clientEdit.user;export const isCrmRole=r=>['owner','admin','manager'].includes(r);`,
 '@/lib/data':`export const updateChunkedDataJson=async(path,id,fn)=>{const s=globalThis.__clientEdit;if(id!==s.client.id)return null;if(s.race)s.client.assignedManagerId='other';const next=fn(s.client);s.writes++;return s.client=next;};`
 };
 const built=await build({entryPoints:['apps/web/app/(crm)/api/crm/clients/[id]/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/^@\/lib\//},a=>sources[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:sources[a.path],loader:'ts',resolveDir:process.cwd()}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,m,m.exports);
 const patch=(body:any={...state.client,fio:'After',assignedManagerId:'forged'},origin='https://avtocena.com',id='c')=>m.exports.PATCH(new Request(`https://avtocena.com/api/crm/clients/${id}`,{method:'PATCH',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({id})});
 try {
  assert.equal((await patch()).status,401);
  state.user={id:'m',role:'partner'};assert.equal((await patch()).status,401);
  state.user={id:'stranger',role:'manager'};assert.equal((await patch()).status,403);
  state.user={id:'m',role:'manager'};
  assert.equal((await patch(undefined,'https://evil.example')).status,403);
  assert.equal((await patch({...state.client,updatedAt:'stale'})).status,409);
  assert.equal((await patch({...state.client,fio:'',phone:'',telegram:''})).status,400);
  assert.equal((await patch(undefined,undefined,'missing')).status,404);
  assert.equal(state.writes,0);
  assert.equal((await patch()).status,200);assert.equal(state.client.fio,'After');assert.equal(state.client.assignedManagerId,'m');assert.equal(state.client.updatedByManagerId,'m');
  state.race=true;assert.equal((await patch()).status,403);assert.equal(state.writes,1);
 }finally{delete (globalThis as any).__clientEdit;}
});
