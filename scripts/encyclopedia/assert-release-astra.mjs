import {compileAstraPower30Facts,astraPower30Key} from '../../apps/web/lib/encyclopedia/astra-power30.ts';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {MANIFEST,ROOT} from '../../apps/web/lib/encyclopedia/records.ts';
import {readCalculationIndex,factFields,token,checksum,modelKey} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {ASTRA_ROOT,sha,stable} from './astra-bridge.mjs';
import {validateBatch,planModelResearch,digest as researchDigest} from './research-batch.mjs';
import {assertResearchBatchMembership} from './release-batch-verification.mjs';

const descriptiveFields=new Set(['motorPeakKw','systemPowerKw','batteryKwh']);
// Literal Korean four-wheel-drive label, not a change to vehicle layout.
// Only a reviewed manufacturer assertion may translate an observed value;
// manual/ASTRA values and all other changes retain byte-for-byte protection.
function reviewedDriveTranslation(original,old,next,field){
 const proof=next.researchEvidence,identity=proof?.checkedIdentity;
 return field==='drive'&&old.drive==='4륜'&&next.drive==='awd'
  &&old.status==='observed'&&!old.manualEditedAt&&!old.astraEvidence
  &&proof?.source?.type==='manufacturer'&&proof.fields?.includes('drive')&&proof.values?.drive==='awd'
  &&identity?.make===original.make&&identity?.model===original.model&&identity?.year===old.year&&identity?.trim===old.trim;
}
// Corrections to unverified observed components must replay an exact reviewed
// batch against the actual parent row. Evidence labels alone cannot authorize
// a change. Registry/manual/certified fields keep their existing protections.
export function reviewedResearchCorrectionVerifier(batches){
 const required=new Map();
 for(const input of batches){
  const batch=validateBatch(input);
  if(required.has(batch.id))throw Error('required_research_duplicate_batch');
  required.set(batch.id,batch);
 }
 const allowed=new Set(['icePowerKw','fuel','powertrainKind']);
 return ({beforeRecord,afterRecord,before,after,field})=>{
  if(!allowed.has(field)||!before||!after||before.manualEditedAt||before.astraEvidence||before.astraIdentity||before.astraMatchEvidence
    ||!['observed','review'].includes(before.status))return false;
  const priorProofs=[...(before.researchEvidenceHistory||[]),before.researchEvidence,...(before.referenceEvidence||[])].filter(Boolean);
  if(priorProofs.some(p=>p.fields?.includes(field)||Object.hasOwn(p.values||{},field)))return false;
  const batch=required.get(after.researchEvidence?.batchId);
  const entry=batch?.entries.find(e=>e.modelId===beforeRecord.id&&e.variantId===before.id);
  if(!entry||entry.operation||entry.source.type!=='manufacturer'||! /^[a-f0-9]{64}$/.test(entry.source.sourceSha256||'')
    ||!entry.confirmedFields.includes(field)||!Object.hasOwn(entry.patch,field)
    ||entry.expectedDigest!==researchDigest(before)||beforeRecord.id!==afterRecord.id
    ||beforeRecord.make!==afterRecord.make||beforeRecord.model!==afterRecord.model)return false;
  const replay=planModelResearch(beforeRecord,[entry],batch,afterRecord.updatedAt);
  return replay.changes.length===1&&replay.skipped.length===0
    &&researchDigest(replay.record.variants.find(v=>v.id===before.id))===researchDigest(after);
 };
}
function reviewedCorrectionChain(original,old,descendants,field,verify){
 let beforeRecord=original,before=old;
 for(const step of descendants){
  const after=step.rows.get(old.id);
  if(!after)return false;
  if(stable(before[field])!==stable(after[field])&&!verify({beforeRecord,afterRecord:step.record,before,after,field}))return false;
  beforeRecord=step.record;before=after;
 }
 return true;
}
const parallel=async(items,run)=>{let cursor=0;await Promise.all(Array.from({length:Math.min(6,items.length)},async()=>{for(;;){const item=items[cursor++];if(!item)return;await run(item);}}));};

