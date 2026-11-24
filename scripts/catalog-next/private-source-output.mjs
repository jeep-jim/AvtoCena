import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const PRIVATE_SOURCE_FILES=Object.freeze(['dispositions.ndjson','reconciliation.json','source-manifest.json','source.sqlite']);
const HASH=/^[a-f0-9]{64}$/;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const PART_BYTES=8*1024*1024;

export function chinaSourceOutputRoot(owner) {
  assert(/^[1-9]\d{0,19}$/.test(owner?.runId)&&/^[1-9]\d{0,5}$/.test(owner?.attempt)&&
    /^[a-f0-9]{40}$/.test(owner?.revision),'china_source_output_owner');
  return `catalog/market-rebuild/v1/china/runs/${owner.runId}/${owner.attempt}/source`;
}

/** All payloads stay in private object storage. The capability deliberately
 * has no delete, pointer update, provider request or foreign-market method. */
export async function savePrivateChinaSource({storage,owner,directory,sourceManifest,assertCurrent=async()=>{},onProgress=()=>{}}) {
  assert(storage?.driver==='object'&&typeof storage.putBinary==='function'&&typeof storage.getBinary==='function',
    'china_source_output_storage');
  const root=chinaSourceOutputRoot(owner),entries=await fs.readdir(directory,{withFileTypes:true});
  assert.deepEqual(entries.map(row=>row.name).sort(),[...PRIVATE_SOURCE_FILES].sort(),'china_source_output_files');
  assert(entries.every(row=>row.isFile()&&!row.isSymbolicLink()),'china_source_output_type');
  const manifestBytes=await fs.readFile(path.join(directory,'source-manifest.json'));
  assert(same(JSON.parse(manifestBytes.toString('utf8')),sourceManifest),'china_source_output_manifest_changed');
  assert(Array.isArray(sourceManifest.files)&&sourceManifest.files.length===3&&
    [...sourceManifest.files.map(row=>row.name)].sort().join(',')===PRIVATE_SOURCE_FILES.filter(name=>name!=='source-manifest.json').sort().join(',')&&
    sourceManifest.files.every(row=>Number.isSafeInteger(row.bytes)&&row.bytes>0&&HASH.test(row.sha256??'')),
    'china_source_output_manifest_files');
  const files=[];
  for(const name of PRIVATE_SOURCE_FILES) {
    await assertCurrent();
    const filename=path.join(directory,name),stat=await fs.lstat(filename);
    assert(stat.isFile()&&!stat.isSymbolicLink()&&Number.isSafeInteger(stat.size)&&stat.size>0,'china_source_output_file');
    const fd=await fs.open(filename,'r'),hash=createHash('sha256'),parts=[];
    let bytes=0;
    try {
      while(bytes<stat.size) {
        const buffer=Buffer.allocUnsafe(Math.min(PART_BYTES,stat.size-bytes));
        let read=0;
        while(read<buffer.length) {
          const result=await fd.read(buffer,read,buffer.length-read,null);
          assert(result.bytesRead>0,'china_source_output_truncated');read+=result.bytesRead;
        }
        hash.update(buffer);bytes+=buffer.length;
        const sha256=digest(buffer),key=`${root}/files/${name}/${parts.length}-${sha256}`;
        let failure;
        try {await storage.putBinary(key,buffer,'application/octet-stream',{ifNoneMatch:'*'});}catch(error){failure=error;}
        // A lost PUT response is reconciled only by exactly the expected bytes.
        let saved;
        try {saved=await storage.getBinary(key);}catch{throw failure??Error('china_source_output_readback_missing');}
        assert(Buffer.isBuffer(saved?.data)&&saved.data.length===buffer.length&&digest(saved.data)===sha256,
          'china_source_output_readback');
        parts.push({key,bytes:buffer.length,sha256});
        await assertCurrent();
      }
    }finally{await fd.close();}
    const current=await fs.lstat(filename);
    assert(current.size===stat.size&&current.mtimeMs===stat.mtimeMs&&bytes===stat.size,'china_source_output_local_changed');
    const sha256=hash.digest('hex');
    if(name!=='source-manifest.json') {
      const expected=sourceManifest.files.find(row=>row.name===name);
      assert(expected.bytes===bytes&&expected.sha256===sha256,'china_source_output_source_changed');
    }else assert(sha256===digest(manifestBytes),'china_source_output_source_changed');
    files.push({name,bytes,sha256,parts});
    onProgress({phase:'private_source_file_saved',file:name,bytes,parts:parts.length});
  }
  assert(files.every(row=>HASH.test(row.sha256)),'china_source_output_digest');
  const receipt={version:1,kind:'china-rebuild-saved-source',market:'china',owner,root,
    sourceManifestSha256:digest(manifestBytes),files,totalBytes:files.reduce((sum,row)=>sum+row.bytes,0),
    published:false,sourceApiCalls:0,liveCatalogWrites:0,deletions:0};
  const completeBytes=Buffer.from(JSON.stringify(receipt)),key=root+'/complete.json';
  await assertCurrent();
  let failure;
  try {await storage.putBinary(key,completeBytes,'application/json',{ifNoneMatch:'*'});}catch(error){failure=error;}
  let complete;
  try {complete=await storage.getBinary(key);}catch{throw failure??Error('china_source_output_complete_missing');}
  assert(Buffer.isBuffer(complete?.data)&&digest(complete.data)===digest(completeBytes),'china_source_output_complete_readback');
  await assertCurrent();
  return {...receipt,receiptSha256:digest(completeBytes)};
}
