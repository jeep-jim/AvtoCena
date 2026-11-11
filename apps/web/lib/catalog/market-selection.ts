import {filterSelections} from './filter-selections';
import {PUBLIC_CATALOG_MARKETS} from './runtime-config';
export function selectedCatalogMarkets(value:unknown){
 return filterSelections(value).filter(m=>m==='green'||PUBLIC_CATALOG_MARKETS.includes(m as any));
}
/** Only source-backed markets extend the inventory/encyclopedia picker. */
export function modelDirectoryMarkets(value:unknown,make:string,ajesChina=false){
 const selected=selectedCatalogMarkets(value);
 return selected.length?selected.filter(m=>m==='korea'||m==='japan'||(m==='china'&&ajesChina)):make?['korea','japan']:[];
}
export function marketSelectionUrl(url:URL,market:string){
 const next=new URL(url);next.searchParams.set('market',market==='green'?'japan':market);
 next.searchParams.delete('stock');next.searchParams.delete('source');
 if(market==='green')next.searchParams.set('stock','green');
 return next;
}
