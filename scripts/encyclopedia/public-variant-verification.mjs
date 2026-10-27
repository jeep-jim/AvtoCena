import {mechanicalFields} from '../../apps/web/lib/encyclopedia/compact.ts';
import {stable} from './astra-bridge.mjs';
const signature=v=>stable(mechanicalFields.map(field=>v[field]??null));
/** A collapsed equipment trim may use another ID, but never another mechanic. */
export function assertPublicVariant(check,record,source){
 let variant=record.variants.find(v=>v.id===check.variantId),grouped=false,privateDescriptions=0;
 if(!variant&&source){
  if(source.id!==record.id||source.revision!==record.revision)throw Error('public_source_revision_mismatch');
  const original=source.variants.find(v=>v.id===check.variantId);
  if(!original||original.year!==check.year)throw Error('verified_source_variant_missing:'+check.variantId);
  for(const [field,value] of Object.entries(check.fields))if(stable(original[field])!==stable(value))throw Error('verified_source_field_mismatch:'+check.variantId+':'+field);
  const key=signature(original),candidates=record.variants.filter(v=>signature(v)===key);
  if(candidates.length!==1)throw Error('public_mechanical_group_missing_or_ambiguous:'+check.variantId);
  variant=candidates[0];
  if(!source.variants.some(v=>v.id===variant.id&&signature(v)===key))throw Error('public_group_identity_unverified');
  grouped=true;
 }
 if(!variant||variant.year!==check.year)throw Error('public_variant_missing:'+check.variantId);
 for(const [field,value] of Object.entries(check.fields)){
  // Equipment labels are deliberately collapsed by the owner's new UI. Their
  // exact original value was checked above against the release-bound source.
  if(grouped&&field==='trim'){privateDescriptions++;continue;}
  if(stable(variant[field])!==stable(value))throw Error('public_field_mismatch:'+check.variantId+':'+field);
 }
 return {grouped,privateDescriptions};
}
