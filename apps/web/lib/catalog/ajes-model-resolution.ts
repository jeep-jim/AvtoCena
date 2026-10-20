import {matchesCatalogModel} from './model-filter';
import {modelSearchName} from './model-search-name';
/** Resolve a displayed family only against names actually present in the source directory.
 * Base names include their versions even when the source also has an exact base row. */
export function resolveAjesModelNames(selected:string,models:Array<{model:string}>,make?:unknown):string {
 const names=[...new Set(models.map(x=>x.model.trim()).filter(Boolean))];
 const key=(s:string)=>modelSearchName(make,s).normalize('NFKC').trim().toUpperCase().replace(/\s+/g,' ');
 const resolved=selected.split('|').flatMap(value=>{
  const target=key(value),exact=names.find(n=>key(n)===target);
  const family=names.filter(n=>matchesCatalogModel(n,value,make));
  return family.length?family:[value];
 });
 const unique=[...new Set(resolved)];
 // Keep the existing bounded SQL selection contract.
 return unique.length<=20?unique.join('|'):selected;
}

/** Large source families use a bounded prefix condition instead of dropping their members. */
export function resolveAjesModelSelection(selected:string,models:Array<{model:string}>,make?:unknown):{model?:string;modelFamilies?:string}{
 const expanded=resolveAjesModelNames(selected,models,make);
 if(expanded!==selected)return {model:expanded};
 const names=[...new Set(models.map(x=>x.model.trim()).filter(Boolean))];
 const key=(s:string)=>modelSearchName(make,s).normalize('NFKC').trim().toUpperCase().replace(/\s+/g,' ');
 const exact:string[]=[],families:string[]=[];
 for(const value of selected.split('|')){
  const target=key(value),match=names.find(n=>key(n)===target);
  if(match)exact.push(match);
  if(names.some(n=>key(n).startsWith(target+' ')))families.push(target);
  else if(!match)exact.push(value);
 }
 return {...(exact.length?{model:[...new Set(exact)].join('|')}:{}),...(families.length?{modelFamilies:[...new Set(families)].join('|')}:{})};
}
