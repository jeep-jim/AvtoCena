import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('customer avatar endpoint only serves assigned manager or an actual thread sender',async()=>{
 const state:any={account:{id:'customer'},manager:'manager',messages:[],reads:[]};(globalThis as any).__avatar=state;
 const mocks:Record<string,string>={
 '@/lib/account/auth':'export const currentAccount=async()=>globalThis.__avatar.account;',
 '@/lib/account/portal':'export const linkedClient=async(a,key)=>{if(key!=="owned")throw Error("denied");return {client:{id:"c",assignedManagerId:globalThis.__avatar.manager},link:{companyId:"company"}}};export const customerLeads=async()=>[];export const threadPath=()=>"own-thread";',
 '@/lib/crm-users':'export const readCrmUsers=async()=>["manager","sender","stranger"].map(id=>({id,displayName:id,avatarUrl:`/api/crm/users/${id}/avatar?v=${"a".repeat(24)}`}));',
 '@/lib/data':'export const readRecentChunkedDataJson=async()=>globalThis.__avatar.messages;export const getJsonStorage=()=>({getBinary:async path=>{globalThis.__avatar.reads.push(path);return {data:new Uint8Array([1,2,3])}}});'
 };
 try{const result=await build({entryPoints:['apps/web/app/api/account/manager-avatar/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'mocks',setup(b){b.onResolve({filter:/^@\//},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'ts'}));}}]});const module={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
 const get=(query:string)=>module.exports.GET(new Request('https://avtocena.com/api/account/manager-avatar?'+query));
 assert.equal((await get('client=other')).status,404);assert.equal(state.reads.length,0);
 assert.equal((await get('client=owned&id=stranger')).status,200);assert.match(state.reads.at(-1),/avatars\/manager\//);
 assert.equal((await get('client=owned&message=unknown')).status,404);
 state.messages=[{id:'m',staffId:'sender',author:'sender'}];assert.equal((await get('client=owned&message=m')).status,200);assert.match(state.reads.at(-1),/avatars\/sender\//);
 state.messages=[{id:'m',accountId:'customer',author:'customer'}];assert.equal((await get('client=owned&message=m')).status,404);
 state.manager='missing';assert.equal((await get('client=owned')).status,404);state.account=null;assert.equal((await get('client=owned')).status,401);
 }finally{delete (globalThis as any).__avatar;}
});
