import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateMarketPointer} from '../../../../scripts/catalog-next/market-data-pointer.mjs';

const SHA=/^[a-f0-9]{64}$/;
const fail=code=>{throw Error('china_local_pointer_'+code)};
const need=(ok,code)=>{if(!ok)fail(code)};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

async function checkedFile(filename,limit){
  const meta=await fs.lstat(filename);
  need(meta.isFile()&&!meta.isSymbolicLink()&&meta.nlink===1&&meta.size>0&&meta.size<=limit,'file_type');
  const bytes=await fs.readFile(filename);
  const after=await fs.lstat(filename);
  need(meta.dev===after.dev&&meta.ino===after.ino&&meta.size===after.size&&meta.mtimeMs===after.mtimeMs,'file_changed');
  return bytes;
}

/**
 * Local read-only view of the accepted China pointer. The host publishes the
 * pointer by atomic rename only AFTER the REG CAS and file validation.
 *
 * With no pointer yet, preserve the exact original independently accepted
 * generation on the existing mount so first-release bootstrap is unchanged.
 */
export function createChinaLocalPointerStore({rootDirectory,bootstrapManifestSha256}={}){
  need(typeof rootDirectory==='string'&&path.isAbsolute(rootDirectory)&&
       SHA.test(bootstrapManifestSha256??''),'config');
  const mount=rootDirectory;
  let initial=null;
  async function baseline(){
    if(initial)return initial;
    need(await fs.realpath(mount)===mount,'root');
    const bytes=await checkedFile(path.join(mount,'GENERATION.json'),1024*1024);
    need(digest(bytes)===bootstrapManifestSha256,'manifest_checksum');
    let manifest;try{manifest=JSON.parse(bytes.toString('utf8'));}catch{fail('bootstrap_json')}
    need(manifest?.kind==='china-local-generation-v1'&&manifest?.version===1&&
      manifest?.market==='china'&&manifest?.prepared===true&&manifest?.source?.supplierLatestVerified===true,
      'bootstrap_manifest');
    const generation={
      market:'china',generationId:manifest.generationId,
      manifestSha256:bootstrapManifestSha256,
      pricingContextSha256:manifest.pricingReceiptSha256,
      sourceObservedAt:manifest.source.sourceObservedAt,
      pricingAsOf:manifest.pricingAsOf,rowCount:manifest.rows,
      sourceMode:'verified-full'
    };
    const pointer={
      kind:'market-data-pointer-v1',version:1,market:'china',revision:1,
      active:generation,previous:null,changedAt:manifest.pricingAsOf
    };
    validateMarketPointer('china',pointer);
    initial=pointer;
    return pointer;
  }
  async function read(market){
    need(market==='china','market');
    const boot=await baseline();
    let bytes;
    try{bytes=await checkedFile(path.join(mount,'ACTIVE.json'),32*1024);}
    catch(error){
      if(error?.code==='ENOENT')return {etag:null,value:boot};
      throw error;
    }
    let document;try{document=JSON.parse(bytes.toString('utf8'));}catch{fail('pointer_json')}
    validateMarketPointer('china',document);
    return {etag:digest(bytes),value:document};
  }
  async function directoryFor(reference){
    need(reference?.market==='china','market');
    const boot=await baseline();
    need(reference?.generationId && SHA.test(reference?.manifestSha256??''),'reference');
    return reference.generationId===boot.active.generationId
      ?(need(reference.manifestSha256===boot.active.manifestSha256,'bootstrap_changed'),mount)
      :path.join(mount,'versions',reference.generationId);
  }
  return Object.freeze({read,directoryFor});
}
