import {gzipSync,gunzipSync} from 'node:zlib';
const prefix='catalog/collector-state/kcar-registry/';
export const kcarRecoveryPointer=prefix+'current.json';
export async function restoreKcarRecovery(storage,now=Date.now()) {
 const meta=await storage.readJson(kcarRecoveryPointer,null);
 if(!meta || meta.complete || now-Date.parse(meta.startedAt)>86400000)return null;
 if(!/^catalog\/collector-state\/kcar-registry\/archive-\d+\.json\.gz$/.test(meta.key))throw Error('kcar_checkpoint_path_invalid');
 const blob=await storage.getBinary(meta.key);
 if(blob.checksum!==meta.checksum)throw Error('kcar_checkpoint_checksum_mismatch');
 const state=JSON.parse(gunzipSync(blob.data,{maxOutputLength:256*1024*1024}).toString('utf8'));
 if(state.version!==2 || !Array.isArray(state.records))throw Error('kcar_checkpoint_invalid');
 return state;
}
export async function saveKcarRecovery(storage,state) {
 const old=await storage.readJson(kcarRecoveryPointer,null);
 const key=prefix+`archive-${Date.now()}.json.gz`;
 const bytes=gzipSync(Buffer.from(JSON.stringify(state)));
 if(bytes.length>64*1024*1024)throw Error('kcar_checkpoint_size_limit');
 const saved=await storage.putBinary(key,bytes,'application/gzip');
 await storage.writeJson(kcarRecoveryPointer,{version:2,key,checksum:saved.checksum,previousKey:old?.key||null,startedAt:state.startedAt,complete:state.complete,records:state.records.length,savedAt:new Date().toISOString()});
 if(old?.previousKey && /^catalog\/collector-state\/kcar-registry\/archive-\d+\.json\.gz$/.test(old.previousKey))await storage.deleteBinary(old.previousKey);
}
