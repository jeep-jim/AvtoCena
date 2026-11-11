import {compileAstraPower30Facts,astraPower30Key} from '../apps/web/lib/encyclopedia/astra-power30.ts';
import test from 'node:test';
import {planModelResearch,digest as researchDigest} from '../scripts/encyclopedia/research-batch.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {assertAstraPlanMembership,assertAstraRecordContinuation,appliedAstraRevisionVerifier,reviewedResearchCorrectionVerifier} from '../scripts/encyclopedia/assert-release-astra.mjs';
import {previewAstraImport,applyAstraImport} from '../scripts/encyclopedia/apply-astra-corpus.mjs';
import {ASTRA_ROOT,sha} from '../scripts/encyclopedia/astra-bridge.mjs';
import {MANIFEST,ROOT,summarize} from '../apps/web/lib/encyclopedia/records.ts';
import {compileModelFacts,checksum,modelKey} from '../apps/web/lib/encyclopedia/calculation-index.ts';

const at='2026-10-23T12:00:00.000Z';
const corpusDigest='b'.repeat(64);
const sourceUrl='https://opendata.astra.admin.ch/ivzod/3000-eDatenblatt/eDatenblatt.csv';
class MemoryStorage{
 driver='object';data=new Map();
 async readJson(key,fallback){return this.data.has(key)?structuredClone(this.data.get(key)):fallback;}
 async writeJson(key,value,condition){if(condition?.ifNoneMatch==='*'&&this.data.has(key))throw Error('conflict');this.data.set(key,structuredClone(value));}
}
function sourceEvidence(){
 const row={sourceDataset:'edatenblatt',sourceUrl,sourceSha256:'a'.repeat(64),sourceRows:2,certified30Min:true,
  manufactureYears:[2021,2024],sourceRecordIds:['official-approval'],additionalFacts:{},
  facts:{make:'Toyota',commercialName:'Yaris',category:'M1',approval:'e6*2007/46*0437*01',type:'XPA1F(EU,M)',variant:'MXPH11(H)',version:'MXPH11L-AHXEBW',engineCode:'M15A',engineCc:'1490',icePowerKw:'68',motorPeakKw:'59',power30MinKw:'37',fuelCodeCH:'C',powerSemantics:'ice_and_electric_separate_no_system_power'},
  values:{fuel:'hybrid',powertrainKind:'other_hybrid',engineCc:1490,engineCode:'M15A',icePowerKw:68,motorPeakKw:59,power30MinKw:37,drive:'fwd',transmission:'cvt',grossVehicleWeightKg:1615}};
 return {...row,evidenceId:sha(row)};
}
async function fixture(t,options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'astra-release-test-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const storage=new MemoryStorage();
 const original={id:'1'.repeat(24),make:'Toyota',model:'Yaris',revision:'before',updatedAt:at,variants:[
  {id:'annual-1',year:2023,trim:options.withoutTrim?undefined:'1.5 Hybrid 115',status:'observed',markets:['europe'],observedCount:1,
   fuel:'hybrid',powertrainKind:'other_hybrid',engineCc:1490,engineCode:'M15A',drive:'fwd',transmission:'cvt',powerKw:85}]};
 const key=`${ROOT}/revisions/${original.id}/${original.revision}.json`;
 await storage.writeJson(key,original);
 await storage.writeJson(MANIFEST,{version:1,capturedAt:at,updatedAt:at,generationId:'fixture',models:[summarize(original,key)],coverage:{},savedSearchRows:0});
 const corpus={corpusDigest,records:[sourceEvidence()],manifest:{version:1,sourceRows:2,files:[],sources:[]}};
 const plan=await previewAstraImport({storage,corpus,reportDirectory:directory,at});
 await applyAstraImport({storage,planDigest:plan.planDigest,reportDirectory:directory,
  mutateManifest:async update=>storage.writeJson(MANIFEST,update(await storage.readJson(MANIFEST,null)))});
 const manifest=await storage.readJson(MANIFEST,null);
 const saved=await storage.readJson(manifest.models[0].key,null);
 const applied=await storage.readJson(`${ASTRA_ROOT}/plans/${plan.planDigest}/applied.json`,null);
 const models={[modelKey(saved.make,saved.model)]:compileModelFacts(saved)};
 const index={version:1,createdAt:at,models,digest:checksum(models),manifestDigest:checksum(manifest.models.map(m=>[m.id,m.revision,m.key]))};
 return {directory,storage,saved,plan,applied,manifest,index,
  args(){return {index:structuredClone(this.index),plan:structuredClone(this.plan),applied:structuredClone(this.applied),manifest:structuredClone(this.manifest),expectedPlanDigest:this.plan.planDigest,readPlan:key=>this.storage.readJson(key,null)};}};
}
const resealIndex=args=>{args.index.digest=checksum(args.index.models);};
test('reviewed literal Korean AWD translation preserves meaning without allowing layout or manual changes',async()=>{
 const original={id:'1'.repeat(24),revision:'old',make:'Genesis',model:'GV80',variants:[{id:'v',year:2021,trim:'2.5 AWD',status:'observed',drive:'4륜'}]};
 const current={...structuredClone(original),revision:'new',previousKey:`${ROOT}/revisions/${original.id}/old.json`};
 current.variants[0]={...current.variants[0],status:'review',drive:'awd',researchEvidence:{source:{type:'manufacturer'},fields:['drive'],values:{drive:'awd'},checkedIdentity:{make:'Genesis',model:'GV80',year:2021,trim:'2.5 AWD'}}};
 const run=(o=original,c=current)=>assertAstraRecordContinuation({original:o,current:c,readRecord:async()=>structuredClone(o)});
 await run();
 for(const change of [v=>{v.drive='fwd';},v=>{v.drive='rwd';},v=>{delete v.researchEvidence;},v=>{v.researchEvidence.checkedIdentity.year=2022;},v=>{v.researchEvidence.source.type='observation';}]){
  const c=structuredClone(current);change(c.variants[0]);await assert.rejects(run(original,c),/existing_value_changed/);
 }
 const manual=structuredClone(original);manual.variants[0].manualEditedAt='2026-10-24';
 const c=structuredClone(current);c.variants[0].manualEditedAt='2026-10-24';await assert.rejects(run(manual,c),/existing_value_changed/);
});
const fact=args=>Object.values(args.index.models).flat()[0];
async function continuedArgs(f,change=()=>{}){
 const record=structuredClone(f.saved);
 record.previousKey=f.manifest.models[0].key;record.revision='later-research';record.updatedAt='2026-10-23T13:00:00Z';
 record.variants[0].bodyType='hatchback';change(record);
 const key=`${ROOT}/revisions/${record.id}/${record.revision}.json`;
 await f.storage.writeJson(key,record);
 const args=f.args();args.readRecord=key=>f.storage.readJson(key,null);
 args.manifest.models[0]=summarize(record,key);
 args.index.models={[modelKey(record.make,record.model)]:compileModelFacts(record)};
 args.index.digest=checksum(args.index.models);args.index.manifestDigest=checksum(args.manifest.models.map(m=>[m.id,m.revision,m.key]));
 return args;
}
test('later fill-only revision preserves the applied ASTRA plan and every source-only variant',async t=>{
 const f=await fixture(t),args=await continuedArgs(f);
 const report=await assertAstraPlanMembership(args);
 assert.equal(report.models,1);assert.equal(report.annualVariants,1);assert.equal(report.unknownYearVariantsOutsideIndex,1);
});
test('repeated ordinary factory fact retains the old registry proof and rejects forged index provenance',async t=>{
 const f=await fixture(t);
 const args=await continuedArgs(f,r=>{
  const v=r.variants[0];
  v.researchEvidenceHistory=[...(v.researchEvidenceHistory||[]),v.researchEvidence];
  v.researchEvidence={batchId:'research-repeated-drive',source:{type:'manufacturer',url:'https://example.test/factory'},fields:['drive'],values:{drive:v.drive},checkedIdentity:{make:r.make,model:r.model,year:v.year,trim:v.trim}};
 });
 assert.equal(fact(args).sources.drive.kind,'manufacturer');
 await assertAstraPlanMembership(args);
 for(const field of ['kind','url','batchId']){
  const changed={...args,index:structuredClone(args.index)};
  fact(changed).sources.drive[field]='forged';resealIndex(changed);
  await assert.rejects(assertAstraPlanMembership(changed),/field_or_provenance_missing/);
 }
 const certified=await continuedArgs(f,r=>{
  const v=r.variants[0];v.researchEvidenceHistory=[...(v.researchEvidenceHistory||[]),v.researchEvidence];
  v.researchEvidence={batchId:'research-repeat-certified',source:{type:'manufacturer',url:'https://example.test/certificate',certificationDocument:'30 minute'},fields:['power30MinKw'],values:{power30MinKw:v.power30MinKw},checkedIdentity:{make:r.make,model:r.model,year:v.year,trim:v.trim}};
 });
 await assert.rejects(assertAstraPlanMembership(certified),/field_or_provenance_missing/);
});
test('later revision cannot remove or alter old values, source-only rows, or ancestry',async t=>{
 const cases=[
  [r=>{r.variants[0].engineCc=1590;},/existing_value_changed/],
  [r=>{r.variants[0].manualEditedAt='changed';r.variants[0].trim='Different';},/existing_value_changed/],
  [r=>{r.variants=r.variants.filter(v=>!v.astraEvidence);},/variant_removed/],
  [r=>{r.variants.find(v=>v.astraEvidence).year=2024;},/source_variant_changed/],
  [r=>{r.previousKey=`${ROOT}/revisions/${r.id}/missing.json`;},/ancestry_invalid/],
  [r=>{r.previousKey=`${ROOT}/revisions/${r.id}/${r.revision}.json`;},/ancestry_invalid/],
 ];
 for(const [change,error] of cases){const f=await fixture(t);await assert.rejects(assertAstraPlanMembership(await continuedArgs(f,change)),error);}
});
test('continuation retains old research proofs and manual values even after new research',async()=>{
 const proof={batchId:'old',fields:['engineCc'],values:{engineCc:1490}};
 const original={id:'1'.repeat(24),revision:'old',make:'Toyota',model:'Yaris',variants:[{id:'v',year:2023,trim:'Hybrid',status:'review',engineCc:1490,manualEditedAt:'manual-date',researchEvidence:proof}]};
 const current={...structuredClone(original),revision:'new',previousKey:`${ROOT}/revisions/${original.id}/old.json`};
 current.variants[0]={...current.variants[0],bodyType:'hatchback',researchEvidenceHistory:[proof],researchEvidence:{batchId:'new',fields:['bodyType'],values:{bodyType:'hatchback'}}};
 const args={original,current,readRecord:async()=>structuredClone(original)};
 await assertAstraRecordContinuation(args);
 const missingProof=structuredClone(current);missingProof.variants[0].researchEvidenceHistory=[];
 await assert.rejects(assertAstraRecordContinuation({...args,current:missingProof}),/proof_removed/);
 const missingManual=structuredClone(current);delete missingManual.variants[0].manualEditedAt;
 await assert.rejects(assertAstraRecordContinuation({...args,current:missingManual}),/existing_value_changed/);
});
async function resealModelPlan(f,change){
 const p=await f.storage.readJson(f.plan.models[0].planKey,null);change(p);
 p.recordChecksum=sha(p.record);
 const descriptor=f.plan.models[0];descriptor.recordChecksum=sha(p.record);descriptor.planChecksum=sha(p);descriptor.assertions=p.assertions.length;
 f.plan.planDigest=sha({version:1,corpusDigest:f.plan.corpusDigest,plans:f.plan.models.map(({planKey,...m})=>m)});
 descriptor.planKey=`${ASTRA_ROOT}/plans/${f.plan.planDigest}/models/${descriptor.id}.json`;
 f.applied={...f.applied,planDigest:f.plan.planDigest,models:f.plan.models.map(m=>({id:m.id,revision:m.afterRevision,checksum:m.recordChecksum}))};
 await f.storage.writeJson(descriptor.planKey,p);
}

