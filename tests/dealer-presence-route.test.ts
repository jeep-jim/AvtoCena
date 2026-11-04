import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('dealer presence only returns approved active own-company people and only writes the signed-in user',async()=>{
 const member={id:'a',role:'dealer',companyId:'dealer_a',status:'active',dealerApproved:true,displayName:'A',accessKeyHash:'private-hash'};
 const state:any={user:member,verified:true,writes:[],users:[member,{...member,id:'b',companyId:'dealer_b'}, {...member,id:'disabled',status:'disabled'},{...member,id:'pending',dealerApproved:false}]};
 (globalThis as any).__dealerPresenceTest=state;
 const mocks:Record<string,string>={
 '@/lib/auth':`export const getCurrentUser=async()=>globalThis.__dealerPresenceTest.user;`,
 '@/lib/crm-users':`export const readCrmUsers=async()=>globalThis.__dealerPresenceTest.users;`,
 '@/lib/staff-presence':`export const readStaffPresence=async()=>({lastSeenAt:'2026-11-04T00:00:00Z'});export const staffIsOnline=()=>false;export const touchStaffPresence=async id=>globalThis.__dealerPresenceTest.writes.push(id);`,
 './showcase-store':`export const findDealer=async()=>({status:globalThis.__dealerPresenceTest.verified?'verified':'pending'});`
 };
 const built=await build({entryPoints:['apps/web/app/api/dealers/presence/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'storage-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'ts',resolveDir:process.cwd()}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,m,m.exports);
 const post=(origin='https://avtocena.com')=>m.exports.POST(new Request('https://avtocena.com/api/dealers/presence',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({userId:'b',companyId:'dealer_b'})}));
 try{
 const response=await m.exports.GET();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const payload=await response.json();assert.deepEqual(payload.team.map((u:any)=>u.id),['a']);assert.equal(JSON.stringify(payload).includes('private-hash'),false);
 assert.equal((await post('https://evil.example')).status,403);assert.deepEqual(state.writes,[]);assert.equal((await post()).status,200);assert.deepEqual(state.writes,['a']);
 for(const user of [null,{...member,role:'manager'},{...member,status:'disabled'},{...member,dealerApproved:false},{...member,companyId:''}]){state.user=user;assert.equal((await m.exports.GET()).status,403);assert.equal((await post()).status,403);}
 state.user=member;state.verified=false;assert.equal((await m.exports.GET()).status,403);assert.equal((await post()).status,403);assert.deepEqual(state.writes,['a']);
 }finally{delete (globalThis as any).__dealerPresenceTest;}
});
