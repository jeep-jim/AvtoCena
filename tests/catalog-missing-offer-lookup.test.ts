import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getJsonStorage,resetJsonStorageForTests} from '../apps/web/lib/data';
import {getOffer,getOfferFromCurrentProjection,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';

test('confirmed missing IDs avoid whole-catalog reads while incomplete indexes retain recovery',async()=>{
  const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER;
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'missing-offer-'));
  await fs.mkdir(path.join(temp,'data'));process.chdir(temp);process.env.JSON_STORAGE_DRIVER='local';
  resetJsonStorageForTests();resetCatalogReadCachesForTests();
  try {
    const storage=getJsonStorage(),reads:string[]=[];
    const read=storage.readJsonWithMeta.bind(storage);
    storage.readJsonWithMeta=async(key,fallback)=>{reads.push(key);return read(key,fallback);};
    await storage.writeJson('catalog/manifest.json',{version:2,generationId:'complete',markets:{}});
    await storage.writeJson('catalog/generations/complete/indexes/offers-by-id.json',{generationId:'complete',byId:{}});
    assert.equal(await getOffer('missing'),null);
    assert.equal(await getOfferFromCurrentProjection('missing'),null);
    assert.equal(reads.some(key=>key.includes('/projection/')),false,'an absent ID must not load every market');

    await storage.writeJson('catalog/generations/complete/indexes/offers-by-id.json',{byId:{}});
    await storage.writeJson('catalog/public/projection/all.json',{generationId:'complete',items:[{id:'recoverable',market:'china',make:'Toyota',model:'Corolla',year:2022,cardImageUrl:'https://example.test/car.jpg'}]});
    resetCatalogReadCachesForTests();
    assert.equal((await getOffer('recoverable'))?.id,'recoverable','legacy/incomplete indexes must still recover projected cards');

    await storage.writeJson('catalog/manifest.json',{version:2,generationId:'next',markets:{}});
    await storage.writeJson('catalog/generations/next/indexes/offers-by-id.json',{generationId:'next',byId:{missing:{market:'china',chunk:'chunk-0001'}}});
    await storage.writeJson('catalog/generations/next/offers/china/chunk-0001.json',[{id:'missing',market:'china'}]);
    resetCatalogReadCachesForTests();
    assert.equal((await getOffer('missing'))?.id,'missing','a later publication may introduce the previously absent ID');
  } finally {
    process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;
    resetJsonStorageForTests();resetCatalogReadCachesForTests();await fs.rm(temp,{recursive:true,force:true});
  }
});
