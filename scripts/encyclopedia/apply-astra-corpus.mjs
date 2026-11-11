import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGunzip} from 'node:zlib';
import path from 'node:path';
import readline from 'node:readline';
import {pathToFileURL} from 'node:url';
import {getJsonStorage,mutateDataJson} from '../../apps/web/lib/data.ts';
import {ROOT,MANIFEST,summarize} from '../../apps/web/lib/encyclopedia/records.ts';
import {ASTRA_ROOT,sha,stable,key,makeName,eligibleAstraRow,normalizeAstraValues,resolveAstraModel,planAstraModel} from './astra-bridge.mjs';

const parallel=async(items,run,limit=4)=>{let cursor=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{for(;;){const i=cursor++;if(i>=items.length)return;await run(items[i],i);}}));};
const identity=manifest=>manifest.models.map(m=>[m.id,m.revision,m.key]).sort(([a],[b])=>a.localeCompare(b));
const increment=(counts,key,n=1)=>counts[key]=(counts[key]||0)+n;
const assertNoPrivateFields=value=>{
 if(!value||typeof value!=='object')return;
 for(const [key,item] of Object.entries(value)){
  if(/^(?:vin|vehicleidentificationnumber|vehicleidentificationnumbervehicle|holdername|holderaddress|ownername|owneraddress)$/i.test(key))throw Error('private_vehicle_fields_not_allowed');
  assertNoPrivateFields(item);
 }
};
async function scanDetailFile(directory,file,onRow){
 if(typeof file.path!=='string'||path.isAbsolute(file.path)||file.path.split(/[\\/]/).some(s=>s==='..'||!s)||!/^[a-f0-9]{64}$/.test(file.sha256)||!(file.bytes>0))throw Error('invalid_astra_detail_part');
 const resolved=path.resolve(directory,file.path);if(!resolved.startsWith(directory+path.sep))throw Error('invalid_astra_detail_part_path');
 const checksum=createHash('sha256');let bytes=0,count=0;
 const stream=createReadStream(resolved);stream.on('data',chunk=>{checksum.update(chunk);bytes+=chunk.length;});
 const compressed=file.path.endsWith('.gz')||String(file.format||'').includes('gzip');
 const input=compressed?stream.pipe(createGunzip()):stream;
 if(compressed)stream.on('error',error=>input.destroy(error));
 const reader=readline.createInterface({input,crlfDelay:Infinity});
 for await(const line of reader){if(!line.trim())continue;const row=JSON.parse(line);assertNoPrivateFields(row);await onRow(row);count++;}
 const expectedRows=file.rows??file.recordCount;
 if(checksum.digest('hex')!==file.sha256||bytes!==file.bytes||(expectedRows!==undefined&&count!==expectedRows))throw Error('astra_detail_checksum_or_count_mismatch');
 return {...file,rows:count};
}
export async function putImmutable(storage,key,value){
 const expected=sha(value),old=await storage.readJson(key,null);
 if(old){if(sha(old)!==expected)throw Error('immutable_object_conflict');return;}
 try{await storage.writeJson(key,value,{ifNoneMatch:'*'});}catch(error){
  const raced=await storage.readJson(key,null);if(!raced||sha(raced)!==expected)throw error;
 }
 const saved=await storage.readJson(key,null);if(!saved||sha(saved)!==expected)throw Error('immutable_object_readback_failed');
}
export async function readAstraCorpus(manifestPath){
 const directory=path.dirname(path.resolve(manifestPath)),manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
 if(!manifest.files&&Array.isArray(manifest.shards))manifest.files=manifest.shards.map(s=>({...s,rows:s.recordCount}));
 if(Array.isArray(manifest.sources))manifest.sources=manifest.sources.map(s=>({...s,url:s.url||s.sourceUrl,sha256:s.sha256||s.sourceSha256,bytes:s.bytes||s.sourceBytes}));
 if(manifest.version!==1||!Array.isArray(manifest.files)||!manifest.files.length||!Array.isArray(manifest.sources)||!manifest.sources.length)throw Error('invalid_astra_corpus_manifest');
 if(manifest.complete===false||manifest.modelYearsInferred===true||manifest.individualVehicleIdentifiersIncluded===true||manifest.power30MinDerivedFromPeak===true)throw Error('unsafe_or_incomplete_astra_corpus');
 const sources=new Set();
 for(const source of manifest.sources){
  const url=new URL(source.url);
  if(url.protocol!=='https:'||url.hostname!=='opendata.astra.admin.ch'||!url.pathname.startsWith('/ivzod/')||!/^[a-f0-9]{64}$/.test(source.sha256)||!(source.bytes>0))throw Error('invalid_astra_source_manifest');
  sources.add(`${source.url}:${source.sha256}`);
 }
 const records=[],seen=new Map(),files=[],preRejectedReasons={},sourceDatasets={};let technicalRows=0,sourceRows=0;
 for(const file of manifest.files){
  if(typeof file.path!=='string'||path.isAbsolute(file.path)||file.path.split(/[\\/]/).some(s=>s==='..'||!s)||!/^[a-f0-9]{64}$/.test(file.sha256)||!(file.bytes>0))throw Error('invalid_astra_corpus_part');
  const resolved=path.resolve(directory,file.path);if(!resolved.startsWith(directory+path.sep))throw Error('invalid_astra_corpus_part_path');
  const checksum=createHash('sha256');let bytes=0,count=0;
  const stream=createReadStream(resolved);stream.on('data',chunk=>{checksum.update(chunk);bytes+=chunk.length;});
  const reader=readline.createInterface({input:stream,crlfDelay:Infinity});
  for await(const line of reader){
   if(!line.trim())continue;const row=JSON.parse(line);assertNoPrivateFields(row);const eligibility=eligibleAstraRow(row);
   if(!sources.has(`${row.sourceUrl}:${row.sourceSha256}`))throw Error('astra_row_source_not_in_manifest');
   const checksum=sha(row),old=seen.get(row.evidenceId);
   if(old&&old!==checksum)throw Error('astra_evidence_id_collision');
   increment(sourceDatasets,row.sourceDataset);
   if(!old){
    seen.set(row.evidenceId,checksum);
    if(eligibility.eligible){
     // Full technical extras are streamed to the immutable corpus below. Keep
     // only facts used for planning in memory; details never enter this array.
     const {additionalFacts,...compact}=row;records.push(compact);
    }else increment(preRejectedReasons,eligibility.reason);
   }else increment(preRejectedReasons,'duplicate_technical_evidence');
   count++;technicalRows++;sourceRows+=Number(row.sourceRows||1);
  }
  const expectedRows=file.rows??file.recordCount;
  if(checksum.digest('hex')!==file.sha256||bytes!==file.bytes||(expectedRows!==undefined&&count!==expectedRows))throw Error('astra_corpus_checksum_or_count_mismatch');
  files.push({path:file.path,sha256:file.sha256,bytes,rows:count});
 }
 if(manifest.technicalGroups!==undefined&&technicalRows!==manifest.technicalGroups||manifest.sourceRows!==undefined&&sourceRows!==manifest.sourceRows)throw Error('astra_corpus_denominator_mismatch');
 const detailFiles=[];let detailRows=0;
 for(const file of manifest.detailFiles||[]){
  const verified=await scanDetailFile(directory,file,row=>{
   if(row.parentEvidenceId){if(!seen.has(row.parentEvidenceId))throw Error('astra_detail_parent_missing');}
   else if(!row.parentApprovalCH&&!row.selectors&&!row.evidenceId)throw Error('astra_supplement_identity_missing');
   if(row.sourceUrl||row.sourceSha256){if(!sources.has(`${row.sourceUrl}:${row.sourceSha256}`))throw Error('astra_detail_source_not_in_manifest');}
  });detailFiles.push(verified);detailRows+=verified.rows;
 }
 const corpusDigest=sha({version:1,files,detailFiles,sources:manifest.sources});
 return {manifest:{...manifest,files,detailFiles},corpusDigest,records,directory,detailRows,inputRecords:technicalRows,uniqueRecords:seen.size,originalSourceRows:sourceRows,preRejectedReasons,sourceDatasets};
}
async function archiveCorpus(storage,corpus){
 const prefix=`${ASTRA_ROOT}/corpora/${corpus.corpusDigest}`,parts=[];let pending=[];
 const finish=async()=>{const results=await Promise.all(pending);pending=[];const failed=results.find(r=>r.error);if(failed)throw failed.error;};
 // Attach rejection handlers immediately, including when fewer than four
 // writes have been queued while the source stream is still being read.
 const enqueue=async(key,value)=>{pending.push(putImmutable(storage,key,value).then(()=>({ok:true}),error=>({error})));if(pending.length>=4)await finish();};
 let chunk=[],bytes=0,number=0;
 const flush=async()=>{
  if(!chunk.length)return;
  const part={version:1,records:chunk},digest=sha(part),key=`${prefix}/parts/${String(++number).padStart(6,'0')}.json`;
  const count=chunk.length;chunk=[];bytes=0;parts.push({key,sha256:digest,rows:count});await enqueue(key,part);
 };
 const appendCore=async row=>{
  const size=Buffer.byteLength(stable(row));if(chunk.length&&(chunk.length>=500||bytes+size>2*1024*1024))await flush();
  chunk.push(row);bytes+=size;
 };
 if(corpus.directory&&corpus.manifest.files?.length)for(const file of corpus.manifest.files)await scanDetailFile(corpus.directory,file,appendCore);
 else for(const row of corpus.records)await appendCore(row);
 await flush();
 await finish();
 const detailParts=[];let detailChunk=[],detailBytes=0,detailNumber=0;
 const flushDetails=async()=>{
  if(!detailChunk.length)return;
  const part={version:1,recordType:'astra-technical-details',records:detailChunk},digest=sha(part),key=`${prefix}/details/${String(++detailNumber).padStart(6,'0')}.json`;
  const count=detailChunk.length;detailChunk=[];detailBytes=0;detailParts.push({key,sha256:digest,rows:count});await enqueue(key,part);
 };
 for(const file of corpus.manifest.detailFiles||[])await scanDetailFile(corpus.directory,file,async row=>{
  const size=Buffer.byteLength(stable(row));if(detailChunk.length&&(detailChunk.length>=500||detailBytes+size>2*1024*1024))await flushDetails();detailChunk.push(row);detailBytes+=size;
 });
 await flushDetails();
 await finish();
 if(parts.reduce((n,p)=>n+p.rows,0)!==(corpus.inputRecords??corpus.records.length)||detailParts.reduce((n,p)=>n+p.rows,0)!==(corpus.detailRows||0))throw Error('astra_archived_denominator_mismatch');
 const descriptor={version:1,corpusDigest:corpus.corpusDigest,inputManifest:corpus.manifest,records:corpus.inputRecords??corpus.records.length,parts,detailRecords:corpus.detailRows||0,detailParts};
 await putImmutable(storage,`${prefix}/manifest.json`,descriptor);
 return descriptor;
}
/** Reuse the immutable verified corpus; no downloads or model discovery. */
export async function readStoredAstraCorpus(storage,corpusDigest){
 if(storage.driver!=='object'||!/^[a-f0-9]{64}$/.test(corpusDigest))throw Error('invalid_stored_astra_corpus');
 const prefix=`${ASTRA_ROOT}/corpora/${corpusDigest}`;
 const archive=await storage.readJson(`${prefix}/manifest.json`,null);
 if(!archive||archive.corpusDigest!==corpusDigest||!Array.isArray(archive.parts)||!archive.parts.length)throw Error('astra_archive_missing');
 const m=archive.inputManifest;
 if(!m||sha({version:1,files:m.files,detailFiles:m.detailFiles||[],sources:m.sources})!==corpusDigest)throw Error('astra_archive_digest');
 const records=[],seen=new Set();let inputRecords=0;
 for(const part of archive.parts){
  if(!new RegExp('^'+prefix+'/parts/[0-9]{6}\\.json$').test(part.key))throw Error('astra_archive_part_path');
  const value=await storage.readJson(part.key,null);
  if(!value||sha(value)!==part.sha256||value.records?.length!==part.rows)throw Error('astra_archive_part_checksum');
  inputRecords+=value.records.length;
  for(const row of value.records){assertNoPrivateFields(row);if(!seen.has(row.evidenceId)){seen.add(row.evidenceId);records.push(row);}}
 }
 if(inputRecords!==archive.records)throw Error('astra_archive_record_count');
 return {manifest:m,corpusDigest,records,inputRecords,uniqueRecords:records.length,detailRows:archive.detailRecords||0,verifiedStoredArchive:true};
}
export async function previewAstraImport({storage,corpus,reportDirectory='reports',at=new Date().toISOString(),annualOnly=false}){
 if(storage.driver!=='object')throw Error('durable_object_storage_required');
 const manifest=await storage.readJson(MANIFEST,null);if(!manifest?.models?.length)throw Error('encyclopedia_missing');
 const context={corpusDigest:corpus.corpusDigest,at,checkedAt:at.slice(0,10),annualOnly},groups=new Map(),rejected={...corpus.preRejectedReasons},datasets={...corpus.sourceDatasets},resolutionCache=new Map();
 const makePools=new Map();for(const summary of manifest.models){const name=key(makeName(summary.make));if(!makePools.has(name))makePools.set(name,[]);makePools.get(name).push(summary);}
 let eligible=0,assigned=0;
 for(const row of corpus.records){
  if(!corpus.sourceDatasets)increment(datasets,row.sourceDataset);
  const eligibility=eligibleAstraRow(row);if(!eligibility.eligible){increment(rejected,eligibility.reason);continue;}eligible++;
  const nameKey=JSON.stringify([row.facts.make,row.facts.commercialName]);let match=resolutionCache.get(nameKey);
  if(!match){match=resolveAstraModel(row,makePools.get(key(makeName(row.facts.make)))||[]);resolutionCache.set(nameKey,match);}if(match.reason){increment(rejected,match.reason);continue;}
  if(annualOnly&&match.create){increment(rejected,'not_existing_model');continue;}
  assigned++;
  let group=groups.get(match.summary.id);if(!group){group={summary:match.summary,create:match.create,sources:[]};groups.set(match.summary.id,group);}
  group.sources.push({row,sourceSuffix:match.sourceSuffix,groupingAliasOnly:match.groupingAliasOnly===true,values:normalizeAstraValues(row)});
 }
 if(!corpus.verifiedStoredArchive)await archiveCorpus(storage,corpus);
 await fs.mkdir(reportDirectory,{recursive:true});
 const planDirectory=await fs.mkdtemp(path.join(path.resolve(reportDirectory),'astra-model-plans-')),plans=[];
 const sourceRecords=corpus.inputRecords??corpus.records.length;
 const counters={sourceRecords,uniqueTechnicalRecords:corpus.uniqueRecords??sourceRecords,detailRecords:corpus.detailRows||0,originalSourceRows:corpus.originalSourceRows??corpus.manifest.sourceRows??corpus.records.reduce((n,r)=>n+Number(r.sourceRows||1),0),eligibleSourceRecords:eligible,assignedSourceRecords:assigned,rejectedSourceRecords:sourceRecords-assigned,sourceDatasets:datasets,rejectedReasons:rejected,
  existingModelsTotal:manifest.models.length,existingVariantsTotal:manifest.models.reduce((n,m)=>n+(m.variants||0),0),targetedExistingAnnualVariants:0,targetModels:groups.size,newModels:0,changedExistingModels:0,newUnknownYearVariants:0,existingAnnualVariantsChanged:0,fieldsFilled:0,existingFieldsAttested:0,existingAnnualPower30Filled:0,heldExistingVariants:0,heldReasons:{}};
 await parallel([...groups.values()],async group=>{
  const before=group.create?null:await storage.readJson(group.summary.key,null);
  if(before&&(before.id!==group.summary.id||before.revision!==group.summary.revision))throw Error('encyclopedia_revision_mismatch');
  if(!group.create&&!before)throw Error('encyclopedia_record_missing');
  const current=before||{id:group.summary.id,make:group.summary.make,model:group.summary.model,photo:'',revision:'',variants:[],updatedAt:at};
  counters.targetedExistingAnnualVariants+=current.variants.filter(v=>Number.isInteger(v.year)).length;
  const result=planAstraModel(current,group.sources,context);
  for(const [reason,count] of Object.entries(result.held)){increment(counters.heldReasons,reason,count);counters.heldExistingVariants+=count;}
  if(!result.changes.length)return;
  const record={...result.record,...(before?{previousKey:group.summary.key}:{})};
  const counts={newUnknownYearVariants:0,existingAnnualVariantsChanged:0,fieldsFilled:0,existingFieldsAttested:0,existingAnnualPower30Filled:0};
  for(const change of result.changes){
   if(change.operation==='create_unknown_year')counts.newUnknownYearVariants++;
   else{counts.existingAnnualVariantsChanged++;counts.fieldsFilled+=change.filled.length;counts.existingFieldsAttested+=change.attested.length;counts.existingAnnualPower30Filled+=Number(change.filled.includes('power30MinKw'));}
  }
  for(const [name,count] of Object.entries(counts))counters[name]+=count;
  counters[group.create?'newModels':'changedExistingModels']++;
  const full={id:record.id,make:record.make,model:record.model,beforeRevision:before?.revision||null,beforeKey:group.summary.key||null,beforeChecksum:before?sha(before):null,
   record,recordChecksum:sha(record),changes:result.changes,assertions:result.assertions,counts};
  const compact={id:full.id,make:full.make,model:full.model,beforeRevision:full.beforeRevision,beforeKey:full.beforeKey,beforeChecksum:full.beforeChecksum,afterRevision:record.revision,recordChecksum:full.recordChecksum,planChecksum:sha(full),counts,assertions:full.assertions.length};
  await fs.writeFile(path.join(planDirectory,`${record.id}.json`),JSON.stringify(full));plans.push(compact);
 });
 plans.sort((a,b)=>a.id.localeCompare(b.id));
 if(sha(identity(await storage.readJson(MANIFEST,null)))!==sha(identity(manifest)))throw Error('encyclopedia_changed_during_astra_preview');
 const compact=plans;
 const planDigest=sha({version:1,corpusDigest:corpus.corpusDigest,plans:compact}),prefix=`${ASTRA_ROOT}/plans/${planDigest}`;
 await parallel(plans,async p=>{const local=path.join(planDirectory,`${p.id}.json`),full=JSON.parse(await fs.readFile(local,'utf8'));if(sha(full)!==p.planChecksum)throw Error('astra_local_plan_changed');await putImmutable(storage,`${prefix}/models/${p.id}.json`,full);await fs.unlink(local);});
 await fs.rm(planDirectory,{recursive:true});
 const descriptor={version:1,mode:'preview',createdAt:at,corpusDigest:corpus.corpusDigest,corpusManifestKey:`${ASTRA_ROOT}/corpora/${corpus.corpusDigest}/manifest.json`,planDigest,counters,
  models:compact.map(p=>({...p,planKey:`${prefix}/models/${p.id}.json`})),assertionsLocation:'Each immutable model plan contains exact annual calculation-index membership assertions; unknown-year imports are excluded.'};
 await putImmutable(storage,`${prefix}/manifest.json`,descriptor);
 await fs.mkdir(reportDirectory,{recursive:true});await fs.writeFile(path.join(reportDirectory,'astra-import-preview.json'),JSON.stringify(descriptor,null,2)+'\n');
 return descriptor;
}
export async function applyAstraImport({storage,planDigest,mutateManifest,reportDirectory='reports',onProgress=()=>{}}){
 if(storage.driver!=='object'||!/^[a-f0-9]{64}$/.test(planDigest))throw Error('reviewed_astra_plan_required');
 const prefix=`${ASTRA_ROOT}/plans/${planDigest}`,plan=await storage.readJson(`${prefix}/manifest.json`,null);
 if(plan?.version!==1||plan.planDigest!==planDigest)throw Error('astra_reviewed_plan_missing');
 const compact=plan.models.map(({planKey,...p})=>p);
 if(sha({version:1,corpusDigest:plan.corpusDigest,plans:compact})!==planDigest)throw Error('astra_plan_digest_mismatch');
 const report={version:1,mode:'apply',startedAt:new Date().toISOString(),planDigest,corpusDigest:plan.corpusDigest,counters:plan.counters,plannedModels:plan.models.length,savedModels:0,alreadySavedModels:0,batches:0,indexAssertions:0,status:'running'};
 await fs.mkdir(reportDirectory,{recursive:true});
 const save=async()=>fs.writeFile(path.join(reportDirectory,'astra-import-apply.json'),JSON.stringify(report,null,2)+'\n');
 await save();
 for(let offset=0;offset<plan.models.length;offset+=32){
  const descriptorBatch=plan.models.slice(offset,offset+32),batch=[];
  const liveBefore=await storage.readJson(MANIFEST,null);
  if(!liveBefore?.models?.length)throw Error('encyclopedia_missing');
  await parallel(descriptorBatch,async descriptor=>{
   if(descriptor.planKey!==`${prefix}/models/${descriptor.id}.json`)throw Error('astra_plan_key_invalid');
   const p=await storage.readJson(descriptor.planKey,null);
   if(!p||sha(p)!==descriptor.planChecksum||p.id!==descriptor.id||sha(p.record)!==descriptor.recordChecksum||p.record.revision!==descriptor.afterRevision||p.beforeRevision!==descriptor.beforeRevision||p.beforeChecksum!==descriptor.beforeChecksum)throw Error('astra_model_plan_invalid');
   const summary=liveBefore.models.find(m=>m.id===p.id);
   if(summary?.revision===p.record.revision){
    const readback=await storage.readJson(summary.key,null);if(sha(readback)!==p.recordChecksum)throw Error('astra_resumed_record_changed');report.alreadySavedModels++;report.indexAssertions+=p.assertions.length;return;
   }
   if((summary?.revision||null)!==p.beforeRevision)throw Error('concurrent_encyclopedia_edit');
   if(summary&&sha(await storage.readJson(summary.key,null))!==p.beforeChecksum)throw Error('astra_before_record_changed');
   const key=`${ROOT}/revisions/${p.id}/${p.record.revision}.json`;await putImmutable(storage,key,p.record);batch.push({...p,key});
  });
  if(batch.length){
   const replacements=new Map(batch.map(p=>[p.id,summarize(p.record,p.key)]));
   await mutateManifest(m=>{
    if(!m?.models?.length)throw Error('encyclopedia_missing');
    for(const p of batch){
     const live=m.models.find(s=>s.id===p.id);if((live?.revision||null)!==p.beforeRevision)throw Error('concurrent_encyclopedia_edit');
     if(!live&&m.models.some(s=>s.id!==p.id&&s.make===p.make&&s.model===p.model))throw Error('concurrent_encyclopedia_identity_creation');
    }
    const models=m.models.map(s=>replacements.get(s.id)||s);const existing=new Set(m.models.map(s=>s.id));
    for(const [id,replacement] of replacements)if(!existing.has(id))models.push(replacement);
    models.sort((a,b)=>`${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`,'ru'));
    return {...m,updatedAt:new Date().toISOString(),models};
   });
   const saved=await storage.readJson(MANIFEST,null);
   for(const p of batch){if(saved?.models.find(s=>s.id===p.id)?.revision!==p.record.revision)throw Error('astra_manifest_readback_failed');report.savedModels++;report.indexAssertions+=p.assertions.length;}
  }
  report.batches++;
  await putImmutable(storage,`${prefix}/checkpoints/${String(offset).padStart(8,'0')}.json`,{version:1,planDigest,offset,modelIds:descriptorBatch.map(p=>p.id),afterRevisions:descriptorBatch.map(p=>p.afterRevision)});
  await save();await onProgress({...report,counters:undefined});
 }
 report.status='completed';report.finishedAt=new Date().toISOString();
 await putImmutable(storage,`${prefix}/applied.json`,{version:1,planDigest,corpusDigest:plan.corpusDigest,models:plan.models.map(m=>({id:m.id,revision:m.afterRevision,checksum:m.recordChecksum})),counters:plan.counters});
 await save();return report;
}
async function main(){
 const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
 const mode=value('--mode')||'preview',storage=getJsonStorage(),reportDirectory=value('--reports')||'reports';
 if(mode==='replan'){
  const corpus=await readStoredAstraCorpus(storage,value('--corpus-digest'));
  const report=await previewAstraImport({storage,corpus,reportDirectory,annualOnly:true});
  console.log('ASTRA_IMPORT_PREVIEW',JSON.stringify({...report,models:undefined}));
 }else if(mode==='preview'){
  const input=value('--manifest');if(!input)throw Error('astra_corpus_manifest_required');
  const corpus=await readAstraCorpus(input),report=await previewAstraImport({storage,corpus,reportDirectory});
  console.log('ASTRA_IMPORT_PREVIEW',JSON.stringify({...report,models:undefined}));
 }else if(mode==='apply'){
  const report=await applyAstraImport({storage,planDigest:value('--expected-plan-digest'),mutateManifest:update=>mutateDataJson(MANIFEST,null,update),reportDirectory,onProgress:progress=>console.log('ASTRA_IMPORT_PROGRESS',JSON.stringify(progress))});
  console.log('ASTRA_IMPORT_SAVED',JSON.stringify(report));
 }else throw Error('invalid_astra_import_mode');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
