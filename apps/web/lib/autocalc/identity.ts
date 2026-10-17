import {CATALOG_BRANDS,canonicalCatalogBrand} from '../catalog/brands';
const known = new Set(CATALOG_BRANDS.map(brand=>brand.name));
const makeAliases:Record<string,string>={'мерседес':'Mercedes-Benz','мерседес бенц':'Mercedes-Benz'};
export function autoCalcMake(value:string) {
 return makeAliases[value.trim().toLocaleLowerCase('ru-RU')] || canonicalCatalogBrand(value);
}
/** Longest known brand prefix; a numeric model such as Peugeot 2008 is preserved. */
export function splitAutoCalcIdentity(title:string) {
 const words=title.trim().split(/\s+/);
 for(let end=words.length;end>0;end--) {
  const make=autoCalcMake(words.slice(0,end).join(' '));
  if(known.has(make))return {make,model:words.slice(end).join(' ')};
 }
 return {make:'',model:title.trim()};
}
