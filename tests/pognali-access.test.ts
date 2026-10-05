import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('global ranking combines legacy staff from different companies and customers without exposing private accounts',async()=>{
 const state:any={customer:null,staff:null,allow:true,records:new Map(),users:[{id:'staff-a',displayName:'Антон',companyId:'a'},{id:'staff-b',displayName:'Ян',companyId:'b'}]};
 const result={runId:'old',mode:'hills',score:123,distance:123,coins:0,kills:0,duration:10,at:'2026-10-05'};
 state.records.set('games/pognali/v1/staff-a.json',{best:{hills:result,circuit:{...result,mode:'circuit'}}});
 state.records.set('games/pognali/v1/staff-b.json',{best:{hills:result}});
 state.records.set('games/pognali/v1/customer%3Acustomer-c.json',{profile:{name:'John',avatar:'/key-logo.png'},best:{hills:result}});
 (globalThis as any).__pognaliTest=state;
 const mocks:Record<string,string>={
 'auth':"export const getCurrentUser=async()=>globalThis.__pognaliTest.staff;export const isCrmRole=r=>['owner','admin','manager','dealer'].includes(r);",
 'account/auth':'export const currentAccount=async()=>globalThis.__pognaliTest.customer;',
 'crm-permissions':'export const hasCrmPermission=()=>globalThis.__pognaliTest.allow;',
 'crm-users':'export const readCrmUsers=async()=>globalThis.__pognaliTest.users;',
 'data':`const s=globalThis.__pognaliTest;export const readDataJson=async(k,f)=>s.records.get(k)||f;export const mutateDataJson=async(k,f,fn)=>{s.records.set(k,await fn(s.records.get(k)||f));};export const getJsonStorage=()=>({listObjects:async()=>[...s.records.keys()].map(key=>({key}))});`,
 };
 const bundled=await build({entryPoints:['apps/web/app/(crm)/api/crm/game/route.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'game-access',setup(b){b.onResolve({filter:/(?:^|\/)(?:auth|data|crm-users|crm-permissions)$/},args=>{const id=args.path.endsWith('account/auth')?'account/auth':args.path.split('/').at(-1)!;return mocks[id]?{path:id,namespace:'mock'}:undefined;});b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path]}));}}]});
 const module={exports:{} as any};new Function('require','module','exports',bundled.outputFiles[0].text)(require,module,module.exports);
 try{
  assert.equal((await module.exports.GET()).status,401);
  state.customer={id:'customer-c',name:'John',profileConfigured:true,phone:'PRIVATE_PHONE',passwordHash:'PRIVATE_HASH'};
  const response=await module.exports.GET(),data=await response.json();assert.equal(response.status,200);assert.deepEqual(data.team.map((r:any)=>r.name).sort(),['John','Антон','Ян']);assert.ok(data.team.every((r:any)=>!r.best.circuit));assert.ok(data.team.every((r:any)=>/^[a-f0-9]{64}$/.test(r.id)));assert.ok(!JSON.stringify(data).includes('PRIVATE_'));
  const post=(input:any,origin='https://avtocena.com')=>module.exports.POST(new Request('https://avtocena.com/api/crm/game',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(input)}));
  assert.equal((await post({action:'start',mode:'circuit'})).status,400);
  assert.equal((await post({action:'start',mode:'hills'},'https://other.test')).status,403);
  assert.equal((await post({action:'start',mode:'hills',userId:'staff-a'})).status,200);assert.ok(state.records.get('games/pognali/v1/customer%3Acustomer-c.json').active);assert.equal(state.records.get('games/pognali/v1/staff-a.json').active,undefined);
  state.customer=null;state.staff={id:'staff-a',displayName:'Антон',role:'manager'};assert.equal((await module.exports.GET()).status,200);state.allow=false;assert.equal((await module.exports.GET()).status,403);
 }finally{delete (globalThis as any).__pognaliTest;}
});
