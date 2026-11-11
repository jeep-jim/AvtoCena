import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
const pointer='catalog/collector-state/proauctions/current.json';
const archiveKey=/^catalog\/collector-state\/proauctions\/archive-\d+(?:-[a-f0-9-]+)?\.(?:tgz|json)$/;
let lastSaved=0;
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function archiveParts(storage, metadata) {
 if(!archiveKey.test(metadata?.key||''))throw Error('invalid_checkpoint_archive');
 const object=await storage.getBinary(metadata.key);
 if(object.checksum!==metadata.checksum)throw Error('checkpoint_checksum_mismatch');
 if(metadata.version!==2)return {legacy:object.data};
 const value=JSON.parse(object.data.toString('utf8'));
 const prefix=metadata.key.replace(/\.json$/, '/');
 if(value.version!==2||!Array.isArray(value.parts)||!value.parts.length||value.parts.length>256
   ||value.parts.some((part,index)=>part.key!==`${prefix}${String(index).padStart(4,'0')}.bin`||!Number.isSafeInteger(part.size)||part.size<1||part.size>64*1024*1024||!/^[a-f0-9]{64}$/.test(part.checksum)))throw Error('invalid_checkpoint_parts');
 return value;
}
async function removeArchive(storage,key) {
 if(!archiveKey.test(key||''))return;
 if(key.endsWith('.json')){
  const obj=await storage.getBinary(key);
  const parts=await archiveParts(storage,{version:2,key,checksum:obj.checksum});
  for(const part of parts.parts)await storage.deleteBinary(part.key);
 }
 await storage.deleteBinary(key);
}
// Immutable bounded objects first, CAS pointer last. No whole archive in RAM.
// Failed uploads leave the last good checkpoint and its predecessor untouched.
export async function saveProAuctionsState(root,state,force=false) {
 if(process.env.PROAUCTIONS_DURABLE!=='1'||(!force&&Date.now()-lastSaved<900000))return;
 const storage=getJsonStorage(),old=await storage.readJsonWithMeta(pointer,null);
 const key=`catalog/collector-state/proauctions/archive-${Date.now()}-${crypto.randomUUID()}.json`;
 const temp=`${root}.checkpoint.tgz`;
 execFileSync('tar',['-czf',temp,'-C',root,'.']);
 const partBytes=Math.max(65536,Math.min(64*1024*1024,Number(process.env.PROAUCTIONS_CHECKPOINT_PART_BYTES)||64*1024*1024));
 const parts=[],hash=crypto.createHash('sha256');let size=0;
 const file=await fs.open(temp,'r');
 try{
  while(true){
   const buffer=Buffer.allocUnsafe(partBytes);const {bytesRead}=await file.read(buffer,0,partBytes,null);if(!bytesRead)break;
   if(parts.length>=256)throw Error('proauctions_checkpoint_part_limit');
   const bytes=buffer.subarray(0,bytesRead);hash.update(bytes);size+=bytesRead;
   const partKey=`${key.replace(/\.json$/,'/')}${String(parts.length).padStart(4,'0')}.bin`;
   const saved=await storage.putBinary(partKey,bytes,'application/octet-stream',{ifNoneMatch:'*'});
   parts.push({key:partKey,size:bytesRead,checksum:saved.checksum});
  }
  const descriptor=Buffer.from(JSON.stringify({version:2,size,checksum:hash.digest('hex'),parts}));
  const saved=await storage.putBinary(key,descriptor,'application/json',{ifNoneMatch:'*'});
  await storage.writeJson(pointer,{version:2,key,checksum:saved.checksum,previousKey:old.value?.key||null,startedAt:state.startedAt,complete:state.complete,published:false,stopReason:state.stopReason,details:state.details,prepared:state.prepared,savedAt:new Date().toISOString()},old.found?{ifMatch:old.etag}:{ifNoneMatch:'*'});
  lastSaved=Date.now();
  // Cleanup is best effort AFTER commit; it must never turn a saved checkpoint into failure.
  if(old.value?.previousKey)try{await removeArchive(storage,old.value.previousKey);}catch(e){console.warn('checkpoint_old_archive_cleanup_deferred',String(e.message));}
 }finally{await file.close();await fs.rm(temp,{force:true});}
}
export async function restoreProAuctionsState(root,metadata) {
 const storage=getJsonStorage(),archive=await archiveParts(storage,metadata);
 const temp=`${root}.restore.tgz`;
 try{
  if(archive.legacy)await fs.writeFile(temp,archive.legacy);
  else{
   const file=await fs.open(temp,'w');const hash=crypto.createHash('sha256');let size=0;
   try{for(const part of archive.parts){const bytes=await storage.getBinary(part.key);if(bytes.size!==part.size||bytes.checksum!==part.checksum)throw Error('checkpoint_part_checksum_mismatch');await file.writeFile(bytes.data);hash.update(bytes.data);size+=bytes.size;}}finally{await file.close();}
   if(size!==archive.size||hash.digest('hex')!==archive.checksum)throw Error('checkpoint_archive_checksum_mismatch');
  }
  const names=execFileSync('tar',['-tzf',temp],{encoding:'utf8',maxBuffer:32*1024*1024}).split('\n').filter(Boolean);
  if(names.some(name=>name.startsWith('/')||name.split('/').includes('..')))throw Error('unsafe_checkpoint_path');
  const listing=execFileSync('tar',['-tvzf',temp],{encoding:'utf8',maxBuffer:64*1024*1024});
  if(listing.split('\n').filter(Boolean).some(line=>!['-','d'].includes(line[0])))throw Error('unsafe_checkpoint_entry_type');
  await fs.mkdir(root,{recursive:true});execFileSync('tar',['-xzf',temp,'--no-same-owner','--no-same-permissions','-C',root]);
 }finally{await fs.rm(temp,{force:true});}
}
export {pointer as proAuctionsStateKey};
