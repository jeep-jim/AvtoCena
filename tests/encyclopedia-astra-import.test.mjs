import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {eligibleAstraRow,normalizeAstraValues,astraVariant,resolveAstraModel,planAstraExistingVariant,planAstraModel,sha,ASTRA_ROOT} from '../scripts/encyclopedia/astra-bridge.mjs';
import {readAstraCorpus,readStoredAstraCorpus,previewAstraImport,applyAstraImport} from '../scripts/encyclopedia/apply-astra-corpus.mjs';
import {MANIFEST,ROOT,summarize} from '../apps/web/lib/encyclopedia/records.ts';
import {compileModelFacts} from '../apps/web/lib/encyclopedia/calculation-index.ts';

const sourceUrl='https://opendata.astra.admin.ch/ivzod/3000-eDatenblatt/eDatenblatt.csv';
const sourceSha='a'.repeat(64),corpusDigest='b'.repeat(64),at='2026-10-23T12:00:00.000Z';
const context={corpusDigest,at,checkedAt:'2026-10-23'};
function evidence(overrides={}){
 const facts={make:'Toyota',commercialName:'Yaris',category:'M1',approval:'e6*2007/46*0437*01',type:'XPA1F(EU,M)',variant:'MXPH11(H)',version:'MXPH11L-AHXEBW',engineCode:'M15A',engineCc:'1490',icePowerKw:'68',motorPeakKw:'59',power30MinKw:'37',grossVehicleWeightKg:'1615',fuelCodeCH:'C',powerSemantics:'ice_and_electric_separate_no_system_power',...overrides.facts};
 const values={fuel:'hybrid',powertrainKind:'other_hybrid',engineCc:1490,engineCode:'M15A',icePowerKw:68,motorPeakKw:59,power30MinKw:37,drive:'fwd',transmission:'cvt',grossVehicleWeightKg:1615,...overrides.values};
 const base={sourceDataset:'edatenblatt',sourceUrl,sourceSha256:sourceSha,sourceRows:2,certified30Min:true,manufactureYears:[2021,2024],additionalFacts:{},sourceRecordIds:['approval-only'],...overrides,facts,values};
 return {...base,evidenceId:overrides.evidenceId||sha(base)};
}
const annual=extra=>({id:'annual-1',year:2023,trim:'1.5 Hybrid 115',status:'observed',markets:['europe'],observedCount:1,fuel:'hybrid',powertrainKind:'other_hybrid',engineCc:1490,engineCode:'M15A',drive:'fwd',transmission:'cvt',...extra});
const model=(variants=[annual()])=>({id:'1'.repeat(24),make:'Toyota',model:'Yaris',photo:'https://example.test/photo',revision:'original-revision',updatedAt:'2026-10-20T00:00:00Z',variants});
const candidate=(row,sourceSuffix='')=>({row,values:normalizeAstraValues(row),sourceSuffix});

