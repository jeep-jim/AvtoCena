import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {ObjectJsonStorage, StorageConflictError, serializeStorageJson} from '../apps/web/lib/data.ts';

test('immutable calculation indexes use compact gzip with signed conditions and lossless content', async()=>{
 const names=['YC_OBJECT_STORAGE_ENDPOINT','YC_OBJECT_STORAGE_REGION','YC_OBJECT_STORAGE_BUCKET','YC_OBJECT_STORAGE_ACCESS_KEY_ID','YC_OBJECT_STORAGE_SECRET_ACCESS_KEY'];
 const before=Object.fromEntries(names.map(n=>[n,process.env[n]])),original=globalThis.fetch;
 try{
  Object.assign(process.env,{YC_OBJECT_STORAGE_ENDPOINT:'https://s3.regru.cloud',YC_OBJECT_STORAGE_REGION:'us-east-1',YC_OBJECT_STORAGE_BUCKET:'test',YC_OBJECT_STORAGE_ACCESS_KEY_ID:'test',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'test'});
  const value={digest:'abc',models:Array.from({length:15000},(_,i)=>({id:i,source:{url:'https://example.test/vehicle',value:'Модель 北京',power30MinKw:100}}))};
  const key='knowledge/encyclopedia/calculation-indexes/abc.json';
  assert.equal(serializeStorageJson(key,value),JSON.stringify(value));
  let calls=0,status=200;
  globalThis.fetch=async(_url,options)=>{
   calls++;const h=new Headers(options?.headers);const bytes=Buffer.from(options!.body as any);
   assert.equal(h.get('content-encoding'),'gzip');assert.equal(h.get('if-none-match'),'*');
   assert.match(h.get('authorization')!,/SignedHeaders=[^,]*content-encoding/);
   assert.equal(h.get('x-amz-content-sha256'),createHash('sha256').update(bytes).digest('hex'));
   assert.deepEqual(JSON.parse(gunzipSync(bytes).toString()),value);
   assert.ok(bytes.length<Buffer.byteLength(JSON.stringify(value))/4);
   return new Response('',{status});
  };
  const storage=new ObjectJsonStorage();await storage.writeJson(key,value,{ifNoneMatch:'*'});
  for(const conflict of [409,412]){status=conflict;const prior=calls;await assert.rejects(storage.writeJson(key,value,{ifNoneMatch:'*'}),StorageConflictError);assert.equal(calls,prior+1);}
  globalThis.fetch=async(_url,options)=>{assert.equal(new Headers(options?.headers).get('content-encoding'),null);return new Response('',{status:200});};
  await storage.writeJson('settings/large.json',value);
  await storage.writeJson(key,{small:true});
 }finally{globalThis.fetch=original;for(const n of names)if(before[n]===undefined)delete process.env[n];else process.env[n]=before[n];}
});
