import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {getJsonStorage,resetJsonStorageForTests} from '../apps/web/lib/data';
import {buildCatalogBrandSummary,readCatalogBrandCounts,readCatalogBrandModelCounts,readCatalogDirectoryCountRows,readCatalogFacets,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';

test('directory counts and unfiltered facets never download full offer projections',async()=>{
 const previous=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'directory-memory-'));fs.mkdirSync(path.join(root,'data'));
 process.chdir(root);process.env.JSON_STORAGE_DRIVER='local';resetJsonStorageForTests();resetCatalogReadCachesForTests();
 const storage=getJsonStorage();const original=storage.readJsonWithMeta.bind(storage);
 try{
  const generationId='gen_compact_directory';
  await storage.writeJson('catalog/manifest.json',{version:2,generationId,updatedAt:'',markets:{}});
  await storage.writeJson('catalog/public/brand-summary.json',buildCatalogBrandSummary(generationId,[
   {make:'Peugeot',model:'2008',market:'europe'}, {make:'Peugeot',model:'2008',market:'korea'}, {make:'Peugeot',model:'208',market:'europe'},
  ] as any));
  const facets={generationId,makes:['Peugeot'],models:[{make:'Peugeot',model:'2008'},{make:'Peugeot',model:'208'}],markets:['europe','korea'],bodyTypes:[],fuels:[],transmissions:[],drives:[]};
  await storage.writeJson('catalog/public/facets.json',facets);
  storage.readJsonWithMeta=async(file,fallback)=>{assert.ok(!file.includes('projection'),`unexpected full inventory read: ${file}`);return original(file,fallback);};
  const [all,korea,models,directory,loadedFacets]=await Promise.all([readCatalogBrandCounts(),readCatalogBrandCounts({market:'korea'}),readCatalogBrandModelCounts('Peugeot'),readCatalogDirectoryCountRows(),readCatalogFacets()]);
  assert.deepEqual(all.counts,{Peugeot:3});assert.deepEqual(all.modelCounts,{Peugeot:2});
  assert.deepEqual(korea.counts,{Peugeot:1});assert.deepEqual(korea.modelCounts,{Peugeot:1});
  assert.equal(models.models.length,2);assert.equal(directory.reduce((sum,row)=>sum+row.count,0),3);
  assert.deepEqual(loadedFacets,facets);
  const summary=await original('catalog/public/brand-summary.json',{});
  await storage.writeJson(`catalog/generations/${generationId}/indexes/brand-summary.json`,summary.value);
  await storage.writeJson('catalog/public/brand-summary.json',{generationId:'next_staging_generation',brands:{}});
  resetCatalogReadCachesForTests();
  assert.deepEqual((await readCatalogBrandCounts()).counts,{Peugeot:3});
  assert.equal((await readCatalogBrandModelCounts('Peugeot')).models.length,2);
  assert.equal((await readCatalogDirectoryCountRows()).reduce((sum,row)=>sum+row.count,0),3);
  await storage.writeJson('catalog/public/facets.json',{...facets,generationId:'stale'});
  await storage.writeJson(`catalog/generations/${generationId}/indexes/facets.json`,facets);resetCatalogReadCachesForTests();
  assert.deepEqual(await readCatalogFacets(),facets,'a cutover uses immutable compact facets instead of downloading all offers');
 }finally{storage.readJsonWithMeta=original;process.chdir(previous);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;resetJsonStorageForTests();resetCatalogReadCachesForTests();fs.rmSync(root,{recursive:true,force:true});}
});
