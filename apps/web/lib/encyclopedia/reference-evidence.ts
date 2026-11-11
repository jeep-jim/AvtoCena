import {createHash} from 'node:crypto';

/** Internal immutable revision evidence, discarded by the public manual editor. */
export function retainedReferenceSources(record:any,v:any){
 const sources:Record<string,any>={};
 for(const e of v.referenceEvidence||[]){
  const {digest,...proof}=e;
  if(e.version!==1||!/^[a-f0-9]{64}$/.test(e.indexDigest||'')||createHash('sha256').update(JSON.stringify(proof)).digest('hex')!==digest)continue;
  const expected={modelId:record.id,variantId:v.id,make:record.make,model:record.model,year:v.year,trim:v.trim,generation:v.generation||'',chassisCode:v.chassisCode||'',engineCode:v.engineCode||''};
  if(JSON.stringify(e.identity)!==JSON.stringify(expected))continue;
  for(const [field,value] of Object.entries(e.values||{})){
   if(field==='power30MinKw'||JSON.stringify(v[field])!==JSON.stringify(value))continue;
   const origins=e.provenance?.[field];
   if(!Array.isArray(origins)||!origins.length||origins.some(s=>!s.modelId||!s.variantId||!s.revision||s.modelId===record.id&&s.variantId===v.id))continue;
   if(origins.some(s=>{
    if(!['manufacturer','official_registry','manual','owner_reference'].includes(s.kind))return true;
    return s.kind==='owner_reference'?!s.markets?.some((m:string)=>m==='china'||m==='europe'):!/^https?:\/\//.test(s.url||'');
   }))continue;
   // Conservatively retain the least privileged origin, never upgrade a mixed set.
   const source=origins.find(s=>s.kind==='owner_reference')||origins.find(s=>s.kind==='manual')||origins[0];
   sources[field]={...source,reusedFromIndex:e.indexDigest};
  }
 }
 return sources;
}
