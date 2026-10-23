import fs from 'node:fs/promises';
import path from 'node:path';
import {getJsonStorage,getDataRoot} from '../../apps/web/lib/data.ts';
import {MANIFEST,ROOT} from '../../apps/web/lib/encyclopedia/records.ts';
import {isEncyclopediaCar} from '../../apps/web/lib/encyclopedia/scope.ts';
import {CALCULATION_INDEX_PATH,compileModelFacts,modelKey,checksum} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {modelCoverage,summarizeCoverage} from './coverage.mjs';
const storage=getJsonStorage();
if(storage.driver!=='object')throw Error('durable_object_storage_required');
const manifest=await storage.readJson(MANIFEST,null);
if(!manifest?.models?.length)throw Error('encyclopedia_missing');
const models={},report={modelsRead:0,variants:0,factoryFields:0,ownerReferenceFields:0,manualFields:0};
const rows=manifest.models.filter(isEncyclopediaCar);let cursor=0;
const coverageModels=[];
await Promise.all(Array.from({length:6},async()=>{
 for(;;){
  const summary=rows[cursor++];if(!summary)return;
  const record=await storage.readJson(summary.key,null);
  if(record?.revision!==summary.revision||record.id!==summary.id)throw Error('encyclopedia_revision_mismatch');
  const ancestors=[],visited=new Set([summary.key]);let previous=record.previousKey;
  if(record.variants.some(v=>v.status==='review'&&v.researchEvidence))while(previous&&ancestors.length<128){
   if(!previous.startsWith(`${ROOT}/`)||previous.includes('..')||visited.has(previous))throw Error('invalid_encyclopedia_history');
   visited.add(previous);const parent=await storage.readJson(previous,null);
   if(!parent||parent.id!==record.id)throw Error('encyclopedia_history_missing');
   ancestors.push(parent);previous=parent.previousKey;
  }
  const facts=compileModelFacts(record,ancestors),key=modelKey(record.make,record.model);
  coverageModels.push(modelCoverage(record,facts));
  if(facts.length)models[key]=[...(models[key]||[]),...facts];
  report.modelsRead++;report.variants+=facts.length;
  for(const fact of facts)for(const source of Object.values(fact.sources))report[source.kind==='owner_reference'?'ownerReferenceFields':source.kind==='manual'?'manualFields':'factoryFields']++;
  if(report.modelsRead%250===0)console.log(JSON.stringify({stage:'encyclopedia_index',modelsRead:report.modelsRead}));
 }
}));
const identity=m=>m.models.map(x=>[x.id,x.revision,x.key]);
const manifestDigest=checksum(identity(manifest));
if(checksum(identity(await storage.readJson(MANIFEST,null)))!==manifestDigest)throw Error('encyclopedia_changed_during_preparation');
const ordered=Object.fromEntries(Object.keys(models).sort().map(k=>[k,models[k].sort((a,b)=>a.variantId.localeCompare(b.variantId))]));
const index={version:1,createdAt:new Date().toISOString(),manifestDigest,digest:checksum(ordered),models:ordered};
const target=path.join(getDataRoot(),CALCULATION_INDEX_PATH);
await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,JSON.stringify(index));
const key=`knowledge/encyclopedia/calculation-indexes/${index.digest}.json`;
const prior=await storage.readJson(key,null);
if(!prior)await storage.writeJson(key,index,{ifNoneMatch:'*'});
const saved=await storage.readJson(key,null);
if(saved?.digest!==index.digest||checksum(saved.models)!==index.digest)throw Error('encyclopedia_index_readback_failed');
const release=process.env.GITHUB_SHA;
if(release&&/^[a-f0-9]{40}$/.test(release)){
 const bindingKey=`knowledge/encyclopedia/calculation-releases/${release}.json`;
 const old=await storage.readJson(bindingKey,null);
 if(old&&old.digest!==index.digest)throw Error('release_encyclopedia_binding_changed');
 if(!old)await storage.writeJson(bindingKey,{version:1,release,digest:index.digest,key},{ifNoneMatch:'*'});
 if((await storage.readJson(bindingKey,null))?.digest!==index.digest)throw Error('release_encyclopedia_binding_readback_failed');
}
console.log(JSON.stringify({stage:'encyclopedia_index_ready',...report,digest:index.digest,manifestDigest,readback:true}));
const coverage=summarizeCoverage(coverageModels,{createdAt:index.createdAt,indexDigest:index.digest,manifestDigest});
await fs.mkdir('reports',{recursive:true});
await fs.writeFile('reports/encyclopedia-coverage.json',JSON.stringify(coverage,null,2));
console.log(JSON.stringify({stage:'encyclopedia_coverage',...coverage.total,reportPath:'reports/encyclopedia-coverage.json'}));
