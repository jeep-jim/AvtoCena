import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {getJsonStorage,mutateDataJson} from '../../apps/web/lib/data.ts';
import {MANIFEST,ROOT,summarize} from '../../apps/web/lib/encyclopedia/records.ts';
import {repairSavedModelMetadata} from './saved-model-metadata.ts';
const marker=JSON.parse(await fs.readFile('.github/market-runs/encyclopedia-snapshot.json','utf8'));
if(marker.targetAt!=='2026-10-31T13:53:42.224Z'||marker.apply!==true)throw Error('explicit_repair_target_required');
const storage=getJsonStorage();if(storage.driver!=='object')throw Error('durable_object_storage_required');
const baseline=await storage.readJson(MANIFEST,null);if(!baseline)throw Error('encyclopedia_missing');
const changed=new Map(),removed=new Set(),report={metadataRepaired:0,excluded:[],existingValuesPreserved:true};
for(const summary of baseline.models){
 if(summary.directorySnapshot?.capturedAt!==marker.targetAt||summary.directorySnapshot.count!==undefined)continue;
 const record=await storage.readJson(summary.key,null);if(!record||record.revision!==summary.revision)throw Error('encyclopedia_revision_mismatch');
 const repair=repairSavedModelMetadata(record,marker.targetAt);if(!repair)throw Error('repair_record_mismatch');
 if(repair.exclude){removed.add(summary.id);report.excluded.push({make:record.make,model:record.model});continue;}
 const next={...repair.record,revision:randomUUID(),updatedAt:new Date().toISOString(),previousKey:summary.key};
 const key=`${ROOT}/revisions/${record.id}/${next.revision}.json`;await storage.writeJson(key,next,{ifNoneMatch:'*'});
 changed.set(summary.id,summarize(next,key));report.metadataRepaired++;
}
if(changed.size||removed.size){
 await storage.writeJson(`${ROOT}/directory-backups/${randomUUID()}.json`,baseline,{ifNoneMatch:'*'});
 await mutateDataJson(MANIFEST,null,current=>{
  const revisions=new Map(baseline.models.map(m=>[m.id,m.revision]));
  if(!current||current.models.length!==baseline.models.length||current.models.some(m=>revisions.get(m.id)!==m.revision))throw Error('concurrent_edit_retry_required');
  return {...current,updatedAt:new Date().toISOString(),models:current.models.filter(m=>!removed.has(m.id)).map(m=>changed.get(m.id)||m)};
 });
}
await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/encyclopedia-saved-variants.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