test('release accepts the exact applied preview and compiled annual facts, keeping source-only years outside the index',async t=>{
 const f=await fixture(t),report=await assertAstraPlanMembership(f.args());
 assert.equal(report.models,1);assert.equal(report.annualVariants,1);assert.equal(report.unknownYearVariantsOutsideIndex,1);
 assert.ok(report.calculationFields>0);assert.equal(report.descriptiveFields,1);
 assert.equal(f.saved.variants[0].power30MinKw,37);
 const rows=Object.values(f.index.models).flat();assert.equal(rows.length,1);
 assert.equal(rows[0].sources.power30MinKw.kind,'official_registry');
 assert.equal(rows[0].values.motorPeakKw,undefined);
});
test('an absent, wrong, or incomplete applied-plan receipt blocks release',async t=>{
 const f=await fixture(t);
 await assert.rejects(assertAstraPlanMembership({...f.args(),applied:null}),/release_data_missing/);
 for(const change of [{planDigest:'c'.repeat(64)},{corpusDigest:'c'.repeat(64)},{models:[]}]){
  const args=f.args();Object.assign(args.applied,change);
  await assert.rejects(assertAstraPlanMembership(args),/applied_plan_missing|apply_incomplete/);
 }
});
test('requested plan, signed plan contents and calculation-index digest must each match',async t=>{
 const f=await fixture(t);
 await assert.rejects(assertAstraPlanMembership({...f.args(),expectedPlanDigest:'c'.repeat(64)}),/requested_plan_missing/);
 const changed=f.args();changed.plan.models[0].recordChecksum='c'.repeat(64);
 await assert.rejects(assertAstraPlanMembership(changed),/plan_digest_mismatch/);
 const index=f.args();index.index.digest='c'.repeat(64);
 await assert.rejects(assertAstraPlanMembership(index),/index_digest_invalid/);
});
test('current manifest revision and immutable record pointer must identify the saved record',async t=>{
 const f=await fixture(t);
 for(const [change,error] of [[{revision:'manual-new'},/revision_not_active/],[{key:'wrong-record.json'},/record_key_not_active/]]){
  const args=f.args();Object.assign(args.manifest.models[0],change);
  args.index.manifestDigest=checksum(args.manifest.models.map(m=>[m.id,m.revision,m.key]));
  await assert.rejects(assertAstraPlanMembership(args),error);
 }
 const changed=f.args();changed.manifest.models[0].key='wrong-record.json';
 await assert.rejects(assertAstraPlanMembership(changed),/release_manifest_changed/);
});
test('missing or modified immutable model plans block release',async t=>{
 const f=await fixture(t);
 await assert.rejects(assertAstraPlanMembership({...f.args(),readPlan:async()=>null}),/model_plan_changed/);
 const model=await f.storage.readJson(f.plan.models[0].planKey,null);model.record.variants[0].power30MinKw=99;
 await assert.rejects(assertAstraPlanMembership({...f.args(),readPlan:async()=>model}),/model_plan_changed/);
});
test('missing annual fact or wrong year, trim or fact revision blocks release',async t=>{
 const f=await fixture(t),missing=f.args();missing.index.models={};resealIndex(missing);
 await assert.rejects(assertAstraPlanMembership(missing),/annual_variant_missing/);
 for(const change of [{year:2024},{trims:['wrong']},{revision:'older'}]){
  const args=f.args();Object.assign(fact(args),change);resealIndex(args);
  await assert.rejects(assertAstraPlanMembership(args),/annual_variant_missing/);
 }
});
test('correct numeric power without the exact official source, batch or kind does not pass',async t=>{
 const f=await fixture(t);
 for(const change of [{kind:'owner_reference'},{batchId:'another-batch'},{url:'https://example.test/other-source'}]){
  const args=f.args();Object.assign(fact(args).sources.power30MinKw,change);resealIndex(args);
  await assert.rejects(assertAstraPlanMembership(args),/field_or_provenance_missing/);
 }
 const args=f.args();fact(args).values.power30MinKw=43;resealIndex(args);
 await assert.rejects(assertAstraPlanMembership(args),/field_or_provenance_missing/);
});
test('an ASTRA source variant without a model year cannot be inserted into annual calculation facts',async t=>{
 const f=await fixture(t),args=f.args(),unknown=f.saved.variants.find(v=>v.astraEvidence);
 const promoted={...structuredClone(fact(args)),variantId:unknown.id,year:unknown.astraEvidence.manufactureYears[0]};
 Object.values(args.index.models)[0].push(promoted);resealIndex(args);
 await assert.rejects(assertAstraPlanMembership(args),/unknown_astra_model_year_promoted/);
});
test('unknown-year source variants from earlier ASTRA corpora also stay outside annual indexes',async t=>{
 const f=await fixture(t);await resealModelPlan(f,p=>{p.record.variants.find(v=>v.astraEvidence).astraEvidence.corpusDigest='c'.repeat(64);});
 const args=f.args(),unknown=f.saved.variants.find(v=>v.astraEvidence);
 Object.values(args.index.models)[0].push({...structuredClone(fact(args)),variantId:unknown.id,year:2024});resealIndex(args);
 await assert.rejects(assertAstraPlanMembership(args),/unknown_astra_model_year_promoted/);
});
test('duplicate fact identities cannot conceal a contradictory or missing record',async t=>{
 const f=await fixture(t),args=f.args();Object.values(args.index.models)[0].push(structuredClone(fact(args)));resealIndex(args);
 await assert.rejects(assertAstraPlanMembership(args),/duplicate_fact_identity/);
});
test('a self-consistent plan digest cannot excuse assertions that disagree with saved calculation or descriptive values',async t=>{
 for(const field of ['power30MinKw','motorPeakKw']){
  const f=await fixture(t);await resealModelPlan(f,p=>{p.record.variants[0][field]+=1;});
  await assert.rejects(assertAstraPlanMembership(f.args()),/saved_field_missing/);
 }
});
test('assertion model year must agree with the saved variant even if the index repeats the same wrong year',async t=>{
 const f=await fixture(t);await resealModelPlan(f,p=>{p.assertions[0].year=2024;});
 const args=f.args();fact(args).year=2024;resealIndex(args);
 await assert.rejects(assertAstraPlanMembership(args),/annual_variant_missing/);
});


