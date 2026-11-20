import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CHINA_PUBLIC_CONTROL} from '../apps/web/lib/catalog/china-regcloud-object-reader';
import {chinaAggregateCacheKey,legacyAggregateMarketAllowed,readChinaAggregateAuthority,withChinaAggregateAuthority} from '../apps/web/lib/catalog/china-public-aggregate';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
test('exact own China hides old aggregate rows and races; other markets and checked rollback survive',async()=>{
 const keys=['AVTOCENA_CHINA_REGCLOUD_RUNTIME','YC_OBJECT_STORAGE_ENDPOINT','YC_OBJECT_STORAGE_BUCKET','YC_OBJECT_STORAGE_PREFIX','YC_OBJECT_STORAGE_REGION','YC_OBJECT_STORAGE_ACCESS_KEY_ID','YC_OBJECT_STORAGE_SECRET_ACCESS_KEY'];
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]])),originalFetch=globalThis.fetch;
 const old=Buffer.from(JSON.stringify({version:2,generationId:'gen_1795145660283_old',markets:{china:{count:1,chunks:['chunk-0001']},korea:{count:1,chunks:['chunk-0001']}}}));
 const own={runId:'run-fixture',generationId:'gen_1795145660283_new',readySha256:'a'.repeat(64)};
 const rollback={kind:'legacy-unmodified',generationId:'gen_1795145660283_old',manifestSha256:hash(old)};
 let pointer:unknown=null,calls:string[]=[];
 const mode=(active:unknown)=>({version:1,market:'china',revision:1,active,previous:null});
 Object.assign(process.env,{AVTOCENA_CHINA_REGCLOUD_RUNTIME:'1',YC_OBJECT_STORAGE_ENDPOINT:'https://s3.regru.cloud',YC_OBJECT_STORAGE_BUCKET:'fixture-owned-stage',
  YC_OBJECT_STORAGE_PREFIX:'fixture/active',YC_OBJECT_STORAGE_REGION:'ru-central1',YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture-stage',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'fixture-stage-secret'});
 globalThis.fetch=async(url,options)=>{
  const u=new URL(String(url)),key=u.pathname.split('/fixture-owned-stage/fixture/active/')[1];
  assert.equal(u.origin,'https://s3.regru.cloud');assert.equal(options?.method,'GET');calls.push(key);
  const bytes=key===CHINA_PUBLIC_CONTROL?(pointer?Buffer.from(JSON.stringify(pointer)):null):key==='catalog/manifest.json'?old:null;
  return bytes?new Response(new Uint8Array(bytes),{headers:{etag:'"'+hash(bytes)+'"'}}):new Response(null,{status:404});
 };
 const rows=[{id:'obsolete',market:'china'},{id:'keep',market:'korea'}],read=()=>Promise.resolve([...chinaAggregateCacheKey(),...rows.filter(r=>legacyAggregateMarketAllowed(r.market)).map(r=>r.id)]);
 try{
  process.env.AVTOCENA_CHINA_REGCLOUD_RUNTIME='0';
  assert.deepEqual(await withChinaAggregateAuthority(undefined,read),['obsolete','keep']);assert.equal(calls.length,0);
  process.env.AVTOCENA_CHINA_REGCLOUD_RUNTIME='1';
  assert.deepEqual(await withChinaAggregateAuthority(undefined,read),['no-old-china','keep']);
  pointer=mode(own);
  assert.deepEqual(await withChinaAggregateAuthority('any',read),['no-old-china','keep']);
  calls=[];assert.deepEqual(await withChinaAggregateAuthority('korea',read),['obsolete','keep']);assert.equal(calls.length,0);
  pointer=mode(rollback);let executions=0;
  assert.deepEqual(await withChinaAggregateAuthority(undefined,async()=>{if(++executions===1)pointer=mode(own);return read();}),['no-old-china','keep']);
  assert.equal(executions,2);
  pointer=mode(rollback);assert.equal(await readChinaAggregateAuthority(),'legacy');
  assert.deepEqual(await withChinaAggregateAuthority(undefined,read),['obsolete','keep']);
  pointer=mode({...rollback,manifestSha256:'e'.repeat(64)});
  assert.deepEqual(await withChinaAggregateAuthority(undefined,read),['no-old-china','keep']);
  pointer={bad:true};assert.equal(await readChinaAggregateAuthority(),'unavailable');
  assert.deepEqual(await withChinaAggregateAuthority('any',read),['no-old-china','keep']);
 }finally{
  globalThis.fetch=originalFetch;
  for(const [k,v]of Object.entries(before))if(v===undefined)delete process.env[k];else process.env[k]=v;
 }
});
