import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getJsonStorage,resetJsonStorageForTests,writeDataJson} from '../apps/web/lib/data';
import {publishCurrentCatalogReadModels,resetCatalogReadCachesForTests,offerPath,searchProjectionFromOffer,getOfferFromCurrentShard} from '../apps/web/lib/catalog/storage';

test('streaming repair preserves records and refuses incomplete input before publishing aliases',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'readmodel-stream-')),cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER;
 try {
  process.chdir(dir);process.env.JSON_STORAGE_DRIVER='local';resetJsonStorageForTests();resetCatalogReadCachesForTests();
  const now=new Date().toISOString();
  const offer:any={id:'repair-fixture',market:'korea',sourceId:'encar_direct',make:'Hyundai',model:'Sonata',year:2024,trim:'2.0',fuel:'petrol',engineCc:1999,powerHp:160,powerKw:117.68,powertrainKind:'combustion',bodyType:'sedan',drive:'fwd',transmission:'automatic',images:[],totalRub:null,catalogPricingMode:'seller',sellerPriceRub:1000000,sourcePrice:10000000,sourceCurrency:'KRW',updatedAt:now,firstSeenAt:now,operational:{sourceUrl:'https://www.encar.com/dc/dc_cardetailview.do?carid=123',raw:{large:'discard me'}}};
  await writeDataJson('catalog/manifest.json',{generationId:'g',markets:{korea:{count:2,chunks:['one','two']}}});
  await writeDataJson(offerPath('g','korea','one'),[offer]);
  const storage=getJsonStorage(),write=storage.writeJson.bind(storage),writes:string[]=[];
  storage.writeJson=async(key,value,options)=>{writes.push(key);return write(key,value,options);};
  await assert.rejects(publishCurrentCatalogReadModels(),/chunk_missing/);
  assert.equal(writes.length,0,'missing source chunk must not partially publish aliases');
  const second={...offer,id:'repair-fixture-2',drive:'awd'};
  await writeDataJson(offerPath('g','korea','two'),[second]);writes.length=0;
  const result=await publishCurrentCatalogReadModels();
  assert.equal(result.total,2);assert.equal(result.markets.korea,2);
  const projection:any=await storage.readJson('catalog/public/projection/all.json',null);
  assert.deepEqual(projection.items,JSON.parse(JSON.stringify([offer,second].map(searchProjectionFromOffer))));
  resetCatalogReadCachesForTests();
  const restored=await getOfferFromCurrentShard(second.id);
  assert.equal(restored?.drive,'awd');assert.equal(restored?.sellerPriceRub,1000000);
  assert.equal((restored?.operational as any)?.raw,undefined);
 }finally{
  process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;
  resetJsonStorageForTests();resetCatalogReadCachesForTests();await fs.rm(dir,{recursive:true,force:true});
 }
});