test('release verifies unnamed annual technical facts by unchanged record identity',async t=>{
 const f=await fixture(t,{withoutTrim:true});
 assert.ok(f.plan.counters.existingAnnualVariantsChanged>0);
 const args=f.args(),report=await assertAstraPlanMembership(args);assert.equal(report.annualVariants,1);
 const changed=f.args();fact(changed).trims=['invented equipment'];resealIndex(changed);
 await assert.rejects(assertAstraPlanMembership(changed),/annual_variant_missing/);
});


test('a later applied ASTRA pass may update its match summary while old facts and proofs remain required',async t=>{
 const f=await fixture(t),row=sourceEvidence();
 row.values.bodyType='hatchback';delete row.evidenceId;row.evidenceId=sha(row);
 const second=await previewAstraImport({storage:f.storage,corpus:{corpusDigest:'c'.repeat(64),records:[row],manifest:{}},reportDirectory:f.directory,at:'2026-10-24T15:00:00Z',annualOnly:true});
 assert.equal(second.models.length,1);
 await applyAstraImport({storage:f.storage,planDigest:second.planDigest,reportDirectory:f.directory,
  mutateManifest:async update=>f.storage.writeJson(MANIFEST,update(await f.storage.readJson(MANIFEST,null)))});
 const receipt=await f.storage.readJson(`${ASTRA_ROOT}/plans/${second.planDigest}/applied.json`,null);
 const manifest=await f.storage.readJson(MANIFEST,null),current=await f.storage.readJson(manifest.models[0].key,null);
 assert.notDeepEqual(current.variants[0].astraMatchEvidence,f.saved.variants[0].astraMatchEvidence);
 const verifier=()=>appliedAstraRevisionVerifier([{plan:f.plan,applied:f.applied,expectedPlanDigest:f.plan.planDigest},{plan:second,applied:receipt,expectedPlanDigest:second.planDigest}]);
 const args=f.args();args.readRecord=key=>f.storage.readJson(key,null);args.manifest=manifest;
 args.index.models={[modelKey(current.make,current.model)]:compileModelFacts(current)};resealIndex(args);args.index.manifestDigest=checksum(manifest.models.map(m=>[m.id,m.revision,m.key]));
 await assert.rejects(assertAstraPlanMembership(args),/match_summary_not_applied/);
 args.isAppliedAstraRevision=verifier();
 const report=await assertAstraPlanMembership(args);assert.equal(report.annualVariants,1);
 await assertAstraPlanMembership({...args,plan:second,applied:receipt,expectedPlanDigest:second.planDigest});
 const later=structuredClone(current);later.previousKey=manifest.models[0].key;later.revision='later-research-after-second-astra';later.updatedAt='2026-10-24T16:00:00Z';
 await assertAstraRecordContinuation({original:f.saved,current:later,readRecord:args.readRecord,isAppliedAstraRevision:verifier()});
 const run=record=>assertAstraRecordContinuation({original:f.saved,current:record,readRecord:args.readRecord,isAppliedAstraRevision:verifier()});
 for(const mutate of [r=>{r.variants[0].astraMatchEvidence.evidenceIds[0]='forged';},r=>{r.variants[0].researchEvidenceHistory=[];},r=>{r.variants[0].icePowerKw=99;}]){
  const changed=structuredClone(current);mutate(changed);await assert.rejects(run(changed),/match_summary_not_applied|existing_value_changed|proof_removed/);
 }
 assert.throws(()=>appliedAstraRevisionVerifier([{plan:second,applied:{...receipt,models:[]},expectedPlanDigest:second.planDigest}]),/apply_incomplete/);
 const tampered=structuredClone(second);tampered.models[0].recordChecksum='e'.repeat(64);
 assert.throws(()=>appliedAstraRevisionVerifier([{plan:tampered,applied:receipt,expectedPlanDigest:second.planDigest}]),/plan_digest_mismatch/);
 const argsWrongSource=structuredClone(args.index);const fact=Object.values(argsWrongSource.models).flat()[0];fact.sources.icePowerKw.batchId='forged';argsWrongSource.digest=checksum(argsWrongSource.models);
 await assert.rejects(assertAstraPlanMembership({...args,index:argsWrongSource}),/field_or_provenance_missing/);
});

