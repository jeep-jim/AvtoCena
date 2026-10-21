import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {searchOffers, resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
import {catalogCoverThumbnail} from '../apps/web/lib/catalog/cover-image';

test('single bounded market window preserves the order and contents of eight small requests',async()=>{
 const storage=getJsonStorage(), original=storage.readJsonWithMeta;
 const rows=Array.from({length:250},(_,i)=>({id:`window-${i}`,market:'japan',make:'Toyota',model:'Yaris',year:2020,sourcePrice:10000,sourceCurrency:'JPY',sellerPriceRub:5000,catalogPricingMode:'seller',calculationStatus:'needs_data',totalRub:null,cardProjectionVersion:3,cardImageUrl:'https://example.test/car.jpg',calculationSnapshot:{currencyRate:{effectiveRate:.5,rateSource:"cbr",currency:"JPY",sourcePrice:10000}},updatedAt:'2026-09-18T00:00:00Z'}));
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>({found:true,value:(key==='catalog/manifest.json'?{generationId:'window',markets:{japan:{count:250}}}:key==='catalog/public/projection/japan.json'?{generationId:'window',items:rows}:fallback) as T});
 try{
  resetCatalogReadCachesForTests();
  const small=await Promise.all(Array.from({length:8},(_,i)=>searchOffers({market:'japan',page:i+1,pageSize:24})));
  const one=await searchOffers({market:'japan',page:1,pageSize:192},192);
  assert.equal(one.items.length,192);assert.deepEqual(one.items.map(x=>x.id),small.flatMap(p=>p.items.map(x=>x.id)));
  assert.equal((await searchOffers({market:'japan',pageSize:192})).pageSize,48,'public caller retains the original cap');
 }finally{storage.readJsonWithMeta=original;resetCatalogReadCachesForTests();}
});
test('thumbnail keeps exact lot and filename and leaves other providers alone',()=>{
 const original='https://jp2.pa-server.ru/auc_auto/2026_09_17/1881816509/1789240274.5197_2.webp';
 assert.equal(catalogCoverThumbnail(original),'https://jp2.pa-server.ru/auc_auto/2026_09_17/1881816509/400/1789240274.5197_2.webp');
 assert.equal(catalogCoverThumbnail('https://example.com/car.jpg'),'https://example.com/car.jpg');
});
