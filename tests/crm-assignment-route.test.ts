import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {leadReadState} from '../apps/web/lib/crm-read-state';
const require=createRequire(import.meta.url);
test('only senior roles assign active staff; assignment alerts target the assignee and stale assignments conflict',async()=>{
 const state:any={user:{id:'m',role:'manager',displayName:'Manager'},lead:{id:'lot',status:'new',createdAt:'2026-09-20T10:00:00Z',assignedManagerId:'m'},writes:0};
 (globalThis as any).__assignmentRoute=state;
 const sources:Record<string,string>={
 "@/lib/crm-activity":`export const recordCrmActivity=async()=>{};export const activityPerson=u=>({id:u.id,name:u.displayName});export const activityChanges=()=>[];`,
 'next/server':`export const NextResponse={json:(data,options)=>Response.json(data,options)};export const after=fn=>{globalThis.__assignmentRoute.queued=(globalThis.__assignmentRoute.queued||0)+1;};`,
 '@/lib/crm-push':`export const flushCrmPush=async()=>({sent:0});`,
 '@/lib/auth':`export const getCurrentUser=async()=>globalThis.__assignmentRoute.user;export const isCrmRole=r=>['owner','admin','manager'].includes(r);export const isAdminRole=r=>['owner','admin'].includes(r);`,
 '@/lib/crm-users':`export const readCrmUsers=async()=>[{id:'m',role:'manager',displayName:'Manager'},{id:'other',role:'manager',displayName:'Other'},{id:'disabled',role:'manager',status:'disabled'}];`,
 '@/lib/data':`export const readChunkedDataJson=async()=>[globalThis.__assignmentRoute.lead];export const updateChunkedDataJson=async(path,id,fn)=>{const s=globalThis.__assignmentRoute;if(s.race)s.lead.assignedManagerId='third';const next=fn(s.lead);s.writes++;return s.lead=next;};export const appendChunkedDataJson=async()=>{};`,
 '@/lib/cpa-gateway':`export const deliverCpaEvent=async()=>{};`,
 '@/lib/business-settings':`export const handleLeadPartnerStatusChange=async()=>({});`
 };
 const built=await build({entryPoints:['apps/web/app/(crm)/api/crm/leads/[id]/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/^(?:@\/lib\/|next\/server$)/},args=>sources[args.path]?{path:args.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:sources[args.path],loader:'ts',resolveDir:process.cwd()}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,m,m.exports);
 const patch=(body:any,origin='https://avtocena.com')=>m.exports.PATCH(new Request('https://avtocena.com/api/crm/leads/lot',{method:'PATCH',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}),{params:{id:'lot'}});
 try {
 assert.equal((await patch({assignedManagerId:'other'})).status,403);assert.equal(state.writes,0);
 state.user={id:'admin',role:'admin',displayName:'Admin'};
 assert.equal((await patch({assignedManagerId:'disabled'})).status,400);
 assert.equal((await patch({assignedManagerId:'other'},'https://evil.example')).status,403);
 assert.equal((await patch({assignedManagerId:'other',expectedManagerId:'old'})).status,409);
 assert.equal((await patch({assignedManagerId:'other',expectedManagerId:'m'})).status,200);
 assert.equal(leadReadState(state.lead,'other').assignmentUnread,true);assert.equal(leadReadState(state.lead,'m').assignmentUnread,false);
 assert.equal(state.lead.managerHistory[0].changedByName,'Admin');assert.equal(state.queued,1,'assignment schedules background push after durable save');
 state.user={id:'owner',role:'owner',displayName:'Owner'};state.race=true;
 assert.equal((await patch({assignedManagerId:'m',expectedManagerId:'other'})).status,409);assert.equal(state.writes,1);
 }finally{delete (globalThis as any).__assignmentRoute;}
});
