import {randomUUID} from 'node:crypto';
import {applyEncyclopediaCalculation,checksum,compileModelFacts,factFields,modelKey,type CalculationIndex} from './calculation-index';

const identity=(record:any,v:any)=>({modelId:record.id,variantId:v.id,make:record.make,model:record.model,year:v.year,trim:v.trim,
 generation:v.generation||'',chassisCode:v.chassisCode||'',engineCode:v.engineCode||''});
export const referenceIdentity=identity;
const empty=(value:any)=>value===undefined||value===null||value==='';

/** Existing variants only. Same matcher as the catalog; no source requests. */
export function planReferenceReuse(record:any,index:CalculationIndex,at=new Date().toISOString()){
 const changes:{variantId:string;fields:string[];evidenceFields:string[]}[]=[];
 // An editor may intentionally leave a field empty. Do not fill manually edited models.
 if(record.editedBy&&!['owner-authorized-encyclopedia-research','owner-authorized-reference-reuse'].includes(record.editedBy))return {record,changes};
 const key=modelKey(record.make,record.model),facts=index.models[key]||[];
 const currentFacts=compileModelFacts(record);
 const variants=record.variants.map((v:any)=>{
  if(v.status==='verified'||v.status==='review'&&!v.researchEvidence&&!v.referenceEvidence)return v;
  // The target's own partial observation is not a donor. All other possible
  // variants still participate in the existing unanimity/conflict checks.
  const donors=facts.filter(f=>f.modelId!==record.id||f.variantId!==v.id);
  const donorIndex={...index,models:{[key]:donors}};
  const matched:any=applyEncyclopediaCalculation({...v,make:record.make,model:record.model},donorIndex);
  const attestation=matched.operational?.encyclopediaCalculation;
  const fields=factFields.filter(f=>f!=='power30MinKw'&&empty(v[f])&&!empty(matched[f])&&attestation?.filledFields.includes(f));
  const confirmed=factFields.filter(f=>f!=='power30MinKw'&&!empty(matched[f])&&attestation?.provenance?.[f]?.length);
  const supported=currentFacts.find(f=>f.variantId===v.id)?.sources||{};
  const evidenceFields=confirmed.filter(f=>!supported[f]);
  // A previous transfer may have added power but left an already-present fuel
  // without its donor proof. Repair that evidence without changing the value.
  if(!fields.length&&!(v.referenceEvidence?.length&&evidenceFields.length))return v;
  const values=Object.fromEntries(confirmed.map(f=>[f,matched[f]]));
  const provenance=Object.fromEntries(confirmed.map(f=>[f,attestation.provenance[f]]));
  const next={...v,...Object.fromEntries(fields.map(f=>[f,matched[f]]))};
  // Keep source kinds: a saved observation never becomes a factory certificate.
  const proof={version:1,indexDigest:index.digest,checkedAt:at,identity:identity(record,next),values,provenance};
  next.referenceEvidence=[...(v.referenceEvidence||[]),{...proof,digest:checksum(proof)}];
  changes.push({variantId:v.id,fields,evidenceFields});
  return next;
 });
 return {record:changes.length?{...record,variants,revision:randomUUID(),updatedAt:at,editedBy:'owner-authorized-reference-reuse'}:record,changes};
}

/** A saved donor snapshot is usable only while every original fact is still
 * supported by the current records. Added recipient fields cannot become donors
 * during evidence repair; changed/missing facts stop the entire operation. */
export function revalidateReferenceDonorIndex(saved:CalculationIndex,current:CalculationIndex){
 if(saved.version!==1||saved.digest!==checksum(saved.models))throw Error('reference_donor_snapshot_invalid');
 const sourceUnchanged=(before:any,now:any)=>Boolean(before&&now&&before.kind===now.kind&&before.url===now.url&&before.batchId===now.batchId
  &&(before.markets||[]).every((market:string)=>now.markets?.includes(market)));
 for(const [key,facts] of Object.entries(saved.models))for(const before of facts){
  const now=current.models[key]?.find(f=>f.modelId===before.modelId&&f.variantId===before.variantId);
  if(!now||now.year!==before.year||before.trims.some(t=>!now.trims.includes(t))
   ||Object.entries(before.constraints).some(([f,v])=>JSON.stringify(now.constraints[f])!==JSON.stringify(v))
   ||Object.entries(before.values).some(([f,v])=>JSON.stringify(now.values[f as keyof typeof now.values])!==JSON.stringify(v)||!sourceUnchanged(before.sources[f as keyof typeof before.sources],now.sources[f as keyof typeof now.sources])))throw Error('reference_donor_snapshot_changed');
 }
 return saved;
}
