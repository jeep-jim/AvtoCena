import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {validStaffLogin} from '../apps/web/lib/staff-login';
const require=createRequire(import.meta.url);
test('local staff login accepts numeric identifiers and rejects malformed identifiers',()=>{
 for(const login of ['1111111','dealer_one','nstass','12_ab'])assert.equal(validStaffLogin(login),true,login);
 for(const login of ['abc','a'.repeat(33),'имя123','one two','name@example.com'])assert.equal(validStaffLogin(login),false,login);
});
test('numeric dealer logs in with own key; wrong keys, disabled accounts and external bootstrap are denied',async()=>{
 const state={users:[] as any[],allowed:true};(globalThis as any).__loginTest=state;
 const mocks:any={
  '@/lib/data':`export const readDataJson=async()=>globalThis.__loginTest.users;`,
  '@/lib/crm-access':`import crypto from 'node:crypto'; export const digest=v=>crypto.createHash('sha256').update(v).digest('hex'); export const keyMatches=(key,hash)=>!!hash&&digest(key)===hash; export const loginAttempt=async()=>globalThis.__loginTest.allowed;`,
 };
 const result=await build({entryPoints:['apps/web/app/(public)/api/auth/login/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'test-data',setup(b){b.onResolve({filter:/^@\/lib\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 const mod={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,mod,mod.exports);
 const previous=process.env.AUTH_ACCESS_KEY;process.env.AUTH_ACCESS_KEY='bootstrap-test';
 const call=(username='@1111111',accessKey='personal-test')=>mod.exports.POST(new Request('https://avtocena.com/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,accessKey})}));
 const dealer={id:'dealer-staff',displayName:'Test',telegramUsername:'1111111',role:'dealer',companyId:'external',status:'active',dealerApproved:true,accessKeyHash:createHash('sha256').update('personal-test').digest('hex')};
 try{
  state.users=[dealer];let response=await call();assert.equal(response.status,200);assert.match(response.headers.get('set-cookie')||'',/avtocena_session=/);
  assert.equal((await call('1111111','wrong')).status,401);
  state.users=[{...dealer,status:'disabled'}];assert.equal((await call()).status,401);
  state.users=[{...dealer,role:'owner',accessKeyHash:undefined}];assert.equal((await call('1111111','bootstrap-test')).status,401);
  state.users=[{...dealer,role:'owner',companyId:'dealer_topavto',accessKeyHash:undefined}];assert.equal((await call('1111111','bootstrap-test')).status,200);
  state.allowed=false;assert.equal((await call()).status,429);
 }finally{delete(globalThis as any).__loginTest;if(previous===undefined)delete process.env.AUTH_ACCESS_KEY;else process.env.AUTH_ACCESS_KEY=previous;}
});
test('TopAvto team page excludes external staff while preserving disabled internal staff',async()=>{
 const owner={id:'owner',companyId:'dealer_topavto',role:'owner',displayName:'Internal owner',telegramUsername:'owner'};
 (globalThis as any).__teamList={actor:owner,users:[owner,{...owner,id:'disabled',role:'manager',status:'disabled',displayName:'Internal disabled'},{...owner,id:'external',role:'dealer',companyId:'external',displayName:'External dealer'},{...owner,id:'stale',role:'admin',companyId:'external',displayName:'External stale admin'}]};
 const mocks:any={
  '@/lib/auth':`export const getCurrentUser=async()=>globalThis.__teamList.actor;export const isCrmRole=r=>['owner','admin','manager'].includes(r);export const isAdminRole=r=>['owner','admin'].includes(r);`,
  '@/lib/crm-users':`export const readCrmUsers=async()=>globalThis.__teamList.users;`,
  '@/lib/data':`export const readChunkedDataJson=async()=>[];`,
  '@/components/crm/CrmShell':`export const CrmShell=({children})=>children;`,
  '@/components/crm/TeamSchedulePanel':`export const TeamSchedulePanel=()=>null;`,
 };
 const result=await build({entryPoints:['apps/web/app/(crm)/crm/managers/page.tsx'],bundle:true,platform:'node',format:'cjs',jsx:'automatic',write:false,packages:'external',plugins:[{name:'team',setup(b){b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 const mod={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,mod,mod.exports);
 try{const {renderToStaticMarkup}=await import('react-dom/server');const html=renderToStaticMarkup(await mod.exports.default({}));assert.match(html,/Internal owner/);assert.match(html,/Internal disabled/);assert.doesNotMatch(html,/External dealer|External stale admin/);assert.match(html,/href="\/crm\/dealers"/);}finally{delete(globalThis as any).__teamList;}
});