function correctionFixture(changeBefore=()=>{},patch={icePowerKw:195}){
 const original={id:'2'.repeat(24),revision:'observed',make:'Audi',model:'A6',variants:[{id:'annual-phev',year:2024,trim:'Avant PHEV',status:'observed',engineCc:1984,powerKw:270,icePowerKw:270,fuel:'petrol',powertrainKind:'combustion'}]};
 changeBefore(original.variants[0]);
 const entry={modelId:original.id,variantId:'annual-phev',make:'Audi',model:'A6',year:2024,trim:'Avant PHEV',expectedDigest:researchDigest(original.variants[0]),patch,confirmedFields:Object.keys(patch),source:{type:'manufacturer',url:'https://example.test/factory.pdf',sourceSha256:'a'.repeat(64),certificationDocument:'document',checkedAt:'2026-10-25',statement:'Factory confirms separate combustion component; 30-minute proof remains distinct.'}};
 const batch={version:1,id:'research-reviewed-component',entries:[entry]};
 const current=planModelResearch(original,[entry],batch,at).record;
 current.previousKey=`${ROOT}/revisions/${original.id}/observed.json`;
 const args={original,current,readRecord:async()=>structuredClone(original),isReviewedResearchCorrection:reviewedResearchCorrectionVerifier([batch])};
 return {original,current,batch,args};
}
test('exact required manufacturer batch corrects an unverified PHEV component and keeps total power',async()=>{
 const f=correctionFixture(()=>{},{icePowerKw:195,fuel:'hybrid',powertrainKind:'other_hybrid'});
 await assertAstraRecordContinuation(f.args);
 assert.equal(f.current.variants[0].powerKw,270);
 await assert.rejects(assertAstraRecordContinuation({...f.args,isReviewedResearchCorrection:undefined}),/existing_value_changed/);
 const later=structuredClone(f.current);later.revision='later-fill';later.previousKey=`${ROOT}/revisions/${f.original.id}/${f.current.revision}.json`;later.variants[0].bodyType='wagon';
 await assertAstraRecordContinuation({...f.args,current:later,readRecord:async k=>structuredClone(k.endsWith('/observed.json')?f.original:f.current)});
});
test('reviewed correction cannot excuse forged source, stale parent, unsupported fields or unrelated mutations',async()=>{
 for(const mutate of [
  f=>{f.batch.entries[0].expectedDigest='b'.repeat(64);},
  f=>{f.batch.entries[0].source.sourceSha256=undefined;},
  f=>{f.current.variants[0].researchEvidence.source.url='https://example.test/forged.pdf';},
  f=>{f.current.variants[0].powerKw=195;},
  f=>{f.current.variants[0].researchEvidence.values.icePowerKw=190;},
  f=>{f.current.variants[0].researchEvidence.checkedIdentity.year=2023;},
  f=>{f.current.variants[0].notes='forged';},
 ]){
  const f=correctionFixture();mutate(f);f.args.isReviewedResearchCorrection=reviewedResearchCorrectionVerifier([f.batch]);
  await assert.rejects(assertAstraRecordContinuation(f.args),/existing_value_changed/);
 }
 const certified=correctionFixture(v=>{v.power30MinKw=30;},{power30MinKw:40});certified.batch.entries[0].source.certificationDocument='document';certified.batch.entries[0].source.statement='30-minute document';
 await assert.rejects(assertAstraRecordContinuation(certified.args),/existing_value_changed/);
});
test('manual, registry, reusable or previously researched facts cannot be overwritten by correction batches',async()=>{
 for(const mutate of [v=>{v.manualEditedAt=at;},v=>{v.astraEvidence={};},v=>{v.astraIdentity={};},v=>{v.astraMatchEvidence={};},
  v=>{v.researchEvidence={fields:['icePowerKw'],values:{icePowerKw:270}};},
  v=>{v.researchEvidenceHistory=[{fields:['icePowerKw'],values:{icePowerKw:270}}];},
  v=>{v.referenceEvidence=[{values:{icePowerKw:270}}];}]){
  const f=correctionFixture(mutate);await assert.rejects(assertAstraRecordContinuation(f.args),/existing_value_changed/);
 }
});
test('every changed ancestry step requires its own exact reviewed parent, not final proof labels',async()=>{
 const f=correctionFixture(),middle=structuredClone(f.original);middle.revision='unreviewed';middle.previousKey=f.current.previousKey;middle.variants[0].icePowerKw=260;
 f.current.previousKey=`${ROOT}/revisions/${f.original.id}/unreviewed.json`;
 await assert.rejects(assertAstraRecordContinuation({...f.args,readRecord:async k=>structuredClone(k.endsWith('/observed.json')?f.original:middle)}),/existing_value_changed/);
});

test('continuation permission never changes the exact facts promised by an ASTRA plan',async t=>{
 const f=await fixture(t),args=await continuedArgs(f,r=>{r.variants[0].icePowerKw=195;});
 args.isReviewedResearchCorrection=()=>true;
 await assert.rejects(assertAstraPlanMembership(args),/saved_field_missing/);
});

test('separate source-only 30-minute references are verified without admitting a fake annual fact',async t=>{
 const f=await fixture(t),args=f.args(),key=astraPower30Key(modelKey(f.saved.make,f.saved.model));
 args.index.models[key]=compileAstraPower30Facts(f.saved);resealIndex(args);
 await assertAstraPlanMembership(args);
 args.index.models[key][0].values.power30MinKw=999;resealIndex(args);
 await assert.rejects(assertAstraPlanMembership(args),/astra_power30_reference_changed/);
});
