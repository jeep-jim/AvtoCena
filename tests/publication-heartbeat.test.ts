import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
async function startPublicationHeartbeat(...args){const module=await import('../scripts/lib/publication-heartbeat.mjs');return module.startPublicationHeartbeat(...args);}
const operationId='catalog_v3_publish_china_12345678-1234-1234-1234-123456789abc';
async function fixture(fn){
 const cwd=process.cwd(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'publication-heartbeat-'));
 await fs.mkdir(path.join(dir,'data/catalog'),{recursive:true});
 const file=path.join(dir,'data/catalog/import-lock.json');
 await fs.writeFile(file,JSON.stringify({operationId,lockedUntil:new Date(Date.now()+30000).toISOString()}));
 process.chdir(dir);
 try{await fn(file);}finally{process.chdir(cwd);await fs.rm(dir,{recursive:true,force:true});}
}
test('lease stays live while publisher event loop is blocked longer than lease TTL',async()=>{
 await fixture(async file=>{
  const heartbeat=await startPublicationHeartbeat({key:'catalog/import-lock.json',operationId,ttlMs:1200,intervalMs:100},{...process.env,JSON_STORAGE_DRIVER:'local'});
  try{
   const until=Date.now()+2400;while(Date.now()<until){} // Regression: parent timers cannot run here.
   const saved=JSON.parse(await fs.readFile(file,'utf8'));
   assert.equal(saved.operationId,operationId);assert.ok(Date.parse(saved.lockedUntil)>Date.now());
   heartbeat.assertHealthy();
  }finally{await heartbeat.stop();}
  const saved=await fs.readFile(file,'utf8');await delay(250);assert.equal(await fs.readFile(file,'utf8'),saved);
 });
});
test('heartbeat cannot extend another writer lease',async()=>{
 await fixture(async file=>{
  const heartbeat=await startPublicationHeartbeat({key:'catalog/import-lock.json',operationId,ttlMs:1200,intervalMs:100},{...process.env,JSON_STORAGE_DRIVER:'local'});
  try{
   const other={operationId:'another-writer',lockedUntil:new Date(Date.now()+30000).toISOString()};
   await fs.writeFile(file,JSON.stringify(other));await delay(400);
   assert.throws(()=>heartbeat.assertHealthy(),/heartbeat/);
   assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),other);
  }finally{await heartbeat.stop();}
 });
});
test('expired lease cannot be revived by the heartbeat',async()=>{
 await fixture(async file=>{
  await fs.writeFile(file,JSON.stringify({operationId,lockedUntil:'2020-01-01T00:00:00Z'}));
  await assert.rejects(()=>startPublicationHeartbeat({key:'catalog/import-lock.json',operationId,ttlMs:1200,intervalMs:100},{...process.env,JSON_STORAGE_DRIVER:'local'}),/heartbeat_start_failed/);
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).lockedUntil,'2020-01-01T00:00:00Z');
 });
});
