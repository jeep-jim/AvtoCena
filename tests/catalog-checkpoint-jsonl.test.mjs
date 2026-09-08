import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readCheckpointJsonl} from '../scripts/lib/read-checkpoint-jsonl.mjs';

test('source descriptions with Unicode line separators and split UTF-8 round-trip intact', async () => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'catalog-jsonl-'));
 try {
  const file=path.join(dir,'rows.jsonl');
  const rows=[{id:1,text:'a'.repeat(65520)+'🇯🇵\u2028описание\u2029<br>\nстрока'},{id:2,text:'SUV'}];
  await fs.writeFile(file,rows.map(r=>JSON.stringify(r)).join('\r\n'));
  const actual=[];for await(const row of readCheckpointJsonl(file))actual.push(row);
  assert.deepEqual(actual,rows);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('malformed checkpoints fail explicitly rather than dropping an offer', async () => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'catalog-jsonl-'));
 try {
  const file=path.join(dir,'rows.jsonl');await fs.writeFile(file,'{"id":1}\n{"id":');
  await assert.rejects(async()=>{for await(const row of readCheckpointJsonl(file)){}},/invalid_checkpoint_line:.*:2:/);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
