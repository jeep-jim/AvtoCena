import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectJsonStorage, StorageConflictError, jsonReadByteLength } from '../apps/web/lib/data.ts';

test('REG conditional JSON and binary writes preserve conflict guards and other endpoints', async () => {
  const names = ['YC_OBJECT_STORAGE_ENDPOINT', 'YC_OBJECT_STORAGE_REGION', 'YC_OBJECT_STORAGE_BUCKET', 'YC_OBJECT_STORAGE_ACCESS_KEY_ID', 'YC_OBJECT_STORAGE_SECRET_ACCESS_KEY'];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  try {
    process.env.YC_OBJECT_STORAGE_REGION = 'us-east-1';
    process.env.YC_OBJECT_STORAGE_BUCKET = 'synthetic-test';
    process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID = 'test-key';
    process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY = 'test-secret';
    let expected: string | null = null;
    let expectedNone: string | null = null;
    let status = 200;
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls++;
      const headers = new Headers(options?.headers);
      assert.equal(headers.get('if-match'), expected);
      assert.equal(headers.get('if-none-match'), expectedNone);
      if (expected) assert.match(headers.get('authorization')!, /SignedHeaders=[^,]*if-match/);
      return new Response('', { status });
    };
    const storage = new ObjectJsonStorage();
    for (const endpoint of ['https://s3.regru.cloud', 'https://storage.yandexcloud.net', 'https://s3.regru.cloud.example.org']) {
      process.env.YC_OBJECT_STORAGE_ENDPOINT = endpoint;
      expected = endpoint === 'https://s3.regru.cloud' ? 'abc123' : '"abc123"';
      await storage.writeJson('test.json', { v: 2 }, { ifMatch: '"abc123"' });
      await storage.putBinary('test.bin', Buffer.from('test'), 'application/octet-stream', { ifMatch: '"abc123"' });
    }
    process.env.YC_OBJECT_STORAGE_ENDPOINT = 'https://s3.regru.cloud';
    expected = 'abc123';
    await storage.writeJson('test.json', {}, { ifMatch: 'abc123' });
    for (const conflictStatus of [409, 412]) {
      status = conflictStatus;
      const count = calls;
      await assert.rejects(storage.writeJson('test.json', {}, { ifMatch: '"abc123"' }), StorageConflictError);
      await assert.rejects(storage.putBinary('test.bin', Buffer.from('test'), 'application/octet-stream', { ifMatch: '"abc123"' }), StorageConflictError);
      assert.equal(calls, count + 2, 'No retry without the original condition');
    }
    status = 200; expected = null; expectedNone = '*';
    await storage.writeJson('new.json', {}, { ifNoneMatch: '*' });
    await storage.putBinary('new.bin', Buffer.from('test'), 'application/octet-stream', { ifNoneMatch: '*' });
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name];
  }
});

test('conditional reads reuse unchanged objects and never hide updates or deletion', async () => {
 const names=['YC_OBJECT_STORAGE_ENDPOINT','YC_OBJECT_STORAGE_REGION','YC_OBJECT_STORAGE_BUCKET','YC_OBJECT_STORAGE_ACCESS_KEY_ID','YC_OBJECT_STORAGE_SECRET_ACCESS_KEY'];
 const before=Object.fromEntries(names.map(n=>[n,process.env[n]])),original=globalThis.fetch;
 try{
  Object.assign(process.env,{YC_OBJECT_STORAGE_ENDPOINT:'https://s3.regru.cloud',YC_OBJECT_STORAGE_REGION:'us-east-1',YC_OBJECT_STORAGE_BUCKET:'test',YC_OBJECT_STORAGE_ACCESS_KEY_ID:'test',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'test'});
  let version=1,condition:string|null=null;
  globalThis.fetch=async(_url,options)=>{
   const headers=new Headers(options?.headers);assert.equal(headers.get('if-none-match'),condition);
   if(condition)assert.match(headers.get('authorization')!,/SignedHeaders=[^,]*if-none-match/);
   if(version===0)return new Response(null,{status:404});
   if(condition===`"v${version}"`)return new Response(null,{status:304});
   return new Response(JSON.stringify({version,name:'Авто'}),{headers:{etag:`"v${version}"`}});
  };
  const storage=new ObjectJsonStorage();const first=await storage.readJsonWithMeta('catalog/current/test.json',null);
  assert.equal(jsonReadByteLength(first.value),Buffer.byteLength(JSON.stringify({version:1,name:'Авто'})));
  condition='"v1"';assert.equal(await storage.readJsonWithMeta('catalog/current/test.json',null,first),first);
  version=2;const second=await storage.readJsonWithMeta('catalog/current/test.json',null,first);assert.equal((second.value as any).version,2);assert.notEqual(second.value,first.value);
  condition='"v2"';version=0;assert.deepEqual(await storage.readJsonWithMeta('catalog/current/test.json',null,second),{value:null,found:false});
 }finally{globalThis.fetch=original;for(const n of names)if(before[n]===undefined)delete process.env[n];else process.env[n]=before[n];}
});
