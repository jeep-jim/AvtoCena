import {numberFields,textFields,type ModelRecord,type Variant} from './schema';
// Explicit public projection: provenance and free-form internal notes never leave this boundary.
export function publicEncyclopediaRecord(record:ModelRecord):ModelRecord {
 return {id:record.id,make:record.make,model:record.model,photo:record.photo,photoMarket:record.photoMarket,revision:record.revision,updatedAt:record.updatedAt,variants:record.variants.map(v=>{
  const out:Variant={id:v.id,markets:[],status:v.status,observedCount:v.observedCount};
  for(const key of [...numberFields,...textFields])if(key!=='sourceUrl'&&key!=='notes'&&v[key]!==undefined)(out as any)[key]=v[key];
  if(v.astraIdentity)out.astraIdentity=Object.fromEntries(['approval','approvalCH','type','variant','version'].filter(k=>typeof (v.astraIdentity as any)[k]==='string').map(k=>[k,(v.astraIdentity as any)[k]]));
  const years=v.astraEvidence?.manufactureYears;
  if(Array.isArray(years))out.astraEvidence={manufactureYears:years.filter(Number.isInteger)};
  return out;
 })};
}