// A later ASTRA pass can replace its match summary while adding facts. Only an
// exact record checksum from a digest-verified, fully applied required plan is
// authorized to do so. Revision labels or self-asserted evidence are not proof.
export function assertAppliedAstraPlan(plan,applied,expectedPlanDigest){
 if(!plan||!applied||!Array.isArray(plan.models))throw Error('required_astra_release_data_missing');
 if(expectedPlanDigest!==undefined&&plan.planDigest!==expectedPlanDigest)throw Error('required_astra_requested_plan_missing');
 if(!/^[a-f0-9]{64}$/.test(plan.planDigest)||plan.version!==1||applied.version!==1||applied.planDigest!==plan.planDigest||applied.corpusDigest!==plan.corpusDigest)throw Error('required_astra_applied_plan_missing');
 if(new Set(plan.models.map(m=>m.id)).size!==plan.models.length)throw Error('required_astra_duplicate_model_identity');
 if(sha({version:1,corpusDigest:plan.corpusDigest,plans:plan.models.map(({planKey,...model})=>model)})!==plan.planDigest)throw Error('required_astra_plan_digest_mismatch');
 if(stable(applied.models)!==stable(plan.models.map(m=>({id:m.id,revision:m.afterRevision,checksum:m.recordChecksum}))))throw Error('required_astra_apply_incomplete');
 return plan.models;
}
export function appliedAstraRevisionVerifier(requiredPlans){
 const records=new Map(),verified=new WeakMap();
 for(const {plan,applied,expectedPlanDigest} of requiredPlans)for(const descriptor of assertAppliedAstraPlan(plan,applied,expectedPlanDigest)){
  const key=`${descriptor.id}:${descriptor.afterRevision}`,old=records.get(key);
  if(old&&old!==descriptor.recordChecksum)throw Error('required_astra_revision_checksum_conflict');
  records.set(key,descriptor.recordChecksum);
 }
 return record=>{
  // Cache by object, not by caller-controlled revision label.
  if(verified.has(record))return verified.get(record);
  const expected=records.get(`${record.id}:${record.revision}`),ok=Boolean(expected&&sha(record)===expected);
  verified.set(record,ok);return ok;
 };
}
function matchSummaryBoundToProof(record,variant){
 const match=variant?.astraMatchEvidence,proof=variant?.researchEvidence,source=proof?.source,identity=proof?.checkedIdentity;
 return match?.version===1&&Array.isArray(match.evidenceIds)&&match.evidenceIds.length>0
  &&match.evidenceIdsDigest===sha(match.evidenceIds)&&source?.type==='official_registry'
  &&match.corpusDigest===source.corpusDigest&&match.evidenceIdsDigest===source.evidenceIdsDigest
  &&proof.batchId===`astra-${match.corpusDigest}`&&identity?.make===record.make&&identity?.model===record.model
  &&identity?.year===variant.year&&identity?.trim===variant.trim;
}

