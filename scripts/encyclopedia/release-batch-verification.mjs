// Descriptive encyclopedia fields do not have a value/source slot in the index.
// Their persistence is checked by the independent model readback, never claimed here.
const descriptiveFields=new Set(['motorPeakKw','systemPowerKw','batteryKwh']);
export function assertResearchBatchMembership(index,batches,factFields,token){
 const facts=new Map(Object.values(index.models).flat().map(f=>[`${f.modelId}:${f.variantId}`,f]));
 const calculationFields=new Set(factFields),variants=new Set();
 let fields=0,identityFields=0,descriptiveFieldsOutsideIndex=0;
 for(const b of batches)for(const e of b.entries){
  const fact=facts.get(`${e.modelId}:${e.variantId}`);
  if(!fact||fact.year!==e.year)throw Error('required_variant_missing:'+e.variantId);
  for(const field of e.confirmedFields){
   if(field==='trim'){
    if(!fact.trims.includes(token(e.patch.trim)))throw Error('required_trim_missing:'+e.variantId);
    identityFields++;continue;
   }
   if(field==='chassisCode'){
    if(!fact.constraints?.chassisCode||token(fact.constraints.chassisCode)!==token(e.patch.chassisCode))throw Error('required_identity_missing:'+e.variantId+':'+field);
    identityFields++;continue;
   }
   if(descriptiveFields.has(field)){descriptiveFieldsOutsideIndex++;continue;}
   if(!calculationFields.has(field))throw Error('unsupported_release_field:'+field);
   const source=fact.sources[field],expectedKind=e.source.type==='owner_confirmed'?'manual':e.source.type;
   if(JSON.stringify(fact.values[field])!==JSON.stringify(e.patch[field])||source?.batchId!==b.id||source.kind!==expectedKind||source.url!==e.source.url)throw Error('required_field_or_provenance_missing:'+e.variantId+':'+field);
   fields++;
  }
  variants.add(`${e.modelId}:${e.variantId}`);
 }
 return {batches:batches.length,variants:variants.size,fields,identityFields,descriptiveFieldsOutsideIndex};
}