test('ASTRA manufacturing years stay source evidence; unknown-year variants are excluded from calculation facts',()=>{
 const row=evidence(),variant=astraVariant(row,corpusDigest);
 assert.equal(variant.year,undefined);assert.equal(variant.chassisCode,undefined);
 assert.deepEqual(variant.astraEvidence.manufactureYears,[2021,2024]);
 assert.deepEqual(compileModelFacts(model([variant])),[]);
});
test('withheld decoder power is not restored from raw facts; no TARGA 30-minute inference',()=>{
 const row=evidence({values:{power30MinKw:undefined,icePowerKw:undefined,motorPeakKw:undefined,powerKw:undefined}});
 const values=normalizeAstraValues(row);
 for(const field of ['power30MinKw','icePowerKw','motorPeakKw','powerKw'])assert.equal(values[field],undefined);
 assert.equal(normalizeAstraValues(evidence({certified30Min:false})).power30MinKw,undefined);
 assert.equal(normalizeAstraValues(evidence({sourceDataset:'targa'})).power30MinKw,undefined);
 assert.equal(normalizeAstraValues(evidence({values:{transmission:'Одноступенчатый редуктор'}})).transmission,'Одноступенчатый редуктор');
 assert.equal(normalizeAstraValues(evidence({values:{power30MinKw:175,motorPeakKw:158},facts:{power30MinKw:'175'}})).power30MinKw,undefined);
});
test('category rules exclude buses, motorcycles, ambiguous vans and truck families',()=>{
 assert.equal(eligibleAstraRow(evidence()).eligible,true);
 for(const category of ['M2','M3','L3e','M1S',''])assert.equal(eligibleAstraRow(evidence({facts:{category}})).eligible,false);
 assert.equal(eligibleAstraRow(evidence({facts:{category:'N1',bodyworkCode:'BB',grossVehicleWeightKg:'3500'}})).eligible,true);
 assert.equal(eligibleAstraRow(evidence({facts:{category:'N1',bodyworkCode:'BB',grossVehicleWeightKg:'3501'}})).eligible,false);
 assert.equal(eligibleAstraRow(evidence({facts:{category:'N1',bodyworkCode:'BA',grossVehicleWeightKg:'3000'}})).eligible,false);
 assert.equal(eligibleAstraRow(evidence({facts:{commercialName:'Dutro 2.0'}})).eligible,false);
 assert.equal(eligibleAstraRow(evidence({facts:{commercialName:'N/A'}})).eligible,false);
});
test('named directory grouping preserves longer models and manufacturer designations without certifying them',()=>{
 const summaries=[{id:'p',make:'Toyota',model:'Prius'},{id:'pc',make:'Toyota',model:'Prius Prime'},{id:'nx',make:'Lexus',model:'NX'},{id:'glc',make:'Mercedes-Benz',model:'GLC Class'}];
 assert.equal(resolveAstraModel(evidence({facts:{commercialName:'Prius Prime Limited'}}),summaries).summary.id,'pc');
 assert.equal(resolveAstraModel(evidence({facts:{make:'LEXUS',commercialName:'NX450H+'}}),summaries).summary.id,'nx');
 assert.equal(resolveAstraModel(evidence({facts:{make:'MERCEDES BENZ',commercialName:'GLC220d4MATIC'}}),summaries).summary.id,'glc');
 assert.equal(resolveAstraModel(evidence({facts:{commercialName:'Priusx'}}),summaries).create,true);
 assert.equal(resolveAstraModel(evidence({facts:{make:'VW',commercialName:'GOLF GTI'}}),[{id:'golf',make:'Volkswagen',model:'Golf'}]).summary.id,'golf');
 assert.equal(resolveAstraModel(evidence({facts:{make:'AUDI',commercialName:'RS 6 Avant'}}),[{id:'rs6',make:'Audi',model:'RS6'}]).summary.id,'rs6');
 assert.equal(resolveAstraModel(evidence({facts:{make:'CITROEN',commercialName:'C4'}}),[{id:'c4',make:'Citroën',model:'C4'}]).summary.id,'c4');
 assert.equal(resolveAstraModel(evidence({facts:{make:'MAZDA',commercialName:'3'}}),[{id:'mazda3',make:'Mazda',model:'MAZDA3'}]).summary.id,'mazda3');
 assert.equal(resolveAstraModel(evidence({facts:{make:'Renault',commercialName:'Mégane II 1.6'}}),[{id:'megane',make:'Renault',model:'Megane'}]).summary.id,'megane');
 const plus=evidence({facts:{make:'LEXUS',commercialName:'450h+'}}),plain=evidence({facts:{make:'LEXUS',commercialName:'450h'}});
 assert.notEqual(resolveAstraModel(plus,[]).summary.id,resolveAstraModel(plain,[]).summary.id);
});
test('displacement, a generic trim, or a chassis-like type alone never proves an annual modification',()=>{
 const row=evidence(),v=annual({engineCode:undefined,chassisCode:'MXPH11(H)'});
 assert.equal(planAstraExistingVariant(model(),v,[candidate(row)],context).variant.power30MinKw,undefined);
 assert.equal(planAstraExistingVariant(model(),annual({drive:undefined}),[candidate(row)],context).reason,'no_exact_technical_match');
 assert.equal(planAstraExistingVariant(model(),annual({markets:['japan']}),[candidate(row)],context).variant.icePowerKw,68);
});
test('Swiss abbreviated and displacement-suffixed names group families without granting technical matches',()=>{
 const cases=[['Peugeot','ExpertTr. 2.0HDi','Expert'],['Skoda','SuperbC 2.0TDI4x4','Superb'],['BMW','740Ld xDrive','7 Series'],['MINI','3door Cooper S','Cooper'],['Citroen','C5 Airc.1.50 HDi','C5 Aircross'],['Land Rover','DiscoverySp.TD4','Discovery Sport'],['Volkswagen','PassatV 2.0TDI4M','Passat'],['Hyundai','Tucson1.6TGDIPHEV','Tucson'],['Audi','A8L 50 TDI','A8']];
 for(const [make,commercialName,canonical] of cases){
  const match=resolveAstraModel(evidence({facts:{make,commercialName}}),[{id:'canonical',make,model:canonical}]);
  assert.equal(match.summary?.id,'canonical',commercialName);assert.equal(match.groupingAliasOnly,true,commercialName);
 }
 const auris=resolveAstraModel(evidence({facts:{commercialName:'Auris 1.6'}}),[]);
 assert.equal(auris.summary.model,'Auris');assert.equal(auris.create,true);assert.equal(auris.groupingAliasOnly,true);
 const ix=resolveAstraModel(evidence({facts:{make:'BMW',commercialName:'iX xDrive60'}}),[]);assert.equal(ix.summary.model,'iX');
 const row=evidence(),source={...candidate(row),groupingAliasOnly:true};
 assert.equal(planAstraExistingVariant(model(),annual(),[source],context).variant.power30MinKw,undefined);
 assert.equal(planAstraExistingVariant(model(),annual({fuel:undefined,engineCc:undefined,engineCode:undefined,drive:undefined,transmission:undefined}),[source],context).reason,'no_exact_technical_match');
 const v=annual({astraIdentity:{approval:row.facts.approval,type:row.facts.type,variant:row.facts.variant,version:row.facts.version}});
 assert.equal(planAstraExistingVariant(model(),v,[source],context).variant.power30MinKw,37);
});
test('exact approval identity is cross-market; uncertified candidates and disagreements hold each affected field',()=>{
 const row=evidence(),v=annual({markets:['japan'],astraIdentity:{approval:row.facts.approval,type:row.facts.type,variant:row.facts.variant,version:row.facts.version}});
 const result=planAstraExistingVariant(model(),v,[candidate(row)],context);
 assert.equal(result.variant.power30MinKw,37);assert.equal(result.variant.year,2023);
 const missing=evidence({values:{power30MinKw:undefined},facts:{version:'another-version'}});
 const broad=planAstraExistingVariant(model(),annual(),[candidate(row),candidate(missing)],context);
 assert.equal(broad.variant.power30MinKw,undefined);
 const conflict=evidence({values:{power30MinKw:43},facts:{power30MinKw:'43',version:'another-version'}});
 assert.equal(planAstraExistingVariant(model(),annual(),[candidate(row),candidate(conflict)],context).variant.power30MinKw,undefined);
});
test('plausible siblings with incomplete mechanical identity remain in per-field consensus',()=>{
 const row=evidence(),incomplete=evidence({values:{drive:undefined,power30MinKw:undefined},facts:{version:'incomplete-version'}});
 const result=planAstraExistingVariant(model(),annual(),[candidate(row),candidate(incomplete)],context);
 assert.equal(result.candidateCount,2);assert.equal(result.variant.power30MinKw,undefined);
 assert.equal(planAstraExistingVariant(model(),annual(),[candidate(incomplete)],context).reason,'no_exact_technical_match');
});
test('a complete official modification prefix accepts equipment only with power and mechanical evidence',()=>{
 const record={...model(),make:'BMW',model:'X5'};
 const row=evidence({facts:{make:'BMW',commercialName:'X5 xDrive30d',engineCc:'2993',engineCode:'B57D30',powerSemantics:'ice_net'},values:{fuel:'diesel',powertrainKind:'combustion',engineCc:2993,engineCode:'B57D30',powerKw:195,icePowerKw:195,motorPeakKw:undefined,power30MinKw:undefined,drive:'awd',transmission:'automatic'}});
 const v=annual({trim:'xDrive30d xLine',engineCode:undefined,fuel:'diesel',powertrainKind:'combustion',engineCc:2993,powerKw:195,drive:'awd',transmission:'automatic'});
 const good=planAstraExistingVariant(record,v,[candidate(row,'xDrive30d')],context);
 assert.equal(good.variant.engineCode,'B57D30');assert.equal(good.variant.icePowerKw,195);
 for(const extra of [{powerKw:210},{drive:undefined}])assert.equal(planAstraExistingVariant(record,{...v,...extra},[candidate(row,'xDrive30d')],context).reason,'no_exact_technical_match');
 for(const markets of [['japan'],['china'],['korea'],['uae'],['georgia']]){const out=planAstraExistingVariant(record,{...v,trim:'Unrelated equipment',markets},[candidate(row,'xDrive30d')],context);assert.equal(out.variant.engineCode,'B57D30');assert.equal(out.variant.icePowerKw,195);}
 const hybrid=evidence({values:{powerKw:180}}),hybridV=annual({engineCode:undefined,trim:'450h Luxury',powerKw:180});
 assert.equal(planAstraExistingVariant(model(),hybridV,[candidate(hybrid,'450h+')],context).variant.power30MinKw,undefined);
});
test('manual values and research history survive; protected historical fields are never re-certified',()=>{
 const confirmation={batchId:'owner-old',source:{type:'owner_confirmed'},fields:['power30MinKw'],values:{power30MinKw:37}};
 const v=annual({power30MinKw:37,researchEvidenceHistory:[confirmation],researchEvidence:{batchId:'other',source:{type:'manufacturer'},fields:['drive'],values:{drive:'fwd'}}});
 const result=planAstraExistingVariant(model(),v,[candidate(evidence())],context);
 assert.equal(result.variant.power30MinKw,37);assert.equal(result.variant.researchEvidence.fields.includes('power30MinKw'),false);
 assert.deepEqual(result.variant.researchEvidenceHistory[0],confirmation);
 assert.equal(planAstraExistingVariant(model(),annual({status:'verified'}),[candidate(evidence())],context).reason,'manual_or_unknown_year');
});
test('matching numeric tolerance is not official evidence for a different stored value',()=>{
 const row=evidence({values:{powerKw:85}}),v=annual({powerKw:85.4});
 const result=planAstraExistingVariant(model(),v,[candidate(row)],context);
 assert.equal(result.variant.powerKw,85.4);assert.equal(result.variant.researchEvidence.fields.includes('powerKw'),false);
 assert.equal(result.variant.power30MinKw,37);
});
test('accepted official field provenance survives new missing fields and required batch membership',()=>{
 const old={batchId:'required-toyota-batch',source:{type:'official_registry',url:sourceUrl,certificationDocument:'explicit 27.4'},fields:['power30MinKw'],values:{power30MinKw:37},checkedIdentity:{make:'Toyota',model:'Yaris',year:2023,trim:'1.5 Hybrid 115'}};
 const v=annual({status:'review',power30MinKw:37,researchEvidenceHistory:[old],researchEvidence:{batchId:'manufacturer-body',source:{type:'manufacturer',url:'https://example.test/official'},fields:['bodyType'],values:{bodyType:'hatchback'}}});
 const result=planAstraExistingVariant(model(),v,[candidate(evidence())],context);
 assert.equal(result.variant.researchEvidence.fields.includes('power30MinKw'),false);
 assert.equal(compileModelFacts(model([result.variant]))[0].sources.power30MinKw.batchId,'required-toyota-batch');
 assert.equal(result.variant.motorPeakKw,59);assert.deepEqual(result.variant.researchEvidenceHistory[0],old);
});
test('import planning is missing-only and idempotent, with old power/history retained in compiled facts',()=>{
 const before=model([annual({powerKw:85})]),rows=[candidate(evidence())];
 const first=planAstraModel(before,rows,context);
 assert.equal(first.record.variants[0].powerKw,85);assert.equal(first.record.variants[0].power30MinKw,37);
 assert.equal(first.record.variants[1].year,undefined);
 const compiled=compileModelFacts(first.record);
 assert.equal(compiled.length,1);assert.equal(compiled[0].values.powerKw,85);assert.equal(compiled[0].values.power30MinKw,37);
 const again=planAstraModel(first.record,rows,context);assert.equal(again.changes.length,0);assert.deepEqual(again.record,first.record);
});
class Storage{
 driver='object';data=new Map();
 async readJson(key,fallback){return this.data.has(key)?structuredClone(this.data.get(key)):fallback;}
 async writeJson(key,value,condition){if(condition?.ifNoneMatch==='*'&&this.data.has(key))throw Error('conflict');this.data.set(key,structuredClone(value));}
}
async function fixture(){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'astra-import-test-')),storage=new Storage(),record=model();
 const key=`${ROOT}/revisions/${record.id}/${record.revision}.json`;
 await storage.writeJson(key,record);await storage.writeJson(MANIFEST,{version:1,capturedAt:at,generationId:'fixture',models:[summarize(record,key)],coverage:{},savedSearchRows:0,updatedAt:at});
 return {directory,storage,record};
}
test('JSONL source manifest verifies exact byte/hash/count and rejects private vehicle identifiers',async t=>{
 const f=await fixture();t.after(()=>fs.rm(f.directory,{recursive:true,force:true}));
 const row=evidence(),bytes=JSON.stringify(row)+'\n',file={path:'part.jsonl',sha256:createHash('sha256').update(bytes).digest('hex'),bytes:Buffer.byteLength(bytes),rows:1};
 await fs.writeFile(path.join(f.directory,file.path),bytes);
 const manifest={version:1,complete:true,sourceRows:2,technicalGroups:1,files:[file],sources:[{url:sourceUrl,sha256:sourceSha,bytes:100}]};
 const manifestPath=path.join(f.directory,'manifest.json');await fs.writeFile(manifestPath,JSON.stringify(manifest));
 assert.equal((await readAstraCorpus(manifestPath)).records.length,1);
 await fs.appendFile(path.join(f.directory,file.path),' ');await assert.rejects(readAstraCorpus(manifestPath),/checksum/);
 const privateRow={...row,additionalFacts:{VIN:'JTD12345678900000'}};await fs.writeFile(path.join(f.directory,file.path),JSON.stringify(privateRow)+'\n');
 await assert.rejects(readAstraCorpus(manifestPath),/private_vehicle_fields/);
});
test('preview archives immutable evidence without exposing revisions; apply, exact readback and resume work',async t=>{
 const f=await fixture();t.after(()=>fs.rm(f.directory,{recursive:true,force:true}));
 const corpus={corpusDigest,records:[evidence()],manifest:{version:1,sourceRows:2,files:[],sources:[]}};
 const before=await f.storage.readJson(MANIFEST,null);
 const plan=await previewAstraImport({storage:f.storage,corpus,reportDirectory:f.directory,at});
 assert.deepEqual(await f.storage.readJson(MANIFEST,null),before);
 assert.equal(plan.counters.newUnknownYearVariants,1);assert.equal(plan.counters.existingAnnualPower30Filled,1);
 assert.ok(await f.storage.readJson(`${ASTRA_ROOT}/corpora/${corpusDigest}/manifest.json`,null));
 const mutateManifest=async update=>f.storage.writeJson(MANIFEST,update(await f.storage.readJson(MANIFEST,null)));
 const first=await applyAstraImport({storage:f.storage,planDigest:plan.planDigest,mutateManifest,reportDirectory:f.directory});
 assert.equal(first.status,'completed');assert.equal(first.savedModels,1);
 const saved=await f.storage.readJson((await f.storage.readJson(MANIFEST,null)).models[0].key,null);
 assert.equal(saved.previousKey,before.models[0].key);assert.equal(saved.variants[0].power30MinKw,37);
 const second=await applyAstraImport({storage:f.storage,planDigest:plan.planDigest,mutateManifest,reportDirectory:f.directory});
 assert.equal(second.savedModels,0);assert.equal(second.alreadySavedModels,1);
 assert.deepEqual(saved,await f.storage.readJson((await f.storage.readJson(MANIFEST,null)).models[0].key,null));
});
test('a concurrent editor change blocks publication without overwriting the revised record',async t=>{
 const f=await fixture();t.after(()=>fs.rm(f.directory,{recursive:true,force:true}));
 const corpus={corpusDigest,records:[evidence()],manifest:{version:1,sourceRows:2,files:[],sources:[]}};
 const plan=await previewAstraImport({storage:f.storage,corpus,reportDirectory:f.directory,at});
 const live=await f.storage.readJson(MANIFEST,null);live.models[0].revision='manual-new';await f.storage.writeJson(MANIFEST,live);
 const mutateManifest=async update=>f.storage.writeJson(MANIFEST,update(await f.storage.readJson(MANIFEST,null)));
 await assert.rejects(applyAstraImport({storage:f.storage,planDigest:plan.planDigest,mutateManifest,reportDirectory:f.directory}),/concurrent_encyclopedia_edit/);
 assert.equal((await f.storage.readJson(MANIFEST,null)).models[0].revision,'manual-new');
});
test('bounded detail parts are authenticated and archived without promoting supplementary facts',async t=>{
 const f=await fixture();t.after(()=>fs.rm(f.directory,{recursive:true,force:true}));
 const row=evidence(),body=JSON.stringify(row)+'\n';
 const details=Array.from({length:1001},(_,i)=>JSON.stringify({evidenceId:sha(`detail-${i}`),parentEvidenceId:row.evidenceId,sourceUrl,sourceSha256:sourceSha,additionalFacts:{tyre:`225/${i}`},sourceRows:1})).join('\n')+'\n';
 await fs.writeFile(path.join(f.directory,'core.jsonl'),body);await fs.writeFile(path.join(f.directory,'details.jsonl'),details);
 const describe=(name,body,rows)=>({path:name,sha256:createHash('sha256').update(body).digest('hex'),bytes:Buffer.byteLength(body),rows});
 const manifest={version:1,complete:true,sourceRows:2,technicalGroups:1,files:[describe('core.jsonl',body,1)],detailFiles:[describe('details.jsonl',details,1001)],sources:[{url:sourceUrl,sha256:sourceSha,bytes:100}]};
 const manifestPath=path.join(f.directory,'manifest.json');await fs.writeFile(manifestPath,JSON.stringify(manifest));
 const corpus=await readAstraCorpus(manifestPath);assert.equal(corpus.records.length,1);assert.equal(corpus.detailRows,1001);assert.equal(corpus.details,undefined);
 const plan=await previewAstraImport({storage:f.storage,corpus,reportDirectory:f.directory,at});
 const archived=await f.storage.readJson(`${ASTRA_ROOT}/corpora/${corpus.corpusDigest}/manifest.json`,null);
 assert.equal(archived.detailRecords,1001);assert.equal(archived.detailParts.length,3);assert.equal(plan.counters.newUnknownYearVariants,1);
 await fs.appendFile(path.join(f.directory,'details.jsonl'),' ');await assert.rejects(readAstraCorpus(manifestPath),/detail_checksum/);
});
test('gzip details and excluded full core records are streamed, authenticated and completely archived',async t=>{
 const f=await fixture();t.after(()=>fs.rm(f.directory,{recursive:true,force:true}));
 const accepted=evidence({additionalFacts:{unmappedTechnical:'retain-me'},additionalFactsRef:{parentEvidenceId:'self',files:['details.jsonl.gz'],observations:2}}),excluded=evidence({facts:{category:'M3'},additionalFacts:{busDetail:'keep-in-corpus'}});
 const body=[accepted,excluded].map(r=>JSON.stringify(r)).join('\n')+'\n';
 const details=gzipSync(JSON.stringify({evidenceId:sha('detail-gz'),parentEvidenceId:accepted.evidenceId,sourceUrl,sourceSha256:sourceSha,additionalFacts:{tyre:'225/45'}})+'\n');
 const supplemental=JSON.stringify({evidenceId:sha('supplement'),parentApprovalCH:'1AA101',selectors:{version:'A'},sourceDataset:'tas_emissions',sourceUrl,sourceSha256:sourceSha,additionalFacts:{power30MinKw:999},relationship:'technical_reference_requires_exact_version_selection'})+'\n';
 await fs.writeFile(path.join(f.directory,'core.jsonl'),body);await fs.writeFile(path.join(f.directory,'details.jsonl.gz'),details);await fs.writeFile(path.join(f.directory,'supplement.jsonl'),supplemental);
 const describe=(name,body,rows)=>({path:name,sha256:createHash('sha256').update(body).digest('hex'),bytes:Buffer.byteLength(body),rows});
 const manifest={version:1,complete:true,sourceRows:4,technicalGroups:2,files:[describe('core.jsonl',body,2)],detailFiles:[describe('details.jsonl.gz',details,1),describe('supplement.jsonl',supplemental,1)],sources:[{url:sourceUrl,sha256:sourceSha,bytes:100}]};
 const manifestPath=path.join(f.directory,'manifest.json');await fs.writeFile(manifestPath,JSON.stringify(manifest));
 const corpus=await readAstraCorpus(manifestPath);assert.equal(corpus.records.length,1);assert.equal(corpus.records[0].additionalFacts,undefined);assert.equal(corpus.inputRecords,2);assert.equal(corpus.detailRows,2);
 const plan=await previewAstraImport({storage:f.storage,corpus,reportDirectory:f.directory,at});
 assert.equal(plan.counters.sourceRecords,2);assert.equal(plan.counters.assignedSourceRecords,1);assert.equal(plan.counters.rejectedSourceRecords,1);assert.equal(plan.counters.sourceDatasets.edatenblatt,2);
 const archived=await f.storage.readJson(`${ASTRA_ROOT}/corpora/${corpus.corpusDigest}/manifest.json`,null);
 assert.equal(archived.records,2);assert.equal(archived.detailRecords,2);
 const full=await f.storage.readJson(archived.parts[0].key,null);assert.equal(full.records[0].additionalFacts.unmappedTechnical,'retain-me');assert.equal(full.records[1].additionalFacts.busDetail,'keep-in-corpus');
 const modelPlan=await f.storage.readJson(plan.models[0].planKey,null);assert.equal(modelPlan.record.variants[0].power30MinKw,37);assert.equal(modelPlan.record.variants[1].astraEvidence.additionalFactsRefs[0].files[0],'details.jsonl.gz');
});
test('an interrupted multi-batch publication resumes from exact revisions without duplicates',async t=>{
 const f=await fixture();t.after(()=>fs.rm(f.directory,{recursive:true,force:true}));
 const records=Array.from({length:40},(_,i)=>evidence({facts:{commercialName:`Astra fixture ${i}`}}));
 const corpus={corpusDigest,records,manifest:{version:1,sourceRows:80,files:[],sources:[]}};
 const plan=await previewAstraImport({storage:f.storage,corpus,reportDirectory:f.directory,at});
 assert.equal(plan.models.length,40);
 const mutateManifest=async update=>f.storage.writeJson(MANIFEST,update(await f.storage.readJson(MANIFEST,null)));
 await assert.rejects(applyAstraImport({storage:f.storage,planDigest:plan.planDigest,mutateManifest,reportDirectory:f.directory,onProgress:report=>{if(report.batches===1)throw Error('simulated_runner_stop');}}),/simulated_runner_stop/);
 assert.equal((await f.storage.readJson(MANIFEST,null)).models.length,33);
 const resumed=await applyAstraImport({storage:f.storage,planDigest:plan.planDigest,mutateManifest,reportDirectory:f.directory});
 assert.equal(resumed.savedModels,8);assert.equal(resumed.alreadySavedModels,32);assert.equal(resumed.status,'completed');
 const final=await f.storage.readJson(MANIFEST,null);assert.equal(final.models.length,41);assert.equal(new Set(final.models.map(m=>m.id)).size,41);
});

