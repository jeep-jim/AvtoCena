import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {gunzipSync} from 'node:zlib';
const text=fs.readFileSync(new URL('./raw-field-audit.ts',import.meta.url),'utf8');
const runnable=stripTypeScriptTypes(text.replace(/^import .*;\n/gm,''),{mode:'strip'}).replace('main().catch(error=>{','globalThis.finished=main().catch(error=>{');
async function run({refusal=false,disabled=false,wrongIp=false,unexpectedCacheWrite=false}={}) {
 const logs=[],requests=[],writes=[];
 const password='synthetic_password_only_1234';
 const evidence={id:'synthetic-lot',observedAt:'2026-11-25T00:00:00Z',fields:['ID','PW','INFO','POWER_KW'],values:{PW:'150,170',INFO:'power 150 hp private text'}};
 const objects=new Map([
  ['catalog/partner-cache/ajes/evidence/stats-last-detail.json',evidence],
  ['catalog/partner-cache/ajes/stats/synthetic-lot.json',{schemaVersion:2,items:[{id:'synthetic-lot',table:'stats',sourcePower:'150,170'}]}],
  ['integrations/ajes/config.json',{encryptedPassword:'synthetic-encrypted-value'}],
  ['catalog/operations/collection-controls-v1.json',{enabled:!disabled}]
 ]);
 const env={AJES_DIAG_IP:wrongIp?'127.0.0.1':'151.248.113.177',AVTOCENA_RELEASE_SHA:'d536c1547c4d82a339ed68ced7d8503f09b6810b',JSON_STORAGE_DRIVER:'object',YC_OBJECT_STORAGE_BUCKET:'fixture-bucket',YC_OBJECT_STORAGE_PREFIX:'fixture-prefix'};
 let context;
 class AjesUnavailable extends Error {constructor(reason){super('redacted');this.reason=reason;}}
 const storage={driver:'object',async readJsonWithMeta(key,fallback){const r=await context.fetch(`https://s3.regru.cloud/fixture-bucket/fixture-prefix/${key}`);return {value:r.status===404?fallback:await r.json(),found:r.status!==404,etag:'fixture-etag'};},async readJson(key,fallback){return (await this.readJsonWithMeta(key,fallback)).value;},async writeJson(key,value,condition){await context.fetch(`https://s3.regru.cloud/fixture-bucket/fixture-prefix/${key}`,{method:'PUT',headers:{'if-match':condition.ifMatch},body:JSON.stringify(value)});}};
 const query=input=>({table:input.table,kind:input.id?'detail':'list',page:1,pageSize:input.id?1:input.pageSize,sql:input.id?`select * from stats where id='${input.id}'`:`select * from ${input.table} limit 0,3`});
 const fetch=async(input,init={})=>{
  const u=new URL(input);requests.push({kind:u.hostname==='s3.regru.cloud'?'storage':'supplier',method:init.method||'GET'});
  if(u.hostname==='s3.regru.cloud'){
   const key=u.pathname.split('/').slice(3).join('/');
   if(init.method==='PUT'){writes.push(key);return new Response('{}');}
   return objects.has(key)?new Response(JSON.stringify(objects.get(key))):new Response('',{status:404});
  }
  if(refusal)return new Response('private refusal '+password,{status:403});
  return new Response(JSON.stringify([{ID:'synthetic-lot',PW:'150,170',POWER_KW:'88',INFO:'horsepower 150 hp '+password,YEAR:2022}]),{headers:{'content-type':'application/json'}});
 };
 const client=deps=>({async read(input,ip){
  await deps.assertEnabled(input.table);const pass=await deps.password();
  await deps.reserve(input.table,input.id?'detail':'list');
  if(unexpectedCacheWrite)await storage.writeJson('catalog/partner-cache/ajes/queries/1.json',{},{});
  const u=new URL(await deps.endpoint(ip));u.search=new URLSearchParams({ip,json:'',code:pass,sql:query(input).sql}).toString();
  const r=await deps.fetcher(u,{redirect:'error',cache:'no-store'});
  if(!r.ok)throw new AjesUnavailable('http_'+r.status);
  const rows=await r.json();return {observedAt:'2026-11-25T00:00:00Z',received:rows.length,rejected:0,stale:false,items:rows.map(row=>({sourcePower:row.PW,info:row.INFO}))};
 }});
 context=vm.createContext({console:{log:(...x)=>logs.push(x.join(' '))},process:{env,exitCode:0},URL,URLSearchParams,Request,Response,Headers,Buffer,Set,Map,gunzipSync,fetch,getJsonStorage:()=>storage,AjesUnavailable,ajesQuery:query,createAjesClient:client,ajesPassword:async()=>{await storage.readJson('integrations/ajes/config.json',null);return password;},ajesEndpoint:()=> 'http://87.242.72.57/api/',clearCollectionControlsCache:()=>{},assertCollectionEnabled:async()=>{const c=await storage.readJson('catalog/operations/collection-controls-v1.json',null);if(!c?.enabled){const e=new Error();e.name='CollectionDisabledError';throw e;}},reserveAjesRequest:async(s,table)=>{const key=`catalog/operations/ajes-quota-${table}.json`;await s.readJsonWithMeta(key,null);await s.writeJson(key,{buckets:{}},{ifMatch:'fixture-etag'});}});
 new vm.Script(runnable).runInContext(context);await context.finished;
 assert(!logs.join('\n').includes(password));assert(!logs.join('\n').includes('synthetic-lot'));assert(!logs.join('\n').includes('private text'));
 return {logs,requests,writes,exitCode:context.process.exitCode};
}
const ok=await run();assert.equal(ok.requests.filter(r=>r.kind==='supplier').length,2);assert.equal(ok.writes.length,2);assert.equal(ok.exitCode,0);assert(ok.logs.some(x=>x.includes('"stage":"complete"')));
const denied=await run({refusal:true});assert.equal(denied.requests.filter(r=>r.kind==='supplier').length,1);assert.equal(denied.writes.length,1);assert.equal(denied.exitCode,1);
const off=await run({disabled:true});assert.equal(off.requests.filter(r=>r.kind==='supplier').length,0);assert.equal(off.writes.length,0);assert.equal(off.exitCode,1);
const identity=await run({wrongIp:true});assert.equal(identity.requests.length,0);assert.equal(identity.exitCode,1);
const cache=await run({unexpectedCacheWrite:true});assert.equal(cache.requests.filter(r=>r.kind==='supplier').length,0);assert.equal(cache.writes.length,1);assert.equal(cache.exitCode,1);assert(cache.writes.every(k=>k.includes('ajes-quota-')));
console.log('raw-field-audit network/owner/identity/write/refusal guards passed');
