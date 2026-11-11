import {mechanicalRows,mechanicalKey,mechanicalValue} from '../../apps/web/lib/encyclopedia/compact.ts';
import {stable} from './astra-bridge.mjs';
const sourceGroups=new WeakMap();
function groupedSource(source,year){
 let years=sourceGroups.get(source);if(!years){years=new Map();sourceGroups.set(source,years);}
 if(!years.has(year)){const variants=source.variants.filter(v=>v.year===year),representatives=new Map();mechanicalRows(variants,representatives);years.set(year,{representatives,byId:new Map(variants.map(v=>[v.id,v]))});}
 return years.get(year);
}
/** A collapsed equipment trim may use another ID, but never another mechanic. */
export function assertPublicVariant(check,record,source){
 let variant=record.variants.find(v=>v.id===check.variantId),grouped=false,privateDescriptions=0;
 if(!variant&&source){
  if(source.id!==record.id||source.revision!==record.revision)throw Error('public_source_revision_mismatch');
  const original=source.variants.find(v=>v.id===check.variantId);
  if(!original||original.year!==check.year)throw Error('verified_source_variant_missing:'+check.variantId);
  for(const [field,value] of Object.entries(check.fields))if(stable(original[field])!==stable(value))throw Error('verified_source_field_mismatch:'+check.variantId+':'+field);
  const {representatives,byId}=groupedSource(source,check.year),representative=byId.get(representatives.get(original.id));
  if(!representative)throw Error('public_group_identity_unverified');
  const key=mechanicalKey(representative),candidates=record.variants.filter(v=>mechanicalKey(v)===key);
  if(candidates.length!==1)throw Error('public_mechanical_group_missing_or_ambiguous:'+check.variantId);
  variant=candidates[0];
  if(!byId.has(variant.id)||mechanicalKey(byId.get(variant.id))!==key||representatives.get(variant.id)!==representatives.get(original.id))throw Error('public_group_identity_unverified');
  grouped=true;
 }
 if(!variant||variant.year!==check.year)throw Error('public_variant_missing:'+check.variantId);
 for(const [field,value] of Object.entries(check.fields)){
  // Equipment labels are deliberately collapsed by the owner's new UI. Their
  // exact original value was checked above against the release-bound source.
  if(grouped&&field==='trim'){privateDescriptions++;continue;}
  if(grouped?stable(mechanicalValue(variant,field))!==stable(mechanicalValue({[field]:value},field)):stable(variant[field])!==stable(value))throw Error('public_field_mismatch:'+check.variantId+':'+field);
 }
 return {grouped,privateDescriptions};
}
