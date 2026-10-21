import {createHash,randomUUID} from 'node:crypto';
export const stable = value => JSON.stringify(value, (_,v)=>v && typeof v==='object' && !Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const digest = value => createHash('sha256').update(stable(value)).digest('hex');
const fields = new Set(['trim','bodyType','fuel','powertrainKind','transmission','drive','engineCode','engineCc','powerHp','powerKw','icePowerKw','motorPeakKw','systemPowerKw','batteryKwh','grossVehicleWeightKg','power30MinKw','frontMotor30MinKw','rearMotor30MinKw','motors30MinKw']);
const certified = new Set(['power30MinKw','frontMotor30MinKw','rearMotor30MinKw','motors30MinKw']);
export function validateBatch(batch){
 if(batch.version!==1||!/^research-[a-z0-9-]+$/.test(batch.id)||!Array.isArray(batch.entries)||!batch.entries.length||batch.entries.length>64)throw Error('invalid_batch');
 const ids=new Set();
 for(const e of batch.entries){
  const id=`${e.modelId}:${e.variantId}`;
  if(ids.has(id)||! /^[a-f0-9]{24}$/.test(e.modelId)||!e.variantId||! /^[a-f0-9]{64}$/.test(e.expectedDigest))throw Error('invalid_entry_identity');ids.add(id);
  if(!e.make||!e.model||!e.trim||!Number.isInteger(e.year)||e.year<1900||e.year>new Date().getUTCFullYear()+1)throw Error('missing_exact_identity');
  if(!e.source || !['manufacturer','official_registry'].includes(e.source.type)||!e.source.statement||e.source.statement.length>1200||!/^\d{4}-\d{2}-\d{2}$/.test(e.source.checkedAt))throw Error('missing_field_source');
  const url=new URL(e.source.url);if(url.protocol!=='https:'||url.username||url.password)throw Error('invalid_source_url');
  if(!e.patch||!Object.keys(e.patch).length)throw Error('empty_patch');
  for(const [field,value] of Object.entries(e.patch)){
   if(!fields.has(field)||!e.confirmedFields.includes(field))throw Error('unconfirmed_patch_field');
   if(typeof value==='number'&&(!Number.isFinite(value)||value<=0||value>50000))throw Error('invalid_value');
   if(typeof value!=='number'&&typeof value!=='string')throw Error('invalid_value');
   if(typeof value==='string'&&(!value.trim()||value.length>160||/\p{Script=Han}/u.test(value)))throw Error('untranslated_value');
   if(certified.has(field)&&(!e.source.certificationDocument||!e.source.statement.includes('30')))throw Error('certified_power_evidence_required');
  }
 }
 return batch;
}
/** Pure plan: all source assertions have been reviewed before this function. */
export function planModelResearch(current, entries, batch, at=new Date().toISOString()){
 const changes=[],skipped=[];const variants=current.variants.map(v=>{
  const e=entries.find(e=>e.variantId===v.id);if(!e)return v;
  const already=v.researchEvidence?.batchId===batch.id&&Object.entries(e.patch).every(([k,value])=>v[k]===value);
  if(already){skipped.push({variantId:v.id,reason:'already_applied'});return v;}
  if(e.make!==current.make||e.model!==current.model||e.year!==v.year||e.trim!==v.trim||digest(v)!==e.expectedDigest){skipped.push({variantId:v.id,reason:'changed_since_review'});return v;}
  const notes=[v.notes,`${e.source.checkedAt}: ${e.source.statement} Источник: ${e.source.url}`].filter(Boolean).join('\n');
  if(notes.length>2000){skipped.push({variantId:v.id,reason:'notes_limit_requires_review'});return v;}
  changes.push({variantId:v.id,fields:Object.keys(e.patch)});
  return {...v,...e.patch,status:'review',notes,researchEvidence:{batchId:batch.id,source:e.source,fields:e.confirmedFields,values:e.patch,originalTrim:v.trim,checkedIdentity:{make:current.make,model:current.model,year:v.year,trim:e.patch.trim||v.trim}}};
 });
 for(const e of entries)if(!current.variants.some(v=>v.id===e.variantId))skipped.push({variantId:e.variantId,reason:'variant_missing'});
 return {record:changes.length?{...current,variants,revision:randomUUID(),updatedAt:at,editedBy:'owner-authorized-encyclopedia-research'}:current,changes,skipped};
}
