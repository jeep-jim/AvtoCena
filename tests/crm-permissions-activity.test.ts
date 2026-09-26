import test from 'node:test';
import assert from 'node:assert/strict';
import {hasCrmPermission,CRM_PERMISSIONS} from '../apps/web/lib/crm-permissions';
import {canSeeLead} from '../apps/web/lib/crm-visibility';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('permission defaults preserve roles; overrides restrict admins and cannot promote managers to staff administration',()=>{
 const manager:any={id:'m',role:'manager'};const admin:any={id:'a',role:'admin',permissions:{viewAll:false,staff:false,documents:false}};
 assert.equal(hasCrmPermission(manager,'editClients'),true);assert.equal(hasCrmPermission(manager,'viewAll'),false);
 assert.equal(hasCrmPermission({...manager,permissions:{staff:true}},'staff'),false);
 assert.equal(hasCrmPermission(admin,'staff'),false);assert.equal(hasCrmPermission(admin,'documents'),false);
 assert.equal(canSeeLead(admin,{assignedManagerId:'other'}),false);assert.equal(canSeeLead(admin,{assignedManagerId:'a'}),true);
 assert.equal(canSeeLead(manager,undefined),false);assert.equal(hasCrmPermission({...manager,status:'disabled'},'documents'),false);
 for(const key of Object.keys(CRM_PERMISSIONS))assert.equal(hasCrmPermission({id:'o',role:'owner',permissions:{[key]:false}} as any,key as any),true);
});
test('activity visibility follows current assignment, management scope and identity without leaking hidden events',async()=>{
 const state:any={users:[{id:'a',displayName:'Admin',role:'admin'},{id:'m',displayName:'Manager',role:'manager'}],leads:[{id:'mine',assignedManagerId:'m'},{id:'other',assignedManagerId:'a'}],clients:[],events:[{id:'1',createdAt:'2026-09-26T10:00:00Z',type:'lead_assigned',title:'Assigned',leadId:'mine',managerId:'a',assignedManagerId:'m'},{id:'2',createdAt:'2026-09-26T09:00:00Z',type:'lead_updated',title:'Hidden',leadId:'other',managerId:'m'},{id:'3',createdAt:'2026-09-26T08:00:00Z',type:'staff_key_issued',title:'Key issued',visibility:'management',managerId:'m'}]};
 (globalThis as any).__activity=state;
 const r=await build({entryPoints:['apps/web/lib/crm-activity.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'activity-storage',setup(b){b.onResolve({filter:/^\.\/(data|crm-users)$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='./data'?`const s=globalThis.__activity;export const appendChunkedDataJson=async(p,e)=>{s.events.unshift(e);return e};export const generateId=()=>"id";export const readChunkedDataJson=async p=>p.startsWith('leads')?s.leads:s.clients;export const readRecentChunkedDataJson=async(p,n,f)=>s.events.filter(f).slice(0,n);`:`export const readCrmUsers=async()=>globalThis.__activity.users;`,loader:'js'}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',r.outputFiles[0].text)(require,m,m.exports);
 try{const visible=await m.exports.readCrmActivity(state.users[1]);assert.deepEqual(visible.map((e:any)=>e.id),['1']);assert.equal(visible[0].actor.name,'Admin');assert.equal(visible[0].target.name,'Manager');assert.equal((await m.exports.readCrmActivity(state.users[0])).length,3);state.leads[0].assignedManagerId='a';assert.equal((await m.exports.readCrmActivity(state.users[1])).length,0);assert.equal((await m.exports.readCrmActivity(state.users[0],30,'2026-09-26T09:00:00Z'))[0].id,'3');}finally{delete (globalThis as any).__activity;}
});
