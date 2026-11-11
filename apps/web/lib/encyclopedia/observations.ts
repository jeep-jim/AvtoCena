import {mechanicalFields} from './compact';
import type {Variant} from './schema';
/** A later observation must never reuse the ID of a reviewed or edited variant. */
export function appendMissingObservations(existing:Variant[],observed:Variant[]):Variant[]{
 const signature=(v:Variant)=>JSON.stringify(mechanicalFields.map(f=>v[f]??null));
 const ids=new Set(existing.map(v=>v.id)),keys=new Set(existing.map(signature));
 const additions=observed.filter(v=>{const key=signature(v);if(ids.has(v.id)||keys.has(key))return false;ids.add(v.id);keys.add(key);return true;});
 return [...existing,...additions];
}

/** Repair only our deterministic append/cleanup; retain superseded records for audit. */
export function compactObservationRepair(record:any,parent:any,ancestor?:any){
 const same=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b);
 const identity=(a:any,b:any)=>a&&b&&a.id===b.id&&a.make===b.make&&a.model===b.model;
 if(!record?.directorySnapshot||!record.previousKey||!identity(record,parent))return null;
 const appended=(child:any,original:any)=>{
  if(!identity(child,original)||!Array.isArray(original.variants)||!same(child.variants.slice(0,original.variants.length),original.variants))return null;
  const tail=child.variants.slice(original.variants.length);if(tail.some((v:any)=>v.status!=='observed'))return null;
  return appendMissingObservations(original.variants,tail);
 };
 if(!parent.directorySnapshot){
  const variants=appended(record,parent);if(!variants||variants.length===record.variants.length)return null;
  return {variants,previousKey:record.previousKey,removed:record.variants.length-variants.length,ancestryRepaired:false};
 }
 if(!ancestor||ancestor.directorySnapshot||!identity(parent,ancestor))return null;
 const variants=appended(parent,ancestor);if(!variants||variants.length===parent.variants.length||!same(record.variants,variants))return null;
 const shape=(r:any)=>Object.fromEntries(Object.entries(r).filter(([k])=>!['variants','revision','updatedAt','previousKey','supersededSnapshotKeys'].includes(k)).sort(([a],[b])=>a.localeCompare(b)));
 if(!same(shape(record),shape(parent)))return null;
 return {variants,previousKey:parent.previousKey,removed:0,ancestryRepaired:true};
}
