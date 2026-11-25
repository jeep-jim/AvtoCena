import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createChinaLocalPointerStore} from '../apps/web/lib/catalog/china-local-pointer.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const asOf='2026-11-24T10:24:33.128Z',source='2026-11-24T10:22:41.417Z';
const initial='gen_china_45369451603_1';
const next='gen_china_45369451604_1';
async function prepared(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'china-live-pointer-'));
 const manifest={version:1,kind:'china-local-generation-v1',market:'china',
  generationId:initial,prepared:true,rows:283188,
  pricingReceiptSha256:'a'.repeat(64),pricingAsOf:asOf,
  source:{sourceObservedAt:source,supplierLatestVerified:true}};
 const bytes=Buffer.from(JSON.stringify(manifest));
 await fs.writeFile(path.join(root,'GENERATION.json'),bytes);
 return {root,manifestSha256:sha(bytes)};
}
const pointer=(generationId,manifestSha,revision=2)=>({
 kind:'market-data-pointer-v1',version:1,market:'china',revision,
 active:{market:'china',generationId,manifestSha256:manifestSha,
  pricingContextSha256:'a'.repeat(64),sourceObservedAt:source,
  pricingAsOf:asOf,rowCount:283188,sourceMode:'verified-full'},
 previous:null,changedAt:asOf
});
test('bootstrap reads the exact immutable China generation without requiring a new deploy pointer',async()=>{
 const {root,manifestSha256}=await prepared();
 try{
  const store=createChinaLocalPointerStore({rootDirectory:root,bootstrapManifestSha256:manifestSha256});
  const read=await store.read('china');
  assert.equal(read.value.active.generationId,initial);
  assert.equal(read.value.active.manifestSha256,manifestSha256);
  assert.equal(read.value.active.rowCount,283188);
  assert.equal(await store.directoryFor(read.value.active),root);
  assert.equal(read.etag,null);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('atomic pointer to a new immutable directory selects it without relaunching the app',async()=>{
 const {root,manifestSha256}=await prepared();
 try{
  const store=createChinaLocalPointerStore({rootDirectory:root,bootstrapManifestSha256:manifestSha256});
  const second=pointer(next,'b'.repeat(64));
  await fs.writeFile(path.join(root,'ACTIVE.json'),JSON.stringify(second));
  const read=await store.read('china');
  assert.equal(read.value.active.generationId,next);
  assert.equal(read.value.active.manifestSha256,'b'.repeat(64));
  assert.equal(await store.directoryFor(read.value.active),path.join(root,'versions',next));
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('changed and malformed pointers are refused, without silently falling back',async()=>{
 const {root,manifestSha256}=await prepared();
 try{
  const store=createChinaLocalPointerStore({rootDirectory:root,bootstrapManifestSha256:manifestSha256});
  const file=path.join(root,'ACTIVE.json');
  await fs.writeFile(file,'{not-valid');
  await assert.rejects(store.read('china'),/pointer_json/);
  await fs.writeFile(file,JSON.stringify(pointer('../korea','b'.repeat(64))));
  await assert.rejects(store.read('china'),/generation_market/);
  await fs.rm(file);
  await fs.symlink(path.join(root,'GENERATION.json'),file);
  await assert.rejects(store.read('china'),/file_type/);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('cannot substitute a different bootstrap generation or unknown market',async()=>{
 const {root,manifestSha256}=await prepared();
 try{
  const store=createChinaLocalPointerStore({rootDirectory:root,bootstrapManifestSha256:manifestSha256});
  await assert.rejects(store.read('korea'),/market/);
  await assert.rejects(store.directoryFor(pointer(initial,'b'.repeat(64)).active),/bootstrap_changed/);
  const mismatched=createChinaLocalPointerStore({rootDirectory:root,bootstrapManifestSha256:'b'.repeat(64)});
  await assert.rejects(mismatched.read('china'),/bootstrap_hash/);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
