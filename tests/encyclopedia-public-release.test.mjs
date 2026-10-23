import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const script=path.resolve('scripts/encyclopedia/verify-public-release.mjs');
const tsx=import.meta.resolve('tsx');
for(const scenario of ['success','wrong-field','changed-release'])test('public release gate '+scenario,async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'astra-public-'));
 try{
  await fs.mkdir(path.join(root,'.github/market-runs'),{recursive:true});await fs.mkdir(path.join(root,'docs/encyclopedia/batches'),{recursive:true});
  await fs.writeFile(path.join(root,'.github/market-runs/regcloud-deploy.json'),JSON.stringify({publicResearchBatches:['docs/encyclopedia/batches/test.json']}));
  await fs.writeFile(path.join(root,'docs/encyclopedia/batches/test.json'),JSON.stringify({entries:[{modelId:'model',variantId:'variant',year:2026,patch:{power30MinKw:37}}]}));
  const mock=path.join(root,'mock.mjs');await fs.writeFile(mock,`let calls=0;globalThis.fetch=async url=>({ok:true,json:async()=>url.endsWith('/api/health')?{releaseSha:(++calls>1&&${JSON.stringify(scenario)}==='changed-release')?'b'.repeat(40):'a'.repeat(40)}:{id:'model',variants:[{id:'variant',year:2026,power30MinKw:${scenario==='wrong-field'?99:37}}]}});`);
  const r=spawnSync(process.execPath,['--import',tsx,'--import',mock,script],{cwd:root,env:{...process.env,GITHUB_SHA:'a'.repeat(40)},encoding:'utf8'});
  if(scenario==='success'){assert.equal(r.status,0,r.stderr);const v=JSON.parse(await fs.readFile(path.join(root,'reports/encyclopedia-public-release.json')));assert.equal(v.verified,true);assert.equal(v.fields,1);}
  else{assert.notEqual(r.status,0);assert.match(r.stderr,new RegExp(scenario==='wrong-field'?'public_field_mismatch':'public_release_changed'));}
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
