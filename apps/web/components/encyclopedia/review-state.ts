import {numberFields,textFields,type ModelRecord,type Variant} from '../../lib/encyclopedia/schema';

// Presentation only: applying saved parameters never waits for this review state.
export function encyclopediaReviewDisplay(stored:ModelRecord,applied:ModelRecord):ModelRecord {
 const originals=new Map(stored.variants.map(v=>[v.id,v]));
 return {...applied,variants:applied.variants.map(v=>{
  const original=originals.get(v.id);
  const updated=original&&[...numberFields,...textFields].some(field=>v[field]!==original[field]);
  return updated?{...v,status:'review' as const}:v;
 })};
}
export function variantReviewClass(v:Variant){return v.status==='verified'?'ac-ency-row-verified':v.status==='review'?'ac-ency-row-review':'';}
