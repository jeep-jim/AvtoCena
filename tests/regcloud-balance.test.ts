import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchRegcloudBalance} from '../apps/web/lib/regcloud-balance-client';
test('REG balance uses authenticated fixed endpoint and keeps zero/negative cloud balance distinct from bonuses',async()=>{
 for(const balance of [0,-12.34,'9325.75']){
  const value=await fetchRegcloudBalance('private-token',async(url,init)=>{
   assert.equal(String(url),'https://api.cloudvps.reg.ru/v1/balance_data');assert.equal((init?.headers as any).Authorization,'Bearer private-token');assert.equal(init?.redirect,'error');
   return new Response(JSON.stringify({balance_data:{balance,bonus_balance:999,detalization:[{private:'data'}]}}));
  });
  assert.equal(value.balance,Number(balance));assert.deepEqual(Object.keys(value).sort(),['balance','sampledAt']);
 }
});
test('REG rejects missing or malformed balance without exposing provider response or credentials',async()=>{
 for(const raw of [null,undefined,'',true,'NaN',{},'1,25'])await assert.rejects(fetchRegcloudBalance('secret',async()=>new Response(JSON.stringify({balance_data:{balance:raw}}))),{message:'regcloud_balance_unavailable'});
 for(const response of [new Response('secret echoed',{status:401}),new Response('x'.repeat(270000)),new Response('{bad json')])await assert.rejects(fetchRegcloudBalance('secret',async()=>response),{message:'regcloud_balance_unavailable'});
 await assert.rejects(fetchRegcloudBalance('secret',async()=>{throw Error('secret transport failure');}),{message:'regcloud_balance_unavailable'});
});
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('balance API is owner-only and changing its credential requires a trusted origin',async()=>{
 const state={owner:false,calls:0};(globalThis as any).__regBalance=state;
 const mocks:Record<string,string>={
 '@/lib/auth':'export const getCurrentUser=async()=>({});',
 '@/lib/platform-access':'export const isPlatformOwner=()=>globalThis.__regBalance.owner;',
 '@/lib/regcloud-balance':`export const validRegcloudToken=v=>typeof v==='string'&&v.length>=16;export const readRegcloudBalance=async()=>{globalThis.__regBalance.calls++;return {configured:false}};export const connectRegcloudBalance=async()=>{globalThis.__regBalance.calls++;return {configured:true,balance:12,sampledAt:1}};`
 };
 const result=await build({entryPoints:['apps/web/app/(crm)/api/crm/regcloud-balance/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/^@\/lib\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'ts'}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,m,m.exports);
 const put=(origin?:string,token='test-only-credential')=>m.exports.PUT(new Request('https://avtocena.com/api/crm/regcloud-balance',{method:'PUT',headers:origin?{origin}:{},body:JSON.stringify({token})}));
 try{
  assert.equal((await m.exports.GET()).status,403);assert.equal((await put('https://avtocena.com')).status,403);assert.equal(state.calls,0);
  state.owner=true;assert.equal((await put()).status,403);assert.equal((await put('https://other.example')).status,403);assert.equal((await put('https://avtocena.com','short')).status,400);assert.equal(state.calls,0);
  const response=await put('https://avtocena.com');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.ok(!JSON.stringify(await response.json()).includes('credential'));
  assert.equal((await m.exports.GET()).status,200);
 }finally{delete (globalThis as any).__regBalance;}
});
test('low balance targets active Top Avto owners, deduplicates and rearms after recovery',async()=>{
 const state={stored:null as any,notices:new Map<string,any>(),fail:false,users:[{id:'owner',companyId:'dealer_topavto',role:'owner'},{id:'disabled',companyId:'dealer_topavto',role:'owner',status:'disabled'},{id:'admin',companyId:'dealer_topavto',role:'admin'},{id:'other',companyId:'other',role:'owner'}]};
 (globalThis as any).__regAlert=state;
 const mocks:Record<string,string>={
 './data':'export const readDataJson=async(p,f)=>globalThis.__regAlert.stored||f;export const mutateDataJson=async(p,f,fn)=>globalThis.__regAlert.stored=await fn(globalThis.__regAlert.stored||f);',
 './crm-users':'export const readCrmUsers=async()=>globalThis.__regAlert.users;',
 './crm-notification-store':'export const notifyTeam=async(n)=>{if(globalThis.__regAlert.fail)throw Error();globalThis.__regAlert.notices.set(n.id,n)};'
 };
 const result=await build({entryPoints:['apps/web/lib/regcloud-balance-alert.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'ts'}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,m,m.exports);
 const sample=(balance:number,sampledAt:number)=>m.exports.notifyLowRegcloudBalance({balance,sampledAt});
 try{
  await sample(600,1);assert.equal(state.notices.size,0);
  await sample(599.99,2);assert.equal(state.notices.size,1);assert.deepEqual([...state.notices.values()][0].recipientIds,['owner']);
  await sample(0,3);await sample(-12,4);assert.equal(state.notices.size,1);
  await sample(600,5);await sample(599,6);assert.equal(state.notices.size,2);
  await sample(900,4);assert.ok(state.stored.episode); // stale recovery ignored
  await sample(900,7);state.fail=true;await assert.rejects(sample(1,8));state.fail=false;await sample(1,8);assert.equal(state.notices.size,3);
  await sample(NaN,9);assert.equal(state.notices.size,3);
 }finally{delete (globalThis as any).__regAlert;}
});
