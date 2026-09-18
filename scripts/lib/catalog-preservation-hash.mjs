import {createHash} from 'node:crypto';
/** Stable record digest without allocating a catalog-sized JSON string. */
export function hashCatalogRows(rows){
 const hash=createHash('sha256').update('[');let separator='';
 for(const row of [...rows].sort((a,b)=>a.id.localeCompare(b.id))){hash.update(separator).update(JSON.stringify(row));separator=',';}
 return hash.update(']').digest('hex');
}
