import {readFile} from 'node:fs/promises';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {digest} from './research-batch.mjs';

// Immutable source evidence only. Never writes the editable encyclopedia or index.
const source=JSON.parse(await readFile(process.argv[2], 'utf8'));
const expected='4bf64b39463737e8bbcd4e4ac939e7927d8c6438bf7cd1b100092add6437ebcf';
if(source.sourceSha256!==expected || source.sourceBytes!==851983508 ||
   source.sourceRows!==616197 || source.selectedMake!==null ||
   source.records?.length!==44829 || source.status!=='source_evidence_only_not_catalog_matched')
  throw Error('astra_snapshot_mismatch');
const storage=getJsonStorage();
if(storage.driver!=='object')throw Error('durable_object_storage_required');
const root=`knowledge/encyclopedia/official-sources/astra/edatenblatt/${expected}`;
async function immutable(key,value){
  const prior=await storage.readJson(key,null);
  if(prior===null)await storage.writeJson(key,value,{ifNoneMatch:'*'});
  if(digest(await storage.readJson(key,null))!==digest(value))throw Error('astra_readback_mismatch:'+key);
}
const shards=[];
for(let offset=0;offset<source.records.length;offset+=250){
  const records=source.records.slice(offset,offset+250);
  const part={version:1,sourceSha256:expected,status:source.status,records};
  const sha256=digest(part),key=`${root}/parts/${sha256}.json`;
  await immutable(key,part);
  shards.push({key,sha256,records:records.length});
  if(shards.length%20===0)console.log('ASTRA_SHARDS_VERIFIED',shards.length);
}
const {records,...metadata}=source;
const manifest={...metadata,shards,recordCount:records.length};
await immutable(`${root}/manifest.json`,manifest);
console.log('ASTRA_DURABLE_EVIDENCE',JSON.stringify({key:`${root}/manifest.json`,records:records.length,shards:shards.length,catalogWrites:0}));
