import test from 'node:test';
import assert from 'node:assert/strict';
import {PhotoMemoryCache} from '../apps/web/lib/catalog/photo-memory-cache';
import {protectedPhotoUrl,photoProxyEligible,validPhotoSignature,supportedPhotoContentType} from '../apps/web/lib/catalog/photo-proxy-policy';
test('photo signatures bind market and exact URL; Japan, credentials, arbitrary hosts stay excluded',()=>{
 const old=process.env.AUTH_SECRET;process.env.AUTH_SECRET='test-photo-secret';
 try {
  const raw='https://ci.encar.com/photo/1.jpg'; const url=new URL(protectedPhotoUrl(raw,'korea'),'https://avtocena.com');const sig=url.pathname.split('/').pop()!;
  assert.equal(validPhotoSignature(raw,'korea','я'.repeat(43)),false);assert.ok(validPhotoSignature(raw,'korea',sig));assert.equal(validPhotoSignature(raw+'x','korea',sig),false);
  assert.equal(validPhotoSignature(raw,'japan',sig),false);assert.equal(protectedPhotoUrl(raw,'japan'),raw);
  for(const value of ['https://ci.encar.com.evil.test/a','https://127.0.0.1/a','https://u:p@ci.encar.com/a','https://ci.encar.com:444/a'])assert.equal(photoProxyEligible(value,'korea'),false);
 }finally{if(old===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=old;}
});
test('same image requests merge, cache is byte bounded and expires',async()=>{
 const cache=new PhotoMemoryCache(10,10000);let calls=0;
 const fetcher=async()=>{calls++;await new Promise(r=>setTimeout(r,5));return {data:Buffer.alloc(6),type:'image/webp'};};
 await Promise.all(Array.from({length:20},()=>cache.read('https://one.test/a',fetcher)));assert.equal(calls,1);
 await cache.read('https://one.test/a',fetcher);assert.equal(calls,1);
 await cache.read('https://two.test/b',fetcher);assert.equal(cache.size,6);
 cache.prune(Date.now()+10001);assert.equal(cache.size,0);
});
test('source rejection opens circuit, prevents repeat fetches',async()=>{
 const cache=new PhotoMemoryCache();let calls=0;const fail=async()=>{calls++;throw Error('photo_blocked');};
 await assert.rejects(cache.read('https://one.test/a',fail));
 await assert.rejects(cache.read('https://one.test/b',fail));assert.equal(calls,1);
});

test('KCar image/jpg is accepted; HTML is rejected; incompatible Mobile.de stays direct',()=>{
 for(const type of ['image/jpg','image/jpeg','image/webp','image/png','image/avif']) assert.ok(supportedPhotoContentType(type));
 for(const type of ['text/html','image/svg+xml','application/json','image/jpeg-malformed']) assert.equal(supportedPhotoContentType(type),false);
 const mobile='https://img.classistatic.de/api/v1/mo-prod/images/example?rule=mo-1600';
 assert.equal(photoProxyEligible(mobile,'europe'),false);assert.equal(protectedPhotoUrl(mobile,'europe'),mobile);
});
