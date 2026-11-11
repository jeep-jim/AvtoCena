import fs from 'node:fs/promises';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {MANIFEST} from '../../apps/web/lib/encyclopedia/records.ts';
import {isEncyclopediaCar} from '../../apps/web/lib/encyclopedia/scope.ts';
import {checksum,modelKey,applyEncyclopediaCalculation} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {astraPower30FactsForKey} from '../../apps/web/lib/encyclopedia/astra-power30.ts';
import {readCurrentPublicCatalogProjection} from '../../apps/web/lib/catalog/storage.ts';
import {selectWithReportedPrecedents,precedentIdentityKey,precedentModelKeys} from './power30-precedents.mjs';
const marker=JSON.parse(await fs.readFile('.github/market-runs/power30-precedents.json','utf8'));
if(!/^[a-f0-9]{64}$/.test(marker.indexDigest)||marker.mode!=='save_estimates'||!/^20[0-9]{2}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+$/.test(marker.runId))throw Error('invalid_marker');
const storage=getJsonStorage();if(storage.driver!=='object')throw Error('durable_storage_required');
const waitSeconds=marker.waitForPreparedIndexSeconds||0;
if(!Number.isInteger(waitSeconds)||waitSeconds<0||waitSeconds>600)throw Error('invalid_index_wait');
let index=null;const indexDeadline=Date.now()+waitSeconds*1000;
for(;;){
 index=await storage.readJson(`knowledge/encyclopedia/calculation-indexes/${marker.indexDigest}.json`,null);
 if(index||Date.now()>=indexDeadline)break;
 console.log('POWER30_WAIT_FOR_EXACT_PREPARED_INDEX',marker.indexDigest);
 await new Promise(resolve=>setTimeout(resolve,10000));
}
if(index?.digest!==marker.indexDigest||checksum(index.models)!==index.digest)throw Error('index_checksum');
const manifest=await storage.readJson(MANIFEST,null);
const manifestDigest=m=>checksum(m.models.map(x=>[x.id,x.revision,x.key]));
if(manifestDigest(manifest)!==index.manifestDigest)throw Error('manifest_index_mismatch');
const projection=await readCurrentPublicCatalogProjection();
if(!projection.generationId||!Array.isArray(projection.rows))throw Error('missing_projection');
const root=`knowledge/encyclopedia/power30-precedents/runs/${marker.runId}`;
const previous=await storage.readJson(`${root}/manifest.json`,null);
if(previous){if(previous.indexDigest!==index.digest||previous.generationId!==projection.generationId)throw Error('existing_run_different_inputs');console.log('POWER30_PRECEDENTS_ALREADY_SAVED',JSON.stringify(previous.summary));process.exit(0);}
const fields=['year','fuel','powertrainKind','engineCc','powerHp','powerKw','icePowerKw','motorPeakKw','drive','bodyType','engineCode','chassisCode','generation','batteryKwh','power30MinKw','power30MinKwByMotor','powerDataSource','manualEditedAt','calculationSnapshot'];
const reportedFacts=JSON.parse(await fs.readFile('data/catalog/power-reference/reported-power30-precedents.json','utf8'));
const priorityMakes=marker.priorityMakes||[];
if(!Array.isArray(priorityMakes)||priorityMakes.some(m=>typeof m!=='string'||m.length>80))throw Error('invalid_priority_makes');
const priority=make=>{const i=priorityMakes.findIndex(m=>m.toLowerCase()===String(make).toLowerCase());return i<0?priorityMakes.length:i;};
const inventory=new Map();
for(const o of projection.rows){
 const key=modelKey(o.make,o.model),g=inventory.get(key)||{make:o.make,model:o.model,count:0,fuels:{},missing:{}};inventory.set(key,g);g.count++;
 g.fuels[o.fuel||'unknown']=(g.fuels[o.fuel||'unknown']||0)+1;
 for(const f of ['year','fuel','engineCc','drive','bodyType'])if(!o[f]&&!(f==='engineCc'&&o.fuel==='electric'))g.missing[f]=(g.missing[f]||0)+1;
 if(!(o.powerHp>0)&&!(o.powerKw>0))g.missing.power=(g.missing.power||0)+1;
}
const profiles=new Map();
const activeModelKeys=new Set(projection.rows.map(o=>modelKey(o.make,o.model)));
const references=new Map(),resolutions=new Map(),cache=new Map(),bindings=[],perModel=new Map();
const summary={startedAt:new Date().toISOString(),catalog:{checked:0,byStatus:{}},encyclopedia:{models:0,checked:0,byStatus:{}},storageWrites:0,certifiedFieldWrites:0};
const inc=(obj,k)=>obj[k]=(obj[k]||0)+1;
function resolve(o){
 const key=modelKey(o.make,o.model),input=Object.fromEntries(fields.filter(k=>o[k]!==undefined).map(k=>[k,o[k]])),signature=checksum([key,input]);
 if(cache.has(signature))return cache.get(signature);
 const family=precedentModelKeys(precedentIdentityKey(key,o.model),o.fuel);
 const facts=family.keys.flatMap(k=>[...(index.models[k]||[]),...astraPower30FactsForKey(index.models,k)]);
 const result=selectWithReportedPrecedents(o,facts,reportedFacts.filter(f=>family.keys.includes(f.modelKey)));
 if(result.references&&family.regionalNameEvidence)result.regionalNameEvidence=family.regionalNameEvidence;
 if(result.references){result.references=result.references.map(({differences,missing,matches,...reference})=>{const id=checksum(reference);references.set(id,reference);return {id,differences,missing,matches};});}
 const id=checksum(result);resolutions.set(id,result);const resolution={id,status:result.status,inputDigest:signature};cache.set(signature,resolution);
 // Technical inputs are reusable across listing IDs, sellers and price updates.
 const mechanicalInput=Object.fromEntries(Object.entries(input).filter(([k])=>!['calculationSnapshot','manualEditedAt','powerDataSource'].includes(k)));
 if(result.references)profiles.set(checksum([key,mechanicalInput]),{modelKey:key,input:mechanicalInput,resolutionId:id});
 return resolution;
}
function bind(o,target,scope){
 if(!['hybrid','electric'].includes(o.fuel))return;
 const r=resolve(o);summary[scope].checked++;inc(summary[scope].byStatus,r.status);
 const key=modelKey(o.make,o.model),g=perModel.get(key)||{make:o.make,model:o.model,catalog:{},encyclopedia:{}};inc(g[scope],r.status);perModel.set(key,g);
 // Only the derived field, identity and input digest are saved, not commercial feed records.
 bindings.push({...target,inputDigest:r.inputDigest,resolutionId:r.id});
}
for(const raw of projection.rows){
 if(!['electric','hybrid'].includes(raw.fuel))continue;
 const o=applyEncyclopediaCalculation(raw,index);
 bind(o,{scope:'catalog',offerId:raw.id,market:raw.market,modelKey:modelKey(raw.make,raw.model)},'catalog');
}
console.log('POWER30_PRECEDENTS_CATALOG',JSON.stringify(summary.catalog));
const models=manifest.models.filter(m=>isEncyclopediaCar(m)&&activeModelKeys.has(modelKey(m.make,m.model)));let cursor=0;
await Promise.all(Array.from({length:6},async()=>{for(;;){const m=models[cursor++];if(!m)return;
 const record=await storage.readJson(m.key,null);if(record?.revision!==m.revision)throw Error('record_revision_changed');summary.encyclopedia.models++;
 for(const v of record.variants||[]){if(!Number.isInteger(v.year)||v.year<1900)continue;bind({...v,make:record.make,model:record.model},{scope:'encyclopedia',modelId:record.id,variantId:v.id,revision:record.revision,modelKey:modelKey(record.make,record.model)},'encyclopedia');}
 if(summary.encyclopedia.models%500===0)console.log('POWER30_PRECEDENTS_PROGRESS',summary.encyclopedia.models);
}}));
if(manifestDigest(await storage.readJson(MANIFEST,null))!==index.manifestDigest)throw Error('manifest_changed_before_save');
// Stable ordering makes interrupted immutable chunk writes resumable.
bindings.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const parts=[];
async function save(key,value){const prior=await storage.readJson(key,null);if(prior){if(checksum(prior)!==checksum(value))throw Error('immutable_chunk_conflict');}else{await storage.writeJson(key,value,{ifNoneMatch:'*'});summary.storageWrites++;}const saved=await storage.readJson(key,null);if(checksum(saved)!==checksum(value))throw Error('readback_failed');}
for(const [kind,rows] of [['profiles',[...profiles].sort(([a],[b])=>a.localeCompare(b))],['bindings',bindings],['resolutions',[...resolutions].sort(([a],[b])=>a.localeCompare(b))],['references',[...references].sort(([a],[b])=>a.localeCompare(b))]]){
 for(let offset=0;offset<rows.length;offset+=500){const value=rows.slice(offset,offset+500),key=`${root}/${kind}-${String(offset/500).padStart(5,'0')}.json`;await save(key,value);parts.push({kind,key,count:value.length,sha256:checksum(value)});}
 console.log('POWER30_PRECEDENTS_SAVED',kind,rows.length);
}
if(manifestDigest(await storage.readJson(MANIFEST,null))!==index.manifestDigest)throw Error('manifest_changed_before_publication');
summary.finishedAt=new Date().toISOString();summary.bindings=bindings.length;summary.resolutions=resolutions.size;summary.references=references.size;summary.reusableProfiles=profiles.size;summary.activeModelKeys=activeModelKeys.size;
const result={version:2,runId:marker.runId,indexDigest:index.digest,manifestDigest:index.manifestDigest,generationId:projection.generationId,
 policy:'Nearest documented precedent is an estimate requiring confirmation, never certified power. No source model/year/specification or manual value is overwritten.',
 reportedSourcesDigest:checksum(reportedFacts),scope:'models_in_retained_site_catalog',parts,summary:{...summary}};
