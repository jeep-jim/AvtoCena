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