test('mechanical fallback retains ambiguous drive and incomplete output without guessing certification',()=>{
 const v=annual({markets:['japan'],trim:'Unknown grade',icePowerKw:68,drive:undefined,bodyType:'hatchback'});
 const a=evidence({values:{bodyType:'hatchback'}}),b=evidence({facts:{version:'awd'},values:{bodyType:'hatchback',drive:'awd'}});
 const result=planAstraExistingVariant(model(),v,[candidate(a),candidate(b)],context);
 assert.equal(result.variant.drive,undefined);assert.equal(result.variant.power30MinKw,undefined);
 assert.equal(result.variant.engineCc,1490);assert.equal(result.candidateCount,2);
 const partial=evidence({facts:{version:'partial'},values:{bodyType:'hatchback',drive:undefined}});
 assert.equal(planAstraExistingVariant(model(),v,[candidate(a),candidate(partial)],context).variant.drive,undefined);
});

test('stored corpus replan verifies every part and never creates models or unknown-year trims',async t=>{
 const f=await fixture();t.after(()=>fs.rm(f.directory,{recursive:true,force:true}));
 const manifest={version:1,sourceRows:2,files:[],detailFiles:[],sources:[]};
 const digest=sha({version:1,files:[],detailFiles:[],sources:[]});
 const corpus={corpusDigest:digest,records:[evidence()],manifest};
 await previewAstraImport({storage:f.storage,corpus,reportDirectory:f.directory,at});
 const stored=await readStoredAstraCorpus(f.storage,digest);
 assert.equal(stored.records.length,1);
 const plan=await previewAstraImport({storage:f.storage,corpus:stored,reportDirectory:f.directory,at,annualOnly:true});
 assert.equal(plan.counters.newModels,0);assert.equal(plan.counters.newUnknownYearVariants,0);
 assert.equal(plan.counters.existingAnnualVariantsChanged,1);
 const archive=await f.storage.readJson(`${ASTRA_ROOT}/corpora/${digest}/manifest.json`,null);
 const part=await f.storage.readJson(archive.parts[0].key,null);part.records[0].values.drive='awd';
 await f.storage.writeJson(archive.parts[0].key,part);
 await assert.rejects(readStoredAstraCorpus(f.storage,digest),/checksum/);
});

