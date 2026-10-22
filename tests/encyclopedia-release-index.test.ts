import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {restoreReleaseEncyclopedia} from '../scripts/encyclopedia/restore-calculation-index.mjs';
test('off-server preparation restores only the immutable index bound to the live release',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'encyclopedia-release-'));
 try{
  await fs.mkdir(path.join(root,'apps/web/lib/encyclopedia'),{recursive:true});await fs.writeFile(path.join(root,'apps/web/lib/encyclopedia/calculation-index.ts'),'');
  const release='a'.repeat(40),models={},digest=createHash('sha256').update(JSON.stringify(models)).digest('hex'),key=`knowledge/encyclopedia/calculation-indexes/${digest}.json`;
  let binding:any={version:1,release,digest,key},index:any={version:1,digest,models};
  const storage={readJson:async(p:string)=>p===key?index:binding};
  assert.equal(await restoreReleaseEncyclopedia(storage,root,release),digest);
  const file=path.join(root,'data/knowledge/encyclopedia/calculation-v1.json'),before=await fs.readFile(file,'utf8');
  index={...index,models:{corrupt:[]}};await assert.rejects(restoreReleaseEncyclopedia(storage,root,release),/invalid/);
  assert.equal(await fs.readFile(file,'utf8'),before);
  binding=null;await assert.rejects(restoreReleaseEncyclopedia(storage,root,release),/binding_missing/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
