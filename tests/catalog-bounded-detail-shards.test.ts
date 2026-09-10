import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {boundedDetailShards,detailHash,detailShardPath} from '../apps/web/lib/catalog/detail-shards';
import {getOfferFromCurrentShard,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
import {resetJsonStorageForTests,writeDataJson} from '../apps/web/lib/data';

test('an overflowing detail bucket splits, remains readable and rejects another generation',async()=>{
 const rows:Array<{id:string;market:string}>=[];
 for(let i=0;rows.length<501;i++) {
  const id=`scale-${i}`;
  if(detailHash(id).startsWith('ab'))rows.push({id,market:'korea'});
 }
 const shards=boundedDetailShards(rows);
 assert.equal(shards.get('ab')?.children,true);
 assert.ok([...shards.values()].every(shard=>shard.items.length<=500));
 assert.deepEqual(new Set([...shards.values()].flatMap(shard=>shard.items.map(row=>row.id))),new Set(rows.map(row=>row.id)));
 assert.ok([...shards.keys()].filter(key=>key.length>2).every(key=>detailShardPath('gen-test',key).startsWith('catalog/generations/gen-test/')));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bounded-detail-')),cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER;
 try {
  process.chdir(dir);process.env.JSON_STORAGE_DRIVER='local';resetJsonStorageForTests();resetCatalogReadCachesForTests();
  await writeDataJson('catalog/manifest.json',{generationId:'gen-test',markets:{}});
  for(const [prefix,shard] of shards)await writeDataJson(detailShardPath('gen-test',prefix),{generationId:'gen-test',...shard});
  assert.equal((await getOfferFromCurrentShard(rows[0].id))?.id,rows[0].id);
  assert.equal((await getOfferFromCurrentShard(rows[500].id))?.id,rows[500].id);
  await writeDataJson('catalog/manifest.json',{generationId:'other-generation',markets:{}});resetCatalogReadCachesForTests();
  assert.equal(await getOfferFromCurrentShard(rows[0].id),null);
 } finally {
  process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;
  resetJsonStorageForTests();resetCatalogReadCachesForTests();await fs.rm(dir,{recursive:true,force:true});
 }
});