// Later research creates immutable revisions. Require ancestry and preservation
// of prior values/proofs; exact required batches may correct only unverified
// observed components. ASTRA assertions are independently checked below.
export async function assertAstraRecordContinuation({original,current,readRecord,isAppliedAstraRevision=()=>false,isReviewedResearchCorrection=()=>false}){
 if(!current||!Array.isArray(current.variants))throw Error('astra_revision_record_missing');
 const key=record=>`${ROOT}/revisions/${original.id}/${record.revision}.json`;
 let cursor=current;const seen=new Set(),descendants=[];
 for(let depth=0;cursor?.revision!==original.revision;depth++){
  if(depth>=32||cursor?.id!==original.id||!new RegExp(`^${ROOT}/revisions/${original.id}/[a-zA-Z0-9-]+\\.json$`).test(cursor.previousKey||'')||seen.has(cursor.previousKey))throw Error('astra_revision_ancestry_invalid');
  descendants.push({record:cursor,rows:new Map(cursor.variants.map(v=>[v.id,v]))});
  seen.add(cursor.previousKey);const previous=await readRecord(cursor.previousKey);
  if(!previous||key(previous)!==cursor.previousKey)throw Error('astra_revision_ancestry_invalid');
  cursor=previous;
 }
 if(sha(cursor)!==sha(original))throw Error('astra_revision_ancestor_changed');
 descendants.reverse();
 for(const field of ['id','make','model'])if(current[field]!==original[field])throw Error('astra_revision_identity_changed');
 const rows=new Map(current.variants.map(v=>[v.id,v]));
 if(rows.size!==current.variants.length)throw Error('astra_revision_duplicate_variant');
 for(const old of original.variants){
  const next=rows.get(old.id);if(!next)throw Error('astra_revision_variant_removed');
  if(old.astraEvidence&&!Number.isInteger(old.year)){
   if(stable(old)!==stable(next))throw Error('astra_source_variant_changed');
   continue;
  }
  for(const [field,value] of Object.entries(old)){
   if(['notes','status','researchEvidence','researchEvidenceHistory'].includes(field))continue;
   if(field==='astraMatchEvidence'&&stable(value)!==stable(next[field])){
    let prior=old;
    for(const step of descendants){
     const variant=step.rows.get(old.id);
     if(!variant)throw Error('astra_revision_variant_removed');
     if(stable(prior.astraMatchEvidence)!==stable(variant.astraMatchEvidence)
       &&(!isAppliedAstraRevision(step.record)||!matchSummaryBoundToProof(step.record,variant)))
      throw Error(`astra_revision_match_summary_not_applied:${original.id}:${old.id}:${step.record.revision}`);
     prior=variant;
    }
    continue;
   }
   if(value!==null&&value!==''&&stable(value)!==stable(next[field])&&!reviewedDriveTranslation(original,old,next,field)
     &&!reviewedCorrectionChain(original,old,descendants,field,isReviewedResearchCorrection))throw Error(`astra_revision_existing_value_changed:${field}:${original.id}:${old.id}`);
  }
  if(old.status!==next.status&&!(old.status==='observed'&&next.status==='review'&&next.researchEvidence))throw Error('astra_revision_status_changed');
  if(old.notes&&!(next.notes||'').includes(old.notes))throw Error('astra_revision_notes_removed');
  const proofs=[...(next.researchEvidenceHistory||[]),next.researchEvidence].filter(Boolean);
  for(const proof of [...(old.researchEvidenceHistory||[]),old.researchEvidence].filter(Boolean))if(!proofs.some(p=>stable(p)===stable(proof)))throw Error('astra_revision_proof_removed');
 }
 return current;
}

