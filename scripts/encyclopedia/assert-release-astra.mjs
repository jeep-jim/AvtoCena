import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {MANIFEST,ROOT} from '../../apps/web/lib/encyclopedia/records.ts';
import {readCalculationIndex,factFields,token,checksum} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {ASTRA_ROOT,sha,stable} from './astra-bridge.mjs';

const descriptiveFields=new Set(['motorPeakKw','systemPowerKw','batteryKwh']);
const parallel=async(items,run)=>{let cursor=0;await Promise.all(Array.from({length:Math.min(6,items.length)},async()=>{for(;;){const item=items[cursor++];if(!item)return;await run(item);}}));};

/** The release must contain the exact saved plan and every promised annual fact. */
export async function assertAstraPlanMembership({index,plan,applied,manifest,readPlan,expectedPlanDigest}){
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
 for(const fact of Object.values(index.models).flat()){
  const identity=`${fact.modelId}:${fact.variantId}`;
  if(facts.has(identity))throw Error('required_astra_duplicate_fact_identity:'+identity);
  facts.set(identity,fact);
 }
 const calculationFields=new Set(factFields),seen=new Set();
 const report={plans:1,models:0,annualVariants:0,calculationFields:0,descriptiveFields:0,unknownYearVariantsOutsideIndex:0};
 await parallel(plan.models,async descriptor=>{
  if(live.get(descriptor.id)?.revision!==descriptor.afterRevision)throw Error('required_astra_revision_not_active:'+descriptor.id);
  if(live.get(descriptor.id).key!==`${ROOT}/revisions/${descriptor.id}/${descriptor.afterRevision}.json`)throw Error('required_astra_record_key_not_active:'+descriptor.id);
  if(descriptor.planKey!==`${ASTRA_ROOT}/plans/${plan.planDigest}/models/${descriptor.id}.json`)throw Error('required_astra_plan_key_invalid');
  const modelPlan=await readPlan(descriptor.planKey);
  if(!modelPlan||sha(modelPlan)!==descriptor.planChecksum||sha(modelPlan.record)!==descriptor.recordChecksum||modelPlan.id!==descriptor.id||modelPlan.record.id!==descriptor.id||modelPlan.record.revision!==descriptor.afterRevision)throw Error('required_astra_model_plan_changed');
  if(modelPlan.assertions.length!==descriptor.assertions)throw Error('required_astra_assertion_count_mismatch');
  const variants=new Map(modelPlan.record.variants.map(v=>[v.id,v]));
  if(variants.size!==modelPlan.record.variants.length)throw Error('required_astra_duplicate_variant_identity');
  for(const variant of variants.values())if(variant.astraEvidence&&!Number.isInteger(variant.year)){
   if(facts.has(`${descriptor.id}:${variant.id}`))throw Error('unknown_astra_model_year_promoted');
   report.unknownYearVariantsOutsideIndex++;
  }
  for(const assertion of modelPlan.assertions){
   const identity=`${assertion.modelId}:${assertion.variantId}`,fact=facts.get(identity),variant=variants.get(assertion.variantId);
   if(seen.has(identity)||assertion.modelId!==descriptor.id||!Number.isInteger(assertion.year)||!fact||!variant||variant.year!==assertion.year||variant.trim!==assertion.trim||fact.revision!==descriptor.afterRevision||fact.year!==assertion.year||!fact.trims.includes(token(assertion.trim)))throw Error('required_astra_annual_variant_missing:'+identity);
   seen.add(identity);report.annualVariants++;
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

async function main(){
 const marker=JSON.parse(await fs.readFile('.github/market-runs/regcloud-deploy.json','utf8'));
 const digests=marker.requiredAstraPlanDigests||[];
 if(!Array.isArray(digests)||digests.length>8||new Set(digests).size!==digests.length||digests.some(d=>!/^[a-f0-9]{64}$/.test(d)))throw Error('invalid_required_astra_plans');
 if(!digests.length)return;
 const storage=getJsonStorage();if(storage.driver!=='object')throw Error('durable_object_storage_required');
 const index=readCalculationIndex(),manifest=await storage.readJson(MANIFEST,null),reports=[];
 for(const digest of digests){
  const prefix=`${ASTRA_ROOT}/plans/${digest}`;
  const plan=await storage.readJson(`${prefix}/manifest.json`,null),applied=await storage.readJson(`${prefix}/applied.json`,null);
  const report=await assertAstraPlanMembership({index,plan,applied,manifest,readPlan:key=>storage.readJson(key,null),expectedPlanDigest:digest});
  reports.push({planDigest:digest,corpusDigest:plan.corpusDigest,...report});
 }
 if(checksum((await storage.readJson(MANIFEST,null)).models.map(m=>[m.id,m.revision,m.key]))!==index.manifestDigest)throw Error('astra_release_manifest_changed_after_verification');
 await fs.mkdir('reports',{recursive:true});
 await fs.writeFile('reports/astra-release-verification.json',JSON.stringify({version:1,indexDigest:index.digest,manifestDigest:index.manifestDigest,verified:true,plans:reports},null,2)+'\n');
 console.log(JSON.stringify({stage:'required_astra_plans_verified',indexDigest:index.digest,plans:reports}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
