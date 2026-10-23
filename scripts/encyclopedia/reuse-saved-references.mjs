import fs from 'node:fs/promises';
import {getJsonStorage,mutateDataJson} from '../../apps/web/lib/data.ts';
import {MANIFEST,ROOT,summarize} from '../../apps/web/lib/encyclopedia/records.ts';
import {isEncyclopediaCar} from '../../apps/web/lib/encyclopedia/scope.ts';
import {compileModelFacts,modelKey,checksum} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {planReferenceReuse,revalidateReferenceDonorIndex} from '../../apps/web/lib/encyclopedia/reference-reuse.ts';
import {publishReferencePlans} from './publish-reference-plans.mjs';

const marker=JSON.parse(await fs.readFile('.github/market-runs/encyclopedia-reference-reuse.json','utf8'));
if(!['preview','apply'].includes(marker.mode))throw Error('invalid_reuse_mode');
if(marker.mode==='apply'&&!/^[a-f0-9]{64}$/.test(marker.expectedPlanDigest||''))throw Error('reviewed_plan_required');
const storage=getJsonStorage();if(storage.driver!=='object')throw Error('durable_object_storage_required');
const manifest=await storage.readJson(MANIFEST,null);
if(!manifest?.models?.length)throw Error('encyclopedia_missing');
const identity=m=>m.models.map(x=>[x.id,x.revision,x.key]);
const manifestDigest=checksum(identity(manifest)),rows=manifest.models.filter(isEncyclopediaCar);
const records=new Map(),models={};let cursor=0;
await Promise.all(Array.from({length:6},async()=>{
 for(;;){
  const summary=rows[cursor++];if(!summary)return;
  const record=await storage.readJson(summary.key,null);
  if(record?.revision!==summary.revision||record.id!==summary.id)throw Error('record_revision_mismatch');
  const ancestors=[],visited=new Set([summary.key]);let previous=record.previousKey;
  if(record.variants.some(v=>v.status==='review'&&v.researchEvidence))while(previous&&ancestors.length<128){
   if(!previous.startsWith(`${ROOT}/`)||previous.includes('..')||visited.has(previous))throw Error('invalid_history');
   visited.add(previous);const parent=await storage.readJson(previous,null);
   if(!parent||parent.id!==record.id)throw Error('history_missing');
   ancestors.push(parent);previous=parent.previousKey;
  }
  records.set(summary.id,record);
  const key=modelKey(record.make,record.model),facts=compileModelFacts(record,ancestors);
  if(facts.length)models[key]=[...(models[key]||[]),...facts];
 }
}));
const ordered=Object.fromEntries(Object.keys(models).sort().map(k=>[k,models[k].sort((a,b)=>a.variantId.localeCompare(b.variantId))]));
const index={version:1,createdAt:new Date().toISOString(),manifestDigest,digest:checksum(ordered),models:ordered};
let donorIndex=index;
if(marker.donorSnapshotDigest){
 if(!/^[a-f0-9]{64}$/.test(marker.donorSnapshotDigest))throw Error('invalid_donor_snapshot_digest');
 const saved=await storage.readJson(`knowledge/encyclopedia/calculation-indexes/${marker.donorSnapshotDigest}.json`,null);
 if(saved?.digest!==marker.donorSnapshotDigest)throw Error('reference_donor_snapshot_missing');
 donorIndex=revalidateReferenceDonorIndex(saved,index);
}
const plans=rows.map(summary=>({summary,...planReferenceReuse(records.get(summary.id),donorIndex)})).filter(p=>p.changes.length);
const reviewed=plans.map(p=>({id:p.record.id,revision:p.summary.revision,changes:p.changes.map(c=>{const v=p.record.variants.find(v=>v.id===c.variantId),proof=v.referenceEvidence.at(-1);return {variantId:c.variantId,fields:c.fields,evidenceFields:c.evidenceFields,values:proof.values,provenance:proof.provenance};})}));
const planDigest=checksum({manifestDigest,indexDigest:index.digest,donorIndexDigest:donorIndex.digest,reviewed});
const report={mode:marker.mode,startedAt:index.createdAt,manifestDigest,indexDigest:index.digest,planDigest,modelsRead:rows.length,
 donorIndexDigest:donorIndex.digest,modelsChanged:plans.length,variants:plans.reduce((n,p)=>n+p.changes.length,0),fields:plans.reduce((n,p)=>n+p.changes.reduce((k,c)=>k+c.fields.length,0),0),
 evidenceFields:plans.reduce((n,p)=>n+p.changes.reduce((k,c)=>k+c.evidenceFields.length,0),0),
 models:plans.map(p=>({id:p.record.id,make:p.record.make,model:p.record.model,expectedRevision:p.summary.revision,changes:p.changes})),savedModels:0,savedFields:0};
await fs.mkdir('reports',{recursive:true});
const saveReport=()=>fs.writeFile('reports/encyclopedia-reference-reuse.json',JSON.stringify(report,null,2));
await saveReport();console.log('REFERENCE_REUSE_PLAN',JSON.stringify({...report,models:undefined}));
if(checksum(identity(await storage.readJson(MANIFEST,null)))!==manifestDigest)throw Error('encyclopedia_changed_during_preparation');
if(marker.mode==='apply'){
 if(planDigest!==marker.expectedPlanDigest)throw Error('reference_plan_changed_review_again');
 // Freeze donor evidence before changing recipients; never rebase onto a newer donor.
 const indexKey=`knowledge/encyclopedia/calculation-indexes/${index.digest}.json`;
 if(!await storage.readJson(indexKey,null))await storage.writeJson(indexKey,index,{ifNoneMatch:'*'});
 if(checksum((await storage.readJson(indexKey,null))?.models)!==index.digest)throw Error('reference_index_readback_failed');
 await publishReferencePlans({plans,manifest,storage,root:ROOT,summarize,checksum,
  mutateManifest:update=>mutateDataJson(MANIFEST,null,update),onBatch:async batch=>{
   report.savedModels+=batch.length;report.savedFields+=batch.reduce((n,p)=>n+p.changes.reduce((k,c)=>k+c.fields.length,0),0);
   await saveReport();console.log('REFERENCE_REUSE_PROGRESS',JSON.stringify({savedModels:report.savedModels,savedFields:report.savedFields,models:plans.length}));
  }});
 report.finishedAt=new Date().toISOString();
 await storage.writeJson(`${ROOT}/reference-reuse-runs/${planDigest}.json`,report,{ifNoneMatch:'*'});
 await saveReport();console.log('REFERENCE_REUSE_SAVED',JSON.stringify({...report,models:undefined}));
}
