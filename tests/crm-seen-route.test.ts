import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {leadReadState} from '../apps/web/lib/crm-read-state';
const require=createRequire(import.meta.url);
test('seen endpoint validates user, visibility, origin and exact event; preserves other readers',async()=>{
 const state:any={user:null,lead:{id:'lot',createdAt:'2026-09-20T10:00:00Z',assignedManagerId:'m'},writes:0};
 (globalThis as any).__seenRoute=state;
 const sources:Record<string,string>={
 '@/lib/auth':`export const getCurrentUser=async()=>globalThis.__seenRoute.user;export const isCrmRole=role=>['owner','admin','manager'].includes(role);`,
 '@/lib/data':`export const readChunkedDataJson=async()=>[globalThis.__seenRoute.lead];export const updateChunkedDataJson=async(path,id,fn)=>{const s=globalThis.__seenRoute;if(s.race)s.lead.assignedManagerId='other';const next=fn(s.lead);s.writes++;return s.lead=next;};`
 };
 const built=await build({entryPoints:['apps/web/app/(crm)/api/crm/leads/[id]/seen/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/^@\/lib\//},args=>sources[args.path]?{path:args.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:sources[args.path],loader:'ts',resolveDir:process.cwd()}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,m,m.exports);
 const post=(key=leadReadState(state.lead,state.user?.id||'m').eventKey,origin='https://avtocena.com')=>m.exports.POST(new Request('https://avtocena.com/api/crm/leads/lot/seen',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({eventKey:key,userId:'forged',displayName:'forged'})}),{params:{id:'lot'}});
 try{
 assert.equal((await post()).status,401);
 state.user={id:'p',role:'partner'};assert.equal((await post()).status,401);
 state.user={id:'stranger',role:'manager'};assert.equal((await post()).status,403);
 state.user={id:'m',role:'manager',displayName:'Manager'};
 assert.equal((await post(undefined,'https://evil.example')).status,403);
 assert.equal((await post('stale')).status,409);assert.equal(state.writes,0);
 assert.equal((await post()).status,200);assert.equal(state.lead.readReceipts[0].userId,'m');assert.equal(state.lead.readReceipts[0].displayName,'Manager');
 state.user={id:'owner',role:'owner',displayName:'Owner'};assert.equal((await post()).status,200);assert.equal(state.lead.readReceipts.length,2);
 state.user={id:'m',role:'manager',displayName:'Manager'};state.race=true;assert.equal((await post()).status,403);assert.equal(state.writes,2);
 }finally{delete (globalThis as any).__seenRoute;}
});
