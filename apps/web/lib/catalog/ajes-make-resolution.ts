import {canonicalCatalogBrand} from './brands';
/** Match display names against the supplier directory, preserving its exact names. */
export function resolveAjesMakeNames(selected:string,makes:Array<{make:string}>):string {
 const key=(value:string)=>canonicalCatalogBrand(value).normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu,'');
 const names=selected.split(',').flatMap(value=>{
  const matches=makes.filter(row=>key(row.make)===key(value)).map(row=>row.make);
  return matches.length?matches:[value];
 });
 const unique=[...new Set(names)];
 return unique.length<=20?unique.join(','):selected;
}
