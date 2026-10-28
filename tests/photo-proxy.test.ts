import test from 'node:test';
import assert from 'node:assert/strict';
import {PhotoMemoryCache} from '../apps/web/lib/catalog/photo-memory-cache';
import {catalogCoverThumbnail} from '../apps/web/lib/catalog/cover-image';
import {renderCatalogPhoto} from '../apps/web/lib/catalog/photo-rendition';
import sharp from 'sharp';
import {protectCatalogCardPhotos,protectedPhotoUrl,photoProxyEligible,validPhotoSignature,supportedPhotoContentType} from '../apps/web/lib/catalog/photo-proxy-policy';
test('stored homepage overview signs both selected cover and gallery at delivery, without mutating persisted cards',()=>{
 const old=process.env.AUTH_SECRET;process.env.AUTH_SECRET='runtime-web-secret';
 try {
  const raw='https://2sc2.autoimg.cn/escimg/auto/car.jpg.webp';
  const card={id:'china-car',market:'china',cardImageUrl:raw,images:[{url:raw,id:'cover',width:1024}],totalRub:1234567};
  const result=protectCatalogCardPhotos(card);
  assert.ok(result.cardImageUrl.startsWith('/api/catalog/photo/'));
  assert.equal(result.images[0].url,result.cardImageUrl);
  assert.equal(result.images[0].width,1024);assert.equal(result.totalRub,card.totalRub);
  assert.equal(card.cardImageUrl,raw);assert.equal(card.images[0].url,raw);
  assert.deepEqual(protectCatalogCardPhotos(result),result);
  assert.equal(protectCatalogCardPhotos({...card,market:'japan'}).cardImageUrl,raw);
 }finally{if(old===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=old;}
});
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

test('tile renditions preserve signed source identity and do not replace full gallery images',async()=>{
 const original='/api/catalog/photo/signature?url=https%3A%2F%2Fci.encar.com%2Fphoto%2F1.jpg&market=korea';
 const thumbnail=catalogCoverThumbnail(original);
 const url=new URL(thumbnail,'https://avtocena.com');
 assert.equal(url.pathname,'/api/catalog/photo/signature');
 assert.equal(url.searchParams.get('url'),'https://ci.encar.com/photo/1.jpg');
 assert.equal(url.searchParams.get('market'),'korea');assert.equal(url.searchParams.get('view'),'card');
 assert.equal(catalogCoverThumbnail(thumbnail),thumbnail);
 const input=await sharp({create:{width:2000,height:1500,channels:3,background:'#315e88'}}).jpeg().toBuffer();
 const [card,full]=await Promise.all([renderCatalogPhoto(input,true),renderCatalogPhoto(input,false)]);
 const cardMeta=await sharp(card).metadata();assert.equal(cardMeta.width,800);assert.equal(cardMeta.height,600);
 const fullMeta=await sharp(full).metadata();assert.equal(fullMeta.width,1800);assert.equal(fullMeta.height,1350);
 assert.ok(card.length<full.length);
});

test('photo variants coalesce separately and share the same memory budget',async()=>{
 const cache=new PhotoMemoryCache(10,10000);let fullCalls=0,cardCalls=0;
 const full=()=>{fullCalls++;return Promise.resolve({data:Buffer.alloc(6,1),type:'image/webp'});};
 const card=()=>{cardCalls++;return Promise.resolve({data:Buffer.alloc(3,2),type:'image/webp'});};
 const url='https://one.test/a';
 await cache.read(url,full);
 await Promise.all([cache.read(url,card,'card'),cache.read(url,card,'card')]);
 assert.equal(fullCalls,1);assert.equal(cardCalls,1);assert.equal(cache.size,9);
 assert.equal((await cache.read(url,full)).data[0],1);
 assert.equal((await cache.read(url,card,'card')).data[0],2);
});

test('KCar image/jpg is accepted; HTML is rejected; incompatible Mobile.de stays direct',()=>{
 for(const type of ['image/jpg','image/jpeg','image/webp','image/png','image/avif']) assert.ok(supportedPhotoContentType(type));
 for(const type of ['text/html','image/svg+xml','application/json','image/jpeg-malformed']) assert.equal(supportedPhotoContentType(type),false);
 const mobile='https://img.classistatic.de/api/v1/mo-prod/images/example?rule=mo-1600';
 assert.equal(photoProxyEligible(mobile,'europe'),false);assert.equal(protectedPhotoUrl(mobile,'europe'),mobile);
});

// A broken image must not take every other car on the same CDN offline.
test('an invalid individual photo does not block healthy photos on its host',async()=>{
 const cache=new PhotoMemoryCache();
 await assert.rejects(cache.read('https://one.test/missing',async()=>{throw Error('photo_invalid');}));
 const healthy=await cache.read('https://one.test/healthy',async()=>({data:Buffer.from('ok'),type:'image/webp'}));
 assert.equal(healthy.data.toString(),'ok');
});
