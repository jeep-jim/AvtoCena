import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getJsonStorage,resetJsonStorageForTests} from '../apps/web/lib/data';
import {persistCatalogOffers,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
test('a stale publisher cannot overwrite a generation committed by another worker',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,root=await fs.mkdtemp(path.join(os.tmpdir(),'avtocena-race-'));
 try{
 process.chdir(root);await fs.mkdir('data');process.env.JSON_STORAGE_DRIVER='local';resetJsonStorageForTests();resetCatalogReadCachesForTests();
 const storage=getJsonStorage();const baseline={version:2,generationId:'gen_initial',updatedAt:new Date().toISOString(),markets:{}};
 await storage.writeJson('catalog/manifest.json',baseline);
 let checks=0;
 const winner={...baseline,generationId:'gen_other_worker'};
 await assert.rejects(()=>persistCatalogOffers([], {expectedBaseGenerationId:'gen_initial',async beforeManifestCommit(){if(++checks===2)await storage.writeJson('catalog/manifest.json',winner);}}),/catalog_publish_base_changed/);
 assert.equal(checks,2);assert.deepEqual(await storage.readJson('catalog/manifest.json',null),winner);
 resetCatalogReadCachesForTests();
 await assert.rejects(()=>persistCatalogOffers([], {expectedBaseGenerationId:'gen_initial'}),/catalog_publish_base_changed/);
 }finally{process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;resetJsonStorageForTests();resetCatalogReadCachesForTests();await fs.rm(root,{recursive:true,force:true});}
});