await save(`${root}/manifest.json`,result);
// The pointer identifies this explicit run only; no production calculation index is changed.
await storage.writeJson(`knowledge/encyclopedia/power30-precedents/checkpoints/${marker.runId}.json`,{key:`${root}/manifest.json`,sha256:checksum(result)},{ifNoneMatch:'*'});
const groups=[...perModel.values()].sort((a,b)=>priority(a.make)-priority(b.make)||Object.values(b.catalog).reduce((x,y)=>x+y,0)-Object.values(a.catalog).reduce((x,y)=>x+y,0)||JSON.stringify(a).localeCompare(JSON.stringify(b)));
const prioritySummary=priorityMakes.map(make=>{const catalog={},matching=groups.filter(g=>g.make.toLowerCase()===make.toLowerCase());for(const g of matching)for(const [status,count]of Object.entries(g.catalog))catalog[status]=(catalog[status]||0)+count;return{make,models:matching.length,catalog};});
const report={...result,groups,prioritySummary,inventoryScope:'retained projection, all fuels; missing raw fields are not proof of missing runtime calculations',inventory:[...inventory.values()].sort((a,b)=>priority(a.make)-priority(b.make)||b.count-a.count),readback:true};
await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/power30-precedents.json',JSON.stringify(report,null,2));
console.log('POWER30_PRECEDENTS_COMPLETE',JSON.stringify({key:`${root}/manifest.json`,summary,readback:true}));
console.log('POWER30_PRIORITY_SUMMARY',JSON.stringify(prioritySummary));
console.log('POWER30_PRECEDENTS_GROUPS',JSON.stringify(report.groups.filter(g=>g.catalog.estimated||g.catalog.range_requires_version).slice(0,50)));
