import {canonicalCatalogBrand} from './brands';
import type {AjesResolvedMakes} from './ajes-query';
/** Match display names against the supplier directory, preserving its exact names. */
export function resolveAjesMakeNames(selected:string,makes:Array<{make:string}>):string {
 const key=(value:string)=>canonicalCatalogBrand(value).normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu,'');
 const names=selected.split(',').flatMap(value=>{
  const matches=makes.filter(row=>key(row.make)===key(value)).map(row=>row.make);
  return matches.length?matches:[value];
 });
 const unique=[...new Set(names)];
 return unique.join(',');
}

/** The user-choice bound does not limit observed spellings of those choices.
 * Keep the original selection as model-discovery context when the supplier
 * aliases need a separate internal descriptor; do not truncate their scope.
 */
export function resolveAjesMakeSelection(selected:string,makes:Array<{make:string}>):{make:string;resolvedMakes?:AjesResolvedMakes} {
 // Preserve an invalid public selection for the existing query validator.
 // Alias resolution must not collapse 21 choices into an accepted short list.
 if(selected.split(',').length>20)return {make:selected};
 const names=resolveAjesMakeNames(selected,makes).split(',');
 return names.length>20?{make:selected,resolvedMakes:{exact:names}}:{make:names.join(',')};
}
