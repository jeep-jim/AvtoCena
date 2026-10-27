import {randomUUID} from 'node:crypto';
import {getJsonStorage,mutateDataJson} from '../../apps/web/lib/data.ts';
import {ROOT,MANIFEST,summarize} from '../../apps/web/lib/encyclopedia/records.ts';
import {appendMissingObservations} from '../../apps/web/lib/encyclopedia/observations.ts';
const store=getJsonStorage();if(store.driver!=='object')throw Error('durable_object_storage_required');
const baseline=await store.readJson(MANIFEST,null);if(!baseline?.directoryCapturedAt)throw Error('compact_directory_missing');
const prepared=new Map();let cursor=0,removed=0,checked=0;
const candidates=baseline.models.filter(m=>m.directorySnapshot);
await Promise.all(Array.from({length:6},async()=>{for(;;){
 const summary=candidates[cursor++];if(!summary)return;
 const record=await store.readJson(summary.key,null);if(record?.revision!==summary.revision)throw Error('revision_mismatch');
 if(!record.directorySnapshot||!record.previousKey)continue;
 const parent=await store.readJson(record.previousKey,null);
 if(!parent||parent.id!==record.id)throw Error('previous_record_missing');
 // Only the migration's exact append is eligible; never undo later staff edits.
 if(parent.directorySnapshot||JSON.stringify(record.variants.slice(0,parent.variants.length))!==JSON.stringify(parent.variants))continue;
 const added=record.variants.slice(parent.variants.length);if(added.some(v=>v.status!=='observed'))throw Error('unexpected_non_observed_append');
 const variants=appendMissingObservations(parent.variants,added);checked++;
 if(variants.length===record.variants.length)continue;
 const count=record.variants.length-variants.length;removed+=count;
 const next={...record,variants,revision:randomUUID(),updatedAt:new Date().toISOString(),previousKey:summary.key};
 const key=`${ROOT}/revisions/${record.id}/${next.revision}.json`;await store.writeJson(key,next,{ifNoneMatch:'*'});
 prepared.set(summary.id,summarize(next,key));
 console.log(JSON.stringify({modelId:record.id,removedAppendedCollisions:count,originalVariantsPreserved:parent.variants.length}));
}}));
if(prepared.size){
 await store.writeJson(`${ROOT}/directory-backups/${randomUUID()}.json`,baseline,{ifNoneMatch:'*'});
 await mutateDataJson(MANIFEST,null,current=>{
  const revisions=new Map(baseline.models.map(m=>[m.id,m.revision]));
  if(!current||current.models.length!==baseline.models.length||current.models.some(m=>revisions.get(m.id)!==m.revision))throw Error('concurrent_edit_retry_required');
  return {...current,updatedAt:new Date().toISOString(),models:current.models.map(m=>prepared.get(m.id)||m)};
 });
}
console.log(JSON.stringify({repaired:true,models:prepared.size,removedAppendedCollisions:removed,checked,originalsPreserved:true}));
