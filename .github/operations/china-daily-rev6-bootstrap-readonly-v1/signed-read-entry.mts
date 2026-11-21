/** Isolated protected read process only. All output is an explicitly selected aggregate. */
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {previewNativeRev6Bootstrap} from './native-bootstrap-preview.mts';
const fail=(k:string):never=>{throw Error('china_daily_rev6_read_entry:'+k);};
const h=(x:Buffer)=>createHash('sha256').update(x).digest('hex');
const sha256=/^[a-f0-9]{64}$/,rawSha='5027a27aa7cb949564aba8e586e7c27c84288e08e68677663c6a1ae2d14215e3';
async function verified(name:string,max:number,hash?:string){
 if(!name||!path.isAbsolute(name)||path.normalize(name)!==name)fail('pinned_input');
 const fd=await open(name,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=await fd.stat();
  if(!s.isFile()||s.size<1||s.size>max||s.nlink!==1)fail('pinned_input');
  const b=await fd.readFile();if(b.length!==s.size||hash&&h(b)!==hash)fail('pinned_input_hash');return b;
 }finally{await fd.close();}
}
try{
 if(process.argv.length!==4||'GITHUB_TOKEN' in process.env||'AUTO_API_CHE168_KEY' in process.env||
  process.env.GITHUB_JOB!=='observe'||process.env.GITHUB_EVENT_NAME!=='push'||process.env.JSON_STORAGE_DRIVER!=='object'||
  process.env.CATALOG_STORAGE_TIMING==='1')fail('isolated_read_only_process');
 const snapshot=await verified(process.argv[2],128*1024),name=process.argv[3];
 await verified(name,128*1024,rawSha);
 const raw=await import(pathToFileURL(name).href),result=await previewNativeRev6Bootstrap(snapshot,raw);
 const {kind,generationId,cursor,receiptSha256,readObjects,compressedBytesRead,replicaParts,loadedReplicaBodies,providerRequests,storageWrites}=result.report;
 if(kind!=='china_daily_rev6_bootstrap_metadata_verified'||cursor!==13196544||!sha256.test(receiptSha256)||readObjects!==6||loadedReplicaBodies!==0||
   providerRequests!==0||storageWrites!==0||result.network.providerRequests!==0||result.network.storageWrites!==0)fail('safe_result_projection');
 console.log(JSON.stringify({kind,generationId,cursor,receiptSha256,readObjects,compressedBytesRead,replicaParts,loadedReplicaBodies,
  totalSignedGets:result.network.reads,totalSignedBytes:result.network.bytes,providerRequests:0,storageWrites:0,publicationAuthorized:false,cursorAdvanceAuthorized:false}));
}catch (error){
 const e=error as NodeJS.ErrnoException,m=e?.message??'';
 const reason=/^china_daily_(?:rev6_bootstrap|native_bootstrap|rev6_read_entry):[a-z0-9_]{1,80}$/.test(m)?m:
  /^china_own_regcloud:[a-z0-9_]{1,70}$/.test(m)?m:/^object_storage_(?:binary_read|control_read)_\d{3}(?:$|:)/.test(m)?m.split(':')[0]:
  ['TimeoutError','AbortError'].includes(e?.name??'')?'bounded_timeout':'native_reader_held';
 console.error(JSON.stringify({kind:'china_daily_rev6_bootstrap_held',reason,providerRequests:0,storageWrites:0,publicationAuthorized:false,cursorAdvanceAuthorized:false}));
 process.exitCode=3;
}
