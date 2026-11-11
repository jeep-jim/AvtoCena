import fs from 'node:fs/promises';
import {getJsonStorage,mutateDataJson} from '../../apps/web/lib/data.ts';
import {MANIFEST,ROOT,summarize} from '../../apps/web/lib/encyclopedia/records.ts';
import {isEncyclopediaCar} from '../../apps/web/lib/encyclopedia/scope.ts';
import {validateBatch,planModelResearch,digest} from './research-batch.mjs';
const markerArg=process.argv.find(a=>a.startsWith('--marker='))?.slice(9);
if(markerArg&&!/^docs\/encyclopedia\/japan-chassis-drive-2026-10-25\/apply-\d{4}\.json$/.test(markerArg))throw Error('invalid_marker_path');
const marker=JSON.parse(await fs.readFile(markerArg||'.github/market-runs/encyclopedia-research.json','utf8'));
if(!/^docs\/encyclopedia\/batches\/[a-z0-9-]+\.json$/.test(marker.batch))throw Error('invalid_batch_path');
const batch=validateBatch(JSON.parse(await fs.readFile(marker.batch,'utf8')));
if(digest(batch)!==marker.sha256)throw Error('batch_review_digest_mismatch');
const storage=getJsonStorage();if(storage.driver!=='object')throw Error('durable_object_storage_required');
const dryRun=process.argv.includes('--dry-run'),report={batch:batch.id,dryRun,models:[],startedAt:new Date().toISOString()};
for(const id of [...new Set(batch.entries.map(e=>e.modelId))]){
 const manifest=await storage.readJson(MANIFEST,null),summary=manifest?.models.find(m=>m.id===id);
 if(!summary||!isEncyclopediaCar(summary)){report.models.push({id,skipped:'model_missing_or_excluded'});continue;}
 const current=await storage.readJson(summary.key,null);if(!current||current.revision!==summary.revision)throw Error('record_revision_mismatch');
 const result=planModelResearch(current,batch.entries.filter(e=>e.modelId===id),batch);
 if(result.changes.length&&!dryRun){
  result.record.previousKey=summary.key;
  const key=`${ROOT}/revisions/${id}/${result.record.revision}.json`;
  await storage.writeJson(key,result.record,{ifNoneMatch:'*'});
  try{await mutateDataJson(MANIFEST,null,m=>{
   if(!m||m.models.find(x=>x.id===id)?.revision!==current.revision)throw Error('concurrent_editor_change');
   return {...m,updatedAt:result.record.updatedAt,models:m.models.map(x=>x.id===id?summarize(result.record,key):x)};
  });}catch(error){if(error.message==='concurrent_editor_change'){report.models.push({id,skipped:'concurrent_editor_change'});continue;}throw error;}
  const confirmed=await storage.readJson(MANIFEST,null),saved=await storage.readJson(key,null);
  if(confirmed.models.find(x=>x.id===id)?.revision!==saved?.revision)throw Error('publication_changed_before_verification');
 }
 report.models.push({id,changes:result.changes,skipped:result.skipped});
}
report.finishedAt=new Date().toISOString();
if(!dryRun)await storage.writeJson(`${ROOT}/research-runs/${batch.id}/${Date.now()}.json`,report,{ifNoneMatch:'*'});
console.log(JSON.stringify(report));
