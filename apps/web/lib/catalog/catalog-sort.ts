export const catalogSortOptions = [
 {value:'auctionDateDesc',label:'Сначала недавно проданные',field:'auctionDate'},
 {value:'auctionDateAsc',label:'Сначала давно проданные',field:'auctionDate'},
 {value:'totalRub',label:'Сначала дешевле',field:'price'},
 {value:'totalRubDesc',label:'Сначала дороже',field:'price'},
 {value:'year',label:'Сначала новые',field:'year'},
 {value:'yearAsc',label:'Сначала старые',field:'year'},
 {value:'mileage',label:'Меньше пробег',field:'mileage'},
 {value:'mileageDesc',label:'Больше пробег',field:'mileage'},
] as const;
export type CatalogSortTerm=typeof catalogSortOptions[number]['value'];
export function parseCatalogSort(value:string|undefined):CatalogSortTerm[]|null{
 if(!value||value==='updatedAt')return [];
 const terms=value.split(',');const fields=new Set<string>();
 if(terms.length>4)return null;
 for(const term of terms){const option=catalogSortOptions.find(o=>o.value===term);if(!option||fields.has(option.field))return null;fields.add(option.field);}
 return terms as CatalogSortTerm[];
}
export function normalizedCatalogSort(value:string|undefined){return (parseCatalogSort(value)||[]).join(',');}
export function toggleCatalogSort(value:string,next:CatalogSortTerm){
 const terms=parseCatalogSort(value)||[];const option=catalogSortOptions.find(o=>o.value===next)!;
 const index=terms.findIndex(term=>catalogSortOptions.find(o=>o.value===term)!.field===option.field);
 if(index<0)terms.push(next);else if(terms[index]===next)terms.splice(index,1);else terms[index]=next;
 return terms.join(',');
}
export function sortNumber(value:unknown,zeroAllowed=false){if(value===null||value===undefined||value==='')return NaN;const n=Number(value);return Number.isFinite(n)&&(zeroAllowed?n>=0:n>0)?n:NaN;}
export function compareSortNumbers(a:number,b:number,term:CatalogSortTerm){
 if(!Number.isFinite(a))return Number.isFinite(b)?1:0;
 if(!Number.isFinite(b))return -1;
 return term==='auctionDateDesc'||term==='year'||term==='totalRubDesc'||term==='mileageDesc'?b-a:a-b;
}
export function compareCatalogTerms<T extends {year?:unknown;mileageKm?:unknown;auctionDate?:unknown}>(a:T,b:T,terms:CatalogSortTerm[],price:(row:T)=>number){
 for(const term of terms){const value=(row:T)=>term.startsWith('auctionDate')?Date.parse(String(row.auctionDate||'')):term.startsWith('totalRub')?sortNumber(price(row)):term.startsWith('mileage')?sortNumber(row.mileageKm,true):sortNumber(row.year);const delta=compareSortNumbers(value(a),value(b),term);if(delta)return delta;if(term.startsWith('totalRub')&&!Number.isFinite(value(a))&&!Number.isFinite(value(b))){const seller=compareSortNumbers(sortNumber((a as any).sellerPriceRub),sortNumber((b as any).sellerPriceRub),term);if(seller)return seller;}}
 return 0;
}
