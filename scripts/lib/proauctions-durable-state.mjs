import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
const pointer='catalog/collector-state/proauctions/current.json';
let lastSaved=0;
// Immutable archive first, pointer last. The previous archive survives interrupted writes.
export async function saveProAuctionsState(root,state,force=false) {
 if (process.env.PROAUCTIONS_DURABLE !== '1' || (!force && Date.now()-lastSaved<900000)) return;
 const storage=getJsonStorage();
 const old=await storage.readJson(pointer,null);
 const key=`catalog/collector-state/proauctions/archive-${Date.now()}.tgz`;
 const temp=`${root}.checkpoint.tgz`;
 execFileSync('tar',['-czf',temp,'-C',root,'.']);
 const bytes=await fs.readFile(temp);
 if(bytes.length>512*1024*1024)throw Error('proauctions_checkpoint_exceeds_512mb');
 const saved=await storage.putBinary(key,bytes,'application/gzip');
 await storage.writeJson(pointer,{version:1,key,checksum:saved.checksum,previousKey:old?.key||null,startedAt:state.startedAt,complete:state.complete,published:false,stopReason:state.stopReason,details:state.details,prepared:state.prepared,savedAt:new Date().toISOString()});
 // Keep two generations; deletion is limited to the former previous archive.
 if(old?.previousKey && /^catalog\/collector-state\/proauctions\/archive-\d+\.tgz$/.test(old.previousKey)) await storage.deleteBinary(old.previousKey);
 await fs.rm(temp,{force:true});lastSaved=Date.now();
}
export async function restoreProAuctionsState(root,metadata) {
 if(!/^catalog\/collector-state\/proauctions\/archive-\d+\.tgz$/.test(metadata?.key||''))throw Error('invalid_checkpoint_archive');
 const bytes=await getJsonStorage().getBinary(metadata.key);
 if(bytes.checksum!==metadata.checksum)throw Error('checkpoint_checksum_mismatch');
 const temp=`${root}.restore.tgz`;await fs.writeFile(temp,bytes.data);
 const names=execFileSync('tar',['-tzf',temp],{encoding:'utf8',maxBuffer:32*1024*1024}).split('\n').filter(Boolean);
 if(names.some(name=>name.startsWith('/') || name.split('/').includes('..')))throw Error('unsafe_checkpoint_path');
 await fs.mkdir(root,{recursive:true});execFileSync('tar',['-xzf',temp,'-C',root]);await fs.rm(temp,{force:true});
}
export {pointer as proAuctionsStateKey};
