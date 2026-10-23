import {randomUUID} from 'node:crypto';
import {applyEncyclopediaCalculation,checksum,factFields,modelKey,type CalculationIndex} from './calculation-index';

const identity=(record:any,v:any)=>({modelId:record.id,variantId:v.id,make:record.make,model:record.model,year:v.year,trim:v.trim,
 generation:v.generation||'',chassisCode:v.chassisCode||'',engineCode:v.engineCode||''});
export const referenceIdentity=identity;
const empty=(value:any)=>value===undefined||value===null||value==='';

/** Existing variants only. Same matcher as the catalog; no source requests. */
export function planReferenceReuse(record:any,index:CalculationIndex,at=new Date().toISOString()){
 const changes:{variantId:string;fields:string[]}[]=[];
 // An editor may intentionally leave a field empty. Do not fill manually edited models.
 if(record.editedBy&&!['owner-authorized-encyclopedia-research','owner-authorized-reference-reuse'].includes(record.editedBy))return {record,changes};
 const key=modelKey(record.make,record.model),facts=index.models[key]||[];
 const variants=record.variants.map((v:any)=>{
  if(v.status==='verified'||v.status==='review'&&!v.researchEvidence&&!v.referenceEvidence)return v;
  // The target's own partial observation is not a donor. All other possible
  // variants still participate in the existing unanimity/conflict checks.
  const donors=facts.filter(f=>f.modelId!==record.id||f.variantId!==v.id);
  const donorIndex={...index,models:{[key]:donors}};
  const matched:any=applyEncyclopediaCalculation({...v,make:record.make,model:record.model},donorIndex);
  const attestation=matched.operational?.encyclopediaCalculation;
  const fields=factFields.filter(f=>f!=='power30MinKw'&&empty(v[f])&&!empty(matched[f])&&attestation?.filledFields.includes(f));
  if(!fields.length)return v;
  const values=Object.fromEntries(fields.map(f=>[f,matched[f]]));
  const provenance=Object.fromEntries(fields.map(f=>[f,attestation.provenance[f]]));
  const next={...v,...values};
  // Keep source kinds: a saved observation never becomes a factory certificate.
  const proof={version:1,indexDigest:index.digest,checkedAt:at,identity:identity(record,next),values,provenance};
  next.referenceEvidence=[...(v.referenceEvidence||[]),{...proof,digest:checksum(proof)}];
  changes.push({variantId:v.id,fields});
  return next;
 });
 return {record:changes.length?{...record,variants,revision:randomUUID(),updatedAt:at,editedBy:'owner-authorized-reference-reuse'}:record,changes};
}
