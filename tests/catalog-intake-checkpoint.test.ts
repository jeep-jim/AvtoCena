import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {observationShardWriter,restoreIntakeCursor,publishedIntakeCheckpoint} from '../scripts/lib/catalog-intake-checkpoint.mjs';

test('raw observations rotate after 500 revisions and reject accidental reuse',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'intake-shards-'));
 try {
  const write=observationShardWriter(dir,'encar_direct');
  await Promise.all(Array.from({length:1001},(_,id)=>write({id})));
  const files=(await fs.readdir(dir)).sort();
  const parts=await Promise.all(files.map(async file=>(await fs.readFile(path.join(dir,file),'utf8')).trim().split('\n').map(JSON.parse)));
  assert.deepEqual(parts.map(rows=>rows.length),[500,500,1]);
  assert.deepEqual(parts.flat().map(row=>row.id),Array.from({length:1001},(_,i)=>i));
  await assert.rejects(observationShardWriter(dir,'encar_direct')({id:9999}),/EEXIST/);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('only a published market may advance its continuation; stale or foreign state is ignored',()=>{
 const now=Date.now(),date=new Date(now).toISOString();
 const intake={market:'korea',completedAt:date,sources:[{sourceId:'encar_direct',cursor:'424',stopReason:'time_budget'}]};
 assert.throws(()=>publishedIntakeCheckpoint(intake,{market:'korea',published:false}),/successful_publication/);
 assert.throws(()=>publishedIntakeCheckpoint(intake,{market:'china',published:true,generationId:'gen'}),/successful_publication/);
 const saved=publishedIntakeCheckpoint(intake,{market:'korea',published:true,generationId:'gen'});
 const state=()=>({source:{market:'korea'},sourceId:'encar_direct',cursor:null,initialCursor:null});
 const resumed=state();restoreIntakeCursor(resumed,saved,now);assert.equal(resumed.cursor,'424');assert.equal(resumed.initialCursor,'424');
 for(const bad of [{...saved,market:'china'},{...saved,version:2},{...saved,updatedAt:new Date(now-15*86400000).toISOString()}]) {
  const untouched=state();restoreIntakeCursor(untouched,bad,now);assert.equal(untouched.cursor,null);
 }
});

test('a smaller conversion replaces obsolete shards and keeps the latest observation',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'intake-conversion-'));
 try {
  const input=path.join(dir,'input'),output=path.join(dir,'output'),market=path.join(input,'catalog-intake-korea');
  await fs.mkdir(market,{recursive:true});
  const env={...process.env,CATALOG_INTAKE_INPUT_DIR:input,CATALOG_REBUILD_INPUT_DIR:output};
  const source=path.join(market,'encar-000001.jsonl');
  await fs.writeFile(source,Array.from({length:1001},(_,i)=>JSON.stringify({offer:{id:String(i),market:'korea'}})).join('\n')+'\n');
  const run=()=>execFileSync(process.execPath,['--import','tsx','scripts/catalog-intake-to-publication.mjs'],{env});
  run();assert.equal((await fs.readdir(output)).length,3);
  await fs.writeFile(source,JSON.stringify({offer:{id:'one',market:'korea',revision:1}})+'\n');
  await fs.writeFile(path.join(market,'encar-000002.jsonl'),JSON.stringify({offer:{id:'one',market:'korea',revision:2}})+'\n');
  run();assert.deepEqual(await fs.readdir(output),['catalog-rebuild-korea-0001.json']);
  const result=JSON.parse(await fs.readFile(path.join(output,'catalog-rebuild-korea-0001.json'),'utf8'));
  assert.equal(result.count,1);assert.equal(result.offers[0].revision,2);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