test('missing output or displacement is filled by consensus without requiring the missing field itself',()=>{
 const row=evidence(), v=annual({markets:['korea'],engineCode:undefined});
 const result=planAstraExistingVariant(model(),v,[candidate(row)],context);assert.equal(result.variant.icePowerKw,68);assert.equal(result.variant.power30MinKw,undefined);
 const other=evidence({facts:{version:'other'},values:{icePowerKw:80}});
 assert.equal(planAstraExistingVariant(model(),v,[candidate(row),candidate(other)],context).variant.icePowerKw,undefined);
 const sparse=evidence({facts:{version:'unknown'},values:{icePowerKw:undefined}});
 assert.equal(planAstraExistingVariant(model(),v,[candidate(row),candidate(sparse)],context).variant.icePowerKw,undefined);
});


test('dry annual technical identity needs no equipment name and never fabricates one',()=>{
 const v=annual({trim:undefined,markets:['japan'],engineCode:undefined,icePowerKw:undefined});
 const result=planAstraExistingVariant(model([v]),v,[candidate(evidence())],context);
 assert.ok(result.variant);assert.equal(result.variant.trim,undefined);
 assert.equal(result.variant.icePowerKw,68);assert.equal(result.variant.power30MinKw,undefined);
 assert.equal(result.variant.year,2023);
 const facts=compileModelFacts(model([result.variant]));
 assert.equal(facts.length,1);assert.deepEqual(facts[0].trims,[]);assert.equal(facts[0].values.icePowerKw,68);
 assert.equal(planAstraExistingVariant(model(),{...v,status:'verified'},[candidate(evidence())],context).reason,'manual_or_unknown_year');
 assert.equal(planAstraExistingVariant(model(),{...v,year:undefined},[candidate(evidence())],context).reason,'manual_or_unknown_year');
});
