import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
const CHUNK=16*1024*1024;
const sha=b=>createHash('sha256').update(b).digest('hex');
const prefix='catalog/provider-replicas/che168/';
/** Working inventory is immutable until its descriptor is committed together
 * with the successful publication cursor. No public database writes here. */
export async function saveChe168Replica({storage,filename,binding,cursor}) {
  const key=`${prefix}${randomUUID()}`,file=await fs.open(filename,'r'),parts=[];
  try {
    let offset=0;
    while(true) {
      const buffer=Buffer.alloc(CHUNK),{bytesRead}=await file.read(buffer,0,CHUNK,offset);
      if(!bytesRead)break;
      const raw=buffer.subarray(0,bytesRead),index=parts.length;
      await storage.putBinary(`${key}/${index}.gz`,gzipSync(raw,{level:1}),'application/gzip');
      parts.push({bytes:bytesRead,sha256:sha(raw)});offset+=bytesRead;
    }
    const manifest={version:1,binding,cursor,bytes:offset,parts};
    await storage.writeJson(`${key}/manifest.json`,manifest);
    return {key,sha256:sha(JSON.stringify(manifest)),binding,cursor};
  }finally{await file.close();}
}
export async function restoreChe168Replica({storage,filename,descriptor,binding,cursor}) {
  if(!new RegExp(`^${prefix}[a-f0-9-]{36}$`).test(descriptor?.key)||descriptor.binding!==binding||descriptor.cursor!==cursor)throw Error('auto_api_invalid_replica');
  const manifest=await storage.readJson(`${descriptor.key}/manifest.json`,null);
  if(!manifest||sha(JSON.stringify(manifest))!==descriptor.sha256||manifest.version!==1||manifest.binding!==binding||manifest.cursor!==cursor
    ||!Array.isArray(manifest.parts)||!manifest.parts.length||manifest.parts.length>1024)throw Error('auto_api_invalid_replica');
  const file=await fs.open(filename,'wx');let bytes=0;
  try {
    for(let index=0;index<manifest.parts.length;index++) {
      const part=manifest.parts[index],raw=gunzipSync((await storage.getBinary(`${descriptor.key}/${index}.gz`)).data,{maxOutputLength:CHUNK});
      if(raw.length!==part.bytes||sha(raw)!==part.sha256)throw Error('auto_api_invalid_replica_part');
      await file.writeFile(raw);bytes+=raw.length;
    }
    if(bytes!==manifest.bytes)throw Error('auto_api_invalid_replica_size');
  }finally{await file.close();}
}