/** The release must contain the exact saved plan and every promised annual fact. */
export async function assertAstraPlanMembership({index,plan,applied,manifest,readPlan,readRecord,expectedPlanDigest,isAppliedAstraRevision,isReviewedResearchCorrection}){
 if(!index||!plan||!applied||!Array.isArray(manifest?.models)||!Array.isArray(plan.models))throw Error('required_astra_release_data_missing');
 if(index.version!==1||!index.models||index.digest!==checksum(index.models))throw Error('required_astra_index_digest_invalid');
 if(expectedPlanDigest!==undefined&&plan.planDigest!==expectedPlanDigest)throw Error('required_astra_requested_plan_missing');
 if(!/^[a-f0-9]{64}$/.test(plan.planDigest)||plan.version!==1||applied.version!==1||applied.planDigest!==plan.planDigest||applied.corpusDigest!==plan.corpusDigest)throw Error('required_astra_applied_plan_missing');
 if(new Set(plan.models.map(m=>m.id)).size!==plan.models.length||new Set(manifest.models.map(m=>m.id)).size!==manifest.models.length)throw Error('required_astra_duplicate_model_identity');
 const compact=plan.models.map(({planKey,...model})=>model);
 if(sha({version:1,corpusDigest:plan.corpusDigest,plans:compact})!==plan.planDigest)throw Error('required_astra_plan_digest_mismatch');
 const expectedApplied=plan.models.map(m=>({id:m.id,revision:m.afterRevision,checksum:m.recordChecksum}));
 if(stable(applied.models)!==stable(expectedApplied))throw Error('required_astra_apply_incomplete');
 if(index.manifestDigest!==checksum(manifest.models.map(m=>[m.id,m.revision,m.key])))throw Error('astra_release_manifest_changed');
 const live=new Map(manifest.models.map(m=>[m.id,m]));
 const facts=new Map();
 for(const fact of Object.entries(index.models).filter(([key])=>!key.startsWith(astraPower30Key(''))).flatMap(([,rows])=>rows)){
  const identity=`${fact.modelId}:${fact.variantId}`;
  if(facts.has(identity))throw Error('required_astra_duplicate_fact_identity:'+identity);
  facts.set(identity,fact);
 }
 const calculationFields=new Set(factFields),seen=new Set();
 const report={plans:1,models:0,annualVariants:0,calculationFields:0,descriptiveFields:0,unknownYearVariantsOutsideIndex:0,annualChanges:[]};
 await parallel(plan.models,async descriptor=>{
  const active=live.get(descriptor.id);
  if(!active||active.revision!==descriptor.afterRevision&&!readRecord)throw Error('required_astra_revision_not_active:'+descriptor.id);
  if(active.key!==`${ROOT}/revisions/${descriptor.id}/${active.revision}.json`)throw Error('required_astra_record_key_not_active:'+descriptor.id);
  if(descriptor.planKey!==`${ASTRA_ROOT}/plans/${plan.planDigest}/models/${descriptor.id}.json`)throw Error('required_astra_plan_key_invalid');
  const modelPlan=await readPlan(descriptor.planKey);
  if(!modelPlan||sha(modelPlan)!==descriptor.planChecksum||sha(modelPlan.record)!==descriptor.recordChecksum||modelPlan.id!==descriptor.id||modelPlan.record.id!==descriptor.id||modelPlan.record.revision!==descriptor.afterRevision)throw Error('required_astra_model_plan_changed');
  if(modelPlan.assertions.length!==descriptor.assertions)throw Error('required_astra_assertion_count_mismatch');
  const current=active.revision===descriptor.afterRevision?modelPlan.record:await assertAstraRecordContinuation({original:modelPlan.record,current:await readRecord(active.key),readRecord,isAppliedAstraRevision,isReviewedResearchCorrection});
  if(current.revision!==active.revision)throw Error('required_astra_record_key_not_active:'+descriptor.id);
  // Technical-only references cannot enter annual facts. If bundled, validate
  // their complete structure against the unchanged official source record.
  const technical=index.models[astraPower30Key(modelKey(current.make,current.model))];
  if(technical){
   const actual=technical.filter(f=>f.modelId===current.id).sort((a,b)=>a.variantId.localeCompare(b.variantId));
   const expected=compileAstraPower30Facts(current).sort((a,b)=>a.variantId.localeCompare(b.variantId));
   if(stable(actual)!==stable(expected))throw Error('astra_power30_reference_changed');
  }
  const variants=new Map(current.variants.map(v=>[v.id,v]));
  if(variants.size!==current.variants.length)throw Error('required_astra_duplicate_variant_identity');
  for(const variant of variants.values())if(variant.astraEvidence&&!Number.isInteger(variant.year)){
   if(facts.has(`${descriptor.id}:${variant.id}`))throw Error('unknown_astra_model_year_promoted');
   report.unknownYearVariantsOutsideIndex++;
  }
  for(const assertion of modelPlan.assertions){
   const identity=`${assertion.modelId}:${assertion.variantId}`,fact=facts.get(identity),variant=variants.get(assertion.variantId);
   if(seen.has(identity)||assertion.modelId!==descriptor.id||!Number.isInteger(assertion.year)||!fact||!variant||variant.year!==assertion.year||variant.trim!==assertion.trim||fact.revision!==active.revision||fact.year!==assertion.year||(token(assertion.trim)?!fact.trims.includes(token(assertion.trim)):fact.trims.length!==0))throw Error('required_astra_annual_variant_missing:'+identity);
   seen.add(identity);report.annualVariants++;
   report.annualChanges.push({modelId:descriptor.id,make:modelPlan.record.make,model:modelPlan.record.model,variantId:assertion.variantId,year:assertion.year,trim:assertion.trim,fields:assertion.fields,sourceUrl:assertion.sourceUrl});
   for(const [field,value] of Object.entries(assertion.fields)){
    if(stable(variant[field])!==stable(value))throw Error('required_astra_saved_field_missing:'+identity+':'+field);
    if(descriptiveFields.has(field)){
     report.descriptiveFields++;continue;
    }
    if(!calculationFields.has(field))throw Error('unsupported_astra_release_field:'+field);
    const source=fact.sources[field];
    if(stable(fact.values[field])!==stable(value)||source?.batchId!==assertion.batchId||source?.kind!=='official_registry'||source?.url!==assertion.sourceUrl)throw Error('required_astra_field_or_provenance_missing:'+identity+':'+field);
    report.calculationFields++;
   }
  }
  report.models++;
 });
 return report;
}

