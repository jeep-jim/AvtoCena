import fs from 'node:fs/promises';
import {getJsonStorage,mutateDataJson} from '../../apps/web/lib/data.ts';
import {MANIFEST,ROOT,summarize} from '../../apps/web/lib/encyclopedia/records.ts';
import {isEncyclopediaCar} from '../../apps/web/lib/encyclopedia/scope.ts';
import {compileModelFacts,modelKey,checksum} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {planReferenceReuse} from '../../apps/web/lib/encyclopedia/reference-reuse.ts';

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
const plans=rows.map(summary=>({summary,...planReferenceReuse(records.get(summary.id),index)})).filter(p=>p.changes.length);
const reviewed=plans.map(p=>({id:p.record.id,revision:p.summary.revision,changes:p.changes.map(c=>({variantId:c.variantId,values:Object.fromEntries(c.fields.map(f=>[f,p.record.variants.find(v=>v.id===c.variantId)[f]]))}))}));
const planDigest=checksum({manifestDigest,indexDigest:index.digest,reviewed});
const report={mode:marker.mode,startedAt:index.createdAt,manifestDigest,indexDigest:index.digest,planDigest,modelsRead:rows.length,
 modelsChanged:plans.length,variants:plans.reduce((n,p)=>n+p.changes.length,0),fields:plans.reduce((n,p)=>n+p.changes.reduce((k,c)=>k+c.fields.length,0),0),
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
 const expected=new Map(manifest.models.map(s=>[s.id,s.revision]));
 for(const p of plans){
  const key=`${ROOT}/revisions/${p.record.id}/${p.record.revision}.json`;
  p.record.previousKey=p.summary.key;
  await storage.writeJson(key,p.record,{ifNoneMatch:'*'});
  // Includes every donor revision: concurrent human/research edits stop the pass.
  await mutateDataJson(MANIFEST,null,m=>{
   if(!m||m.models.length!==expected.size||m.models.some(s=>expected.get(s.id)!==s.revision))throw Error('concurrent_encyclopedia_edit');
   return {...m,updatedAt:p.record.updatedAt,models:m.models.map(s=>s.id===p.record.id?summarize(p.record,key):s)};
  });
  expected.set(p.record.id,p.record.revision);
  const saved=await storage.readJson(key,null),current=await storage.readJson(MANIFEST,null);
  if(checksum(saved)!==checksum(p.record)||current.models.find(s=>s.id===saved.id)?.revision!==saved.revision)throw Error('reference_revision_readback_failed');
  report.savedModels++;report.savedFields+=p.changes.reduce((n,c)=>n+c.fields.length,0);await saveReport();
 }
 report.finishedAt=new Date().toISOString();
 await storage.writeJson(`${ROOT}/reference-reuse-runs/${planDigest}.json`,report,{ifNoneMatch:'*'});
 await saveReport();console.log('REFERENCE_REUSE_SAVED',JSON.stringify({...report,models:undefined}));
}
