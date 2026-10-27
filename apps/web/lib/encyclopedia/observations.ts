import {mechanicalFields} from './compact';
import type {Variant} from './schema';
/** A later observation must never reuse the ID of a reviewed or edited variant. */
export function appendMissingObservations(existing:Variant[],observed:Variant[]):Variant[]{
 const signature=(v:Variant)=>JSON.stringify(mechanicalFields.map(f=>v[f]??null));
 const ids=new Set(existing.map(v=>v.id)),keys=new Set(existing.map(signature));
 const additions=observed.filter(v=>{const key=signature(v);if(ids.has(v.id)||keys.has(key))return false;ids.add(v.id);keys.add(key);return true;});
 return [...existing,...additions];
}
