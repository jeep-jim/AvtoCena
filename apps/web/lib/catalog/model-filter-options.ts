import {canonicalCatalogBrand} from './brands';
import {matchesCatalogModel} from './model-filter';
import type {ModelSuggestion} from './model-suggestion-search';

// Navigation only: never use the family name as technical matching evidence.
export function filterModelName(value:string):string {
 const name=value.replace(/\s+/g,' ').trim();
 const suffix=/\s+(?:\([^)]*\)|AWD\b|FWD\b|RWD\b|[24]WD\b|4x[24]\b|Electric\b|Hybrid\b|Plug-in\b|PHEV\b|HEV\b|BEV\b|EV\b|N(?:\s+Line)?\b|Long\s+Range\b|Standard\s+Range\b|\d[.,]\d(?:\s|$))/i;
 const index=name.search(suffix);
 return index>0?name.slice(0,index).trim():name;
}
export function groupFilterModels(rows:ModelSuggestion[]):ModelSuggestion[]{
 const byBrand=new Map<string,ModelSuggestion[]>();
 for(const row of rows){const key=canonicalCatalogBrand(row.make);const list=byBrand.get(key)||[];list.push(row);byBrand.set(key,list);}
 const result:ModelSuggestion[]=[];
 for(const [make,list] of byBrand){
  const roots=[...new Set(list.map(row=>filterModelName(row.model)))].sort((a,b)=>a.length-b.length);
  const grouped=new Map<string,ModelSuggestion>();
  for(const row of list){
   const root=roots.find(name=>matchesCatalogModel(row.model,name,make))||row.model;
   const key=root.toLocaleLowerCase('ru-RU'),previous=grouped.get(key);
   grouped.set(key,{make,model:previous?.model||root,aliases:[...new Set([...(previous?.aliases||[]),row.model,...row.aliases])],related:previous?previous.related&&row.related:row.related});
  }
  result.push(...grouped.values());
 }
 return result;
}
