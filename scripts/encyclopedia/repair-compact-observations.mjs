import {randomUUID} from 'node:crypto';
import {getJsonStorage,mutateDataJson} from '../../apps/web/lib/data.ts';
import {ROOT,MANIFEST,summarize} from '../../apps/web/lib/encyclopedia/records.ts';
import {compactObservationRepair} from '../../apps/web/lib/encyclopedia/observations.ts';
const store=getJsonStorage();if(store.driver!=='object')throw Error('durable_object_storage_required');
const baseline=await store.readJson(MANIFEST,null);if(!baseline?.directoryCapturedAt)throw Error('compact_directory_missing');
const prepared=new Map();let cursor=0,removed=0,checked=0,ancestryRepaired=0;
const candidates=baseline.models.filter(m=>m.directorySnapshot);
await Promise.all(Array.from({length:6},async()=>{for(;;){
 const summary=candidates[cursor++];if(!summary)return;
 const record=await store.readJson(summary.key,null);if(record?.revision!==summary.revision)throw Error('revision_mismatch');
 if(!record.directorySnapshot||!record.previousKey)continue;
 const parent=await store.readJson(record.previousKey,null);
 if(!parent||parent.id!==record.id)throw Error('previous_record_missing');
 const ancestor=parent.directorySnapshot&&parent.previousKey?await store.readJson(parent.previousKey,null):null;
 const plan=compactObservationRepair(record,parent,ancestor);checked++;
 if(!plan)continue;
 removed+=plan.removed;if(plan.ancestryRepaired)ancestryRepaired++;
 const supersededSnapshotKeys=[...new Set([...(record.supersededSnapshotKeys||[]),summary.key,...(plan.ancestryRepaired?[record.previousKey]:[])])];
 const next={...record,variants:plan.variants,revision:randomUUID(),updatedAt:new Date().toISOString(),previousKey:plan.previousKey,supersededSnapshotKeys};
 const key=`${ROOT}/revisions/${record.id}/${next.revision}.json`;await store.writeJson(key,next,{ifNoneMatch:'*'});
 prepared.set(summary.id,summarize(next,key));
 console.log(JSON.stringify({modelId:record.id,removedAppendedCollisions:plan.removed,ancestryRepaired:plan.ancestryRepaired,originalVariantsPreserved:(ancestor||parent).variants.length}));
}}));
if(prepared.size){
 await store.writeJson(`${ROOT}/directory-backups/${randomUUID()}.json`,baseline,{ifNoneMatch:'*'});
 await mutateDataJson(MANIFEST,null,current=>{
  const revisions=new Map(baseline.models.map(m=>[m.id,m.revision]));
  if(!current||current.models.length!==baseline.models.length||current.models.some(m=>revisions.get(m.id)!==m.revision))throw Error('concurrent_edit_retry_required');
  return {...current,updatedAt:new Date().toISOString(),models:current.models.map(m=>prepared.get(m.id)||m)};
 });
}
console.log(JSON.stringify({repaired:true,models:prepared.size,removedAppendedCollisions:removed,ancestryRepaired,checked,originalsPreserved:true}));
