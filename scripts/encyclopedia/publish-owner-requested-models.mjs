import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {getJsonStorage,mutateDataJson} from '../../apps/web/lib/data.ts';
import {MANIFEST,ROOT,summarize} from '../../apps/web/lib/encyclopedia/records.ts';
import {publishOwnerRequestedModel} from './saved-model-metadata.ts';
const marker=JSON.parse(await fs.readFile('.github/market-runs/encyclopedia-snapshot.json','utf8'));
if(marker.targetAt!=='2026-10-31T13:53:42.224Z'||marker.apply!==true)throw Error('explicit_repair_target_required');
const storage=getJsonStorage();if(storage.driver!=='object')throw Error('durable_object_storage_required');
const baseline=await storage.readJson(MANIFEST,null);if(!baseline)throw Error('encyclopedia_missing');
const candidates=baseline.models.filter(m=>!m.directorySnapshot&&!m.manualCreated&&m.updatedAt.startsWith('2026-10-31T14:15:'));
if(candidates.length!==0&&candidates.length!==29)throw Error('owner_addition_candidate_count_changed');
const changed=new Map(),models=[];
for(const summary of candidates){
 const record=await storage.readJson(summary.key,null);if(!record||record.revision!==summary.revision||!record.previousKey?.startsWith(`${ROOT}/revisions/`))throw Error('encyclopedia_revision_mismatch');
 const parent=await storage.readJson(record.previousKey,null);if(!parent)throw Error('repair_parent_missing');
 const next={...publishOwnerRequestedModel(record,parent,marker.targetAt),revision:randomUUID(),updatedAt:new Date().toISOString(),previousKey:summary.key};
 const key=`${ROOT}/revisions/${record.id}/${next.revision}.json`;await storage.writeJson(key,next,{ifNoneMatch:'*'});changed.set(summary.id,summarize(next,key));models.push({make:next.make,model:next.model});
}
if(changed.size){
 await storage.writeJson(`${ROOT}/directory-backups/${randomUUID()}.json`,baseline,{ifNoneMatch:'*'});
 await mutateDataJson(MANIFEST,null,current=>{
  const revisions=new Map(baseline.models.map(m=>[m.id,m.revision]));
  if(!current||current.models.length!==baseline.models.length||current.models.some(m=>revisions.get(m.id)!==m.revision))throw Error('concurrent_edit_retry_required');
  return {...current,updatedAt:new Date().toISOString(),models:current.models.map(m=>changed.get(m.id)||m)};
 });
}
const report={publishedOwnerRequestedModels:changed.size,models,existingValuesPreserved:true,unknownCountsPreserved:true};
await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/encyclopedia-saved-variants.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