export async function verifyRequiredAstraRelease({storage,index,marker,readBatch=async path=>JSON.parse(await fs.readFile(path,'utf8'))}){
 const digests=marker.requiredAstraPlanDigests||[];
 if(!Array.isArray(digests)||digests.length>8||new Set(digests).size!==digests.length||digests.some(d=>!/^[a-f0-9]{64}$/.test(d)))throw Error('invalid_required_astra_plans');
 if(!digests.length)throw Error('required_astra_plans_missing');
 if(storage.driver!=='object')throw Error('durable_object_storage_required');
 const manifest=await storage.readJson(MANIFEST,null),reports=[],requiredPlans=[];
 for(const digest of digests){
  const prefix=`${ASTRA_ROOT}/plans/${digest}`;
  const plan=await storage.readJson(`${prefix}/manifest.json`,null),applied=await storage.readJson(`${prefix}/applied.json`,null);
  requiredPlans.push({plan,applied,expectedPlanDigest:digest});
 }
 const paths=marker.requiredResearchBatches||[];
 if(!Array.isArray(paths)||paths.length>64||new Set(paths).size!==paths.length)throw Error('invalid_required_batches');
 const batches=[];
 for(const path of paths){
  if(!/^docs\/encyclopedia\/batches\/[a-z0-9-]+\.json$/.test(path))throw Error('invalid_batch_path');
  batches.push(await readBatch(path));
 }
 // Independently bind authorization to the exact release index and provenance.
 assertResearchBatchMembership(index,batches,factFields,token);
 const isReviewedResearchCorrection=reviewedResearchCorrectionVerifier(batches);
 const isAppliedAstraRevision=appliedAstraRevisionVerifier(requiredPlans);
 for(const {plan,applied,expectedPlanDigest} of requiredPlans){
  const report=await assertAstraPlanMembership({index,plan,applied,manifest,readPlan:key=>storage.readJson(key,null),readRecord:key=>storage.readJson(key,null),expectedPlanDigest,isAppliedAstraRevision,isReviewedResearchCorrection});
  reports.push({planDigest:expectedPlanDigest,corpusDigest:plan.corpusDigest,...report});
 }
 if(checksum((await storage.readJson(MANIFEST,null)).models.map(m=>[m.id,m.revision,m.key]))!==index.manifestDigest)throw Error('astra_release_manifest_changed_after_verification');
 return {version:1,indexDigest:index.digest,manifestDigest:index.manifestDigest,verified:true,plans:reports};
}
async function main(){
 const marker=JSON.parse(await fs.readFile('.github/market-runs/regcloud-deploy.json','utf8'));
 const digests=marker.requiredAstraPlanDigests||[];
 if(Array.isArray(digests)&&!digests.length)return;
 const report=await verifyRequiredAstraRelease({storage:getJsonStorage(),index:readCalculationIndex(),marker});
 await fs.mkdir('reports',{recursive:true});
 await fs.writeFile('reports/astra-release-verification.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({stage:'required_astra_plans_verified',indexDigest:report.indexDigest,plans:report.plans}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
